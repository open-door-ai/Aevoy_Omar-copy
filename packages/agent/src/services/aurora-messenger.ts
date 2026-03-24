/**
 * Aurora Messenger — Central delivery for ALL Aurora outbound communication
 *
 * Every outbound message (proactive, digest, response, alert) flows through here.
 *
 * Flow:
 * 1. ALWAYS insert into conversation_context (in-app feed — free)
 * 2. Check cost budget via cost-circuit-breaker
 * 3. If budget exceeded → only free channels (email, telegram, in-app)
 * 4. Select external channel based on: user preference, priority, cost, quiet hours
 * 5. Check quiet hours (10PM-7AM user local time) — queue for morning if not critical
 * 6. Send via selected channel using existing functions
 * 7. Track cost in daily_spend_tracking
 * 8. If priority high/critical and no response → schedule escalation
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { checkBudget, trackSpend, CHANNEL_COSTS } from "./cost-circuit-breaker.js";
import { getPreferredChannel } from "./channel-learner.js";
import { sendSms, callUser } from "./twilio.js";
import { sendResponse } from "./email.js";
import type { DeliveryChannel } from "./cost-circuit-breaker.js";
import { logger } from "../utils/logger.js";

// ---- Types ----

export interface AuroraMessage {
  userId: string;
  content: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  preferredChannel?: string;
  source: 'proactive' | 'response' | 'digest' | 'alert';
  proactiveQueueId?: string;
  /** Optional subject for email delivery */
  emailSubject?: string;
}

export interface DeliveryResult {
  delivered: boolean;
  channel: DeliveryChannel;
  queued: boolean;
  reason?: string;
}

// ---- Free channels (never cost-blocked) ----

const FREE_CHANNELS: DeliveryChannel[] = ['email', 'telegram', 'in_app'];

// ---- Escalation loop prevention ----

/** Max escalations per original message chain to prevent infinite escalation loops */
const MAX_ESCALATIONS = 3;

/** SMS segment size — 160 chars for GSM-7, but we use 320 (2 segments) as a reasonable limit */
const MAX_SMS_LENGTH = 320;

/** Channel cost ordering for fallback (cheapest first) */
const FALLBACK_CHANNEL_ORDER: DeliveryChannel[] = ['in_app', 'telegram', 'email', 'sms', 'whatsapp', 'voice'];

// ---- Public API ----

/**
 * Central delivery function for all Aurora outbound communication.
 *
 * Always writes to conversation_context (in-app feed).
 * Selects the best external channel based on priority, budget, quiet hours, and user preference.
 */
export async function sendAuroraMessage(message: AuroraMessage): Promise<DeliveryResult> {
  const { userId, content, priority, source, proactiveQueueId } = message;

  // Step 1: Always insert into conversation_context (in-app feed — free)
  await insertConversationContext(userId, content, source, proactiveQueueId);

  // Step 2: Select external channel
  const selectedChannel = await selectChannel(message);

  // Step 3: Check quiet hours (skip for critical)
  if (priority !== 'critical') {
    const quiet = await isQuietHours(userId);
    if (quiet && selectedChannel !== 'email' && selectedChannel !== 'in_app') {
      // Queue for morning delivery
      await queueForLater(message);
      return { delivered: false, channel: 'in_app', queued: true, reason: 'Quiet hours — queued for morning' };
    }
  }

  // Step 4: Check budget for paid channels
  const costCents = CHANNEL_COSTS[selectedChannel];
  if (costCents > 0) {
    const budgetResult = await checkBudget(userId, selectedChannel);
    if (!budgetResult.allowed) {
      // Fall back to free channel
      logger.info({ channel: selectedChannel, reason: budgetResult.reason }, '[AURORA-MSG] Budget blocked, falling back to email');
      const fallbackChannel = await pickFreeChannel(userId);
      const sent = await deliverMessage(userId, content, fallbackChannel, message.emailSubject);
      return {
        delivered: sent,
        channel: fallbackChannel,
        queued: false,
        reason: `Budget exceeded for ${selectedChannel} — sent via ${fallbackChannel}`,
      };
    }
  }

  // Step 5: Send via selected channel
  let sent = await deliverMessage(userId, content, selectedChannel, message.emailSubject);
  let actualChannel = selectedChannel;

  // Step 5b: On delivery failure, try next cheapest channel before giving up
  if (!sent) {
    logger.info({ channel: selectedChannel }, '[AURORA-MSG] Delivery failed, trying fallback channels');
    for (const fallback of FALLBACK_CHANNEL_ORDER) {
      if (fallback === selectedChannel) continue;
      const available = await isChannelAvailable(userId, fallback);
      if (!available) continue;
      // Check budget for paid fallback channels
      const fallbackCost = CHANNEL_COSTS[fallback];
      if (fallbackCost > 0) {
        const fallbackBudget = await checkBudget(userId, fallback);
        if (!fallbackBudget.allowed) continue;
      }
      sent = await deliverMessage(userId, content, fallback, message.emailSubject);
      if (sent) {
        actualChannel = fallback;
        logger.info({ channel: fallback }, '[AURORA-MSG] Fallback delivery succeeded');
        break;
      }
    }
  }

  // Step 6: Track cost
  const actualCost = CHANNEL_COSTS[actualChannel];
  if (sent && actualCost > 0) {
    await trackSpend(userId, actualChannel, actualCost);
  }

  // Step 7: Schedule escalation for high/critical if needed
  if (sent && (priority === 'high' || priority === 'critical')) {
    await scheduleEscalation(message, actualChannel);
  }

  return { delivered: sent, channel: actualChannel, queued: false };
}

// ---- Channel Selection ----

/**
 * Select the best channel based on priority, user preference, and availability.
 *
 * Priority mapping:
 * - critical → phone call immediately
 * - high → SMS/WhatsApp, escalate to call if no response
 * - medium → SMS/WhatsApp or learned preferred channel
 * - low → email or in-app only
 */
async function selectChannel(message: AuroraMessage): Promise<DeliveryChannel> {
  const { userId, priority, preferredChannel, source } = message;

  // If caller specified a channel, respect it
  if (preferredChannel && isDeliveryChannel(preferredChannel)) {
    return preferredChannel;
  }

  // Priority-based default selection
  switch (priority) {
    case 'critical':
      return 'voice';

    case 'high': {
      // Check if user has SMS capability
      const profile = await getUserProfile(userId);
      if (profile?.phone) return 'sms';
      if (profile?.whatsappPhone) return 'whatsapp';
      if (profile?.telegramChatId) return 'telegram';
      return 'email';
    }

    case 'medium': {
      // Use learned channel preference for the source type
      const infoType = source === 'digest' ? 'digest' : source === 'alert' ? 'alert' : 'general';
      const learned = await getPreferredChannel(userId, infoType);

      if (learned.confidence > 0.3) {
        // Verify the channel is available for this user
        const available = await isChannelAvailable(userId, learned.channel);
        if (available) return learned.channel;
      }

      // Fallback: check user profile for available channels
      const profile = await getUserProfile(userId);
      if (profile?.phone) return 'sms';
      if (profile?.telegramChatId) return 'telegram';
      return 'email';
    }

    case 'low':
    default:
      return 'email';
  }
}

// ---- Message Delivery ----

/**
 * Actually send the message via the given channel, using existing service functions.
 */
async function deliverMessage(
  userId: string,
  content: string,
  channel: DeliveryChannel,
  emailSubject?: string
): Promise<boolean> {
  try {
    const profile = await getUserProfile(userId);
    if (!profile) {
      logger.error({ userId: userId.slice(0, 8) }, '[AURORA-MSG] No profile found for user');
      return false;
    }

    switch (channel) {
      case 'sms': {
        if (!profile.phone) return false;
        // Truncate SMS to MAX_SMS_LENGTH (2 segments) to control costs
        const smsBody = content.length > MAX_SMS_LENGTH
          ? content.substring(0, MAX_SMS_LENGTH - 3) + '...'
          : content;
        const result = await sendSms({ userId, to: profile.phone, body: smsBody });
        return result.success;
      }

      case 'voice': {
        if (!profile.phone) return false;
        const result = await callUser({ userId, to: profile.phone, message: content });
        return result.success;
      }

      case 'whatsapp': {
        if (!profile.whatsappPhone) return false;
        const { sendWhatsAppMessage } = await import("./whatsapp.js");
        return await sendWhatsAppMessage(profile.whatsappPhone, content, userId);
      }

      case 'telegram': {
        if (!profile.telegramChatId) return false;
        const { sendTelegramMessage } = await import("./telegram.js");
        return await sendTelegramMessage(profile.telegramChatId, content, userId);
      }

      case 'email': {
        const subject = emailSubject || '[Aurora] Notification';
        return await sendResponse({
          to: profile.email,
          from: `${profile.username || 'aurora'}@aevoy.com`,
          subject,
          body: content,
        });
      }

      case 'in_app':
        // Already inserted into conversation_context above
        return true;

      default:
        logger.error({ channel }, '[AURORA-MSG] Unknown channel');
        return false;
    }
  } catch (err) {
    logger.error({ err, channel }, '[AURORA-MSG] deliverMessage error');
    return false;
  }
}

// ---- Quiet Hours ----

/**
 * Check if it's quiet hours (10PM-7AM) in the user's local timezone.
 */
export async function isQuietHours(userId: string): Promise<boolean> {
  try {
    const profile = await getUserProfile(userId);
    const timezone = profile?.timezone || 'America/Los_Angeles';

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const hour = parseInt(formatter.format(new Date()));
    return hour >= 22 || hour < 7;
  } catch (err) {
    logger.warn({ err }, '[AURORA-MSG] Quiet hours check failed');
    return false; // On error, assume not quiet
  }
}

// ---- Queue & Escalation ----

/**
 * Queue a message for later delivery (morning after quiet hours).
 * Inserts into proactive_queue with trigger_at set to 7AM user local time.
 */
async function queueForLater(message: AuroraMessage): Promise<void> {
  try {
    const profile = await getUserProfile(message.userId);
    const timezone = profile?.timezone || 'America/Los_Angeles';

    // Calculate next 7AM in user's timezone
    const triggerAt = getNext7AM(timezone);

    // Map string priority to integer (1-10 scale)
    const priorityMap: Record<string, number> = { low: 3, medium: 5, high: 7, critical: 9 };

    await getSupabaseClient()
      .from('proactive_queue')
      .insert({
        user_id: message.userId,
        action_type: 'remind',
        title: `Queued ${message.source} message`,
        description: message.content,
        priority: priorityMap[message.priority] || 5,
        confidence: 0.95,
        trigger_at: triggerAt.toISOString(),
        status: 'pending',
        preferred_channel: message.preferredChannel || null,
        trigger_condition: {
          originalChannel: message.preferredChannel,
          queuedReason: 'quiet_hours',
          emailSubject: message.emailSubject,
        },
      });

    logger.info({ userId: message.userId.slice(0, 8), triggerAt: triggerAt.toISOString() }, '[AURORA-MSG] Queued message for morning delivery');
  } catch (err) {
    logger.error({ err }, '[AURORA-MSG] queueForLater error');
  }
}

/**
 * Schedule an escalation: if no response within delay, send via a more urgent channel.
 * Enforces MAX_ESCALATIONS per message chain to prevent infinite escalation loops (C006).
 */
async function scheduleEscalation(message: AuroraMessage, originalChannel: DeliveryChannel): Promise<void> {
  // Only escalate if not already on voice (highest urgency)
  if (originalChannel === 'voice') return;

  try {
    // Check escalation count for this user in the last 2 hours to prevent loops
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recentEscalations } = await getSupabaseClient()
      .from('proactive_queue')
      .select('id')
      .eq('user_id', message.userId)
      .eq('action_type', 'follow_up')
      .gte('created_at', twoHoursAgo)
      .limit(MAX_ESCALATIONS + 1);

    if (recentEscalations && recentEscalations.length >= MAX_ESCALATIONS) {
      logger.info({ userId: message.userId.slice(0, 8), cap: MAX_ESCALATIONS }, '[AURORA-MSG] Escalation cap reached — stopping chain');
      return;
    }

    // Escalation: 15 min for critical, 60 min for high
    const delayMinutes = message.priority === 'critical' ? 15 : 60;
    const triggerAt = new Date(Date.now() + delayMinutes * 60 * 1000);

    // Escalation channel: voice for critical, SMS for high
    const escalationChannel = message.priority === 'critical' ? 'voice' : 'sms';

    // Map string priority to integer (1-10 scale)
    const priorityMap: Record<string, number> = { low: 3, medium: 5, high: 7, critical: 9 };

    await getSupabaseClient()
      .from('proactive_queue')
      .insert({
        user_id: message.userId,
        action_type: 'follow_up',
        title: `Escalation: ${message.source} via ${escalationChannel}`,
        description: `[FOLLOW-UP] ${message.content}`,
        priority: priorityMap[message.priority] || 7,
        confidence: 0.95,
        trigger_at: triggerAt.toISOString(),
        status: 'pending',
        preferred_channel: escalationChannel,
        trigger_condition: {
          originalChannel,
          escalationChannel,
          originalSource: message.source,
          escalationCount: (recentEscalations?.length || 0) + 1,
          emailSubject: message.emailSubject,
        },
      });
  } catch (err) {
    logger.error({ err }, '[AURORA-MSG] scheduleEscalation error');
  }
}

// ---- User Profile Cache ----

interface UserProfile {
  email: string;
  username: string;
  phone: string | null;
  timezone: string | null;
  telegramChatId: string | null;
  whatsappPhone: string | null;
}

const profileCache = new Map<string, { profile: UserProfile; cachedAt: number }>();
const PROFILE_CACHE_TTL_MS = 300_000; // 5 minutes

async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }

  try {
    const { data } = await getSupabaseClient()
      .from('profiles')
      .select('email, username, twilio_number, timezone, telegram_chat_id, whatsapp_phone')
      .eq('id', userId)
      .single();

    if (!data) return null;

    const profile: UserProfile = {
      email: data.email,
      username: data.username || 'aurora',
      phone: data.twilio_number || null,
      timezone: data.timezone || null,
      telegramChatId: data.telegram_chat_id || null,
      whatsappPhone: data.whatsapp_phone || null,
    };

    profileCache.set(userId, { profile, cachedAt: Date.now() });
    return profile;
  } catch (err) {
    logger.error({ err, userId: userId.slice(0, 8) }, '[AURORA-MSG] getUserProfile error');
    return null;
  }
}

// ---- Helpers ----

/**
 * Insert a record into conversation_context for the in-app feed.
 */
async function insertConversationContext(
  userId: string,
  content: string,
  source: string,
  proactiveQueueId?: string
): Promise<void> {
  try {
    await getSupabaseClient()
      .from('conversation_context')
      .insert({
        user_id: userId,
        role: 'aurora',
        content,
        source,
        proactive_queue_id: proactiveQueueId || null,
        created_at: new Date().toISOString(),
      });
  } catch (err) {
    // Non-critical — don't block delivery
    logger.error({ err }, '[AURORA-MSG] insertConversationContext error');
  }
}

/**
 * Check if a channel is available for a given user.
 */
async function isChannelAvailable(userId: string, channel: DeliveryChannel): Promise<boolean> {
  const profile = await getUserProfile(userId);
  if (!profile) return false;

  switch (channel) {
    case 'sms':
    case 'voice':
      return !!profile.phone;
    case 'whatsapp':
      return !!profile.whatsappPhone;
    case 'telegram':
      return !!profile.telegramChatId;
    case 'email':
      return !!profile.email;
    case 'in_app':
      return true;
    default:
      return false;
  }
}

/**
 * Pick the best free channel available for a user.
 */
async function pickFreeChannel(userId: string): Promise<DeliveryChannel> {
  const profile = await getUserProfile(userId);
  if (!profile) return 'in_app';

  // Prefer telegram (instant), then email, then in_app
  if (profile.telegramChatId) return 'telegram';
  if (profile.email) return 'email';
  return 'in_app';
}

/**
 * Calculate the next 7AM in a given timezone.
 */
function getNext7AM(timezone: string): Date {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const currentHour = parseInt(formatter.format(now));

    // If it's before 7AM, trigger at 7AM today; otherwise 7AM tomorrow
    const hoursUntil7AM = currentHour < 7 ? (7 - currentHour) : (24 - currentHour + 7);
    return new Date(now.getTime() + hoursUntil7AM * 60 * 60 * 1000);
  } catch (err) {
    logger.warn({ err }, '[AURORA-MSG] Next morning calculation failed');
    // Fallback: 8 hours from now
    return new Date(Date.now() + 8 * 60 * 60 * 1000);
  }
}

function isDeliveryChannel(channel: string): channel is DeliveryChannel {
  return ['sms', 'voice', 'whatsapp', 'email', 'telegram', 'in_app'].includes(channel);
}

// ---- Frustration Detection & Proactive Feedback Handling ----

/** Keywords/phrases that indicate user frustration with a proactive message */
const FRUSTRATION_PATTERNS = [
  'this is wrong',
  'stop making things up',
  'that\'s not right',
  'that\'s wrong',
  'not true',
  'incorrect',
  'don\'t send me this',
  'stop sending',
  'leave me alone',
  'shut up',
  'this is annoying',
  'stop it',
  'you\'re wrong',
  'you are wrong',
  'completely wrong',
  'not helpful',
  'useless',
  'terrible',
  'awful suggestion',
  'bad advice',
  'wtf',
  'what the hell',
  'seriously?',
  'are you kidding',
  'makes no sense',
  'nonsense',
  'hallucinating',
  'made that up',
];

/**
 * Detect whether a user response indicates frustration.
 * Returns true if any frustration pattern is found in the text.
 */
export function detectFrustration(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return FRUSTRATION_PATTERNS.some(pattern => normalized.includes(pattern));
}

/**
 * Handle proactive feedback when a user responds with frustration.
 *
 * 1. Marks the proactive item as 'dismissed' with negative feedback
 * 2. Reduces confidence threshold for the source pattern by 0.10
 * 3. Returns an apologetic response to send back
 *
 * @param userId - The user who responded
 * @param responseText - The user's response text
 * @param proactiveQueueId - The proactive_queue item they're responding to (if known)
 * @returns Object with `isFrustrated` flag and optional `reply` text
 */
export async function handleProactiveFeedback(
  userId: string,
  responseText: string,
  proactiveQueueId?: string
): Promise<{ isFrustrated: boolean; reply?: string }> {
  if (!detectFrustration(responseText)) {
    return { isFrustrated: false };
  }

  logger.info({ userId: userId.slice(0, 8), text: responseText.slice(0, 80) }, '[AURORA-MSG] Frustration detected from user');

  const supabase = getSupabaseClient();

  try {
    // Step 1: Mark the proactive item as dismissed with negative feedback
    if (proactiveQueueId) {
      await supabase
        .from('proactive_queue')
        .update({
          status: 'dismissed',
          feedback: 'negative',
          feedback_text: responseText.slice(0, 500),
          dismissed_at: new Date().toISOString(),
        })
        .eq('id', proactiveQueueId)
        .eq('user_id', userId);

      // Step 2: Find the pattern that generated this proactive item and reduce its confidence
      const { data: queueItem } = await supabase
        .from('proactive_queue')
        .select('trigger_condition, action_type')
        .eq('id', proactiveQueueId)
        .single();

      if (queueItem?.trigger_condition) {
        const condition = queueItem.trigger_condition as Record<string, unknown>;
        const patternType = (condition.pattern_type as string) || queueItem.action_type;

        if (patternType) {
          // Reduce confidence of matching patterns by 0.10
          const { data: patterns } = await supabase
            .from('detected_patterns')
            .select('id, confidence')
            .eq('user_id', userId)
            .eq('pattern_type', patternType)
            .gte('confidence', 0.1);

          if (patterns && patterns.length > 0) {
            for (const pattern of patterns) {
              const newConfidence = Math.max(0, (pattern.confidence || 0.5) - 0.10);
              await supabase
                .from('detected_patterns')
                .update({ confidence: newConfidence })
                .eq('id', pattern.id);
            }
            logger.info({ userId: userId.slice(0, 8), patternType, patternCount: patterns.length }, '[AURORA-MSG] Reduced confidence for patterns');
          }
        }
      }
    }

    // Record the negative channel interaction for channel-learner
    try {
      const { recordChannelResponse } = await import('./channel-learner.js');
      await recordChannelResponse(userId, 'in_app', 'proactive', 0, false);
    } catch (err) {
      logger.warn({ err }, '[AURORA-MSG] channel-learner recordChannelResponse failed (non-critical)');
    }
  } catch (err) {
    logger.error({ err }, '[AURORA-MSG] handleProactiveFeedback error');
  }

  return {
    isFrustrated: true,
    reply: "My mistake. I'll learn from this. What did I get wrong?",
  };
}

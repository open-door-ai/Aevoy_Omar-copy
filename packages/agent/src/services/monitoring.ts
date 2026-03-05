/**
 * Persistent Monitoring Service
 *
 * Allows the AI agent to register ongoing monitoring jobs via
 * [ACTION:remember("MONITOR:description every 15min")] tags.
 *
 * When the AI writes a MONITOR: prefixed fact to memory, this service:
 * 1. Parses and registers the monitoring job (in-memory + Supabase user_memory)
 * 2. Runs background checks at the specified interval (default 15 min)
 * 3. Calls AI with monitoring context to assess whether anything new happened
 * 4. Sends notification via user's preferred channel if AI finds actionable info
 *
 * Also provides a legacy heartbeat for long-running task monitoring.
 *
 * Heartbeat interval: 15 minutes (configurable via MONITORING_INTERVAL_MS env var)
 */

import { getSupabaseClient, acquireDistributedLock, releaseDistributedLock } from '../utils/supabase.js';
import { sendResponse } from './email.js';
import { sendSms } from './twilio.js';
import { quickValidate } from './ai.js';
import type { TaskRequest } from '../types/index.js';

const HEARTBEAT_INTERVAL_MS = parseInt(process.env.MONITORING_INTERVAL_MS || '') || 15 * 60 * 1000;
const DEFAULT_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let monitoringInterval: NodeJS.Timeout | null = null;
let isHeartbeatRunning = false;

// ---- In-memory job registry ----

export interface MonitoringJob {
  id: string;                     // Unique job identifier (uuid-like)
  userId: string;
  username: string;
  description: string;            // What to monitor
  checkIntervalMs: number;        // How often to check
  createdAt: string;              // ISO timestamp
  lastCheckedAt?: string;         // ISO timestamp of last check
  nextCheckAt: string;            // ISO timestamp of next scheduled check
  isActive: boolean;
}

// Legacy MonitoringJob shape used by registerMonitoringJob (old API)
export interface LegacyMonitoringJob {
  userId: string;
  taskId: string;
  type: 'listing' | 'outreach' | 'inbox_watch' | 'url_watch' | 'price_watch';
  metadata: Record<string, string>;
  checkEveryMs?: number;
  expiresAt?: string; // ISO date
}

// In-memory store: userId → job[]
const monitoringJobs = new Map<string, MonitoringJob[]>();

// ---- Interval parsing ----

/**
 * Parse an interval hint from monitoring description text.
 * Examples: "every 15min", "every hour", "every day", "every 30 minutes"
 */
function parseIntervalMs(description: string): number {
  const lc = description.toLowerCase();

  // "every X minutes" / "every Xmin"
  const minMatch = lc.match(/every\s+(\d+)\s*min/);
  if (minMatch) return parseInt(minMatch[1]) * 60 * 1000;

  // "every X hours" / "every Xh"
  const hourMatch = lc.match(/every\s+(\d+)\s*h(?:our)?/);
  if (hourMatch) return parseInt(hourMatch[1]) * 60 * 60 * 1000;

  // "every hour" (singular, no number)
  if (/every\s+hour/.test(lc)) return 60 * 60 * 1000;

  // "every day" / "daily"
  if (/every\s+day|daily/.test(lc)) return 24 * 60 * 60 * 1000;

  // "every X seconds"
  const secMatch = lc.match(/every\s+(\d+)\s*s(?:ec)?/);
  if (secMatch) return parseInt(secMatch[1]) * 1000;

  return DEFAULT_CHECK_INTERVAL_MS;
}

// ---- Job ID generation ----

function generateJobId(): string {
  return `monitor_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ---- Public API ----

/**
 * Register a monitoring job from a MONITOR: memory string.
 * Called from updateMemoryWithFact when a MONITOR: prefix is detected.
 *
 * @param userId  User who owns the job
 * @param username  User's username (for email sending)
 * @param jobDescription  Full job description (e.g. "check Fiverr inbox every 15min")
 * @param checkIntervalMs  Override interval (optional — parsed from description if not provided)
 */
export async function registerMonitoringJob(
  userId: string,
  username: string,
  jobDescription: string,
  checkIntervalMs?: number
): Promise<void>;

/**
 * Legacy overload: register a monitoring job using the old LegacyMonitoringJob shape.
 * Used by older code that registers jobs directly via task completion hooks.
 */
export async function registerMonitoringJob(job: LegacyMonitoringJob): Promise<void>;

// Implementation
export async function registerMonitoringJob(
  userIdOrJob: string | LegacyMonitoringJob,
  username?: string,
  jobDescription?: string,
  checkIntervalMs?: number
): Promise<void> {
  // Handle legacy overload
  if (typeof userIdOrJob === 'object') {
    const job = userIdOrJob;
    try {
      await getSupabaseClient().from('tasks').insert({
        user_id: job.userId,
        type: 'monitoring',
        status: 'active',
        input_text: JSON.stringify(job.metadata),
        email_subject: `[MONITORING] ${job.type}: ${job.taskId}`,
        input_channel: 'proactive',
        started_at: new Date().toISOString(),
      });
      console.log(`[MONITORING] Registered legacy ${job.type} job for user ${job.userId.substring(0, 8)}`);
    } catch (err) {
      console.error('[MONITORING] Failed to register legacy job:', err);
    }
    return;
  }

  // New API: string-based
  const userId = userIdOrJob;
  if (!username || !jobDescription) {
    console.error('[MONITORING] registerMonitoringJob: username and jobDescription are required');
    return;
  }

  // Hard cap: max 3 active monitoring jobs per user (or user's custom max_monitor_jobs setting)
  try {
    const { data: settingsRow } = await getSupabaseClient()
      .from('user_settings')
      .select('max_monitor_jobs')
      .eq('user_id', userId)
      .single();
    const maxJobs = (settingsRow as any)?.max_monitor_jobs ?? 3;

    const userJobs = monitoringJobs.get(userId) || [];
    const activeCount = userJobs.filter(j => j.isActive).length;
    if (activeCount >= maxJobs) {
      console.warn(`[MONITORING] User ${userId.slice(0, 8)} already has ${activeCount} active monitors (cap: ${maxJobs}) — blocking new one: "${jobDescription.slice(0, 60)}"`);
      return; // Silently skip — don't error, just don't create over the cap
    }
  } catch (capErr) {
    console.warn('[MONITORING] Failed to check monitor job cap:', capErr); // Non-fatal
  }

  const interval = checkIntervalMs ?? parseIntervalMs(jobDescription);
  const now = new Date();
  const job: MonitoringJob = {
    id: generateJobId(),
    userId,
    username,
    description: jobDescription,
    checkIntervalMs: interval,
    createdAt: now.toISOString(),
    nextCheckAt: new Date(now.getTime() + interval).toISOString(),
    isActive: true,
  };

  // Store in memory
  const existing = monitoringJobs.get(userId) || [];
  // De-duplicate: don't register same description twice
  const alreadyExists = existing.some(j => j.description === jobDescription && j.isActive);
  if (alreadyExists) {
    console.log(`[MONITORING] Job already registered for user ${userId.substring(0, 8)}: "${jobDescription.substring(0, 60)}"`);
    return;
  }
  existing.push(job);
  monitoringJobs.set(userId, existing);

  // Persist to Supabase user_memory so jobs survive restarts
  try {
    await getSupabaseClient().from('user_memory').insert({
      user_id: userId,
      memory_type: 'working',
      encrypted_data: JSON.stringify({ monitoringJob: job }),
      created_at: now.toISOString(),
    });
  } catch (err) {
    // Non-fatal: in-memory store is the source of truth for current process
    console.warn('[MONITORING] Could not persist job to Supabase:', err);
  }

  console.log(`[MONITORING] Registered job for user ${userId.substring(0, 8)}: "${jobDescription.substring(0, 60)}" (every ${Math.round(interval / 60000)}min)`);
}

/**
 * Get all active monitoring jobs for a user.
 */
export function getMonitoringJobs(userId: string): MonitoringJob[] {
  return (monitoringJobs.get(userId) || []).filter(j => j.isActive);
}

/**
 * Stop (deactivate) a monitoring job by ID.
 */
export function stopMonitoringJob(userId: string, jobId: string): boolean {
  const jobs = monitoringJobs.get(userId);
  if (!jobs) return false;
  const job = jobs.find(j => j.id === jobId);
  if (!job) return false;
  job.isActive = false;
  console.log(`[MONITORING] Stopped job ${jobId} for user ${userId.substring(0, 8)}`);
  return true;
}

// ---- MONITOR: tag parsing ----

/**
 * Check if a memory string contains a MONITOR: tag.
 * Called from memory.ts updateMemoryWithFact.
 */
export function extractMonitorTag(fact: string): string | null {
  const trimmed = fact.trim();
  if (trimmed.toUpperCase().startsWith('MONITOR:')) {
    return trimmed.substring('MONITOR:'.length).trim();
  }
  return null;
}

// ---- Monitoring check runner ----

/**
 * Run a single monitoring job check — calls AI with context and notifies user if needed.
 */
/**
 * Detect if a monitoring job requires browser/platform checks vs simple AI reasoning.
 * Platform checks need a real task execution; simple checks just need AI.
 */
function needsRealCheck(description: string): boolean {
  const lc = description.toLowerCase();
  return /\b(check|monitor|watch|track|inbox|message|notification|reply|response|new order|listing|post|follower|earning|point|balance|survey|video|view|comment|like)\b/.test(lc)
    && /\b(swagbucks|tiktok|twitter|x\.com|instagram|youtube|reddit|fiverr|upwork|linkedin|facebook|discord|slack|notion|trello|github|gmail|outlook|indeed|craigslist)\b/.test(lc);
}

/**
 * Extract a URL or platform name from a monitoring description.
 */
function extractPlatformUrl(description: string): string | null {
  // Direct URL
  const urlMatch = description.match(/https?:\/\/[^\s)]+/);
  if (urlMatch) return urlMatch[0];

  // Platform name → URL mapping
  const platforms: Record<string, string> = {
    swagbucks: 'https://www.swagbucks.com/account/summary',
    tiktok: 'https://www.tiktok.com/notifications',
    twitter: 'https://twitter.com/notifications',
    'x.com': 'https://x.com/notifications',
    instagram: 'https://www.instagram.com/accounts/activity/',
    youtube: 'https://studio.youtube.com/',
    fiverr: 'https://www.fiverr.com/inbox',
    upwork: 'https://www.upwork.com/nx/messages',
    linkedin: 'https://www.linkedin.com/messaging/',
    discord: 'https://discord.com/channels/@me',
    reddit: 'https://www.reddit.com/notifications',
    github: 'https://github.com/notifications',
  };

  const lc = description.toLowerCase();
  for (const [name, url] of Object.entries(platforms)) {
    if (lc.includes(name)) return url;
  }
  return null;
}

async function runJobCheck(job: MonitoringJob): Promise<void> {
  console.log(`[MONITORING] Running check for job ${job.id} (user ${job.userId.substring(0, 8)}): "${job.description.substring(0, 60)}"`);

  try {
    // Fetch user profile for notification routing
    const { data: profile } = await getSupabaseClient()
      .from('profiles')
      .select('email, phone_number, telegram_chat_id, whatsapp_phone')
      .eq('id', job.userId)
      .single();

    if (!profile) {
      console.warn(`[MONITORING] User ${job.userId.substring(0, 8)} not found — skipping job`);
      job.isActive = false;
      return;
    }

    // Fetch user's preferred proactive channel
    const { data: settings } = await getSupabaseClient()
      .from('user_settings')
      .select('proactive_channel')
      .eq('user_id', job.userId)
      .single();

    const preferredChannel = settings?.proactive_channel || 'email';

    let aiResponse = '';

    // ---- Strategy: real task execution for platform checks ----
    if (needsRealCheck(job.description)) {
      const platformUrl = extractPlatformUrl(job.description);
      console.log(`[MONITORING] Platform check: "${job.description.substring(0, 50)}" → ${platformUrl || 'no URL'}`);

      try {
        // Fire a real subtask through the processor (suppressed email)
        const { processTask } = await import('./processor.js');
        const checkSubject = `[MONITOR CHECK] ${job.description}. Report what you find — any new messages, notifications, earnings, points, followers, or changes. Be specific with numbers.`;

        const subtaskRequest: TaskRequest = {
          userId: job.userId,
          username: job.username,
          from: `${job.username}@aevoy.com`,
          subject: checkSubject,
          body: platformUrl ? `Start by browsing ${platformUrl}` : '',
          inputChannel: 'proactive',
          suppressEmail: true,
          sessionHint: platformUrl ? { userId: job.userId, domain: new URL(platformUrl).hostname } : undefined,
        };

        const result = await Promise.race([
          processTask(subtaskRequest),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5 * 60 * 1000)), // 5 min timeout
        ]);

        if (result && 'response' in result) {
          aiResponse = (result as any).response || '';
        }
      } catch (taskErr) {
        console.error(`[MONITORING] Subtask execution failed for job ${job.id}:`, taskErr);
        // Fall through to quickValidate
      }
    }

    // ---- Fallback: AI-only check (inbox, email, simple reasoning) ----
    if (!aiResponse) {
      // Check email inbox for replies if description mentions inbox/reply/email
      let inboxContext = '';
      const lc = job.description.toLowerCase();
      if (/\b(inbox|email|reply|response|message)\b/.test(lc) && !needsRealCheck(job.description)) {
        try {
          const { fetchRecentEmails } = await import('./inbox-poller.js');
          const emails = await fetchRecentEmails(job.userId, 5);
          if (emails?.length) {
            inboxContext = `\n\nRecent emails in inbox:\n${emails.map((e: any) => `- From: ${e.from}, Subject: ${e.subject}, Date: ${e.date}`).join('\n')}`;
          }
        } catch {
          // Inbox check failed — continue without it
        }
      }

      const prompt = `You are monitoring: "${job.description}"

Last checked: ${job.lastCheckedAt ? new Date(job.lastCheckedAt).toLocaleString() : 'never (first check)'}
Current time: ${new Date().toLocaleString()}
${inboxContext}

Your job is to check if there is anything NEW or ACTIONABLE since the last check.

Instructions:
1. If there is nothing new to report, respond with exactly: NO_UPDATE
2. If there IS something new and actionable, respond with a brief, clear message for the user (1-3 sentences max). Be specific and direct.
3. Do NOT include disclaimers or meta-commentary. Just the useful information.

What do you find?`;

      const result = await quickValidate(
        prompt,
        `You are an AI monitoring agent. You check on things and report back only if there is something actionable. Be concise and specific.`
      );

      aiResponse = result?.result?.trim() || '';
    }

    if (!aiResponse || aiResponse === 'NO_UPDATE' || aiResponse.toUpperCase().includes('NO_UPDATE') || aiResponse.toUpperCase().includes('NOTHING NEW')) {
      console.log(`[MONITORING] No update for job ${job.id}`);
      return;
    }

    // AI found something actionable — notify user
    console.log(`[MONITORING] Actionable update for job ${job.id}: "${aiResponse.substring(0, 100)}"`);

    await notifyUser(job, profile, settings, aiResponse);
  } catch (err) {
    console.error(`[MONITORING] Error running job check ${job.id}:`, err);
  } finally {
    // Update last checked + next check timestamps
    job.lastCheckedAt = new Date().toISOString();
    job.nextCheckAt = new Date(Date.now() + job.checkIntervalMs).toISOString();
  }
}

/**
 * Send a monitoring notification to the user via their preferred channel.
 */
async function notifyUser(
  job: MonitoringJob,
  profile: { email: string; phone_number?: string | null; telegram_chat_id?: string | null; whatsapp_phone?: string | null },
  settings: { proactive_channel?: string } | null,
  message: string
): Promise<void> {
  const preferredChannel = settings?.proactive_channel || 'email';
  const notificationMessage = `[Monitoring] ${job.description.substring(0, 50)}...\n\n${message}`;
  const emailSubject = `[Aevoy Monitor] ${job.description.substring(0, 60)}`;

  try {
    if (preferredChannel === 'telegram' && profile.telegram_chat_id) {
      const { sendTelegramMessage } = await import('./telegram.js');
      await sendTelegramMessage(profile.telegram_chat_id, notificationMessage);
    } else if (preferredChannel === 'whatsapp' && profile.whatsapp_phone) {
      const { sendWhatsAppMessage } = await import('./whatsapp.js');
      await sendWhatsAppMessage(profile.whatsapp_phone, notificationMessage);
    } else if ((preferredChannel === 'sms' || preferredChannel === 'voice') && profile.phone_number) {
      const smsBody = notificationMessage.length > 1500
        ? notificationMessage.substring(0, 1500) + '...'
        : notificationMessage;
      await sendSms({ userId: job.userId, to: profile.phone_number as string, body: smsBody });
    } else {
      await sendResponse({
        to: profile.email,
        from: `${job.username}@aevoy.com`,
        subject: emailSubject,
        body: message,
      });
    }
  } catch (sendErr) {
    console.error(`[MONITORING] Failed to send notification for job ${job.id}:`, sendErr);
    try {
      await sendResponse({
        to: profile.email,
        from: `${job.username}@aevoy.com`,
        subject: emailSubject,
        body: message,
      });
    } catch {
      // Silent
    }
  }
}

// ---- Heartbeat ----

/**
 * Run one heartbeat tick:
 * 1. Run all due MONITOR: jobs from the in-memory registry
 * 2. Also check legacy monitoring tasks in the tasks table
 */
async function runHeartbeat(): Promise<void> {
  if (isHeartbeatRunning) {
    console.log('[MONITORING] Heartbeat already running, skipping');
    return;
  }

  const acquired = await acquireDistributedLock('monitoring_heartbeat', HEARTBEAT_INTERVAL_MS);
  if (!acquired) {
    console.log('[MONITORING] Could not acquire lock — another instance running');
    return;
  }

  isHeartbeatRunning = true;
  console.log('[MONITORING] Heartbeat starting');

  try {
    const now = Date.now();

    // --- Run due MONITOR: jobs ---
    for (const [userId, jobs] of monitoringJobs.entries()) {
      for (const job of jobs) {
        if (!job.isActive) continue;
        if (new Date(job.nextCheckAt).getTime() <= now) {
          // Run check non-blocking (catch errors per job)
          runJobCheck(job).catch(err => console.error(`[MONITORING] Unhandled job check error:`, err));
        }
      }
    }

    // --- Legacy: check tasks table for old-style monitoring records ---
    const { data: legacyJobs } = await getSupabaseClient()
      .from('tasks')
      .select('id, user_id, input_text, started_at')
      .eq('type', 'monitoring')
      .eq('status', 'active')
      .lt('started_at', new Date(now - 5 * 60 * 1000).toISOString()); // At least 5 min old

    if (legacyJobs?.length) {
      console.log(`[MONITORING] Checking ${legacyJobs.length} legacy monitoring tasks`);

      for (const job of legacyJobs) {
        try {
          const metadata = JSON.parse(job.input_text || '{}');
          if (metadata.expiresAt && new Date(metadata.expiresAt) < new Date()) {
            await getSupabaseClient().from('tasks').update({ status: 'completed' }).eq('id', job.id);
            console.log(`[MONITORING] Legacy job ${job.id} expired`);
            continue;
          }
          await getSupabaseClient().from('tasks').update({
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          console.log(`[MONITORING] Checked legacy job ${job.id} for user ${job.user_id?.substring(0, 8)}`);
        } catch (jobErr) {
          console.error(`[MONITORING] Error checking legacy job ${job.id}:`, jobErr);
        }
      }
    } else {
      console.log('[MONITORING] No legacy monitoring jobs');
    }

  } catch (err) {
    console.error('[MONITORING] Heartbeat error:', err);
  } finally {
    isHeartbeatRunning = false;
    await releaseDistributedLock('monitoring_heartbeat');
    console.log('[MONITORING] Heartbeat complete');
  }
}

// ---- Startup: restore persisted jobs ----

/**
 * Reload monitoring jobs that were persisted to Supabase user_memory on a previous run.
 * Called once at startup so jobs survive process restarts.
 */
async function restorePersistedJobs(): Promise<void> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows } = await getSupabaseClient()
      .from('user_memory')
      .select('user_id, encrypted_data, created_at')
      .eq('memory_type', 'working')
      .gte('created_at', sevenDaysAgo);

    if (!rows?.length) return;

    let restored = 0;
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.encrypted_data || '{}');
        if (!parsed.monitoringJob) continue;
        const job: MonitoringJob = parsed.monitoringJob;
        if (!job.isActive) continue;

        const existing = monitoringJobs.get(job.userId) || [];
        const alreadyIn = existing.some(j => j.id === job.id);
        if (!alreadyIn) {
          // Reset nextCheckAt to now + interval (don't use stale future timestamp)
          job.nextCheckAt = new Date(Date.now() + job.checkIntervalMs).toISOString();
          existing.push(job);
          monitoringJobs.set(job.userId, existing);
          restored++;
        }
      } catch {
        // Skip malformed rows
      }
    }

    if (restored > 0) {
      console.log(`[MONITORING] Restored ${restored} monitoring jobs from Supabase`);
    }
  } catch (err) {
    console.warn('[MONITORING] Could not restore persisted jobs:', err);
  }
}

// ---- Service lifecycle ----

/**
 * Start the monitoring service.
 * - Restores persisted jobs from Supabase
 * - Runs heartbeat immediately then every HEARTBEAT_INTERVAL_MS
 * Called from scheduler.ts startScheduler().
 */
export function startMonitoringService(): void {
  if (monitoringInterval) return;
  console.log(`[MONITORING] Starting heartbeat service (interval: ${HEARTBEAT_INTERVAL_MS / 60000}min)`);

  // Restore jobs from previous run
  restorePersistedJobs().catch(console.error);

  // Run immediately on startup
  runHeartbeat().catch(console.error);

  // Then every HEARTBEAT_INTERVAL_MS
  monitoringInterval = setInterval(() => {
    runHeartbeat().catch(console.error);
  }, HEARTBEAT_INTERVAL_MS);

  monitoringInterval.unref(); // Don't prevent clean process exit
}

export function stopMonitoringService(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.log('[MONITORING] Heartbeat service stopped');
  }
}

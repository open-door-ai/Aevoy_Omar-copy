/**
 * V3 Channel Router
 *
 * Handles response delivery across all channels (email, SMS, voice, Telegram, WhatsApp, web).
 * Extracted from processor.ts sendViaChannel / atomicCompleteTask.
 */

import { sendResponse, sendProgressEmail } from '../services/email.js';
import { sendSms } from '../services/twilio.js';
import { getSupabaseClient } from '../utils/supabase.js';
import type { InputChannel } from '../types/index.js';

/**
 * Resolve correct recipient based on channel and user profile.
 */
export async function resolveRecipient(
  channel: InputChannel | undefined,
  from: string,
  userId: string
): Promise<{ email: string; phone: string | null }> {
  if (channel === 'email') {
    return { email: from, phone: null };
  }

  const { data: profile } = await getSupabaseClient()
    .from('profiles')
    .select('email, phone')
    .eq('id', userId)
    .single();

  return {
    email: profile?.email || from,
    phone: from,
  };
}

/**
 * Send a message back to the user via the same channel they used.
 */
export async function sendViaChannel(
  channel: InputChannel | undefined,
  userId: string,
  from: string,
  aevoyFrom: string,
  subject: string,
  body: string
): Promise<void> {
  const { email, phone } = await resolveRecipient(channel, from, userId);

  if (channel === 'sms' || channel === 'voice') {
    if (phone) {
      const smsBody = body.length > 1500
        ? body.substring(0, 1500) + '... (full results emailed)'
        : body;
      await sendSms({ userId, to: phone, body: smsBody });
      if (body.length > 1500 || channel === 'voice') {
        await sendResponse({ to: email, from: aevoyFrom, subject, body });
      }
      return;
    }
  }

  if (channel === 'telegram') {
    const { sendTelegramMessage } = await import('../services/telegram.js');
    await sendTelegramMessage(from, body);
    return;
  }

  if (channel === 'whatsapp') {
    const { sendWhatsAppMessage } = await import('../services/whatsapp.js');
    await sendWhatsAppMessage(from, body);
    return;
  }

  await sendResponse({ to: email, from: aevoyFrom, subject, body });
}

/**
 * Atomic task completion: send response first, then update DB.
 * If delivery fails, task stays 'processing' so watchdog can retry.
 */
export async function atomicCompleteTask(
  taskId: string,
  channel: InputChannel | undefined,
  userId: string,
  from: string,
  aevoyFrom: string,
  subject: string,
  responseText: string,
  dbUpdate: Record<string, unknown>,
  opts?: { suppressEmail?: boolean }
): Promise<void> {
  if (!opts?.suppressEmail) {
    try {
      await sendViaChannel(channel, userId, from, aevoyFrom, `Re: ${subject}`, responseText);
    } catch (sendErr) {
      console.error(`[V3-DELIVERY] sendViaChannel failed for task ${taskId?.slice(0, 8)}:`, sendErr);
      await getSupabaseClient().from('tasks').update({
        stuck_reason: `[DELIVERY-FAIL] ${sendErr instanceof Error ? sendErr.message : 'unknown'}`,
      }).eq('id', taskId);
      throw sendErr;
    }
  }

  await getSupabaseClient().from('tasks').update({
    ...dbUpdate,
    response_text: responseText,
  }).eq('id', taskId);
}

/**
 * Send a progress update to the user.
 */
export async function sendProgress(
  userId: string,
  from: string,
  username: string,
  subject: string,
  channel: InputChannel | undefined,
  progressMessage: string,
  taskId?: string
): Promise<void> {
  if (channel === 'sms' || channel === 'voice') {
    const { email } = await resolveRecipient(channel, from, userId);
    await sendProgressEmail(email, `${username}@aevoy.com`, subject, progressMessage, taskId);
  } else if (channel === 'email') {
    await sendProgressEmail(from, `${username}@aevoy.com`, subject, progressMessage, taskId);
  }
}

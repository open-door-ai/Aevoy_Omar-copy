/**
 * V3 Communication Tools
 *
 * Email, SMS, voice call, Telegram, WhatsApp tools.
 * Wraps existing service implementations.
 */

import { registerTool } from '../tool-registry.js';
import { sendResponse } from '../../services/email.js';
import { sendSms, callUser } from '../../services/twilio.js';
import { getSupabaseClient } from '../../utils/supabase.js';
import type { ToolCallResult, TaskContext } from '../types.js';

/** Send email tool */
registerTool({
  name: 'send_email',
  description: 'Send an email to a recipient. Use this when the user asks to send, compose, or draft an email.',
  category: 'communication',
  parameters: {
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject line' },
    body: { type: 'string', description: 'Email body content' },
  },
  required: ['to', 'subject', 'body'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const to = String(params.to);
    const subject = String(params.subject);
    const body = String(params.body);

    if (!to || !to.includes('@')) {
      return { success: false, error: 'Invalid email address', cost: 0 };
    }

    // Try user's IMAP first, then fall back to Resend
    let sent = false;
    try {
      const { isEmailConnected, sendViaUserEmail } = await import('../../services/inbox.js');
      const connected = await isEmailConnected(ctx.userId);
      if (connected) {
        sent = await Promise.race([
          sendViaUserEmail(ctx.userId, to, subject, body),
          new Promise<false>(r => setTimeout(() => r(false), 3000)),
        ]) as boolean;
      }
    } catch { /* IMAP unavailable */ }

    if (!sent) {
      sent = await sendResponse({
        to,
        from: `${ctx.username}@aevoy.com`,
        subject,
        body,
      });
    }

    return {
      success: sent,
      data: sent ? `Email sent to ${to}` : undefined,
      error: sent ? undefined : `Failed to send email to ${to}`,
      cost: 0,
    };
  },
});

/** Send SMS tool */
registerTool({
  name: 'send_sms',
  description: 'Send an SMS text message to a phone number.',
  category: 'communication',
  parameters: {
    to: { type: 'string', description: 'Recipient phone number in E.164 format (e.g. +15551234567)' },
    body: { type: 'string', description: 'SMS message body (max 1600 chars)' },
  },
  required: ['to', 'body'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const to = String(params.to);
    const body = String(params.body).substring(0, 1600);

    const result = await sendSms({ userId: ctx.userId, to, body });
    return {
      success: result.success,
      data: result.success ? `SMS sent to ${to}` : undefined,
      error: result.error,
      cost: 0,
    };
  },
});

/** Make voice call tool */
registerTool({
  name: 'make_call',
  description: 'Place a voice call to the user or an external number. The message will be spoken to the recipient.',
  category: 'communication',
  parameters: {
    to: { type: 'string', description: 'Phone number to call in E.164 format' },
    message: { type: 'string', description: 'Message to speak to the recipient' },
  },
  required: ['to', 'message'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const to = String(params.to);
    const message = String(params.message);

    const result = await callUser({ userId: ctx.userId, to, message });
    return {
      success: result.success,
      data: result.success ? `Call placed to ${to}` : undefined,
      error: result.error,
      cost: 0,
    };
  },
});

/** Read inbox tool */
registerTool({
  name: 'read_inbox',
  description: 'Read recent emails from the user\'s inbox. Use this to check for verification codes, replies, or other incoming messages.',
  category: 'communication',
  parameters: {
    limit: { type: 'number', description: 'Number of recent emails to retrieve (default: 5)' },
    search: { type: 'string', description: 'Optional search query to filter emails' },
  },
  async execute(params, ctx): Promise<ToolCallResult> {
    const limit = Number(params.limit) || 5;
    try {
      const { data: emails } = await getSupabaseClient()
        .from('inbox_queue')
        .select('from_address, subject, body_text, received_at')
        .eq('user_id', ctx.userId)
        .order('received_at', { ascending: false })
        .limit(limit);

      if (!emails || emails.length === 0) {
        return { success: true, data: 'No recent emails found.', cost: 0 };
      }

      const formatted = emails.map((e: any) =>
        `From: ${e.from_address}\nSubject: ${e.subject}\nDate: ${e.received_at}\n${(e.body_text || '').substring(0, 300)}`
      ).join('\n---\n');

      return { success: true, data: formatted, cost: 0 };
    } catch (err) {
      return { success: false, error: 'Failed to read inbox', cost: 0 };
    }
  },
});

/** Ask user tool */
registerTool({
  name: 'ask_user',
  description: 'Ask the user a clarifying question when you need more information to complete the task. The question will be sent via their preferred channel.',
  category: 'communication',
  parameters: {
    question: { type: 'string', description: 'The question to ask the user' },
  },
  required: ['question'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const question = String(params.question);
    const { sendViaChannel } = await import('../channel-router.js');

    await sendViaChannel(
      ctx.inputChannel,
      ctx.userId,
      ctx.from,
      `${ctx.username}@aevoy.com`,
      'Question from your AI assistant',
      question
    );

    return {
      success: true,
      data: `Question sent to user: "${question}". Waiting for their reply.`,
      cost: 0,
    };
  },
});

/** Send Telegram message tool */
registerTool({
  name: 'send_telegram',
  description: 'Send a message via Telegram.',
  category: 'communication',
  parameters: {
    chat_id: { type: 'string', description: 'Telegram chat ID to send to' },
    body: { type: 'string', description: 'Message body' },
  },
  required: ['chat_id', 'body'],
  async execute(params): Promise<ToolCallResult> {
    try {
      const { sendTelegramMessage } = await import('../../services/telegram.js');
      await sendTelegramMessage(String(params.chat_id), String(params.body));
      return { success: true, data: 'Telegram message sent', cost: 0 };
    } catch (err) {
      return { success: false, error: 'Failed to send Telegram message', cost: 0 };
    }
  },
});

/** Send WhatsApp message tool */
registerTool({
  name: 'send_whatsapp',
  description: 'Send a message via WhatsApp.',
  category: 'communication',
  parameters: {
    to: { type: 'string', description: 'Phone number in E.164 format' },
    body: { type: 'string', description: 'Message body' },
  },
  required: ['to', 'body'],
  async execute(params): Promise<ToolCallResult> {
    try {
      const { sendWhatsAppMessage } = await import('../../services/whatsapp.js');
      await sendWhatsAppMessage(String(params.to), String(params.body));
      return { success: true, data: 'WhatsApp message sent', cost: 0 };
    } catch (err) {
      return { success: false, error: 'Failed to send WhatsApp message', cost: 0 };
    }
  },
});

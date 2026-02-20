/**
 * Telegram Bot API client
 * Handles sending messages, downloading voice notes, and webhook verification.
 */

import crypto from "crypto";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Send a text message to a Telegram chat.
 * Splits messages > 4096 chars (Telegram limit).
 */
export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const MAX_LEN = 4096;
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX_LEN) {
    chunks.push(text.slice(i, i + MAX_LEN));
  }

  for (const chunk of chunks) {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[TELEGRAM] sendMessage failed: ${err.slice(0, 200)}`);
      return false;
    }
  }
  return true;
}

/**
 * Download a voice note file from Telegram.
 * Returns the audio buffer, or null on failure.
 */
export async function downloadTelegramVoiceNote(fileId: string): Promise<Buffer | null> {
  // Step 1: get file path
  const fileRes = await fetch(`${API_BASE}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!fileRes.ok) return null;
  const fileData = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } };
  const filePath = fileData.result?.file_path;
  if (!filePath) return null;

  // Step 2: download
  const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const dlRes = await fetch(downloadUrl);
  if (!dlRes.ok) return null;
  const arrayBuffer = await dlRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Validate the X-Telegram-Bot-Api-Secret-Token header.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyTelegramWebhookSecret(headerValue: string): boolean {
  if (!WEBHOOK_SECRET || !headerValue) return false;
  try {
    const expected = Buffer.from(WEBHOOK_SECRET, "utf8");
    const actual = Buffer.from(headerValue, "utf8");
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Check if the Telegram bot token is configured.
 */
export function isTelegramConfigured(): boolean {
  return Boolean(BOT_TOKEN && BOT_TOKEN.length > 10);
}

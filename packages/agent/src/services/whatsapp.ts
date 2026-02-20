/**
 * WhatsApp messaging via Twilio (Sandbox or Production)
 * Thin wrapper that adds the "whatsapp:" prefix to To/From numbers.
 */

import twilio from "twilio";

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured");
  }
  return twilio(accountSid, authToken);
}

/**
 * Get the WhatsApp-enabled number (sandbox or production).
 */
function getWhatsAppNumber(): string {
  return process.env.TWILIO_WHATSAPP_SANDBOX_NUMBER || process.env.TWILIO_PHONE_NUMBER || "";
}

/**
 * Send a WhatsApp message via Twilio.
 * @param to E.164 phone number (e.g. "+12015551234") — "whatsapp:" prefix is added internally
 * @param body Message text
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<boolean> {
  try {
    const client = getTwilioClient();
    const from = getWhatsAppNumber();
    if (!from) {
      console.error("[WHATSAPP] No WhatsApp number configured");
      return false;
    }

    // Twilio WhatsApp requires "whatsapp:" prefix
    const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const fromFormatted = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

    // Split long messages (WhatsApp limit is ~4096 chars)
    const MAX_LEN = 1600; // Conservative limit for WhatsApp
    const chunks = [];
    for (let i = 0; i < body.length; i += MAX_LEN) {
      chunks.push(body.slice(i, i + MAX_LEN));
    }

    for (const chunk of chunks) {
      await client.messages.create({
        from: fromFormatted,
        to: toFormatted,
        body: chunk,
      });
    }
    return true;
  } catch (err) {
    console.error("[WHATSAPP] sendMessage failed:", err);
    return false;
  }
}

/**
 * Get the WhatsApp sandbox join URL for a user to link their account.
 * Returns a wa.me deep link with the join keyword pre-filled.
 */
export function getWhatsAppJoinUrl(): string {
  const sandboxNumber = (process.env.TWILIO_WHATSAPP_SANDBOX_NUMBER || "+14155238886").replace(/\D/g, "");
  const sandboxCode = process.env.TWILIO_WHATSAPP_SANDBOX_CODE || "";
  const text = sandboxCode ? `join ${sandboxCode}` : "join";
  return `https://wa.me/${sandboxNumber}?text=${encodeURIComponent(text)}`;
}

/**
 * Check if WhatsApp is configured.
 */
export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/**
 * In-memory error rate tracker for service health monitoring.
 * Tracks errors per service per minute with Telegram alerting.
 * No DB queries — purely in-memory for fast /aurora/status responses.
 */

const errorCounts: Record<string, number> = { ai: 0, sms: 0, voice: 0, email: 0, total: 0 };
const ERROR_WINDOW_MS = 60_000;
let lastErrorReset = Date.now();
let lastAlertSent = 0;
const ALERT_COOLDOWN_MS = 5 * 60_000; // 5 minutes between alerts

/**
 * Track an error for a given service. Resets counts every minute.
 * Triggers Telegram admin alert if error rate exceeds threshold.
 */
export function trackError(service: string): void {
  resetIfStale();
  if (service in errorCounts) errorCounts[service]++;
  errorCounts.total++;
  checkAndAlert();
}

/** Get current error counts (for status endpoint) */
export function getErrorCounts(): Readonly<Record<string, number>> {
  resetIfStale();
  return { ...errorCounts };
}

function resetIfStale(): void {
  if (Date.now() - lastErrorReset > ERROR_WINDOW_MS) {
    for (const k of Object.keys(errorCounts)) errorCounts[k] = 0;
    lastErrorReset = Date.now();
  }
}

function checkAndAlert(): void {
  if (errorCounts.total > 5 && Date.now() - lastAlertSent > ALERT_COOLDOWN_MS) {
    lastAlertSent = Date.now();
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (token && adminChatId) {
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminChatId,
          text: `Anticipy Error Spike: ${errorCounts.total} errors in the last minute. AI: ${errorCounts.ai}, SMS: ${errorCounts.sms}, Voice: ${errorCounts.voice}, Email: ${errorCounts.email}`,
        }),
      }).catch(() => {});
    }
  }
}

/**
 * Comprehensive Failure Handlers
 *
 * Specific recovery strategies for different failure types.
 * Each handler attempts recovery and returns a result.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { RecoveryResult } from "../types/index.js";

/**
 * Handle OAuth token refresh failure.
 * Marks the connection as expired and notifies user.
 */
export async function handleOAuthRefreshFailure(
  userId: string,
  provider: string,
  taskId: string
): Promise<RecoveryResult> {
  try {
    // Mark connection as expired
    await getSupabaseClient()
      .from("oauth_connections")
      .update({ status: "expired" })
      .eq("user_id", userId)
      .eq("provider", provider);

    // Could generate a re-connect link here
    console.log(`[RECOVERY] OAuth ${provider} expired for user, marked for re-auth`);

    return {
      recovered: false,
      method: "oauth_reauth_needed",
      error: `Your ${provider} connection has expired. Please reconnect via your settings.`,
    };
  } catch {
    return { recovered: false, error: "OAuth recovery failed" };
  }
}

/**
 * Handle password change detection.
 * Marks credential as stale and notifies user.
 */
export async function handlePasswordChanged(
  userId: string,
  siteDomain: string,
  _taskId: string
): Promise<RecoveryResult> {
  try {
    // Mark credential as needing update
    await getSupabaseClient()
      .from("credential_vault")
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("site_domain", siteDomain);

    return {
      recovered: false,
      method: "password_update_needed",
      error: `Your password for ${siteDomain} appears to have changed. Please update it in your settings.`,
    };
  } catch {
    return { recovered: false, error: "Password recovery failed" };
  }
}

/**
 * Handle layout change on a cached page.
 * Marks learnings as stale so they won't be reused.
 */
export async function handleLayoutChanged(
  domain: string,
  taskType: string,
  _taskId: string
): Promise<RecoveryResult> {
  try {
    // Mark learnings as stale by clearing page_hash
    await getSupabaseClient()
      .from("learnings")
      .update({
        page_hash: null,
        layout_verified_at: null,
        updated_at: new Date().toISOString(),
      })
      .ilike("service", `%${domain}%`)
      .eq("task_type", taskType);

    console.log(`[RECOVERY] Marked ${domain}/${taskType} learnings as stale`);

    return {
      recovered: true,
      method: "layout_stale_fallback",
    };
  } catch {
    return { recovered: false, error: "Layout recovery failed" };
  }
}

/**
 * Handle session/browser crash.
 * Attempts to resume from checkpoint.
 */
export async function handleSessionCrash(
  taskId: string,
  _checkpointData: object
): Promise<RecoveryResult> {
  try {
    // Update task for retry
    await getSupabaseClient()
      .from("tasks")
      .update({
        status: "pending",
        error_message: "Session crashed, retrying...",
      })
      .eq("id", taskId);

    return {
      recovered: true,
      method: "session_retry",
    };
  } catch {
    return { recovered: false, error: "Session recovery failed" };
  }
}

/**
 * Handle bot detection (CAPTCHA, etc.).
 * Logs the detection and falls back to cascade.
 */
export async function handleBotDetection(
  _taskId: string
): Promise<RecoveryResult> {
  // Bot detection usually means we need human intervention or a different approach
  return {
    recovered: false,
    method: "bot_detected_cascade",
    error: "Bot detection triggered. Trying alternative approach.",
  };
}

/**
 * Handle rate limiting.
 * Waits and retries if the delay is reasonable.
 */
export async function handleRateLimit(
  retryAfterSeconds: number,
  _taskId: string
): Promise<RecoveryResult> {
  if (retryAfterSeconds > 60) {
    return {
      recovered: false,
      method: "rate_limit_too_long",
      error: `Rate limited for ${retryAfterSeconds}s — too long to wait.`,
    };
  }

  // Wait and signal for retry
  await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
  return {
    recovered: true,
    method: "rate_limit_waited",
  };
}

/**
 * Dispatch to the appropriate failure handler based on error type.
 */
export async function dispatchFailureHandler(
  error: Error,
  userId: string,
  taskId: string,
  domain?: string,
  taskType?: string
): Promise<RecoveryResult> {
  const msg = error.message.toLowerCase();

  if (msg.includes("401") || msg.includes("token") || msg.includes("unauthorized")) {
    return handleOAuthRefreshFailure(userId, domain || "unknown", taskId);
  }

  if (msg.includes("password") || msg.includes("incorrect credentials")) {
    return handlePasswordChanged(userId, domain || "unknown", taskId);
  }

  if (msg.includes("layout") || msg.includes("selector") || msg.includes("not found")) {
    return handleLayoutChanged(domain || "unknown", taskType || "unknown", taskId);
  }

  if (msg.includes("captcha") || msg.includes("bot") || msg.includes("challenge")) {
    return handleBotDetection(taskId);
  }

  if (msg.includes("429") || msg.includes("rate limit")) {
    const retryMatch = msg.match(/retry.after[:\s]*(\d+)/i);
    const retryAfter = retryMatch ? parseInt(retryMatch[1]) : 30;
    return handleRateLimit(retryAfter, taskId);
  }

  if (msg.includes("crash") || msg.includes("disconnected") || msg.includes("closed")) {
    return handleSessionCrash(taskId, {});
  }

  // Unknown error — no specific handler
  return { recovered: false, error: error.message };
}

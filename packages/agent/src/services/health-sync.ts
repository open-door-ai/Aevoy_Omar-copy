/**
 * Health Sync Service — Agent-side Fitbit sync
 *
 * Called by the cron scheduler to pull yesterday's Fitbit data
 * for all active Fitbit OAuth connections.
 *
 * Handles:
 * - Token decryption
 * - Fitbit API calls (heart rate, sleep, steps)
 * - 401 → automatic token refresh
 * - Metric upsert into health_metrics table
 */

import { getSupabaseClient } from "../utils/supabase.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OAuthConnectionRow {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

interface FitbitNewTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

type MetricRow = {
  user_id: string;
  source: "fitbit";
  metric_type: string;
  value: number;
  unit: string;
  recorded_at: string;
  raw_data: unknown;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a Date as YYYY-MM-DD (Fitbit date format).
 */
function toFitbitDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Decrypt a token stored in the database.
 *
 * The agent does not import the web-side crypto lib, so we implement
 * AES-256-GCM decryption inline using Node.js built-ins.
 * Format expected: salt:iv:authTag:data (all base64) — or legacy 3-part.
 */
async function decryptToken(encryptedData: string): Promise<string> {
  const { createDecipheriv, scryptSync } = await import("crypto");

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY env var is not set");
  }

  const parts = encryptedData.split(":");

  let salt: Buffer;
  let ivB64: string;
  let authTagB64: string;
  let dataB64: string;

  if (parts.length === 4) {
    salt = Buffer.from(parts[0], "base64");
    ivB64 = parts[1];
    authTagB64 = parts[2];
    dataB64 = parts[3];
  } else if (parts.length === 3) {
    salt = Buffer.from("memory-salt");
    ivB64 = parts[0];
    authTagB64 = parts[1];
    dataB64 = parts[2];
  } else {
    throw new Error("Invalid encrypted data format");
  }

  const key = scryptSync(encryptionKey, salt, 32);
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  );
}

/**
 * Encrypt a token for storage (AES-256-GCM, random salt).
 */
async function encryptToken(plaintext: string): Promise<string> {
  const { createCipheriv, randomBytes, scryptSync } = await import("crypto");

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY env var is not set");
  }

  const salt = randomBytes(16);
  const key = scryptSync(encryptionKey, salt, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${salt.toString("base64")}:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Attempt to refresh a Fitbit access token.
 * On success, updates the oauth_connections row and returns the new access token.
 * Returns null on failure.
 */
async function refreshFitbitToken(
  conn: OAuthConnectionRow,
  userId: string
): Promise<string | null> {
  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;

  if (!clientId || !clientSecret || !conn.refresh_token) {
    return null;
  }

  let refreshTokenPlain: string;
  try {
    refreshTokenPlain = await decryptToken(conn.refresh_token);
  } catch (err) {
    console.error("[HEALTH SYNC] Failed to decrypt refresh token:", err);
    return null;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  try {
    const res = await fetch("https://api.fitbit.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshTokenPlain,
      }),
    });

    if (!res.ok) {
      console.error(
        `[HEALTH SYNC] Token refresh failed for ${userId}: HTTP ${res.status}`
      );
      return null;
    }

    const newTokens = (await res.json()) as FitbitNewTokens;
    const newAccessEncrypted = await encryptToken(newTokens.access_token);
    const newRefreshEncrypted = newTokens.refresh_token
      ? await encryptToken(newTokens.refresh_token)
      : conn.refresh_token;

    const sb = getSupabaseClient();
    await sb
      .from("oauth_connections")
      .update({
        access_token: newAccessEncrypted,
        refresh_token: newRefreshEncrypted,
        expires_at: new Date(
          Date.now() + (newTokens.expires_in || 28800) * 1000
        ).toISOString(),
      })
      .eq("id", conn.id)
      .eq("user_id", userId);

    return newTokens.access_token;
  } catch (err) {
    console.error("[HEALTH SYNC] Token refresh error:", err);
    return null;
  }
}

// ─── Core Sync Logic ──────────────────────────────────────────────────────────

/**
 * Sync yesterday's Fitbit data for a single user.
 * Returns the number of metric rows upserted.
 */
export async function syncFitbitForUser(
  userId: string,
  accessToken: string,
  conn?: OAuthConnectionRow
): Promise<number> {
  const sb = getSupabaseClient();

  // Get yesterday's date in YYYY-MM-DD format
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = toFitbitDate(yesterday);
  const dateTs = `${date}T12:00:00.000Z`;

  let currentToken = accessToken;

  /**
   * Wrapper for Fitbit API calls.
   * Handles 401 by attempting a token refresh once.
   */
  async function fitbitFetch(url: string): Promise<Response> {
    let res = await fetch(url, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });

    if (res.status === 401 && conn) {
      const newToken = await refreshFitbitToken(conn, userId);
      if (newToken) {
        currentToken = newToken;
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${currentToken}` },
        });
      }
    }

    return res;
  }

  const metrics: MetricRow[] = [];

  // 1. Heart Rate — resting heart rate
  try {
    const hrRes = await fitbitFetch(
      `https://api.fitbit.com/1/user/-/activities/heart/date/${date}/1d.json`
    );
    if (hrRes.ok) {
      const hrData = (await hrRes.json()) as {
        "activities-heart"?: Array<{
          value?: { restingHeartRate?: number };
        }>;
      };
      const restingHR =
        hrData["activities-heart"]?.[0]?.value?.restingHeartRate;
      if (typeof restingHR === "number" && restingHR > 0) {
        metrics.push({
          user_id: userId,
          source: "fitbit",
          metric_type: "heart_rate",
          value: restingHR,
          unit: "bpm",
          recorded_at: dateTs,
          raw_data: hrData["activities-heart"]?.[0] ?? {},
        });
      }
    }
  } catch (err) {
    console.error(`[HEALTH SYNC] Heart rate error for ${userId}:`, err);
  }

  // 2. Sleep — main sleep duration in hours
  try {
    const sleepRes = await fitbitFetch(
      `https://api.fitbit.com/1/user/-/sleep/date/${date}.json`
    );
    if (sleepRes.ok) {
      const sleepData = (await sleepRes.json()) as {
        sleep?: Array<{ duration?: number; isMainSleep?: boolean }>;
      };
      const mainSleep = sleepData.sleep?.find((s) => s.isMainSleep);
      const durationMs = mainSleep?.duration || 0;
      if (durationMs > 0) {
        const hours = Math.round((durationMs / 3_600_000) * 100) / 100;
        metrics.push({
          user_id: userId,
          source: "fitbit",
          metric_type: "sleep",
          value: hours,
          unit: "hours",
          recorded_at: dateTs,
          raw_data: mainSleep ?? {},
        });
      }
    }
  } catch (err) {
    console.error(`[HEALTH SYNC] Sleep error for ${userId}:`, err);
  }

  // 3. Steps — total step count
  try {
    const stepsRes = await fitbitFetch(
      `https://api.fitbit.com/1/user/-/activities/steps/date/${date}/1d.json`
    );
    if (stepsRes.ok) {
      const stepsData = (await stepsRes.json()) as {
        "activities-steps"?: Array<{ value?: string }>;
      };
      const stepsStr = stepsData["activities-steps"]?.[0]?.value;
      const steps = stepsStr ? parseInt(stepsStr, 10) : 0;
      if (steps > 0) {
        metrics.push({
          user_id: userId,
          source: "fitbit",
          metric_type: "steps",
          value: steps,
          unit: "steps",
          recorded_at: dateTs,
          raw_data: stepsData["activities-steps"]?.[0] ?? {},
        });
      }
    }
  } catch (err) {
    console.error(`[HEALTH SYNC] Steps error for ${userId}:`, err);
  }

  if (metrics.length === 0) {
    console.log(`[HEALTH SYNC] No metrics fetched for ${userId} on ${date}`);
    return 0;
  }

  const { error: upsertError } = await sb
    .from("health_metrics")
    .upsert(metrics, {
      onConflict: "user_id,source,metric_type,recorded_at",
      ignoreDuplicates: false,
    });

  if (upsertError) {
    console.error(`[HEALTH SYNC] Upsert error for ${userId}:`, upsertError);
  }

  console.log(
    `[HEALTH SYNC] Synced ${metrics.length} metric(s) for user ${userId} (${date})`
  );
  return metrics.length;
}

/**
 * Sync Fitbit data for ALL users with an active Fitbit connection.
 * Called by the daily cron job.
 */
export async function syncFitbitForAllUsers(): Promise<void> {
  const sb = getSupabaseClient();

  const { data: connections, error: fetchError } = await sb
    .from("oauth_connections")
    .select("id, user_id, access_token, refresh_token, expires_at")
    .eq("provider", "fitbit")
    .eq("status", "active");

  if (fetchError) {
    console.error("[HEALTH SYNC] Failed to fetch connections:", fetchError);
    return;
  }

  if (!connections || connections.length === 0) {
    console.log("[HEALTH SYNC] No active Fitbit connections found");
    return;
  }

  console.log(
    `[HEALTH SYNC] Starting sync for ${connections.length} Fitbit connection(s)`
  );

  const results = await Promise.allSettled(
    connections.map(async (conn) => {
      const row = conn as OAuthConnectionRow;

      if (!row.access_token) {
        console.warn(
          `[HEALTH SYNC] No access token for user ${row.user_id}, skipping`
        );
        return;
      }

      let accessTokenPlain: string;
      try {
        accessTokenPlain = await decryptToken(row.access_token);
      } catch (err) {
        console.error(
          `[HEALTH SYNC] Failed to decrypt token for ${row.user_id}:`,
          err
        );
        return;
      }

      await syncFitbitForUser(row.user_id, accessTokenPlain, row);
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  console.log(
    `[HEALTH SYNC] Complete — ${succeeded} succeeded, ${failed} failed`
  );
}

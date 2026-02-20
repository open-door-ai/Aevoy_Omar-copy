import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt, encrypt } from "@/lib/encryption";

const FITBIT_CLIENT_ID = process.env.FITBIT_CLIENT_ID;
const FITBIT_CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET;

interface FitbitTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface OAuthConnection {
  id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

/**
 * Refresh a Fitbit access token using the stored refresh token.
 * Updates the oauth_connections row with new tokens.
 * Returns the new access token, or null on failure.
 */
async function refreshFitbitToken(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  conn: OAuthConnection
): Promise<string | null> {
  if (!conn.refresh_token || !FITBIT_CLIENT_ID || !FITBIT_CLIENT_SECRET) {
    return null;
  }

  let refreshTokenPlain: string;
  try {
    refreshTokenPlain = await decrypt(conn.refresh_token);
  } catch {
    console.error("[FITBIT SYNC] Failed to decrypt refresh token");
    return null;
  }

  const basicAuth = Buffer.from(
    `${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch("https://api.fitbit.com/oauth2/token", {
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

  if (!tokenRes.ok) {
    console.error(`[FITBIT SYNC] Token refresh failed: HTTP ${tokenRes.status}`);
    return null;
  }

  const newTokens = (await tokenRes.json()) as FitbitTokens;

  // Encrypt and persist new tokens
  const newAccessEncrypted = await encrypt(newTokens.access_token);
  const newRefreshEncrypted = newTokens.refresh_token
    ? await encrypt(newTokens.refresh_token)
    : conn.refresh_token;

  await supabase
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
}

/**
 * Format a Date as YYYY-MM-DD (Fitbit date format).
 */
function toFitbitDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Fetch metrics from Fitbit API for a given date.
 * Automatically retries with refreshed token on 401.
 * Returns an array of metric rows ready for upserting into health_metrics.
 */
async function fetchFitbitMetrics(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  conn: OAuthConnection,
  accessToken: string,
  date: string
): Promise<Array<{
  user_id: string;
  source: string;
  metric_type: string;
  value: number;
  unit: string;
  recorded_at: string;
  raw_data: unknown;
}>> {
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  });

  type FetchFn = (token: string) => Promise<Response>;

  async function fitbitFetch(url: string): Promise<Response> {
    let res = await fetch(url, { headers: headers(accessToken) });

    if (res.status === 401) {
      // Try token refresh
      const newToken = await refreshFitbitToken(supabase, userId, conn);
      if (newToken) {
        accessToken = newToken; // eslint-disable-line no-param-reassign
        res = await fetch(url, { headers: headers(accessToken) });
      }
    }

    return res;
  }

  const metrics: Array<{
    user_id: string;
    source: string;
    metric_type: string;
    value: number;
    unit: string;
    recorded_at: string;
    raw_data: unknown;
  }> = [];

  const dateTs = `${date}T12:00:00.000Z`;

  // 1. Heart Rate — average resting heart rate for the day
  try {
    const hrRes = await fitbitFetch(
      `https://api.fitbit.com/1/user/-/activities/heart/date/${date}/1d.json`
    );
    if (hrRes.ok) {
      const hrData = await hrRes.json() as {
        "activities-heart"?: Array<{ value?: { restingHeartRate?: number } }>;
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
    console.error("[FITBIT SYNC] Heart rate fetch error:", err);
  }

  // 2. Sleep — total sleep duration in hours
  try {
    const sleepRes = await fitbitFetch(
      `https://api.fitbit.com/1/user/-/sleep/date/${date}.json`
    );
    if (sleepRes.ok) {
      const sleepData = await sleepRes.json() as {
        sleep?: Array<{ duration?: number; isMainSleep?: boolean }>;
      };
      // Main sleep duration in ms → hours
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
    console.error("[FITBIT SYNC] Sleep fetch error:", err);
  }

  // 3. Steps — total step count for the day
  try {
    const stepsRes = await fitbitFetch(
      `https://api.fitbit.com/1/user/-/activities/steps/date/${date}/1d.json`
    );
    if (stepsRes.ok) {
      const stepsData = await stepsRes.json() as {
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
    console.error("[FITBIT SYNC] Steps fetch error:", err);
  }

  // 4. Weight — most recent logged weight for the day (in kg)
  try {
    const weightRes = await fitbitFetch(
      `https://api.fitbit.com/1/user/-/body/weight/date/${date}/1d.json`
    );
    if (weightRes.ok) {
      const weightData = await weightRes.json() as {
        "body-weight"?: Array<{ value?: string }>;
      };
      const weightStr = weightData["body-weight"]?.[0]?.value;
      const weight = weightStr ? parseFloat(weightStr) : 0;
      if (weight > 0) {
        metrics.push({
          user_id: userId,
          source: "fitbit",
          metric_type: "weight",
          value: weight,
          unit: "kg",
          recorded_at: dateTs,
          raw_data: weightData["body-weight"]?.[0] ?? {},
        });
      }
    }
  } catch (err) {
    console.error("[FITBIT SYNC] Weight fetch error:", err);
  }

  return metrics;
}

/**
 * POST /api/health/sync — Trigger a manual Fitbit data sync for the authenticated user.
 * Fetches yesterday's metrics and upserts them into health_metrics.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the user's Fitbit OAuth connection
    const { data: conn, error: connError } = await supabase
      .from("oauth_connections")
      .select("id, access_token, refresh_token, expires_at")
      .eq("user_id", user.id)
      .eq("provider", "fitbit")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (connError || !conn) {
      return NextResponse.json({ error: "not_connected" }, { status: 400 });
    }

    if (!conn.access_token) {
      return NextResponse.json(
        { error: "No access token stored" },
        { status: 400 }
      );
    }

    // Decrypt the access token
    let accessToken: string;
    try {
      accessToken = await decrypt(conn.access_token);
    } catch {
      return NextResponse.json(
        { error: "Failed to decrypt access token" },
        { status: 500 }
      );
    }

    // Sync yesterday's data
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = toFitbitDate(yesterday);

    const metrics = await fetchFitbitMetrics(
      supabase,
      user.id,
      conn as OAuthConnection,
      accessToken,
      date
    );

    if (metrics.length > 0) {
      const { error: upsertError } = await supabase
        .from("health_metrics")
        .upsert(metrics, {
          onConflict: "user_id,source,metric_type,recorded_at",
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error("[FITBIT SYNC] Upsert error:", upsertError);
        // Non-fatal — still return partial results
      }
    }

    return NextResponse.json({
      synced: metrics.length,
      date,
    });
  } catch (err) {
    console.error("[FITBIT SYNC] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

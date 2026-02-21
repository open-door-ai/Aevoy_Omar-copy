/**
 * Calendar Service
 *
 * Reads and writes calendar events via the user's connected Google or Microsoft account.
 * Uses stored OAuth tokens from oauth_connections (managed by oauth-manager.ts).
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { getValidToken } from "./oauth-manager.js";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;      // ISO 8601
  end: string;        // ISO 8601
  attendees: string[];
  location?: string;
  description?: string;
  videoLink?: string;
  provider: "google" | "microsoft";
}

interface CreateEventInput {
  title: string;
  start: string;     // ISO 8601 or natural language-parseable
  end: string;
  attendees?: string[];
  description?: string;
  location?: string;
}

// ---- Helpers ----

function parseIso(dt: string): string {
  // If already ISO, return as-is; otherwise try to parse
  try {
    return new Date(dt).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// ---- Google Calendar ----

async function getGoogleEvents(token: string, daysAhead: number): Promise<CalendarEvent[]> {
  const now = new Date();
  const max = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: max.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    console.error("[CALENDAR] Google fetch error:", res.status, await res.text().catch(() => ""));
    return [];
  }

  const data = await res.json() as { items?: Record<string, unknown>[] };
  const items = data.items || [];

  return items.map((item) => {
    const start = item.start as Record<string, string> | undefined;
    const end = item.end as Record<string, string> | undefined;
    const attendeeList = item.attendees as { email?: string }[] | undefined;
    const loc = item.location as string | undefined;
    const desc = item.description as string | undefined;
    const confData = item.conferenceData as { entryPoints?: { entryPointType: string; uri: string }[] } | undefined;

    return {
      id: String(item.id || ""),
      title: String(item.summary || "No title"),
      start: parseIso((start?.dateTime || start?.date) ?? ""),
      end: parseIso((end?.dateTime || end?.date) ?? ""),
      attendees: (attendeeList || []).map((a) => a.email || "").filter(Boolean),
      location: loc,
      description: desc,
      videoLink: confData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri,
      provider: "google" as const,
    };
  });
}

async function createGoogleEvent(
  token: string,
  event: CreateEventInput
): Promise<{ success: boolean; eventId?: string; link?: string }> {
  const body: Record<string, unknown> = {
    summary: event.title,
    start: { dateTime: parseIso(event.start) },
    end: { dateTime: parseIso(event.end) },
  };

  if (event.description) body.description = event.description;
  if (event.location) body.location = event.location;
  if (event.attendees && event.attendees.length > 0) {
    body.attendees = event.attendees.map((email) => ({ email }));
  }

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    console.error("[CALENDAR] Google create error:", res.status);
    return { success: false };
  }

  const data = await res.json() as { id?: string; htmlLink?: string };
  return { success: true, eventId: data.id, link: data.htmlLink };
}

// ---- Microsoft Calendar ----

async function getMicrosoftEvents(token: string, daysAhead: number): Promise<CalendarEvent[]> {
  const now = new Date().toISOString();
  const max = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  const params = new URLSearchParams({
    "$filter": `start/dateTime ge '${now}' and start/dateTime le '${max}'`,
    "$orderby": "start/dateTime",
    "$top": "20",
    "$select": "id,subject,start,end,attendees,location,bodyPreview,onlineMeeting",
  });

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    console.error("[CALENDAR] Microsoft fetch error:", res.status);
    return [];
  }

  const data = await res.json() as { value?: Record<string, unknown>[] };
  const items = data.value || [];

  return items.map((item) => {
    const start = item.start as Record<string, string> | undefined;
    const end = item.end as Record<string, string> | undefined;
    const attendeeList = item.attendees as { emailAddress?: { address?: string } }[] | undefined;
    const loc = item.location as Record<string, string> | undefined;
    const onlineMtg = item.onlineMeeting as Record<string, string> | undefined;

    return {
      id: String(item.id || ""),
      title: String(item.subject || "No title"),
      start: parseIso(start?.dateTime ?? ""),
      end: parseIso(end?.dateTime ?? ""),
      attendees: (attendeeList || []).map((a) => a.emailAddress?.address || "").filter(Boolean),
      location: loc?.displayName,
      description: String(item.bodyPreview || ""),
      videoLink: onlineMtg?.joinUrl,
      provider: "microsoft" as const,
    };
  });
}

async function createMicrosoftEvent(
  token: string,
  event: CreateEventInput
): Promise<{ success: boolean; eventId?: string; link?: string }> {
  const body: Record<string, unknown> = {
    subject: event.title,
    start: { dateTime: parseIso(event.start), timeZone: "UTC" },
    end: { dateTime: parseIso(event.end), timeZone: "UTC" },
  };

  if (event.description) body.body = { contentType: "text", content: event.description };
  if (event.location) body.location = { displayName: event.location };
  if (event.attendees && event.attendees.length > 0) {
    body.attendees = event.attendees.map((email) => ({
      emailAddress: { address: email },
      type: "required",
    }));
  }

  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    console.error("[CALENDAR] Microsoft create error:", res.status);
    return { success: false };
  }

  const data = await res.json() as { id?: string; webLink?: string };
  return { success: true, eventId: data.id, link: data.webLink };
}

// ---- Public API ----

/**
 * Get calendar events for the next N days from the user's connected calendar (Google or Microsoft).
 */
export async function getCalendarEvents(
  userId: string,
  daysAhead = 7
): Promise<CalendarEvent[]> {
  // Try Google first
  const googleToken = await getValidToken(userId, "google");
  if (googleToken) {
    try {
      const events = await getGoogleEvents(googleToken.accessToken, daysAhead);
      if (events.length > 0 || googleToken) return events; // Return even if empty — calendar is connected
    } catch (err) {
      console.error("[CALENDAR] Google events error:", err);
    }
  }

  // Fall back to Microsoft
  const msToken = await getValidToken(userId, "microsoft");
  if (msToken) {
    try {
      return getMicrosoftEvents(msToken.accessToken, daysAhead);
    } catch (err) {
      console.error("[CALENDAR] Microsoft events error:", err);
    }
  }

  return [];
}

/**
 * Returns which calendar provider is connected for this user, or null if none.
 */
export async function getConnectedCalendarProvider(
  userId: string
): Promise<"google" | "microsoft" | null> {
  const googleToken = await getValidToken(userId, "google");
  if (googleToken) return "google";
  const msToken = await getValidToken(userId, "microsoft");
  if (msToken) return "microsoft";
  return null;
}

/**
 * Create a calendar event on the user's connected calendar.
 */
export async function createCalendarEvent(
  userId: string,
  event: CreateEventInput
): Promise<{ success: boolean; eventId?: string; link?: string; provider?: string }> {
  // Try Google first
  const googleToken = await getValidToken(userId, "google");
  if (googleToken) {
    try {
      const result = await createGoogleEvent(googleToken.accessToken, event);
      if (result.success) return { ...result, provider: "Google Calendar" };
    } catch (err) {
      console.error("[CALENDAR] Google create error:", err);
    }
  }

  // Fall back to Microsoft
  const msToken = await getValidToken(userId, "microsoft");
  if (msToken) {
    try {
      const result = await createMicrosoftEvent(msToken.accessToken, event);
      if (result.success) return { ...result, provider: "Outlook Calendar" };
    } catch (err) {
      console.error("[CALENDAR] Microsoft create error:", err);
    }
  }

  return { success: false };
}

/**
 * Format calendar events as a readable string for AI responses.
 */
export function formatEvents(events: CalendarEvent[]): string {
  if (events.length === 0) return "No upcoming events found.";
  return events.map((e) => {
    const start = new Date(e.start);
    const end = new Date(e.end);
    const dateStr = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeStr = `${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })} – ${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
    let line = `📅 ${e.title} | ${dateStr} ${timeStr}`;
    if (e.location) line += ` | 📍 ${e.location}`;
    if (e.videoLink) line += ` | 🔗 ${e.videoLink}`;
    if (e.attendees.length > 0) line += ` | 👥 ${e.attendees.slice(0, 3).join(", ")}${e.attendees.length > 3 ? ` +${e.attendees.length - 3}` : ""}`;
    return line;
  }).join("\n");
}

// Supabase import needed by getValidToken dependency — ensure service client is available
void getSupabaseClient;

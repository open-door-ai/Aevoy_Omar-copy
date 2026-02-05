/**
 * Skill Registry
 *
 * Manages a registry of API-based skills that can bypass browser automation.
 * Skills map user intents to direct API calls (Google Calendar, Gmail, Drive, etc.).
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { Skill } from "../types/index.js";

const DEFAULT_SKILLS: Omit<Skill, "id">[] = [
  {
    name: "google_calendar_create",
    provider: "google",
    action: "create_event",
    description: "Create a Google Calendar event",
    required_scopes: ["https://www.googleapis.com/auth/calendar.events"],
    api_endpoint: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    method: "POST",
    input_schema: { summary: "string", start: "datetime", end: "datetime", description: "string?" },
    enabled: true,
  },
  {
    name: "google_calendar_list",
    provider: "google",
    action: "list_events",
    description: "List upcoming Google Calendar events",
    required_scopes: ["https://www.googleapis.com/auth/calendar"],
    api_endpoint: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    method: "GET",
    input_schema: { timeMin: "datetime", timeMax: "datetime", maxResults: "number?" },
    enabled: true,
  },
  {
    name: "gmail_send",
    provider: "google",
    action: "send_email",
    description: "Send an email via Gmail API",
    required_scopes: ["https://www.googleapis.com/auth/gmail.send"],
    api_endpoint: "https://www.googleapis.com/gmail/v1/users/me/messages/send",
    method: "POST",
    input_schema: { to: "string", subject: "string", body: "string" },
    enabled: true,
  },
  {
    name: "gmail_search",
    provider: "google",
    action: "search_email",
    description: "Search Gmail messages",
    required_scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    api_endpoint: "https://www.googleapis.com/gmail/v1/users/me/messages",
    method: "GET",
    input_schema: { q: "string", maxResults: "number?" },
    enabled: true,
  },
  {
    name: "google_drive_list",
    provider: "google",
    action: "list_files",
    description: "List files in Google Drive",
    required_scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    api_endpoint: "https://www.googleapis.com/drive/v3/files",
    method: "GET",
    input_schema: { q: "string?", pageSize: "number?" },
    enabled: true,
  },
  {
    name: "microsoft_calendar_create",
    provider: "microsoft",
    action: "create_event",
    description: "Create a Microsoft Calendar event",
    required_scopes: ["Calendars.ReadWrite"],
    api_endpoint: "https://graph.microsoft.com/v1.0/me/events",
    method: "POST",
    input_schema: { subject: "string", start: "datetime", end: "datetime", body: "string?" },
    enabled: true,
  },
  {
    name: "microsoft_mail_send",
    provider: "microsoft",
    action: "send_email",
    description: "Send an email via Microsoft Graph",
    required_scopes: ["Mail.Send"],
    api_endpoint: "https://graph.microsoft.com/v1.0/me/sendMail",
    method: "POST",
    input_schema: { to: "string", subject: "string", body: "string" },
    enabled: true,
  },
  {
    name: "microsoft_mail_search",
    provider: "microsoft",
    action: "search_email",
    description: "Search Outlook messages",
    required_scopes: ["Mail.Read"],
    api_endpoint: "https://graph.microsoft.com/v1.0/me/messages",
    method: "GET",
    input_schema: { search: "string", top: "number?" },
    enabled: true,
  },
];

let seeded = false;

/**
 * Seed default skills into the database (idempotent).
 * Called once on server startup.
 */
export async function seedDefaultSkills(): Promise<void> {
  if (seeded) return;
  seeded = true;

  try {
    for (const skill of DEFAULT_SKILLS) {
      await getSupabaseClient()
        .from("skills")
        .upsert(skill, { onConflict: "name" });
    }
    console.log(`[SKILLS] Seeded ${DEFAULT_SKILLS.length} default skills`);
  } catch (error) {
    console.error("[SKILLS] Failed to seed skills:", error);
  }
}

/**
 * Find a matching skill for a task goal.
 * Matches based on keywords in the goal and available user providers.
 */
export async function findSkillForTask(
  goal: string,
  domains: string[],
  userProviders: string[]
): Promise<Skill | null> {
  if (userProviders.length === 0) return null;

  const text = goal.toLowerCase();

  // Determine which action to look for
  let action: string | null = null;

  if (text.includes("schedule") || text.includes("meeting") || text.includes("calendar") || text.includes("appointment")) {
    action = "create_event";
  } else if (text.includes("list events") || text.includes("my calendar") || text.includes("upcoming")) {
    action = "list_events";
  } else if ((text.includes("send") || text.includes("email") || text.includes("mail")) && !text.includes("search")) {
    action = "send_email";
  } else if (text.includes("search email") || text.includes("find email") || text.includes("look up email")) {
    action = "search_email";
  } else if (text.includes("drive") || text.includes("files") || text.includes("documents")) {
    action = "list_files";
  }

  if (!action) return null;

  try {
    const { data: skills } = await getSupabaseClient()
      .from("skills")
      .select("*")
      .eq("action", action)
      .eq("enabled", true)
      .in("provider", userProviders);

    if (!skills || skills.length === 0) return null;

    // Prefer Google over Microsoft (more common)
    const googleSkill = skills.find((s) => s.provider === "google");
    return (googleSkill || skills[0]) as Skill;
  } catch {
    return null;
  }
}

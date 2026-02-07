/**
 * API Executor
 *
 * Executes tasks via direct API calls instead of browser automation.
 * Uses OAuth tokens from oauth-manager to call Google/Microsoft APIs.
 */

import { getValidToken } from "../services/oauth-manager.js";
import type { ExecutionPlan, PlanStep } from "../types/index.js";

interface ApiActionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute a task plan via API calls.
 */
export async function executeViaApi(
  userId: string,
  plan: ExecutionPlan
): Promise<ApiActionResult[]> {
  const results: ApiActionResult[] = [];

  for (const step of plan.steps) {
    if (step.type !== "api_call") {
      results.push({ success: false, error: "Not an API step" });
      continue;
    }

    const provider = step.params.provider as string;
    const skillName = step.params.skillName as string;

    try {
      const token = await getValidToken(userId, provider);
      if (!token) {
        results.push({ success: false, error: `No valid ${provider} token` });
        continue;
      }

      const result = await executeSkill(skillName, token.accessToken, step);
      results.push(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push({ success: false, error: msg });
    }
  }

  return results;
}

async function executeSkill(
  skillName: string,
  accessToken: string,
  step: PlanStep
): Promise<ApiActionResult> {
  switch (skillName) {
    case "google_calendar_create":
      return googleCalendarCreate(accessToken, step.params);
    case "google_calendar_list":
      return googleCalendarList(accessToken, step.params);
    case "gmail_send":
      return gmailSend(accessToken, step.params);
    case "gmail_search":
      return gmailSearch(accessToken, step.params);
    case "google_drive_list":
      return googleDriveList(accessToken, step.params);
    case "google_sheets_create":
      return googleSheetsCreate(accessToken, step.params);
    case "google_sheets_append":
      return googleSheetsAppend(accessToken, step.params);
    case "google_sheets_read":
      return googleSheetsRead(accessToken, step.params);
    case "google_sheets_update":
      return googleSheetsUpdate(accessToken, step.params);
    case "microsoft_calendar_create":
      return microsoftCalendarCreate(accessToken, step.params);
    case "microsoft_mail_send":
      return microsoftMailSend(accessToken, step.params);
    case "microsoft_mail_search":
      return microsoftMailSearch(accessToken, step.params);
    default:
      return { success: false, error: `Unknown skill: ${skillName}` };
  }
}

// ---- Google Skills ----

async function googleCalendarCreate(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: params.summary || params.title,
        description: params.description || params.body || "",
        start: { dateTime: params.start, timeZone: params.timezone || "America/Los_Angeles" },
        end: { dateTime: params.end, timeZone: params.timezone || "America/Los_Angeles" },
        attendees: params.attendees
          ? (params.attendees as string[]).map((e) => ({ email: e }))
          : undefined,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return { success: false, error: `Calendar API error: ${err}` };
  }

  const event = await res.json();
  return {
    success: true,
    result: {
      eventId: event.id,
      htmlLink: event.htmlLink,
      summary: event.summary,
    },
  };
}

async function googleCalendarList(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events"
  );
  url.searchParams.set(
    "timeMin",
    (params.timeMin as string) || new Date().toISOString()
  );
  url.searchParams.set(
    "timeMax",
    (params.timeMax as string) ||
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  );
  url.searchParams.set("maxResults", String(params.maxResults || 10));
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return { success: false, error: "Calendar list failed" };

  const data = await res.json();
  const events = (data.items || []).map(
    (e: { summary?: string; start?: { dateTime?: string }; htmlLink?: string }) => ({
      summary: e.summary,
      start: e.start?.dateTime,
      link: e.htmlLink,
    })
  );

  return { success: true, result: { events, count: events.length } };
}

async function gmailSend(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const to = params.to as string;
  const subject = params.subject as string;
  const body = params.body as string;

  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  ).toString("base64url");

  const res = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  );

  if (!res.ok) return { success: false, error: "Gmail send failed" };
  const data = await res.json();
  return { success: true, result: { messageId: data.id } };
}

async function gmailSearch(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const q = encodeURIComponent(params.q as string || params.search as string || "");
  const maxResults = params.maxResults || 5;

  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return { success: false, error: "Gmail search failed" };
  const data = await res.json();
  return {
    success: true,
    result: { messages: data.messages || [], count: data.resultSizeEstimate || 0 },
  };
}

async function googleDriveList(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const q = params.q ? `&q=${encodeURIComponent(params.q as string)}` : "";
  const pageSize = params.pageSize || 10;

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}${q}&fields=files(id,name,mimeType,webViewLink)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return { success: false, error: "Drive list failed" };
  const data = await res.json();
  return { success: true, result: { files: data.files || [] } };
}

// ---- Google Sheets Skills (Session 17: Autonomous AI Employee) ----

async function googleSheetsCreate(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  // Create spreadsheet
  const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        title: params.title || "Untitled Spreadsheet",
      },
      sheets: [
        {
          properties: {
            title: params.sheetName || "Sheet1",
          },
        },
      ],
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    return { success: false, error: `Failed to create spreadsheet: ${err}` };
  }

  const sheet = await createRes.json();
  const spreadsheetId = sheet.spreadsheetId;

  // Populate with initial data if provided
  if (params.data && Array.isArray(params.data)) {
    const appendResult = await googleSheetsAppend(token, {
      spreadsheetId,
      range: "A1",
      data: params.data,
    });

    if (!appendResult.success) {
      return {
        success: true,
        result: {
          spreadsheetId,
          url: sheet.spreadsheetUrl,
          title: sheet.properties.title,
          warning: "Spreadsheet created but initial data failed to append",
        },
      };
    }
  }

  return {
    success: true,
    result: {
      spreadsheetId,
      url: sheet.spreadsheetUrl,
      title: sheet.properties.title,
    },
  };
}

async function googleSheetsAppend(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const spreadsheetId = params.spreadsheetId as string;
  const range = (params.range as string) || "A1";
  const values = params.data as unknown[][];

  if (!spreadsheetId) {
    return { success: false, error: "spreadsheetId is required" };
  }

  if (!values || !Array.isArray(values)) {
    return { success: false, error: "data must be a 2D array" };
  }

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return { success: false, error: `Append failed: ${err}` };
  }

  const result = await res.json();
  return {
    success: true,
    result: {
      updatedRows: result.updates.updatedRows,
      updatedCells: result.updates.updatedCells,
    },
  };
}

async function googleSheetsRead(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const spreadsheetId = params.spreadsheetId as string;
  const range = (params.range as string) || "A1:Z1000";

  if (!spreadsheetId) {
    return { success: false, error: "spreadsheetId is required" };
  }

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    const err = await res.text();
    return { success: false, error: `Read failed: ${err}` };
  }

  const data = await res.json();
  return {
    success: true,
    result: {
      values: data.values || [],
      range: data.range,
    },
  };
}

async function googleSheetsUpdate(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const spreadsheetId = params.spreadsheetId as string;
  const range = params.range as string;
  const values = params.data as unknown[][];

  if (!spreadsheetId || !range) {
    return { success: false, error: "spreadsheetId and range are required" };
  }

  if (!values || !Array.isArray(values)) {
    return { success: false, error: "data must be a 2D array" };
  }

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return { success: false, error: `Update failed: ${err}` };
  }

  const result = await res.json();
  return {
    success: true,
    result: {
      updatedRows: result.updatedRows,
      updatedCells: result.updatedCells,
    },
  };
}

// ---- Microsoft Skills ----

async function microsoftCalendarCreate(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subject: params.subject || params.summary,
      body: {
        contentType: "Text",
        content: params.body || params.description || "",
      },
      start: {
        dateTime: params.start,
        timeZone: params.timezone || "Pacific Standard Time",
      },
      end: {
        dateTime: params.end,
        timeZone: params.timezone || "Pacific Standard Time",
      },
    }),
  });

  if (!res.ok) return { success: false, error: "Microsoft Calendar API error" };
  const event = await res.json();
  return {
    success: true,
    result: { eventId: event.id, webLink: event.webLink },
  };
}

async function microsoftMailSend(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/sendMail",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: params.subject,
          body: { contentType: "Text", content: params.body },
          toRecipients: [
            { emailAddress: { address: params.to } },
          ],
        },
      }),
    }
  );

  if (!res.ok) return { success: false, error: "Microsoft mail send failed" };
  return { success: true, result: { sent: true } };
}

async function microsoftMailSearch(
  token: string,
  params: Record<string, unknown>
): Promise<ApiActionResult> {
  const search = encodeURIComponent(params.search as string || params.q as string || "");
  const top = params.top || 5;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?$search="${search}"&$top=${top}&$select=subject,from,receivedDateTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return { success: false, error: "Microsoft mail search failed" };
  const data = await res.json();
  return { success: true, result: { messages: data.value || [] } };
}

/**
 * Extra Mile Service
 *
 * After completing any substantive task, the agent automatically thinks of
 * 10 ways to add value beyond what was literally asked, then executes the
 * best 3 immediately — without being asked.
 *
 * Examples:
 *   "Book a restaurant at 7pm" → Done. Extra: added calendar event, found parking nearby, texted confirmation
 *   "Find cheapest Sony headphones" → Done. Extra: checked eBay/Kijiji, set a price alert, emailed the link
 *   "Create a Figma account" → Done. Extra: bookmarked tutorials, noted the account in memory
 *   "Research flights to Tokyo" → Done. Extra: saved search to memory, checked visa requirements
 *
 * Design principles:
 *   - Max 30s total — never blocks main response
 *   - Fails silently — never affects main response
 *   - Never runs for pure research/text tasks
 *   - Only runs on genuinely completed (successful) tasks
 *   - AI dynamically generates ideas — no hardcoded per-task logic
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { updateMemoryWithFact } from "./memory.js";

// ---- Extra Mile Action Types ----

interface ExtraMileAction {
  type: "SAVE_MEMORY" | "ADD_CALENDAR" | "SCHEDULE_REMINDER" | "SEARCH_RELATED" | "SEND_SUMMARY";
  label: string;     // Human-readable: what was done
  params: Record<string, string>;
}

// ---- Cheap AI call (Groq Scout → DeepSeek → OpenRouter fallback) ----

async function callCheapAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const maxTokens = 600;

  // Groq Scout — fast, free, generous TPM
  if (process.env.GROQ_API_KEY) {
    try {
      const { default: OpenAI } = await import("openai");
      const groq = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      });
      const resp = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        max_tokens: maxTokens,
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      const content = resp.choices[0]?.message?.content || "";
      if (content.trim().length > 10) return content.trim();
    } catch {
      // Fall through
    }
  }

  // DeepSeek — cheap, reliable
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const { default: OpenAI } = await import("openai");
      const ds = new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: "https://api.deepseek.com",
      });
      const resp = await ds.chat.completions.create({
        model: "deepseek-chat",
        max_tokens: maxTokens,
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      const content = resp.choices[0]?.message?.content || "";
      if (content.trim().length > 10) return content.trim();
    } catch {
      // Fall through
    }
  }

  // OpenRouter free tier
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const { default: OpenAI } = await import("openai");
      const or = new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": "https://www.aevoy.com",
          "X-Title": "Aurora AI Assistant",
        },
      });
      const resp = await or.chat.completions.create({
        model: "mistralai/mistral-small-3.1-24b-instruct:free",
        max_tokens: maxTokens,
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      const content = resp.choices[0]?.message?.content || "";
      if (content.trim().length > 10) return content.trim();
    } catch {
      // Fall through
    }
  }

  return "";
}

// ---- Idea Parser ----
// Parse the AI's output into structured extra-mile actions.
// The AI is instructed to emit a specific format; this extracts actionable lines.

function parseExtraMileIdeas(aiOutput: string): ExtraMileAction[] {
  const actions: ExtraMileAction[] = [];
  const lines = aiOutput.split("\n").map(l => l.trim()).filter(l => l.length > 3);

  for (const line of lines) {
    // SAVE_MEMORY:"fact to remember"
    const memMatch = line.match(/SAVE_MEMORY:"([^"]{5,200})"/i);
    if (memMatch) {
      actions.push({
        type: "SAVE_MEMORY",
        label: `Saved to memory: ${memMatch[1].substring(0, 60)}`,
        params: { fact: memMatch[1] },
      });
      continue;
    }

    // ADD_CALENDAR:"title"|"datetime"|"location"
    const calMatch = line.match(/ADD_CALENDAR:"([^"]{2,100})"\|"([^"]{2,50})"\|"([^"]*)"/i);
    if (calMatch) {
      actions.push({
        type: "ADD_CALENDAR",
        label: `Added to calendar: ${calMatch[1]}`,
        params: { title: calMatch[1], datetime: calMatch[2], location: calMatch[3] },
      });
      continue;
    }

    // SCHEDULE_REMINDER:"description"|"when"
    const schedMatch = line.match(/SCHEDULE_REMINDER:"([^"]{5,150})"\|"([^"]{2,50})"/i);
    if (schedMatch) {
      actions.push({
        type: "SCHEDULE_REMINDER",
        label: `Scheduled reminder: ${schedMatch[1].substring(0, 60)}`,
        params: { description: schedMatch[1], when: schedMatch[2] },
      });
      continue;
    }

    // SEARCH_RELATED:"search query to run later"
    const searchMatch = line.match(/SEARCH_RELATED:"([^"]{5,150})"/i);
    if (searchMatch) {
      actions.push({
        type: "SEARCH_RELATED",
        label: `Queued related search: ${searchMatch[1].substring(0, 60)}`,
        params: { query: searchMatch[1] },
      });
      continue;
    }
  }

  return actions;
}

// ---- Reminder time parser ----
// Converts relative strings like "tomorrow morning", "in 2 days", "next week" → ISO timestamp.

function parseReminderTime(when: string): string | null {
  const now = new Date();
  const lower = when.toLowerCase().trim();

  if (/\bin (\d+) days?\b/.test(lower)) {
    const days = parseInt(lower.match(/\bin (\d+) days?\b/)![1]);
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  if (/tomorrow/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(/evening/.test(lower) ? 18 : /afternoon/.test(lower) ? 14 : 9, 0, 0, 0);
    return d.toISOString();
  }
  if (/next week/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  if (/in an? hour/.test(lower)) {
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  }
  if (/tonight/.test(lower)) {
    const d = new Date(now);
    d.setHours(19, 0, 0, 0);
    return d > now ? d.toISOString() : null;
  }
  // Try direct date parse as last resort
  try {
    const parsed = new Date(when);
    if (!isNaN(parsed.getTime()) && parsed > now) return parsed.toISOString();
  } catch { /* ignore */ }

  return null;
}

// ---- Calendar datetime parser ----
// Extracts a useful datetime from loosely-formatted strings like "Friday March 7 at 7:30 PM".

function parseCalendarDatetime(datetimeStr: string): string | null {
  try {
    const parsed = new Date(datetimeStr);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  } catch { /* ignore */ }

  // Try extracting date patterns like "March 7 at 7pm"
  const match = datetimeStr.match(/(\w+ \d{1,2}(?:,? \d{4})?)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
  if (match) {
    try {
      const parsed = new Date(`${match[1]} ${match[2]}`);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    } catch { /* ignore */ }
  }

  return null;
}

// ---- Executor for each extra-mile action type ----

async function executeExtraMileAction(
  action: ExtraMileAction,
  userId: string,
): Promise<string | null> {
  switch (action.type) {
    case "SAVE_MEMORY": {
      try {
        await updateMemoryWithFact(userId, action.params.fact);
        console.log(`[EXTRA-MILE] Saved memory: "${action.params.fact.substring(0, 60)}"`);
        return action.label;
      } catch (err) {
        console.warn("[EXTRA-MILE] Memory save failed:", err);
        return null;
      }
    }

    case "ADD_CALENDAR": {
      const isoTime = parseCalendarDatetime(action.params.datetime);
      if (!isoTime) {
        console.warn(`[EXTRA-MILE] Could not parse calendar time: "${action.params.datetime}"`);
        return null;
      }
      try {
        const { error } = await getSupabaseClient().from("scheduled_tasks").insert({
          user_id: userId,
          description: action.params.title,
          task_template: action.params.title,
          cron_expression: "once",
          next_run_at: isoTime,
          is_active: true,
          created_at: new Date().toISOString(),
        });
        if (error) throw error;
        const loc = action.params.location ? ` at ${action.params.location}` : "";
        console.log(`[EXTRA-MILE] Calendar event added: "${action.params.title}"${loc}`);
        return `${action.label}${loc}`;
      } catch (err) {
        console.warn("[EXTRA-MILE] Calendar insert failed:", err);
        return null;
      }
    }

    case "SCHEDULE_REMINDER": {
      const isoTime = parseReminderTime(action.params.when);
      if (!isoTime) {
        console.warn(`[EXTRA-MILE] Could not parse reminder time: "${action.params.when}"`);
        return null;
      }
      try {
        const { error } = await getSupabaseClient().from("scheduled_tasks").insert({
          user_id: userId,
          description: action.params.description,
          task_template: action.params.description,
          cron_expression: "once",
          next_run_at: isoTime,
          is_active: true,
          created_at: new Date().toISOString(),
        });
        if (error) throw error;
        console.log(`[EXTRA-MILE] Reminder scheduled: "${action.params.description.substring(0, 60)}" at ${isoTime}`);
        return action.label;
      } catch (err) {
        console.warn("[EXTRA-MILE] Reminder schedule failed:", err);
        return null;
      }
    }

    case "SEARCH_RELATED": {
      // We don't run the actual search here (would add latency).
      // Instead save it as a working memory note so future context is richer.
      try {
        await getSupabaseClient().from("user_memory").insert({
          user_id: userId,
          memory_type: "working",
          content: `Related search queued: ${action.params.query}`,
          source: "extra_mile_search_queue",
          created_at: new Date().toISOString(),
        });
        console.log(`[EXTRA-MILE] Related search queued: "${action.params.query.substring(0, 60)}"`);
        return action.label;
      } catch (err) {
        console.warn("[EXTRA-MILE] Search queue failed:", err);
        return null;
      }
    }

    default:
      return null;
  }
}

// ---- Main exported function ----

/**
 * After task completion, think of 10 extra-mile value-adds, execute the best 3.
 * Returns a brief summary string of what was done (for appending to the response),
 * or empty string if nothing was worth doing.
 *
 * Must complete within 30 seconds total.
 */
export async function executeExtraMile(
  task: string,
  body: string,
  result: string,
  userId: string,
  username: string,
  completedActionTypes: string[],
): Promise<string> {
  const EXTRA_MILE_TIMEOUT_MS = 28_000;
  const startTime = Date.now();

  try {
    // Skip for short/empty results — task likely didn't complete meaningfully
    if (!result || result.length < 80 || !task || task.length < 5) return "";

    // Skip if no completed actions — indicates a pure text/knowledge response
    // (Extra mile only fires when the agent actually DID something)
    if (completedActionTypes.length === 0) return "";

    // Skip for trivially simple tasks (greetings, single-word answers)
    const isSubstantive = /\b(booked|reserved|found|created|signed up|searched|ordered|purchased|called|emailed|scheduled|researched|built|generated|sent|registered|cancelled|completed)\b/i.test(result);
    if (!isSubstantive) return "";

    const alreadyHasCalendar = completedActionTypes.includes("create_event") || completedActionTypes.includes("check_calendar");
    const alreadyHasMemory = completedActionTypes.includes("remember");
    const alreadyHasSchedule = completedActionTypes.includes("schedule");
    const alreadyHasSms = completedActionTypes.includes("send_sms");

    const systemPrompt = `You are an elite executive assistant who always goes the extra mile. After completing a task, you automatically do 3 bonus actions the user didn't ask for but will love.

You have access to these action types:
- SAVE_MEMORY:"fact" — Save important info to the user's memory (prices, contacts, addresses, account details, reference info)
- ADD_CALENDAR:"event title"|"date/time (e.g. March 7 2026 at 7:00 PM)"|"location (or empty)" — Add an event/booking to calendar
- SCHEDULE_REMINDER:"reminder text"|"when (e.g. tomorrow morning, in 2 days, next week)" — Set a helpful reminder
- SEARCH_RELATED:"specific search query" — Queue a related search for context

SELECTION RULES (strictly enforced):
- Only choose actions with CONCRETE data from the task result (specific dates, prices, names, addresses, contacts)
- CALENDAR already done: ${alreadyHasCalendar ? "YES — do NOT suggest ADD_CALENDAR again" : "NO"}
- MEMORY already saved: ${alreadyHasMemory ? "YES — do NOT suggest SAVE_MEMORY again" : "NO"}
- SCHEDULE already set: ${alreadyHasSchedule ? "YES — do NOT suggest SCHEDULE_REMINDER again" : "NO"}
- SMS already sent: ${alreadyHasSms ? "YES — think of other value-adds" : "NO"}
- If the result is just advice/research with no concrete data → output only: NONE
- Do not invent data that isn't in the result
- Maximum 3 actions — pick only the ones with clear concrete data`;

    const userPrompt = `TASK: "${task.substring(0, 200)}"
RESULT: "${result.substring(0, 600)}"
ACTIONS TAKEN: ${completedActionTypes.join(", ") || "none"}
USER: ${username}

First, mentally list 10 ways you could add value (don't output the list).
Then select the best 3 that have CONCRETE data to act on RIGHT NOW.

Output ONLY the selected actions in this exact format (one per line):
SAVE_MEMORY:"specific fact worth remembering for future reference"
ADD_CALENDAR:"descriptive event title"|"exact date and time"|"location or venue name"
SCHEDULE_REMINDER:"actionable reminder text"|"when to remind (e.g. tomorrow morning)"
SEARCH_RELATED:"specific follow-up search query"

Or output: NONE (if no concrete data available for any action)`;

    const aiOutput = await Promise.race([
      callCheapAI(systemPrompt, userPrompt),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("Extra mile AI timeout")), 15_000)
      ),
    ]).catch(() => "");

    if (!aiOutput || aiOutput.trim() === "NONE" || aiOutput.trim() === "") {
      console.log("[EXTRA-MILE] AI returned no actionable extras");
      return "";
    }

    console.log(`[EXTRA-MILE] AI output (${aiOutput.length} chars): ${aiOutput.substring(0, 200)}`);

    const ideas = parseExtraMileIdeas(aiOutput);
    if (ideas.length === 0) {
      console.log("[EXTRA-MILE] No parseable actions in AI output");
      return "";
    }

    console.log(`[EXTRA-MILE] Parsed ${ideas.length} action(s) to execute`);

    // Execute up to 3 actions, with per-action timeout
    const done: string[] = [];
    for (const idea of ideas.slice(0, 3)) {
      if (Date.now() - startTime > EXTRA_MILE_TIMEOUT_MS) {
        console.log("[EXTRA-MILE] Timeout — stopping early");
        break;
      }

      try {
        const label = await Promise.race([
          executeExtraMileAction(idea, userId),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error(`Extra mile action timeout: ${idea.type}`)), 8_000)
          ),
        ]).catch(err => {
          console.warn(`[EXTRA-MILE] Action ${idea.type} timed out or failed:`, err instanceof Error ? err.message : err);
          return null;
        });

        if (label) done.push(label);
      } catch (actionErr) {
        console.warn(`[EXTRA-MILE] Action ${idea.type} threw:`, actionErr);
      }
    }

    if (done.length === 0) return "";

    // Format the summary line (appended to main response)
    const summary = done.length === 1
      ? done[0]
      : done.slice(0, -1).join(", ") + " and " + done[done.length - 1];

    console.log(`[EXTRA-MILE] Completed ${done.length} extra action(s) in ${Date.now() - startTime}ms: ${summary}`);
    return summary;

  } catch (err) {
    // Non-critical — never let extra mile affect the main response
    console.warn("[EXTRA-MILE] Top-level error (suppressed):", err instanceof Error ? err.message : err);
    return "";
  }
}

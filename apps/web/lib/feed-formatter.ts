export interface FeedItem {
  id: string;
  summary: string; // Clean, human-readable text in Aurora's voice
  channel:
    | "sms"
    | "email"
    | "voice"
    | "web"
    | "telegram"
    | "whatsapp"
    | "microphone"
    | "proactive";
  status: "completed" | "processing" | "failed" | "pending";
  timestamp: string;
  isUser?: boolean; // true = user message, false/undefined = Aurora response
}

// Patterns that indicate raw/debug data that must NEVER be shown
const RAW_DATA_PATTERNS = [
  /\[ref[=_]/i, // DOM references
  /ref=e\d+/i, // Element refs
  /browser_(click|fill|snapshot|go|read|scroll)/i, // Tool names
  /aria-/i, // Accessibility attributes
  /<[a-z]+[^>]*>/i, // HTML tags
  /checkbox.*robot/i, // CAPTCHA references
  /Actionable elements/i, // Snapshot output
  /\.ts:\d+/, // Stack traces
  /\{.*"role".*"content"/, // Raw JSON
  /https?:\/\/[^\s]+\.(js|css|json)/i, // Asset URLs
  /https?:\/\/[^\s]+/i, // All URLs (stripped unless confirmation links)
  /\d{3,}/, // Status codes and long number sequences
  /null|undefined|NaN|\[object Object\]/i, // Garbage data
  /\*\*Also did for you:\*\*/, // Markdown artifacts
  /Saved to memory:/i, // Internal memory operations
  /\[CRED_/i, // Credential placeholders
];

// JSON-like multiline pattern
const JSON_PATTERN = /\{[^}]*:[^}]*\}/;

// URLs that ARE user-facing (keep these)
const USER_FACING_URL_PATTERNS = [
  /booking/i,
  /confirmation/i,
  /receipt/i,
  /invoice/i,
  /document/i,
  /docs\.google/i,
  /drive\.google/i,
  /dropbox/i,
  /calendar/i,
];

function isUserFacingUrl(url: string): boolean {
  return USER_FACING_URL_PATTERNS.some((p) => p.test(url));
}

export function formatTaskForFeed(task: {
  id: string;
  email_subject?: string;
  response_text?: string;
  input_channel?: string;
  status: string;
  created_at: string;
}): FeedItem[] {
  const items: FeedItem[] = [];

  // User message (only if it's a real user message, not raw data)
  if (task.email_subject && !containsRawData(task.email_subject)) {
    items.push({
      id: `${task.id}-user`,
      summary: task.email_subject,
      channel: (task.input_channel as FeedItem["channel"]) || "web",
      status: task.status as FeedItem["status"],
      timestamp: task.created_at,
      isUser: true,
    });
  }

  // Aurora response — clean it up
  if (task.response_text) {
    const cleaned = cleanResponse(task.response_text);
    if (cleaned) {
      items.push({
        id: `${task.id}-aurora`,
        summary: cleaned,
        channel: (task.input_channel as FeedItem["channel"]) || "web",
        status: task.status as FeedItem["status"],
        timestamp: task.created_at,
        isUser: false,
      });
    }
  } else if (task.status === "processing") {
    items.push({
      id: `${task.id}-aurora`,
      summary: "",
      channel: "web",
      status: "processing",
      timestamp: task.created_at,
      isUser: false,
    });
  }

  return items;
}

function containsRawData(text: string): boolean {
  return RAW_DATA_PATTERNS.some((pattern) => pattern.test(text)) ||
    JSON_PATTERN.test(text);
}

function cleanResponse(text: string): string {
  if (!text) return "";

  // If the response is mostly raw data, extract just the final answer
  if (containsRawData(text)) {
    // Try to find the last meaningful sentence that doesn't contain raw data
    const sentences = text.split(/[.!?]\s+/);
    const clean = sentences.filter(
      (s) => !containsRawData(s) && s.trim().length > 10
    );
    if (clean.length > 0) {
      const result = clean.slice(-3).join(". ").trim();
      // Ensure it ends with punctuation
      if (!/[.!?]$/.test(result)) {
        return result + ".";
      }
      return result;
    }
    return "Aurora completed a task."; // Fallback
  }

  // Strip any inline raw data patterns
  let cleaned = text;
  cleaned = cleaned.replace(/\[ref[=_][^\]]*\]/g, "");
  cleaned = cleaned.replace(/ref=e\d+/g, "");
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  cleaned = cleaned.replace(/\[CRED_[^\]]*\]/g, "");
  cleaned = cleaned.replace(/Saved to memory:[^\n]*/gi, "");
  cleaned = cleaned.replace(/\*\*Also did for you:\*\*[^\n]*/g, "");
  cleaned = cleaned.replace(/null|undefined|NaN|\[object Object\]/gi, "");

  // Strip URLs unless they're user-facing
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, (match) => {
    if (isUserFacingUrl(match)) return match;
    return "";
  });

  // Clean up JSON fragments
  cleaned = cleaned.replace(/\{[^}]*:[^}]*\}/g, "");

  // Normalize whitespace
  cleaned = cleaned.replace(/\s{2,}/g, " ");
  cleaned = cleaned.trim();

  // If remaining text is under 10 chars, use fallback
  if (cleaned.length < 10) {
    return "Aurora completed a task.";
  }

  return cleaned;
}

export function formatProactiveForFeed(item: {
  id: string;
  action_type?: string;
  title?: string;
  description?: string;
  status: string;
  created_at: string;
  preferred_channel?: string;
}): FeedItem {
  return {
    id: `proactive-${item.id}`,
    summary: item.description || item.title || "Aurora noticed something.",
    channel: (item.preferred_channel as FeedItem["channel"]) || "proactive",
    status: item.status as FeedItem["status"],
    timestamp: item.created_at,
    isUser: false,
  };
}

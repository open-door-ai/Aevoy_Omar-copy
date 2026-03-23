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
];

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
      });
    }
  } else if (task.status === "processing") {
    items.push({
      id: `${task.id}-aurora`,
      summary: "",
      channel: "web",
      status: "processing",
      timestamp: task.created_at,
    });
  }

  return items;
}

function containsRawData(text: string): boolean {
  return RAW_DATA_PATTERNS.some((pattern) => pattern.test(text));
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
      return clean.slice(-3).join(". ").trim() + ".";
    }
    return "Aurora completed a task."; // Fallback
  }

  // Strip any inline raw data patterns
  let cleaned = text;
  cleaned = cleaned.replace(/\[ref[=_][^\]]*\]/g, "");
  cleaned = cleaned.replace(/ref=e\d+/g, "");
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  cleaned = cleaned.replace(/\s{2,}/g, " ");

  return cleaned.trim();
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
  };
}

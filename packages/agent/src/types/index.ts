export interface TaskRequest {
  userId: string;
  username: string;
  from: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  attachments?: Attachment[];
  taskId?: string; // Optional - if provided, use existing task record
}

export interface Attachment {
  filename: string;
  content: string; // base64 encoded
  contentType: string;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  response: string;
  actions: ActionResult[];
  error?: string;
}

export interface Action {
  type: "browse" | "search" | "screenshot" | "fill_form" | "send_email" | "remember" | "schedule";
  params: Record<string, unknown>;
}

export interface ActionResult {
  action: Action;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface Memory {
  facts: string;
  recentLogs: string;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  timezone: string;
  subscription_tier: string;
  messages_used: number;
  messages_limit: number;
}

export interface Task {
  id: string;
  user_id: string;
  status: string;
  type: string | null;
  email_subject: string | null;
  input_text: string | null;
  structured_intent: Record<string, unknown> | null;
  confidence: number | null;
  stuck_reason: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  tokens_used: number;
  cost_usd: number;
  error_message: string | null;
}

export interface AIResponse {
  content: string;
  actions: Action[];
  tokensUsed: number;
  cost?: number;
  model?: string;
}

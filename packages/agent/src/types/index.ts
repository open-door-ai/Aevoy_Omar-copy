// ---- Task Types ----

export type TaskType =
  | 'understand'
  | 'plan'
  | 'reason'
  | 'vision'
  | 'validate'
  | 'respond'
  | 'local'
  | 'classify'
  | 'generate'
  | 'complex';

export type ModelProvider =
  | 'deepseek'
  | 'kimi'
  | 'gemini'
  | 'groq'
  | 'sonnet'
  | 'haiku'
  | 'ollama';

// ---- Execution Plan ----

export interface ExecutionPlan {
  taskId: string;
  method: 'api' | 'browser_cached' | 'browser_new' | 'direct';
  steps: PlanStep[];
  requiredAuth: { provider: string; status: 'ready' | 'missing' }[];
  estimatedCost: number;
}

export interface PlanStep {
  type: 'api_call' | 'browser_action' | 'cached_step' | 'send_message';
  description: string;
  params: Record<string, unknown>;
}

// ---- Skill ----

export interface Skill {
  id: string;
  name: string;
  provider: string;
  action: string;
  description: string | null;
  required_scopes: string[];
  api_endpoint: string | null;
  method: string;
  input_schema: Record<string, unknown> | null;
  enabled: boolean;
}

// ---- Recovery Result ----

export interface RecoveryResult {
  recovered: boolean;
  method?: string;
  error?: string;
}

export type InputChannel = 'email' | 'sms' | 'voice' | 'chat' | 'web' | 'desktop' | 'proactive' | 'workflow';

export type MemoryType = 'short_term' | 'working' | 'long_term' | 'episodic';

// ---- Task Request/Result ----

export interface TaskRequest {
  userId: string;
  username: string;
  from: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  attachments?: Attachment[];
  taskId?: string;
  inputChannel?: InputChannel;
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

// ---- Actions ----

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

// ---- Memory ----

export interface Memory {
  facts: string;
  recentLogs: string;
  workingMemories?: WorkingMemory[];
  episodicMemories?: EpisodicMemory[];
}

export interface WorkingMemory {
  id: string;
  content: string;
  createdAt: string;
}

export interface EpisodicMemory {
  id: string;
  content: string;
  importance: number;
  createdAt: string;
}

export interface MemoryEntry {
  id: string;
  userId: string;
  memoryType: MemoryType;
  encryptedData: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
}

// ---- AI Response ----

export interface AIResponse {
  content: string;
  actions: Action[];
  tokensUsed: number;
  cost?: number;
  model?: string;
}

// ---- User Profile ----

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  phone: string | null;
  timezone: string;
  subscription_tier: string;
  subscription_status: string;
  messages_used: number;
  messages_limit: number;
  twilio_number: string | null;
  proactive_enabled: boolean;
  stripe_customer_id: string | null;
}

// ---- Task Record ----

export interface Task {
  id: string;
  user_id: string;
  status: string;
  type: string | null;
  email_subject: string | null;
  input_text: string | null;
  input_channel: InputChannel;
  structured_intent: Record<string, unknown> | null;
  confidence: number | null;
  stuck_reason: string | null;
  verification_status: string | null;
  verification_data: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  execution_time_ms: number | null;
  tokens_used: number;
  cost_usd: number;
  error_message: string | null;
}

// ---- Verification ----

export interface VerificationResult {
  passed: boolean;
  confidence: number;
  method: 'self_check' | 'evidence' | 'smart_review';
  evidence?: string;
  screenshotBase64?: string;
}

// ---- Proactive ----

export type ProactivePriority = 'high' | 'medium' | 'low';

export interface ProactiveFinding {
  trigger: string;
  action: string;
  channel: InputChannel;
  priority: ProactivePriority;
  userId: string;
  data?: Record<string, unknown>;
}

// ---- Action History (Undo) ----

export interface ActionHistoryEntry {
  id: string;
  taskId: string;
  userId: string;
  actionType: string;
  actionData: Record<string, unknown>;
  undoData: Record<string, unknown> | null;
  screenshotUrl: string | null;
  createdAt: string;
}

// ---- Voice/SMS ----

export interface VoiceCallRequest {
  userId: string;
  to: string;
  message: string;
  voice?: string;
}

export interface SmsRequest {
  userId: string;
  to: string;
  body: string;
}

export interface IncomingVoiceData {
  from: string;
  to: string;
  callSid: string;
  speechResult?: string;
}

export interface IncomingSmsData {
  from: string;
  to: string;
  body: string;
}

// ---- Cascade (Beyond-Browser Fallback) ----

/** Cascade levels: 1=Browser, 2=API, 3=Email service, 4=Draft, 5=Phone script, 6=Manual */
export type CascadeLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface CascadeResult {
  level: CascadeLevel;
  success: boolean;
  result?: string;
  error?: string;
}

// ---- Personality ----

export interface CompiledPersonality {
  hasSoul: boolean;
  hasIdentity: boolean;
  hasUserTemplate: boolean;
  usingFallback: boolean;
}

// ---- Identity ----

export interface ResolvedUser {
  userId: string;
  username: string;
  email: string;
  phone: string | null;
}

// ---- Task Knowledge ----

export interface TaskKnowledge {
  steps: string;
  gotchas: string;
  difficulty: number;
  successRate: number;
}

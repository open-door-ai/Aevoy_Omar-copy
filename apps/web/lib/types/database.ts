export interface Profile {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  timezone: string;
  subscription_tier: "free" | "starter" | "pro" | "business";
  messages_used: number;
  messages_limit: number;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
}

export interface Task {
  id: string;
  user_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  type: string | null;
  email_subject: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  tokens_used: number;
  cost_usd: number;
  error_message: string | null;
}

export interface ScheduledTask {
  id: string;
  user_id: string;
  description: string;
  cron_expression: string;
  timezone: string;
  next_run_at: string | null;
  last_run_at: string | null;
  is_active: boolean;
  run_count: number;
  created_at: string;
}

// API Response types
export interface UserResponse {
  id: string;
  username: string;
  email: string;
  aiEmail: string;
  displayName: string | null;
  timezone: string;
  subscription: {
    tier: string;
    messagesUsed: number;
    messagesLimit: number;
  };
}

export interface TasksResponse {
  tasks: Task[];
  total: number;
}

export interface StatsResponse {
  messagesUsed: number;
  messagesLimit: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
}

// Request types
export interface UpdateUserRequest {
  displayName?: string;
  timezone?: string;
}

export interface CreateScheduledTaskRequest {
  description: string;
  cronExpression: string;
  timezone?: string;
}

// Error response
export interface ErrorResponse {
  error: string;
  message: string;
}

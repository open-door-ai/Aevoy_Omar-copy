/**
 * V3 Processor Types
 *
 * Type definitions for the V3 tiered processor architecture.
 */

import type { TaskRequest, TaskResult, InputChannel } from '../types/index.js';

// ── Task Tiers ──

export type TaskTier = 'instant' | 'single_tool' | 'multi_step' | 'autonomous';

export interface TierClassification {
  tier: TaskTier;
  tool?: string;          // For single_tool tier: which tool to invoke
  reasoning?: string;     // Brief explanation of classification
}

// ── Tool System ──

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'browser' | 'communication' | 'file' | 'data' | 'system';
  parameters: Record<string, ToolParameter>;
  required?: string[];
  execute: (params: Record<string, unknown>, ctx: TaskContext) => Promise<ToolCallResult>;
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface ToolCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
  cost: number;
}

// ── Tool Call (from AI model) ──

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelResponse {
  content: string;
  toolCalls: ToolCall[];
  tokensUsed: number;
  cost: number;
  model: string;
}

// ── Task Context ──

export interface TaskContext {
  userId: string;
  username: string;
  email: string;
  from: string;
  taskId: string;
  inputChannel: InputChannel;
  profile: UserProfileContext;
  memory?: MemoryContext;
  personality?: string;
  budgetLimit: number;
  budgetSpent: number;
  startTime: number;
  timeoutMs: number;
  suppressEmail?: boolean;
  senderName?: string;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
  sessionHint?: { userId: string; domain: string };
  responsePrefix?: string;
}

export interface UserProfileContext {
  displayName: string | null;
  phone: string | null;
  timezone: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  messagesUsed: number;
  messagesLimit: number;
  twilioNumber: string | null;
  proactiveEnabled: boolean;
}

export interface MemoryContext {
  facts: string;
  recentLogs: string;
}

// ── Ledger ──

export interface Observation {
  step: number;
  toolName: string;
  params: Record<string, unknown>;
  result: ToolCallResult;
  timestamp: number;
}

export interface LedgerState {
  taskId: string;
  status: 'executing' | 'reviewing' | 'complete' | 'failed' | 'budget_exceeded' | 'timed_out';
  observations: Observation[];
  totalCost: number;
  stepsCompleted: number;
  stepsFailed: number;
  finalResponse?: string;
  error?: string;
}

// ── Re-exports for convenience ──

export type { TaskRequest, TaskResult, InputChannel };

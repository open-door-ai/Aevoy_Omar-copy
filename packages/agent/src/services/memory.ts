/**
 * Memory Service — 4-Type Memory System
 *
 * Types:
 * 1. Short-term: In-memory Map, keyed by taskId. Current task context. Cleared on completion.
 * 2. Working: Supabase user_memory (type='working'). Recent 7 days. Auto-compressed.
 * 3. Long-term: Encrypted MEMORY.md file. User preferences, facts. Never expires.
 * 4. Episodic: Supabase user_memory (type='episodic'). Specific event memories. Compressed over time.
 *
 * Cost optimization:
 * - Don't load all memories for every task
 * - Load: 5 most relevant long-term + 10 task-relevant + 5 most recent (24h)
 * - Estimate token count before sending to AI
 */

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getSupabaseClient } from "../utils/supabase.js";
import type { Memory, MemoryType, WorkingMemory, EpisodicMemory } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACES_DIR = path.join(__dirname, "../../workspaces");

const ALGORITHM = "aes-256-gcm";

// ---- Short-term memory (in-memory) ----

// TTL for short-term memory entries (30 minutes)
const SHORT_TERM_TTL_MS = 30 * 60 * 1000;

interface ShortTermEntry {
  data: Record<string, unknown>;
  createdAt: number;
}

const shortTermMemory = new Map<string, ShortTermEntry>();

// Periodic cleanup of expired short-term memory entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of shortTermMemory) {
    if (now - entry.createdAt > SHORT_TERM_TTL_MS) {
      shortTermMemory.delete(key);
    }
  }
}, 60_000); // Check every minute

export function setShortTermMemory(taskId: string, data: Record<string, unknown>): void {
  const existing = shortTermMemory.get(taskId);
  shortTermMemory.set(taskId, {
    data: { ...(existing?.data), ...data },
    createdAt: existing?.createdAt ?? Date.now(),
  });
}

export function getShortTermMemory(taskId: string): Record<string, unknown> | undefined {
  const entry = shortTermMemory.get(taskId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > SHORT_TERM_TTL_MS) {
    shortTermMemory.delete(taskId);
    return undefined;
  }
  return entry.data;
}

export function clearShortTermMemory(taskId: string): void {
  shortTermMemory.delete(taskId);
}

// ---- Encryption ----

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY not set");
  }
  return Buffer.from(key, "hex");
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
}

export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encrypted] = encryptedData.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// ---- Workspace management ----

export function getWorkspacePath(userId: string): string {
  // Strict UUID v4 validation to prevent path traversal
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    throw new Error("Invalid user ID format — expected UUID v4");
  }
  const resolved = path.join(WORKSPACES_DIR, userId);
  // Extra safety: ensure resolved path is under WORKSPACES_DIR
  if (!resolved.startsWith(path.resolve(WORKSPACES_DIR))) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

export async function ensureWorkspace(userId: string): Promise<string> {
  const workspacePath = getWorkspacePath(userId);
  const memoryDir = path.join(workspacePath, "memory");
  const filesDir = path.join(workspacePath, "files");

  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.mkdir(filesDir, { recursive: true });

  const memoryFilePath = path.join(workspacePath, "MEMORY.md.enc");
  try {
    await fs.access(memoryFilePath);
  } catch {
    const initialMemory = `# About User
- New user, no information yet

# Preferences
- No preferences recorded yet

# Learned
- Nothing learned yet
`;
    await fs.writeFile(memoryFilePath, encrypt(initialMemory));
  }

  return workspacePath;
}

// ---- Long-term memory (encrypted file) ----

async function loadLongTermMemory(userId: string): Promise<string> {
  const workspacePath = await ensureWorkspace(userId);
  try {
    const memoryFilePath = path.join(workspacePath, "MEMORY.md.enc");
    const encryptedContent = await fs.readFile(memoryFilePath, "utf8");
    return decrypt(encryptedContent);
  } catch {
    return "No memory available.";
  }
}

export async function saveMemory(userId: string, content: string): Promise<void> {
  const workspacePath = await ensureWorkspace(userId);
  const memoryFilePath = path.join(workspacePath, "MEMORY.md.enc");
  await fs.writeFile(memoryFilePath, encrypt(content));
}

// ---- Working memory (Supabase, last 7 days) ----

async function loadWorkingMemories(
  userId: string,
  limit: number = 10,
  keywords?: string[]
): Promise<WorkingMemory[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let query = getSupabaseClient()
    .from("user_memory")
    .select("id, encrypted_data, created_at")
    .eq("user_id", userId)
    .eq("memory_type", "working")
    .gte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  const memories: WorkingMemory[] = [];
  for (const row of data) {
    try {
      const content = decrypt(row.encrypted_data);
      // If keywords provided, filter by relevance
      if (keywords && keywords.length > 0) {
        const lower = content.toLowerCase();
        const relevant = keywords.some((kw) => lower.includes(kw.toLowerCase()));
        if (!relevant) continue;
      }
      memories.push({
        id: row.id,
        content,
        createdAt: row.created_at,
      });
    } catch {
      // Skip corrupted entries
    }
  }

  return memories;
}

// ---- Episodic memory (Supabase, compressed over time) ----

async function loadEpisodicMemories(
  userId: string,
  limit: number = 5,
  keywords?: string[]
): Promise<EpisodicMemory[]> {
  let query = getSupabaseClient()
    .from("user_memory")
    .select("id, encrypted_data, importance, created_at")
    .eq("user_id", userId)
    .eq("memory_type", "episodic")
    .order("importance", { ascending: false })
    .limit(limit);

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  const memories: EpisodicMemory[] = [];
  for (const row of data) {
    try {
      const content = decrypt(row.encrypted_data);
      if (keywords && keywords.length > 0) {
        const lower = content.toLowerCase();
        const relevant = keywords.some((kw) => lower.includes(kw.toLowerCase()));
        if (!relevant) continue;
      }
      memories.push({
        id: row.id,
        content,
        importance: row.importance || 0.5,
        createdAt: row.created_at,
      });
    } catch {
      // Skip corrupted
    }
  }

  return memories;
}

// ---- Cost-optimized context loading ----

/**
 * Load memory optimized for cost. Only loads what's relevant for the task.
 *
 * Loads:
 * - 5 most relevant long-term preferences
 * - 10 task-relevant working memories (keyword filtered)
 * - 5 most recent interactions (24h)
 * - Relevant episodic memories
 */
export async function loadMemory(userId: string, taskContext?: string): Promise<Memory> {
  // Extract keywords from task for relevance filtering
  const keywords = taskContext
    ? taskContext
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 10)
    : [];

  // Load all 3 persistent types in parallel
  const [longTerm, working, episodic, recentLogs] = await Promise.all([
    loadLongTermMemory(userId),
    loadWorkingMemories(userId, 10, keywords),
    loadEpisodicMemories(userId, 5, keywords),
    loadRecentLogs(userId, 3),
  ]);

  // Estimate total tokens to stay under budget
  const longTermTruncated = truncateToTokenBudget(longTerm, 500);
  const workingText = working.map((w) => w.content).join("\n");
  const workingTruncated = truncateToTokenBudget(workingText, 300);
  const episodicText = episodic.map((e) => e.content).join("\n");
  const episodicTruncated = truncateToTokenBudget(episodicText, 200);

  const facts = `${longTermTruncated}${workingTruncated ? "\n\nRecent:\n" + workingTruncated : ""}${episodicTruncated ? "\n\nMemories:\n" + episodicTruncated : ""}`;

  return {
    facts,
    recentLogs,
    workingMemories: working,
    episodicMemories: episodic,
  };
}

// ---- Save memories to Supabase ----

export async function saveWorkingMemory(userId: string, content: string): Promise<void> {
  await getSupabaseClient().from("user_memory").insert({
    user_id: userId,
    memory_type: "working",
    encrypted_data: encrypt(content),
    importance: 0.5,
  });
}

export async function saveEpisodicMemory(
  userId: string,
  content: string,
  importance: number = 0.7
): Promise<void> {
  await getSupabaseClient().from("user_memory").insert({
    user_id: userId,
    memory_type: "episodic",
    encrypted_data: encrypt(content),
    importance: Math.min(Math.max(importance, 0), 1),
  });
}

// ---- Daily log (encrypted file) ----

export async function appendDailyLog(userId: string, entry: string): Promise<void> {
  const workspacePath = await ensureWorkspace(userId);
  const memoryDir = path.join(workspacePath, "memory");

  const today = new Date().toISOString().split("T")[0];
  const logFilePath = path.join(memoryDir, `${today}.md.enc`);

  const timestamp = new Date().toISOString();
  const logEntry = `\n## ${timestamp}\n${entry}\n`;

  try {
    const existingContent = await fs.readFile(logFilePath, "utf8");
    const decrypted = decrypt(existingContent);
    await fs.writeFile(logFilePath, encrypt(decrypted + logEntry));
  } catch {
    const header = `# Daily Log - ${today}\n`;
    await fs.writeFile(logFilePath, encrypt(header + logEntry));
  }
}

export async function loadRecentLogs(userId: string, days: number): Promise<string> {
  const workspacePath = getWorkspacePath(userId);
  const memoryDir = path.join(workspacePath, "memory");

  const logs: string[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const logFilePath = path.join(memoryDir, `${dateStr}.md.enc`);

    try {
      const encryptedContent = await fs.readFile(logFilePath, "utf8");
      logs.push(decrypt(encryptedContent));
    } catch {
      // File doesn't exist
    }
  }

  return logs.join("\n\n---\n\n");
}

// ---- Update memory with new fact ----

export async function updateMemoryWithFact(userId: string, fact: string): Promise<void> {
  const longTerm = await loadLongTermMemory(userId);

  const updatedMemory = longTerm.replace(
    /# Learned\n/,
    `# Learned\n- ${fact}\n`
  );

  await saveMemory(userId, updatedMemory);

  // Also save as episodic memory for retrieval
  await saveEpisodicMemory(userId, fact, 0.6);
}

// ---- Memory compression ----

/**
 * Compress old working memories into long-term facts.
 * Should be called periodically (e.g., daily cron).
 * Uses DeepSeek (cheapest) for summarization.
 */
export async function compressOldMemories(userId: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Get old working memories
  const { data: oldMemories, error } = await getSupabaseClient()
    .from("user_memory")
    .select("id, encrypted_data")
    .eq("user_id", userId)
    .eq("memory_type", "working")
    .lt("created_at", sevenDaysAgo)
    .limit(50);

  if (error || !oldMemories || oldMemories.length === 0) {
    return 0;
  }

  // Decrypt and collect content
  const contents: string[] = [];
  const idsToDelete: string[] = [];

  for (const row of oldMemories) {
    try {
      const content = decrypt(row.encrypted_data);
      contents.push(content);
      idsToDelete.push(row.id);
    } catch {
      // Skip corrupted
      idsToDelete.push(row.id);
    }
  }

  if (contents.length === 0) {
    return 0;
  }

  // Summarize into long-term facts (using AI service)
  // For now, extract key facts using simple heuristic
  const allText = contents.join("\n");
  const keyFacts = extractKeyFacts(allText);

  if (keyFacts.length > 0) {
    // Append to long-term memory — only delete old working memories if save succeeds
    try {
      const longTerm = await loadLongTermMemory(userId);
      const newFacts = keyFacts.map((f) => `- ${f}`).join("\n");
      const updated = longTerm.replace(
        /# Learned\n/,
        `# Learned\n${newFacts}\n`
      );
      await saveMemory(userId, updated);
    } catch (saveErr) {
      console.error(`[MEMORY] Failed to save compressed facts, skipping delete of old memories:`, saveErr);
      return 0;
    }
  }

  // Delete compressed working memories only after successful save above
  if (idsToDelete.length > 0) {
    await getSupabaseClient()
      .from("user_memory")
      .delete()
      .in("id", idsToDelete);
  }

  console.log(`[MEMORY] Compressed ${idsToDelete.length} working memories for user ${userId}`);
  return idsToDelete.length;
}

// ---- Helpers ----

/**
 * Simple key fact extraction (no AI cost).
 * Extracts sentences containing preference/fact-like patterns.
 */
function extractKeyFacts(text: string): string[] {
  const facts: string[] = [];
  const patterns = [
    /prefers?\s+(.+)/gi,
    /likes?\s+(.+)/gi,
    /always\s+(.+)/gi,
    /never\s+(.+)/gi,
    /allergic\s+to\s+(.+)/gi,
    /lives?\s+in\s+(.+)/gi,
    /works?\s+(?:at|for)\s+(.+)/gi,
    /(?:name|called)\s+(.+)/gi,
    /favorite\s+(.+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const fact = match[0].trim();
      if (fact.length > 5 && fact.length < 200 && !facts.includes(fact)) {
        facts.push(fact);
      }
    }
  }

  return facts.slice(0, 10); // Max 10 facts per compression
}

/**
 * Truncate text to approximate token budget.
 * Rough estimate: 1 token ≈ 4 characters.
 */
function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + "\n[... truncated for cost optimization]";
}

/**
 * Estimate token count for text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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
import { encryptWithServerKey, decryptWithServerKey } from "../security/encryption.js";
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
// Uses encryptWithServerKey / decryptWithServerKey from encryption.ts
// which derive keys via scrypt (instead of raw hex key).

/**
 * Legacy decrypt for backward compatibility with old format.
 * Old format used raw hex ENCRYPTION_KEY directly (no scrypt derivation).
 * Format: ivHex:authTagHex:encryptedHex
 */
function legacyDecrypt(encryptedData: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY not set");
  }
  const keyBuf = Buffer.from(key, "hex");
  const [ivHex, authTagHex, encrypted] = encryptedData.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuf, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Encrypt using the unified encryption.ts system (scrypt-derived key).
 */
export async function encrypt(text: string): Promise<string> {
  return encryptWithServerKey(text);
}

/**
 * Decrypt with backward compatibility.
 * Tries new format (encryptWithServerKey) first, then falls back to legacy raw-hex format.
 */
export async function decrypt(encryptedData: string): Promise<string> {
  // Try new scrypt-based decryption first
  try {
    return await decryptWithServerKey(encryptedData);
  } catch {
    // Fall back to legacy raw-hex decryption for old data
  }
  // Legacy format: ivHex:authTagHex:encryptedHex (3 parts, all hex)
  return legacyDecrypt(encryptedData);
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
    await fs.writeFile(memoryFilePath, await encrypt(initialMemory));
  }

  return workspacePath;
}

// ---- Long-term memory (encrypted file) ----

async function loadLongTermMemory(userId: string): Promise<string> {
  const workspacePath = await ensureWorkspace(userId);
  try {
    const memoryFilePath = path.join(workspacePath, "MEMORY.md.enc");
    const encryptedContent = await fs.readFile(memoryFilePath, "utf8");
    return await decrypt(encryptedContent);
  } catch {
    return "No memory available.";
  }
}

export async function saveMemory(userId: string, content: string): Promise<void> {
  const workspacePath = await ensureWorkspace(userId);
  const memoryFilePath = path.join(workspacePath, "MEMORY.md.enc");
  await fs.writeFile(memoryFilePath, await encrypt(content));
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

  const memories: Array<WorkingMemory & { _score: number }> = [];
  for (const row of data) {
    try {
      const content = await decrypt(row.encrypted_data);
      // Score by keyword relevance
      let score = 0.5; // default
      if (keywords && keywords.length > 0) {
        const lower = content.toLowerCase();
        const matchCount = keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
        score = matchCount / keywords.length; // 0.0 to 1.0
        if (score === 0) continue; // No relevant keywords at all
      }
      memories.push({
        id: row.id,
        content,
        createdAt: row.created_at,
        _score: score,
      });
    } catch {
      // Skip corrupted entries
    }
  }

  // Sort by relevance score (highest first)
  memories.sort((a, b) => b._score - a._score);

  // Update last_accessed_at for loaded memories
  const loadedIds = memories.map(m => m.id);
  if (loadedIds.length > 0) {
    Promise.resolve(
      getSupabaseClient()
        .from("user_memory")
        .update({ last_accessed_at: new Date().toISOString() })
        .in("id", loadedIds)
    ).catch(() => { /* non-critical */ });
  }

  return memories.map(({ _score, ...m }) => m);
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

  const memories: Array<EpisodicMemory & { _score: number }> = [];
  for (const row of data) {
    try {
      const content = await decrypt(row.encrypted_data);
      const importance = row.importance || 0.5;
      let keywordOverlap = 0;
      if (keywords && keywords.length > 0) {
        const lower = content.toLowerCase();
        const matchCount = keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
        keywordOverlap = matchCount / keywords.length;
      }
      // Weighted score: importance 60%, keyword relevance 40%
      const score = (importance * 0.6) + (keywordOverlap * 0.4);
      memories.push({
        id: row.id,
        content,
        importance,
        createdAt: row.created_at,
        _score: score,
      });
    } catch {
      // Skip corrupted
    }
  }

  // Sort by combined score (highest first)
  memories.sort((a, b) => b._score - a._score);

  const result = memories.slice(0, limit);

  // Update last_accessed_at for loaded memories
  const loadedIds = result.map(m => m.id);
  if (loadedIds.length > 0) {
    Promise.resolve(
      getSupabaseClient()
        .from("user_memory")
        .update({ last_accessed_at: new Date().toISOString() })
        .in("id", loadedIds)
    ).catch(() => { /* non-critical */ });
  }

  return result.map(({ _score, ...m }) => m);
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
    encrypted_data: await encrypt(content),
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
    encrypted_data: await encrypt(content),
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
    const decrypted = await decrypt(existingContent);
    await fs.writeFile(logFilePath, await encrypt(decrypted + logEntry));
  } catch {
    const header = `# Daily Log - ${today}\n`;
    await fs.writeFile(logFilePath, await encrypt(header + logEntry));
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
      logs.push(await decrypt(encryptedContent));
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
      const content = await decrypt(row.encrypted_data);
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

// ---- Memory Decay ----

/**
 * Reduce importance of old memories by 0.1.
 * Targets memories older than 30 days with importance > 0.1.
 * Called periodically by the scheduler.
 */
export async function decayMemories(userId: string): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: oldMemories, error } = await getSupabaseClient()
    .from("user_memory")
    .select("id, importance")
    .eq("user_id", userId)
    .gt("importance", 0.1)
    .lt("created_at", thirtyDaysAgo)
    .limit(100);

  if (error || !oldMemories || oldMemories.length === 0) {
    return 0;
  }

  let decayed = 0;
  for (const mem of oldMemories) {
    const newImportance = Math.max(0.1, (mem.importance || 0.5) - 0.1);
    const { error: updateErr } = await getSupabaseClient()
      .from("user_memory")
      .update({ importance: newImportance })
      .eq("id", mem.id);
    if (!updateErr) decayed++;
  }

  if (decayed > 0) {
    console.log(`[MEMORY] Decayed ${decayed} memories for user ${userId.slice(0, 8)}`);
  }
  return decayed;
}

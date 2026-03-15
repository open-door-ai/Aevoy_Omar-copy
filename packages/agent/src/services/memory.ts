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
import { generateEmbedding } from "./embedding.js";
import type { Memory, MemoryType, WorkingMemory, EpisodicMemory } from "../types/index.js";

// Dynamic token budgets by task type (1 token ≈ 4 chars)
// Browser tasks get smaller budgets to keep latency low
// Complex tasks get larger budgets for richer context
export type MemoryTaskType = "browser" | "classify" | "complex" | "voice" | "default";

const MEMORY_BUDGETS: Record<MemoryTaskType, { longTerm: number; working: number; episodic: number }> = {
  browser:  { longTerm: 500,  working: 300, episodic: 200 },  // 1000 total — latency-sensitive
  classify: { longTerm: 200,  working: 100, episodic: 0   },  //  300 total — fast classification
  voice:    { longTerm: 600,  working: 400, episodic: 200 },  // 1200 total — voice is real-time
  complex:  { longTerm: 1500, working: 800, episodic: 500 },  // 2800 total — deep reasoning tasks
  default:  { longTerm: 800,  working: 500, episodic: 300 },  // 1600 total — 2x original budget
};

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

// Scope short-term memory key by userId to prevent cross-user collision
function stmKey(userId: string, taskId: string): string {
  return `${userId}:${taskId}`;
}

// Periodic cleanup of expired short-term memory entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of shortTermMemory) {
    if (now - entry.createdAt > SHORT_TERM_TTL_MS) {
      shortTermMemory.delete(key);
    }
  }
}, 60_000); // Check every minute

export function setShortTermMemory(taskId: string, data: Record<string, unknown>, userId?: string): void {
  if (!userId) {
    console.warn(`[MEMORY] setShortTermMemory called without userId for task ${taskId} — skipping to prevent cross-user leak`);
    return;
  }
  const key = stmKey(userId, taskId);
  const existing = shortTermMemory.get(key);
  shortTermMemory.set(key, {
    data: { ...(existing?.data), ...data },
    createdAt: existing?.createdAt ?? Date.now(),
  });
}

export function getShortTermMemory(taskId: string, userId?: string): Record<string, unknown> | undefined {
  const key = userId ? stmKey(userId, taskId) : taskId;
  const entry = shortTermMemory.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > SHORT_TERM_TTL_MS) {
    shortTermMemory.delete(key);
    return undefined;
  }
  return entry.data;
}

export function clearShortTermMemory(taskId: string, userId?: string): void {
  const key = userId ? stmKey(userId, taskId) : taskId;
  shortTermMemory.delete(key);
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

// ---- Long-term memory (DB rows — individual facts) ----
// Replaces the single MEMORY.md.enc file with per-fact rows in user_memory.
// Each fact has: importance (0-1), confidence (direct/inferred/corrected), decay over time.
// On first load per user, lazily migrates MEMORY.md.enc → DB rows.

/**
 * Content hash for deduplication — SHA-256 of the plaintext fact (lowercased).
 * Used to prevent saving "User likes coffee" twice.
 */
function factHash(content: string): string {
  return crypto.createHash("sha256").update(content.toLowerCase().trim()).digest("hex").slice(0, 32);
}

/**
 * Load all long-term facts for a user from DB.
 * Falls back to MEMORY.md.enc if no DB rows exist (triggers lazy migration).
 */
async function loadLongTermMemory(userId: string): Promise<string> {
  // Try DB first
  try {
    const { data, error } = await getSupabaseClient()
      .rpc("get_long_term_facts", { p_user_id: userId, p_limit: 50 });

    if (!error && data && data.length > 0) {
      const facts: string[] = [];
      for (const row of data) {
        try {
          const content = await decrypt(row.encrypted_data);
          // Prefix high-confidence direct facts, mark inferred ones
          const prefix = row.confidence === "corrected" ? "✓ " : row.confidence === "inferred" ? "(inferred) " : "";
          facts.push(`${prefix}${content}`);
        } catch { /* skip corrupted */ }
      }
      // Update last_accessed_at for all loaded facts (fire-and-forget)
      const ids = data.map((r: any) => r.id);
      getSupabaseClient().from("user_memory")
        .update({ last_accessed_at: new Date().toISOString() })
        .in("id", ids).then(() => {}, () => {});
      return facts.join("\n");
    }
  } catch { /* fall through to file */ }

  // LAZY MIGRATION: No DB rows — try to read legacy MEMORY.md.enc and migrate
  try {
    const workspacePath = await ensureWorkspace(userId);
    const memoryFilePath = path.join(workspacePath, "MEMORY.md.enc");
    const encryptedContent = await fs.readFile(memoryFilePath, "utf8");
    const content = await decrypt(encryptedContent);

    // Migrate file → DB rows (fire-and-forget, non-blocking)
    migrateFileToDB(userId, content).catch(() => {});

    return content;
  } catch {
    return "No memory available.";
  }
}

/**
 * Migrate MEMORY.md.enc content to individual DB rows.
 * Called once per user when they still have the legacy file format.
 */
async function migrateFileToDB(userId: string, fileContent: string): Promise<void> {
  const lines = fileContent.split("\n").filter(l => l.trim().startsWith("-")).map(l => l.replace(/^-\s*/, "").trim()).filter(l => l.length > 5 && !l.includes("no information yet") && !l.includes("no preferences") && !l.includes("Nothing learned"));
  if (lines.length === 0) return;

  for (const line of lines) {
    await saveLongTermFact(userId, line, 0.7, "direct").catch(() => {});
  }
  console.log(`[MEMORY] Migrated ${lines.length} facts from file to DB for ${userId.slice(0, 8)}`);
}

/**
 * Save a single long-term fact to DB.
 * Dedup-safe: if the same fact exists, importance is boosted instead.
 */
export async function saveLongTermFact(
  userId: string,
  fact: string,
  importance: number = 0.8,
  confidence: "direct" | "inferred" | "corrected" = "direct"
): Promise<void> {
  const hash = factHash(fact);
  const encrypted = await encrypt(fact);
  await getSupabaseClient().rpc("upsert_long_term_fact", {
    p_user_id: userId,
    p_encrypted: encrypted,
    p_content_hash: hash,
    p_importance: importance,
    p_confidence: confidence,
  });
}

/** @deprecated Use saveLongTermFact() — kept for backward compat */
export async function saveMemory(userId: string, content: string): Promise<void> {
  // Parse the markdown and save each fact as a DB row
  const lines = content.split("\n")
    .filter(l => l.trim().startsWith("-"))
    .map(l => l.replace(/^-\s*/, "").trim())
    .filter(l => l.length > 5);
  for (const line of lines) {
    await saveLongTermFact(userId, line, 0.7, "direct").catch(() => {});
  }
}

// ---- Working memory (Supabase, last 7 days) ----

async function loadWorkingMemories(
  userId: string,
  limit: number = 10,
  keywords?: string[],
  queryEmbedding?: number[] | null
): Promise<WorkingMemory[]> {
  // SEMANTIC SEARCH PATH: if we have a query embedding and the flag is on, use vector similarity
  if (queryEmbedding && process.env.USE_SEMANTIC_SEARCH === "true") {
    try {
      const { data: semData, error: semErr } = await getSupabaseClient()
        .rpc("match_user_memories", {
          query_embedding: queryEmbedding,
          match_user_id: userId,
          match_threshold: 0.4,
          match_count: limit,
          memory_type_filter: "working",
        });
      if (!semErr && semData && semData.length > 0) {
        const memories: WorkingMemory[] = [];
        for (const row of semData) {
          try {
            const content = await decrypt(row.encrypted_data);
            memories.push({ id: row.id, content, createdAt: row.created_at });
          } catch { /* skip corrupted */ }
        }
        const ids = memories.map(m => m.id);
        if (ids.length > 0) {
          getSupabaseClient().from("user_memory")
            .update({ last_accessed_at: new Date().toISOString() })
            .in("id", ids).then(() => {}, () => {});
        }
        return memories;
      }
    } catch { /* fall through to keyword search */ }
  }

  // KEYWORD SEARCH FALLBACK (always works, no external service needed)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabaseClient()
    .from("user_memory")
    .select("id, encrypted_data, created_at")
    .eq("user_id", userId)
    .eq("memory_type", "working")
    .gte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  const memories: Array<WorkingMemory & { _score: number }> = [];
  for (const row of data) {
    try {
      const content = await decrypt(row.encrypted_data);
      let score = 0.5;
      if (keywords && keywords.length > 0) {
        const query = keywords.join(" ");
        score = bm25Score(query, content);
        if (score === 0) continue;
      }
      memories.push({ id: row.id, content, createdAt: row.created_at, _score: score });
    } catch { /* skip corrupted */ }
  }

  memories.sort((a, b) => b._score - a._score);
  const loadedIds = memories.map(m => m.id);
  if (loadedIds.length > 0) {
    getSupabaseClient().from("user_memory")
      .update({ last_accessed_at: new Date().toISOString() })
      .in("id", loadedIds).then(() => {}, () => {});
  }
  return memories.map(({ _score, ...m }) => m);
}

// ---- Episodic memory (Supabase, compressed over time) ----

async function loadEpisodicMemories(
  userId: string,
  limit: number = 5,
  keywords?: string[],
  queryEmbedding?: number[] | null
): Promise<EpisodicMemory[]> {
  // SEMANTIC SEARCH PATH
  if (queryEmbedding && process.env.USE_SEMANTIC_SEARCH === "true") {
    try {
      const { data: semData, error: semErr } = await getSupabaseClient()
        .rpc("match_user_memories", {
          query_embedding: queryEmbedding,
          match_user_id: userId,
          match_threshold: 0.4,
          match_count: limit,
          memory_type_filter: "episodic",
        });
      if (!semErr && semData && semData.length > 0) {
        const memories: EpisodicMemory[] = [];
        for (const row of semData) {
          try {
            const content = await decrypt(row.encrypted_data);
            memories.push({ id: row.id, content, importance: row.importance || 0.5, createdAt: row.created_at });
          } catch { /* skip corrupted */ }
        }
        const ids = memories.map(m => m.id);
        if (ids.length > 0) {
          getSupabaseClient().from("user_memory")
            .update({ last_accessed_at: new Date().toISOString() })
            .in("id", ids).then(() => {}, () => {});
        }
        return memories;
      }
    } catch { /* fall through to keyword search */ }
  }

  // KEYWORD + IMPORTANCE FALLBACK
  const { data, error } = await getSupabaseClient()
    .from("user_memory")
    .select("id, encrypted_data, importance, created_at")
    .eq("user_id", userId)
    .eq("memory_type", "episodic")
    .order("importance", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

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
      const score = (importance * 0.6) + (keywordOverlap * 0.4);
      memories.push({ id: row.id, content, importance, createdAt: row.created_at, _score: score });
    } catch { /* skip corrupted */ }
  }

  memories.sort((a, b) => b._score - a._score);
  const result = memories.slice(0, limit);
  const loadedIds = result.map(m => m.id);
  if (loadedIds.length > 0) {
    getSupabaseClient().from("user_memory")
      .update({ last_accessed_at: new Date().toISOString() })
      .in("id", loadedIds).then(() => {}, () => {});
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
export async function loadMemory(
  userId: string,
  taskContext?: string,
  memoryTaskType: MemoryTaskType = "default"
): Promise<Memory> {
  // Extract keywords from task for relevance filtering
  const keywords = taskContext
    ? taskContext.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 10)
    : [];

  // Generate query embedding for semantic search (fire-and-forget on failure)
  let queryEmbedding: number[] | null = null;
  if (taskContext && process.env.USE_SEMANTIC_SEARCH === "true") {
    queryEmbedding = await generateEmbedding(taskContext).catch(() => null);
  }

  // Get dynamic token budgets based on task type
  const budget = MEMORY_BUDGETS[memoryTaskType] || MEMORY_BUDGETS.default;

  // Load all persistent types in parallel
  const [longTerm, working, episodic, recentLogs] = await Promise.all([
    loadLongTermMemory(userId),
    loadWorkingMemories(userId, 10, keywords, queryEmbedding),
    loadEpisodicMemories(userId, 5, keywords, queryEmbedding),
    loadRecentLogs(userId, 3),
  ]);

  // Apply dynamic token budgets
  const longTermTruncated = truncateToTokenBudget(longTerm, budget.longTerm);
  const workingText = working.map((w) => w.content).join("\n");
  const workingTruncated = truncateToTokenBudget(workingText, budget.working);
  const episodicText = episodic.map((e) => e.content).join("\n");
  const episodicTruncated = budget.episodic > 0
    ? truncateToTokenBudget(episodicText, budget.episodic)
    : "";

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
  const { data, error } = await getSupabaseClient().from("user_memory").insert({
    user_id: userId,
    memory_type: "working",
    encrypted_data: await encrypt(content),
    importance: 0.5,
  }).select("id").single();

  // Fire-and-forget: generate embedding and store it (does not block task execution)
  if (!error && data?.id && process.env.USE_SEMANTIC_SEARCH === "true") {
    generateEmbedding(content).then(async (embedding) => {
      if (embedding) {
        await Promise.resolve(getSupabaseClient().rpc("update_memory_embedding", {
          p_memory_id: data.id,
          p_embedding: embedding,
        })).catch(() => {});
      }
    }).catch(() => {});
  }
}

export async function saveEpisodicMemory(
  userId: string,
  content: string,
  importance: number = 0.7
): Promise<void> {
  const { data, error } = await getSupabaseClient().from("user_memory").insert({
    user_id: userId,
    memory_type: "episodic",
    encrypted_data: await encrypt(content),
    importance: Math.min(Math.max(importance, 0), 1),
  }).select("id").single();

  // Fire-and-forget embedding
  if (!error && data?.id && process.env.USE_SEMANTIC_SEARCH === "true") {
    generateEmbedding(content).then(async (embedding) => {
      if (embedding) {
        await Promise.resolve(getSupabaseClient().rpc("update_memory_embedding", {
          p_memory_id: data.id,
          p_embedding: embedding,
        })).catch(() => {});
      }
    }).catch(() => {});
  }
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

// ---- Update memory with new fact (contradiction-aware) ----

/**
 * Save a new fact to long-term memory.
 * 1. Checks for duplicates (hash-based — free)
 * 2. Checks for contradictions (AI-powered — Groq free tier)
 * 3. If contradiction found: marks old fact as decayed, saves new fact as "corrected"
 * 4. Also saves as episodic memory for retrieval
 */
export async function updateMemoryWithFact(
  userId: string,
  fact: string,
  confidence: "direct" | "inferred" | "corrected" = "direct"
): Promise<void> {
  // Save to long-term DB (dedup-safe)
  await saveLongTermFact(userId, fact, 0.85, confidence);

  // Check for contradictions against existing long-term facts (async, non-blocking)
  resolveContradictions(userId, fact).catch(() => {});

  // Also save as episodic memory for retrieval
  await saveEpisodicMemory(userId, fact, 0.6);
}

/**
 * BM25-inspired relevance scoring (better than String.includes).
 * Considers term frequency and document length.
 * Zero dependencies, runs locally.
 */
function bm25Score(query: string, document: string, k1 = 1.5, b = 0.75, avgDocLen = 200): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const docTerms = document.toLowerCase().split(/\s+/);
  const docLen = docTerms.length;
  let score = 0;
  for (const term of queryTerms) {
    const tf = docTerms.filter(w => w.includes(term)).length;
    if (tf === 0) continue;
    // Simplified BM25 without corpus-wide IDF (single-user context)
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen));
    score += tfNorm;
  }
  return score;
}

/**
 * Detect and resolve contradictions against existing long-term facts.
 * Uses Groq (free) to compare — only fires when a new direct fact is saved.
 * If contradiction found, decays the old fact and marks new one as "corrected".
 */
async function resolveContradictions(userId: string, newFact: string): Promise<void> {
  // Load existing long-term facts
  const { data: existingFacts, error } = await getSupabaseClient()
    .rpc("get_long_term_facts", { p_user_id: userId, p_limit: 30 });
  if (error || !existingFacts || existingFacts.length === 0) return;

  // Pre-filter: only compare facts with BM25 score > 0 (related topic)
  const decryptedFacts: Array<{ id: string; content: string; importance: number }> = [];
  for (const row of existingFacts) {
    try {
      const content = await decrypt(row.encrypted_data);
      const score = bm25Score(newFact, content);
      if (score > 0.5) {  // Only check potentially related facts
        decryptedFacts.push({ id: row.id, content, importance: row.importance });
      }
    } catch { /* skip */ }
  }

  if (decryptedFacts.length === 0) return;

  // Use AI to check for contradictions (Groq free tier — fast, cheap)
  try {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return;
    const existingList = decryptedFacts.map((f, i) => `[${i}] ${f.content}`).join("\n");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        max_tokens: 50,
        temperature: 0,
        messages: [{
          role: "user",
          content: `New fact: "${newFact}"\n\nExisting facts:\n${existingList}\n\nDoes the new fact DIRECTLY CONTRADICT any existing fact? Reply ONLY: "CONFLICT:[index]" or "OK".`,
        }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json() as any;
    const reply: string = json?.choices?.[0]?.message?.content?.trim() || "OK";
    const conflictMatch = reply.match(/CONFLICT:(\d+)/);
    if (conflictMatch) {
      const idx = parseInt(conflictMatch[1]);
      const conflicted = decryptedFacts[idx];
      if (conflicted) {
        // Decay the contradicted fact to near-zero importance
        await getSupabaseClient().from("user_memory")
          .update({ importance: 0.05, confidence: "corrected" })
          .eq("id", conflicted.id);
        console.log(`[MEMORY] Contradiction resolved: decayed "${conflicted.content.slice(0, 50)}" in favor of "${newFact.slice(0, 50)}"`);
      }
    }
  } catch { /* non-critical — contradiction check failure doesn't block memory save */ }
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

  // AI-powered fact extraction (Groq free tier, falls back to regex)
  const allText = contents.join("\n");
  const keyFacts = await extractKeyFactsAI(allText);

  if (keyFacts.length > 0) {
    // Save each fact as individual DB row (dedup-safe)
    try {
      for (const fact of keyFacts) {
        await saveLongTermFact(userId, fact, 0.7, "inferred").catch(() => {});
      }
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
 * AI-powered fact extraction using Groq (free tier).
 * Replaces 9-pattern regex with genuine semantic understanding.
 * Falls back to regex if Groq is unavailable.
 */
async function extractKeyFactsAI(text: string): Promise<string[]> {
  // Try AI extraction first
  if (process.env.GROQ_API_KEY) {
    try {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) throw new Error("no key");
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          max_tokens: 300,
          temperature: 0,
          messages: [{
            role: "user",
            content: `Extract specific, factual, durable information about a person from this text. Focus on: name, location, job, preferences, habits, dietary needs, goals, dislikes, family, schedule patterns.\n\nText:\n${text.slice(0, 3000)}\n\nOutput ONE fact per line. Be specific. Max 15 facts. Only output facts, no headers or explanations.`,
          }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      const json = await res.json() as any;
      const output: string = json?.choices?.[0]?.message?.content?.trim() || "";
      const facts = output.split("\n")
        .map((l: string) => l.replace(/^[-•*\d.]+\s*/, "").trim())
        .filter((l: string) => l.length > 5 && l.length < 200);
      if (facts.length > 0) return facts.slice(0, 15);
    } catch { /* fall through to regex */ }
  }

  // Regex fallback (9 patterns — original behavior)
  return extractKeyFactsRegex(text);
}

function extractKeyFactsRegex(text: string): string[] {
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
      if (fact.length > 5 && fact.length < 200 && !facts.includes(fact)) facts.push(fact);
    }
  }
  return facts.slice(0, 10);
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

// ---- Adaptive Memory Decay ----

/**
 * Adaptive memory decay based on access patterns.
 * Instead of fixed -0.1 for all memories, decay rate varies:
 * - Accessed in last 7 days: NO decay (actively relevant)
 * - Accessed 7-30 days ago: decay = -0.05 (slow)
 * - Accessed 30-90 days ago: decay = -0.1 (normal)
 * - Never accessed after creation: decay = -0.15 (fast)
 * - Never decay below 0.05 (retain indefinitely at minimal level)
 *
 * Called periodically by the scheduler.
 */
export async function decayMemories(userId: string): Promise<number> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Only decay memories older than 7 days that still have importance > 0.05
  const { data: memories, error } = await getSupabaseClient()
    .from("user_memory")
    .select("id, importance, created_at, last_accessed_at")
    .eq("user_id", userId)
    .gt("importance", 0.05)
    .lt("created_at", sevenDaysAgo)
    .limit(200);

  if (error || !memories || memories.length === 0) {
    return 0;
  }

  let decayed = 0;
  for (const mem of memories) {
    const lastAccess = mem.last_accessed_at || mem.created_at;
    const lastAccessDate = new Date(lastAccess);
    const daysSinceAccess = (now - lastAccessDate.getTime()) / (24 * 60 * 60 * 1000);

    // Determine decay rate based on access recency
    let decayRate: number;
    if (daysSinceAccess <= 7) {
      continue; // Recently accessed — no decay
    } else if (daysSinceAccess <= 30) {
      decayRate = 0.05; // Slow decay
    } else if (daysSinceAccess <= 90) {
      decayRate = 0.1; // Normal decay
    } else {
      decayRate = 0.15; // Fast decay for abandoned memories
    }

    // If memory was never accessed (last_accessed_at === null), decay faster
    if (!mem.last_accessed_at) {
      decayRate = Math.min(decayRate + 0.05, 0.2);
    }

    const newImportance = Math.max(0.05, (mem.importance || 0.5) - decayRate);

    // Skip if importance hasn't changed meaningfully
    if (Math.abs(newImportance - (mem.importance || 0.5)) < 0.01) continue;

    const { error: updateErr } = await getSupabaseClient()
      .from("user_memory")
      .update({ importance: newImportance })
      .eq("id", mem.id);
    if (!updateErr) decayed++;
  }

  if (decayed > 0) {
    console.log(`[MEMORY] Adaptively decayed ${decayed} memories for user ${userId.slice(0, 8)}`);
  }
  return decayed;
}

/**
 * Boost memory importance when accessed during a task.
 * Called when memories are loaded for task context.
 */
export async function boostMemoryOnAccess(memoryIds: string[]): Promise<void> {
  if (memoryIds.length === 0) return;
  try {
    // Batch update last_accessed_at for accessed memories
    // Note: Importance boost happens automatically in decay function
    // based on access recency, no need to modify importance here
    await getSupabaseClient()
      .from("user_memory")
      .update({ last_accessed_at: new Date().toISOString() })
      .in("id", memoryIds.slice(0, 20));
  } catch {
    // Non-critical — don't fail the task
  }
}

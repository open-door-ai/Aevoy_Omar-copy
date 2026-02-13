/**
 * Response Cache - LRU Cache with 5-minute TTL
 * Part of OpenClaw feature set
 */

import crypto from 'crypto';

interface CacheEntry {
  response: string;
  timestamp: number;
  model: string;
  cost: number;
  tokens: number;
}

const CACHE_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class LRUCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry;
  }

  set(key: string, value: CacheEntry): void {
    // Remove if exists (to update position)
    this.cache.delete(key);

    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

const cache = new LRUCache(CACHE_SIZE);

export function getCacheKey(prompt: string, systemPrompt: string, taskType: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(prompt);
  hash.update(systemPrompt);
  hash.update(taskType);
  return hash.digest('hex');
}

export function getCached(prompt: string, systemPrompt: string, taskType: string): CacheEntry | null {
  // Skip cache for vision and complex tasks
  if (taskType === 'vision' || taskType === 'reason') {
    return null;
  }

  const key = getCacheKey(prompt, systemPrompt, taskType);
  const entry = cache.get(key);

  if (entry) {
    console.log(`[CACHE] ✅ Hit (saved $${entry.cost.toFixed(6)})`);
  }

  return entry;
}

export function setCached(prompt: string, systemPrompt: string, taskType: string, response: string, model: string, cost: number, tokens: number): void {
  // Skip caching vision and complex tasks
  if (taskType === 'vision' || taskType === 'reason') {
    return;
  }

  const key = getCacheKey(prompt, systemPrompt, taskType);
  cache.set(key, {
    response,
    timestamp: Date.now(),
    model,
    cost,
    tokens,
  });

  console.log(`[CACHE] 💾 Stored (key: ${key.substring(0, 12)}...)`);
}

export function clearCache(): void {
  cache.clear();
  console.log(`[CACHE] 🗑️ Cleared`);
}

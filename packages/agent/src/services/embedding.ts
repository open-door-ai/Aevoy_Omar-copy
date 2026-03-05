/**
 * Embedding Service — Semantic Vector Generation
 *
 * Uses Cloudflare Workers AI (bge-small-en-v1.5, 384 dims) — free tier 10K req/day.
 * Falls back gracefully: if CF is unavailable, callers use keyword search instead.
 *
 * Feature flag: USE_SEMANTIC_SEARCH=true in env vars enables this path.
 * When flag is off, all functions are no-ops and callers fall back to keyword matching.
 */

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_MODEL = "@cf/baai/bge-small-en-v1.5";
const EMBEDDING_DIMS = 384;

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_MODEL = 'voyage-3-lite'; // 1024 dims, $0.02/M

// Track consecutive CF failures to avoid hammering a down service
let cfFailureCount = 0;
const CF_FAILURE_THRESHOLD = 5;
let cfBackoffUntil = 0;

async function generateVoyageEmbedding(text: string): Promise<number[] | null> {
  if (!VOYAGE_API_KEY) return null;
  try {
    const truncated = text.length > 4000 ? text.substring(0, 4000) : text;
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: [truncated], model: VOYAGE_MODEL }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: { embedding: number[] }[] };
    return json?.data?.[0]?.embedding || null;
  } catch { return null; }
}

/**
 * Generate an embedding vector for the given text.
 * Tries Voyage AI first (1024 dims, higher quality), falls back to CF Workers AI (384 dims).
 * Returns null if all embedding services are unavailable — callers MUST handle null.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (process.env.USE_SEMANTIC_SEARCH !== "true") return null;

  // Try Voyage AI first (higher quality)
  const voyageEmbedding = await generateVoyageEmbedding(text);
  if (voyageEmbedding) return voyageEmbedding;

  // Fall back to Cloudflare Workers AI
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) return null;

  // Back off if CF has been failing repeatedly
  if (cfFailureCount >= CF_FAILURE_THRESHOLD && Date.now() < cfBackoffUntil) {
    return null;
  }

  try {
    // Truncate to avoid CF's 512-token limit (rough: 1 token ≈ 4 chars → 2048 chars)
    const truncated = text.length > 2048 ? text.substring(0, 2048) : text;

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: [truncated] }),
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) {
      throw new Error(`CF API ${res.status}: ${res.statusText}`);
    }

    const json = await res.json() as { result?: { data?: number[][] }; success?: boolean };
    const embedding = json?.result?.data?.[0];

    if (!embedding || embedding.length !== EMBEDDING_DIMS) {
      throw new Error(`Unexpected embedding shape: ${embedding?.length}`);
    }

    // Reset failure count on success
    cfFailureCount = 0;
    return embedding;
  } catch (err) {
    cfFailureCount++;
    if (cfFailureCount >= CF_FAILURE_THRESHOLD) {
      // Backoff: 10 minutes before retrying CF
      cfBackoffUntil = Date.now() + 10 * 60 * 1000;
      console.warn(`[EMBED] CF Workers AI failing repeatedly (${cfFailureCount}x), backing off 10 min`);
    }
    if (cfFailureCount === 1) {
      // Only log the first error to avoid spam
      console.warn(`[EMBED] CF Workers AI error:`, err instanceof Error ? err.message : err);
    }
    return null;
  }
}

/**
 * Batch embed multiple texts. Returns array of same length with nulls for failures.
 * Useful for backfill jobs.
 */
export async function batchEmbed(texts: string[], batchSize = 20): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await Promise.all(batch.map(generateEmbedding));
    results.push(...embeddings);
    // Small delay between batches to respect rate limits
    if (i + batchSize < texts.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  return results;
}

/**
 * Cosine similarity between two vectors (used for local comparison if needed).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export { EMBEDDING_DIMS };

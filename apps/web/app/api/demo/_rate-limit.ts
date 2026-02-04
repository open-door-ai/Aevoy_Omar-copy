/**
 * In-memory rate limiter for demo endpoints.
 * Each namespace (e.g. "call", "task", "email") has independent limits.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Map<string, RateLimitEntry>>();

function getBucket(namespace: string): Map<string, RateLimitEntry> {
  let bucket = buckets.get(namespace);
  if (!bucket) {
    bucket = new Map();
    buckets.set(namespace, bucket);
  }
  return bucket;
}

/**
 * Check and increment rate limit for a given IP within a namespace.
 * @returns true if the request is allowed, false if rate limited.
 */
export function checkRateLimit(
  namespace: string,
  ip: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const bucket = getBucket(namespace);
  const now = Date.now();
  const entry = bucket.get(ip);

  if (!entry || now > entry.resetAt) {
    bucket.set(ip, { count: 1, resetAt: now + windowMs });
    // Auto-cleanup when bucket grows too large
    if (bucket.size > 1000) {
      for (const [key, val] of bucket) {
        if (now > val.resetAt) bucket.delete(key);
      }
    }
    return true;
  }

  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

export function getClientIp(request: Request): string {
  const headers = new Headers(request.headers);
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

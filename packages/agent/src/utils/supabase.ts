/**
 * Shared Supabase Client
 *
 * Single instance used across the entire agent server.
 * Avoids creating multiple clients per service module.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

/**
 * Attempt to acquire a distributed lock using a database table.
 * Returns true if the lock was acquired (caller should proceed).
 * Returns false if another instance holds the lock (caller should skip).
 *
 * Locks expire after `ttlMs` milliseconds to handle crashed instances.
 */
export async function acquireDistributedLock(
  lockName: string,
  ttlMs: number = 60_000
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  // Try to insert a lock row; if it already exists and hasn't expired, skip
  const { data: existing } = await getSupabaseClient()
    .from("distributed_locks")
    .select("lock_name, expires_at")
    .eq("lock_name", lockName)
    .single();

  if (existing) {
    // Lock exists — check if it's expired
    if (new Date(existing.expires_at) > now) {
      return false; // Lock held by another instance
    }
    // Lock expired — claim it
    const { error } = await getSupabaseClient()
      .from("distributed_locks")
      .update({ expires_at: expiresAt, acquired_at: now.toISOString() })
      .eq("lock_name", lockName)
      .lt("expires_at", now.toISOString());

    return !error;
  }

  // No lock row — insert one
  const { error } = await getSupabaseClient()
    .from("distributed_locks")
    .insert({ lock_name: lockName, expires_at: expiresAt, acquired_at: now.toISOString() });

  return !error;
}

/**
 * Release a distributed lock.
 */
export async function releaseDistributedLock(lockName: string): Promise<void> {
  await getSupabaseClient()
    .from("distributed_locks")
    .delete()
    .eq("lock_name", lockName);
}

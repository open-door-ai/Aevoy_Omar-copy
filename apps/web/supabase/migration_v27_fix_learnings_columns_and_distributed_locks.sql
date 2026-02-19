-- ================================================
-- Migration v27: Fix learnings columns + distributed lock RPCs
-- ================================================

-- 1. Add missing columns to learnings table
ALTER TABLE public.learnings
  ADD COLUMN IF NOT EXISTS times_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now();

-- 2. Backfill times_used from total_attempts for existing rows
UPDATE public.learnings
SET times_used = COALESCE(total_attempts, 0)
WHERE times_used = 0 AND total_attempts IS NOT NULL;

-- 3. Create acquire_lock RPC for distributed locking
-- Used by oauth-manager.ts to prevent race conditions on single-use refresh tokens
CREATE OR REPLACE FUNCTION public.acquire_lock(
  p_lock_key TEXT,
  p_ttl_seconds INTEGER DEFAULT 30
) RETURNS BOOLEAN AS $$
DECLARE
  v_acquired BOOLEAN := FALSE;
BEGIN
  -- Delete expired locks first
  DELETE FROM public.distributed_locks
  WHERE expires_at < now();

  -- Try to insert a new lock (will fail if lock already exists and not expired)
  BEGIN
    INSERT INTO public.distributed_locks (lock_name, acquired_at, expires_at)
    VALUES (p_lock_key, now(), now() + (p_ttl_seconds || ' seconds')::INTERVAL);
    v_acquired := TRUE;
  EXCEPTION WHEN unique_violation THEN
    -- Lock already held by another process
    v_acquired := FALSE;
  END;

  RETURN v_acquired;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create release_lock RPC
CREATE OR REPLACE FUNCTION public.release_lock(
  p_lock_key TEXT
) RETURNS VOID AS $$
BEGIN
  DELETE FROM public.distributed_locks
  WHERE lock_name = p_lock_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Grant execute to service_role (agent runs as service_role)
GRANT EXECUTE ON FUNCTION public.acquire_lock(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_lock(TEXT) TO service_role;

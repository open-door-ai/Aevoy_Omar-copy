-- Migration v38: Semantic Search + Performance Indexes + Privacy Fix
-- Run AFTER migration_v37.sql
-- Adds: embedding_v2 (384-dim bge-small), ivfflat index, match_user_memories RPC,
--       composite indexes for performance, allow_hive_learning column (opt-in default)

-- =====================================================
-- 1. Ensure pgvector extension is enabled
-- =====================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- For GIN trigram index on learnings

-- =====================================================
-- 2. Add 384-dim embedding column (bge-small-en-v1.5)
--    Using v2 to avoid breaking existing 1536-dim column
-- =====================================================
ALTER TABLE user_memory
  ADD COLUMN IF NOT EXISTS embedding_v2 vector(384),
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;

-- =====================================================
-- 3. ivfflat index for fast approximate similarity search
--    lists=100 is appropriate for < 1M rows per user
--    Adjust to lists=200+ at scale (> 1M total rows)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_user_memory_embedding_v2
  ON user_memory
  USING ivfflat (embedding_v2 vector_cosine_ops)
  WITH (lists = 100);

-- =====================================================
-- 4. Composite performance indexes
-- =====================================================
-- Memory lookups by user + type (used in loadWorkingMemories, loadEpisodicMemories)
CREATE INDEX IF NOT EXISTS idx_user_memory_user_type
  ON user_memory (user_id, memory_type, created_at DESC);

-- Memory lookups by user + importance (used in loadEpisodicMemories ORDER BY)
CREATE INDEX IF NOT EXISTS idx_user_memory_user_importance
  ON user_memory (user_id, importance DESC)
  WHERE importance > 0.05;

-- Tasks dashboard queries (user + status)
CREATE INDEX IF NOT EXISTS idx_tasks_user_status
  ON tasks (user_id, status, created_at DESC);

-- ai_cost_log queries by user + time (billing dashboard)
CREATE INDEX IF NOT EXISTS idx_ai_cost_log_user_created
  ON ai_cost_log (user_id, created_at DESC);

-- =====================================================
-- 5. GIN trigram index on learnings.service for fast hive mind queries
--    The existing OR+ilike query is O(n) — this makes it sub-millisecond
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_learnings_service_trgm
  ON learnings
  USING gin (service gin_trgm_ops);

-- Also index domain if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'learnings' AND column_name = 'domain'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_learnings_domain_trgm ON learnings USING gin (domain gin_trgm_ops)';
  END IF;
END $$;

-- =====================================================
-- 6. Ensure allow_hive_learning exists on profiles (opt-in default)
--    Default FALSE = privacy-first, users must explicitly opt in
-- =====================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS allow_hive_learning BOOLEAN NOT NULL DEFAULT FALSE;

-- =====================================================
-- 7. RPC: match_user_memories — semantic similarity search
--    Called by embedding.ts when USE_SEMANTIC_SEARCH=true
--    Returns memories ordered by cosine similarity (highest first)
--    Filtered by user_id for strict privacy isolation
-- =====================================================
CREATE OR REPLACE FUNCTION match_user_memories(
  query_embedding vector(384),
  match_user_id   uuid,
  match_threshold float DEFAULT 0.5,
  match_count     int   DEFAULT 10,
  memory_type_filter text DEFAULT NULL  -- NULL = all types
)
RETURNS TABLE (
  id              uuid,
  encrypted_data  text,
  memory_type     text,
  importance      decimal,
  created_at      timestamptz,
  similarity      float
)
LANGUAGE plpgsql
SECURITY DEFINER  -- Runs as owner to bypass RLS for internal queries
AS $$
BEGIN
  RETURN QUERY
  SELECT
    um.id,
    um.encrypted_data,
    um.memory_type,
    um.importance,
    um.created_at,
    1 - (um.embedding_v2 <=> query_embedding) AS similarity
  FROM user_memory um
  WHERE
    um.user_id = match_user_id
    AND um.embedding_v2 IS NOT NULL
    AND (memory_type_filter IS NULL OR um.memory_type = memory_type_filter)
    AND 1 - (um.embedding_v2 <=> query_embedding) > match_threshold
  ORDER BY um.embedding_v2 <=> query_embedding  -- cosine distance ASC = similarity DESC
  LIMIT match_count;
END;
$$;

-- Grant execute to service role only (agent uses service role key)
REVOKE ALL ON FUNCTION match_user_memories FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_user_memories TO service_role;

-- =====================================================
-- 8. RPC: update_memory_embedding — called after insert to store embedding
--    Fire-and-forget from agent, does not block task execution
-- =====================================================
CREATE OR REPLACE FUNCTION update_memory_embedding(
  p_memory_id    uuid,
  p_embedding    vector(384)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE user_memory
  SET embedding_v2 = p_embedding
  WHERE id = p_memory_id;
END;
$$;

REVOKE ALL ON FUNCTION update_memory_embedding FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_memory_embedding TO service_role;

-- =====================================================
-- 9. Distributed locks cleanup — remove stale locks > 1 hour old
--    Stale locks can block scheduler/inbox polling indefinitely
-- =====================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'distributed_locks'
  ) THEN
    -- Add expires_at column if not present
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'distributed_locks' AND column_name = 'expires_at'
    ) THEN
      EXECUTE 'ALTER TABLE distributed_locks ADD COLUMN expires_at TIMESTAMPTZ';
      -- Backfill: existing locks expire in 1 hour
      EXECUTE 'UPDATE distributed_locks SET expires_at = NOW() + interval ''1 hour'' WHERE expires_at IS NULL';
    END IF;
  END IF;
END $$;

-- Auto-cleanup function for stale locks
CREATE OR REPLACE FUNCTION cleanup_stale_locks()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count int;
BEGIN
  DELETE FROM distributed_locks
  WHERE expires_at IS NOT NULL AND expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION cleanup_stale_locks FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_stale_locks TO service_role;

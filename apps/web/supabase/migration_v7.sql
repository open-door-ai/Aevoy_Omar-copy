-- Migration V7: Memory decay, cascade tracking, retention indexes
-- Applied: 2026-02-04

-- Track when memories were last accessed (for decay algorithm)
ALTER TABLE user_memory ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ DEFAULT now();

-- Track cascade level for beyond-browser fallback
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cascade_level INTEGER DEFAULT 1;

-- Index for efficient memory decay queries
CREATE INDEX IF NOT EXISTS idx_user_memory_decay ON user_memory(user_id, importance) WHERE importance > 0.1;

-- Index for data retention cleanup (completed/failed tasks older than 90 days)
CREATE INDEX IF NOT EXISTS idx_tasks_retention ON tasks(status, completed_at) WHERE status IN ('completed', 'cancelled', 'failed');

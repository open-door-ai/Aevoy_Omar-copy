-- v46: Auto-proceed on no response
-- When the agent asks a clarifying question and gets no reply, the agent can
-- auto-proceed after a timeout (1h normal, 20min important tasks).

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS auto_proceed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_proceed_context text DEFAULT NULL;

-- Index for the auto-proceed poller query (covers needs_review, pending_approval, awaiting_confirmation)
CREATE INDEX IF NOT EXISTS idx_tasks_auto_proceed
  ON tasks (auto_proceed_at)
  WHERE auto_proceed_at IS NOT NULL AND status IN ('needs_review', 'pending_approval', 'awaiting_confirmation');

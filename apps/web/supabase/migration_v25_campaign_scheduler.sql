-- Migration v25: Campaign scheduler support
-- Adds max_runs (for one-time tasks), campaign_id, and step_number to scheduled_tasks

ALTER TABLE scheduled_tasks
  ADD COLUMN IF NOT EXISTS max_runs INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS campaign_id UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS step_number INTEGER DEFAULT 1;

-- Create campaigns table for multi-step, multi-day workflows
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  total_steps INTEGER NOT NULL DEFAULT 0,
  completed_steps INTEGER NOT NULL DEFAULT 0,
  state JSONB DEFAULT '{}',  -- shared state between steps (e.g., image URLs, results)
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- RLS for campaigns
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own campaigns"
  ON campaigns FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for scheduled_tasks by campaign
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_campaign_id ON scheduled_tasks(campaign_id);

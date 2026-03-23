-- =============================================================================
-- Migration v21: AI Inbox Management System
-- =============================================================================
-- Full inbox autonomy with learning, calendar awareness, and user-defined rules
-- =============================================================================

-- Inbox management settings for each user
CREATE TABLE IF NOT EXISTS inbox_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Autonomy Level (0-100 slider)
  autonomy_level INTEGER NOT NULL DEFAULT 0 CHECK (autonomy_level BETWEEN 0 AND 100),
  
  -- Core toggles (derived from autonomy level but can override)
  enabled BOOLEAN NOT NULL DEFAULT false,
  monitor_inbox BOOLEAN NOT NULL DEFAULT false,
  delete_spam BOOLEAN NOT NULL DEFAULT false,
  respond_to_simple BOOLEAN NOT NULL DEFAULT false,
  schedule_meetings BOOLEAN NOT NULL DEFAULT false,
  call_for_complex BOOLEAN NOT NULL DEFAULT false,
  
  -- Email identity
  ai_signature_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_signature_text TEXT DEFAULT 'Sent by {ai_name}, your Aurora assistant',
  
  -- User-defined rules (natural language → AI prompt)
  user_rules TEXT[] DEFAULT '{}',
  
  -- Learning data
  learned_preferences JSONB DEFAULT '{}',
  feedback_history JSONB DEFAULT '[]',
  
  -- Notification preferences
  notify_daily_digest BOOLEAN NOT NULL DEFAULT true,
  notify_urgent_immediately BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start TIME DEFAULT '22:00',
  quiet_hours_end TIME DEFAULT '07:00',
  
  -- Advanced settings
  max_emails_per_day INTEGER DEFAULT 50,
  auto_archive_after_days INTEGER DEFAULT 30,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Email queue for pending approvals
CREATE TABLE IF NOT EXISTS inbox_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Email data
  external_email_id TEXT NOT NULL, -- Provider's message ID
  from_address TEXT NOT NULL,
  from_name TEXT,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  
  -- AI analysis
  classification VARCHAR(50) NOT NULL, -- spam, simple, complex, urgent, etc.
  confidence DECIMAL(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  suggested_action VARCHAR(50) NOT NULL, -- delete, respond, forward, call_user, etc.
  suggested_response TEXT,
  reasoning TEXT,
  
  -- User decision
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'modified', 'expired')),
  user_decision TEXT, -- user's override/modification
  
  -- Execution tracking
  executed_at TIMESTAMPTZ,
  execution_result JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  
  -- Index for fast queries
  CONSTRAINT unique_email_per_user UNIQUE (user_id, external_email_id)
);

-- Inbox processing log (for debugging and learning)
CREATE TABLE IF NOT EXISTS inbox_processing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_id UUID REFERENCES inbox_queue(id) ON DELETE SET NULL,
  
  action VARCHAR(50) NOT NULL, -- checked_inbox, classified, executed, etc.
  details JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inbox_settings_user ON inbox_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_queue_user_status ON inbox_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_inbox_queue_pending ON inbox_queue(user_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_inbox_queue_expires ON inbox_queue(expires_at);
CREATE INDEX IF NOT EXISTS idx_inbox_log_user ON inbox_processing_log(user_id, created_at);

-- Enable RLS
ALTER TABLE inbox_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_processing_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can only access their own inbox settings"
  ON inbox_settings FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only access their own inbox queue"
  ON inbox_queue FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only access their own inbox logs"
  ON inbox_processing_log FOR ALL
  USING (auth.uid() = user_id);

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_inbox_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_inbox_settings
  BEFORE UPDATE ON inbox_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_inbox_settings_timestamp();

-- Function to check if user has inbox management enabled
CREATE OR REPLACE FUNCTION has_inbox_management_enabled(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT enabled INTO v_enabled
  FROM inbox_settings
  WHERE user_id = p_user_id;
  
  RETURN COALESCE(v_enabled, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE inbox_settings IS 'User preferences for AI inbox management';
COMMENT ON TABLE inbox_queue IS 'Pending email decisions requiring user approval';
COMMENT ON TABLE inbox_processing_log IS 'Audit log of all inbox management actions';
COMMENT ON COLUMN inbox_settings.autonomy_level IS '0=notify only, 25=handle simple, 50=most emails, 75=high autonomy, 100=full autonomy';

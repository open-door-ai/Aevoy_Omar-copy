-- Migration v32: Health data integration tables

-- Health metrics (from Fitbit, Apple Shortcuts, manual input)
CREATE TABLE IF NOT EXISTS health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL,           -- 'fitbit' | 'apple_shortcuts' | 'manual'
  metric_type TEXT NOT NULL,      -- 'heart_rate' | 'steps' | 'sleep_hours' | 'hrv' | 'spo2' | 'weight' | 'resting_hr'
  value NUMERIC NOT NULL,
  unit TEXT,                      -- 'bpm' | 'steps' | 'hours' | '%' | 'ms' | 'kg'
  recorded_at TIMESTAMPTZ NOT NULL,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS health_metrics_user_time ON health_metrics(user_id, recorded_at DESC);
ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own health metrics" ON health_metrics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service full access health_metrics" ON health_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);

-- AI-generated daily insights + anomaly flags
CREATE TABLE IF NOT EXISTS health_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  insight_text TEXT NOT NULL,
  anomalies JSONB,                -- [{metric, value, expected, severity: 'low'|'moderate'|'high'}]
  severity TEXT DEFAULT 'normal', -- 'normal' | 'low' | 'moderate' | 'high'
  data_summary JSONB,             -- condensed metrics used for this analysis
  generated_at TIMESTAMPTZ DEFAULT now(),
  notified BOOLEAN DEFAULT false
);
ALTER TABLE health_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own health insights" ON health_insights FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service full access health_insights" ON health_insights FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Video/AI consultation sessions
CREATE TABLE IF NOT EXISTS health_consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'scheduled',   -- 'scheduled' | 'active' | 'completed' | 'cancelled'
  scheduled_at TIMESTAMPTZ,          -- NULL = immediate (walk-in)
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ai_notes TEXT,                     -- AI's summary from the consultation
  transcript JSONB,                  -- [{role, text, timestamp}]
  disclaimer_acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE health_consultations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own health consultations" ON health_consultations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service full access health_consultations" ON health_consultations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Apple Shortcuts webhook token (per-user, for authenticating Shortcut POSTs)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS health_webhook_token TEXT UNIQUE DEFAULT gen_random_uuid()::text;

-- Health disclaimer acknowledgment flag
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS health_disclaimer_acknowledged BOOLEAN DEFAULT false;

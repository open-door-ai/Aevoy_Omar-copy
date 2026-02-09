-- ============================================================
-- Migration v20: Voice settings, RLS fixes, persisted call limits
-- ============================================================

-- 1. Add voice_preference to user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS voice_preference TEXT DEFAULT 'Google.en-US-Neural2-H';

-- 2. Add daily call tracking columns to usage table
ALTER TABLE usage
  ADD COLUMN IF NOT EXISTS voice_calls_today INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_calls_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS voice_cost_cents NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_cost_cents NUMERIC(10,2) DEFAULT 0;

-- 3. RLS on browser_contexts
ALTER TABLE browser_contexts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_browser_contexts" ON browser_contexts;
CREATE POLICY "users_own_browser_contexts" ON browser_contexts
  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "service_role_browser_contexts" ON browser_contexts;
CREATE POLICY "service_role_browser_contexts" ON browser_contexts
  FOR ALL USING (auth.role() = 'service_role');

-- 4. RLS on captcha_solves
ALTER TABLE captcha_solves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_captcha_solves" ON captcha_solves;
CREATE POLICY "users_own_captcha_solves" ON captcha_solves
  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "service_role_captcha_solves" ON captcha_solves;
CREATE POLICY "service_role_captcha_solves" ON captcha_solves
  FOR ALL USING (auth.role() = 'service_role');

-- 5. RLS on quality_checks
ALTER TABLE quality_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_quality_checks" ON quality_checks;
CREATE POLICY "users_own_quality_checks" ON quality_checks
  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "service_role_quality_checks" ON quality_checks;
CREATE POLICY "service_role_quality_checks" ON quality_checks
  FOR ALL USING (auth.role() = 'service_role');

-- 6. RLS on user_vps_assignments
ALTER TABLE user_vps_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_vps_assignments" ON user_vps_assignments;
CREATE POLICY "users_own_vps_assignments" ON user_vps_assignments
  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "service_role_vps_assignments" ON user_vps_assignments;
CREATE POLICY "service_role_vps_assignments" ON user_vps_assignments
  FOR ALL USING (auth.role() = 'service_role');

-- 7. RLS on vps_instances (admin/service-role only, no user_id)
ALTER TABLE vps_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_vps_instances" ON vps_instances;
CREATE POLICY "service_role_vps_instances" ON vps_instances
  FOR ALL USING (auth.role() = 'service_role');

-- 8. RPC: Track voice call with daily limit check (persisted to DB)
CREATE OR REPLACE FUNCTION track_voice_call(p_user_id UUID, p_daily_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month TEXT;
  v_today DATE;
  v_calls_today INTEGER;
  v_allowed BOOLEAN;
BEGIN
  v_month := to_char(CURRENT_DATE, 'YYYY-MM');
  v_today := CURRENT_DATE;

  INSERT INTO usage (user_id, month, voice_calls_today, voice_calls_date)
  VALUES (p_user_id, v_month, 0, v_today)
  ON CONFLICT (user_id, month) DO NOTHING;

  UPDATE usage
  SET voice_calls_today = 0, voice_calls_date = v_today
  WHERE user_id = p_user_id AND month = v_month AND voice_calls_date < v_today;

  SELECT voice_calls_today INTO v_calls_today
  FROM usage WHERE user_id = p_user_id AND month = v_month;

  v_allowed := (v_calls_today < p_daily_limit);

  IF v_allowed THEN
    UPDATE usage
    SET voice_calls_today = voice_calls_today + 1,
        voice_minutes = voice_minutes + 1
    WHERE user_id = p_user_id AND month = v_month;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'calls_today', v_calls_today + (CASE WHEN v_allowed THEN 1 ELSE 0 END),
    'daily_limit', p_daily_limit
  );
END;
$$;

-- 9. RPC: Get user voice preference
CREATE OR REPLACE FUNCTION get_user_voice(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voice TEXT;
BEGIN
  SELECT voice_preference INTO v_voice
  FROM user_settings WHERE user_id = p_user_id;
  RETURN COALESCE(v_voice, 'Google.en-US-Neural2-H');
END;
$$;

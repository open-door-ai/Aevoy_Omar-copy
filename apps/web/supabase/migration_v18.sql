-- Migration v18: Multi-User Browser Contexts
-- Purpose: Support shared Chrome with isolated contexts per user

-- ============================================================================
-- BROWSER CONTEXTS (per-user storage state)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.browser_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_state_encrypted TEXT,  -- Full Playwright storage state
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_browser_contexts_user ON browser_contexts(user_id);

ALTER TABLE browser_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their browser context"
  ON browser_contexts FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages browser contexts"
  ON browser_contexts FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE browser_contexts IS 'Playwright storage state per user for shared browser isolation';

-- ============================================================================
-- UPDATE USER_SESSIONS FOR PERMANENT STORAGE
-- ============================================================================

-- Already done in v17, but ensure 1 year default
ALTER TABLE user_sessions 
ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '1 year');

-- ============================================================================
-- VPS INSTANCE TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vps_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'full', 'maintenance', 'offline')),
  context_count INTEGER DEFAULT 0,
  max_contexts INTEGER DEFAULT 100,
  region TEXT,
  provider TEXT, -- 'gcp', 'aws', 'azure', 'hetzner'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vps_status ON vps_instances(status, context_count);

ALTER TABLE vps_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages VPS"
  ON vps_instances FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE vps_instances IS 'Track VPS instances running shared Chrome browsers';

-- ============================================================================
-- USER TO VPS MAPPING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_vps_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_user_vps_user ON user_vps_assignments(user_id);
CREATE INDEX idx_user_vps_vps ON user_vps_assignments(vps_id);

ALTER TABLE user_vps_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages VPS assignments"
  ON user_vps_assignments FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE user_vps_assignments IS 'Assign users to specific VPS instances';

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Get least loaded VPS for new user assignment
CREATE OR REPLACE FUNCTION get_available_vps()
RETURNS TABLE (vps_id UUID, host TEXT, port INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT v.id, v.host, v.port
  FROM vps_instances v
  WHERE v.status = 'active'
    AND v.context_count < v.max_contexts
  ORDER BY v.context_count ASC
  LIMIT 1;
END;
$$;

-- Assign user to VPS
CREATE OR REPLACE FUNCTION assign_user_to_vps(p_user_id UUID)
RETURNS TABLE (vps_id UUID, host TEXT, port INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_vps_id UUID;
  v_host TEXT;
  v_port INTEGER;
BEGIN
  -- Check if already assigned
  SELECT va.vps_id, v.host, v.port
  INTO v_vps_id, v_host, v_port
  FROM user_vps_assignments va
  JOIN vps_instances v ON v.id = va.vps_id
  WHERE va.user_id = p_user_id;

  IF FOUND THEN
    RETURN QUERY SELECT v_vps_id, v_host, v_port;
    RETURN;
  END IF;

  -- Get available VPS
  SELECT id, host, port
  INTO v_vps_id, v_host, v_port
  FROM get_available_vps();

  IF FOUND THEN
    -- Create assignment
    INSERT INTO user_vps_assignments (user_id, vps_id)
    VALUES (p_user_id, v_vps_id);

    -- Increment context count
    UPDATE vps_instances
    SET context_count = context_count + 1
    WHERE id = v_vps_id;

    RETURN QUERY SELECT v_vps_id, v_host, v_port;
  END IF;
END;
$$;

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT ALL ON browser_contexts TO service_role;
GRANT ALL ON vps_instances TO service_role;
GRANT ALL ON user_vps_assignments TO service_role;

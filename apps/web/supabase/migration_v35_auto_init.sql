-- =============================================================================
-- Migration v35: Auto-initialize user_settings and inbox_settings on signup
-- =============================================================================
-- Ensures every new user gets sensible defaults for voice, inbox, and billing
-- without requiring manual configuration or completing onboarding first.
-- =============================================================================

-- =====================================================
-- 1. Auto-create user_settings with defaults on signup
-- =====================================================
CREATE OR REPLACE FUNCTION public.auto_create_user_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (
    user_id,
    confirmation_mode,
    verification_method,
    greeting_style,
    voice_preference
  ) VALUES (
    NEW.id,
    'unclear',           -- Ask user to confirm ambiguous tasks
    'forward',           -- Forward verification emails
    'casual',            -- Friendly greeting style
    'EXAVITQu4vr4xnSDxMaL'  -- Sarah (ElevenLabs default)
  )
  ON CONFLICT (user_id) DO NOTHING;  -- Idempotent
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_user_settings ON profiles;
CREATE TRIGGER trg_auto_create_user_settings
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_user_settings();

-- =====================================================
-- 2. Auto-create inbox_settings with safe defaults
-- =====================================================
CREATE OR REPLACE FUNCTION public.auto_create_inbox_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.inbox_settings (
    user_id,
    autonomy_level,
    enabled,
    monitor_inbox,
    delete_spam,
    respond_to_simple,
    schedule_meetings,
    call_for_complex,
    ai_signature_enabled
  ) VALUES (
    NEW.id,
    0,       -- No autonomy until user opts in
    false,   -- Disabled until user connects email
    false,
    false,
    false,
    false,
    false,
    true     -- AI signature enabled by default
  )
  ON CONFLICT (user_id) DO NOTHING;  -- Idempotent
  RETURN NEW;
END;
$$;

-- inbox_settings uses auth.users(id), not profiles(id)
-- So we trigger off profiles insert (which happens after auth.users insert)
DROP TRIGGER IF EXISTS trg_auto_create_inbox_settings ON profiles;
CREATE TRIGGER trg_auto_create_inbox_settings
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_inbox_settings();

-- =====================================================
-- 3. Backfill: Create settings for existing users
-- =====================================================

-- Backfill user_settings for users who don't have one
INSERT INTO user_settings (user_id, confirmation_mode, verification_method, greeting_style, voice_preference)
SELECT p.id, 'unclear', 'forward', 'casual', 'EXAVITQu4vr4xnSDxMaL'
FROM profiles p
WHERE NOT EXISTS (SELECT 1 FROM user_settings us WHERE us.user_id = p.id)
ON CONFLICT (user_id) DO NOTHING;

-- Backfill inbox_settings for users who don't have one
INSERT INTO inbox_settings (user_id, autonomy_level, enabled, monitor_inbox, delete_spam, respond_to_simple, schedule_meetings, call_for_complex, ai_signature_enabled)
SELECT p.id, 0, false, false, false, false, false, false, true
FROM profiles p
WHERE NOT EXISTS (SELECT 1 FROM inbox_settings is WHERE is.user_id = p.id)
ON CONFLICT (user_id) DO NOTHING;

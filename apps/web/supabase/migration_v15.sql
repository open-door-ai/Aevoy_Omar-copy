-- Migration v15: Email PIN Security System
-- Purpose: Allow secure email verification for unregistered sender addresses
-- Created: 2026-02-06

-- Add email PIN columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_pin TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_pin_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_pin_locked_until TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_email_pin
  ON public.profiles(email_pin) WHERE email_pin IS NOT NULL;

COMMENT ON COLUMN public.profiles.email_pin IS 'Encrypted 4-6 digit PIN for email verification when sender != registered email';
COMMENT ON COLUMN public.profiles.email_pin_attempts IS 'Failed email PIN attempts counter (locks at 3)';
COMMENT ON COLUMN public.profiles.email_pin_locked_until IS 'Temporary lockout timestamp after 3 failed email PIN attempts (15 min)';

-- Email PIN verification sessions (temporary storage for pending emails)
CREATE TABLE IF NOT EXISTS public.email_pin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_email TEXT NOT NULL,
  pin_code TEXT NOT NULL, -- 6-digit PIN (not encrypted - short-lived)
  email_subject TEXT,
  email_body TEXT,
  email_body_html TEXT,
  attachments JSONB, -- Store attachment metadata
  expires_at TIMESTAMPTZ NOT NULL, -- 10 minutes from creation
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_pin_sessions_user ON public.email_pin_sessions(user_id, expires_at);
CREATE INDEX idx_email_pin_sessions_sender ON public.email_pin_sessions(sender_email, expires_at);
CREATE INDEX idx_email_pin_sessions_pin ON public.email_pin_sessions(pin_code, verified, expires_at);

-- RLS policies
ALTER TABLE public.email_pin_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own email PIN sessions"
  ON public.email_pin_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to email PIN sessions"
  ON public.email_pin_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- RPC: Increment email PIN attempts
CREATE OR REPLACE FUNCTION increment_email_pin_attempts(p_user_id UUID)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.profiles
  SET email_pin_attempts = COALESCE(email_pin_attempts, 0) + 1
  WHERE id = p_user_id;
END;
$$;

-- RPC: Reset email PIN attempts on success
CREATE OR REPLACE FUNCTION reset_email_pin_attempts(p_user_id UUID)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.profiles
  SET email_pin_attempts = 0,
      email_pin_locked_until = NULL
  WHERE id = p_user_id;
END;
$$;

-- RPC: Cleanup expired sessions (called by scheduler)
CREATE OR REPLACE FUNCTION cleanup_expired_email_pin_sessions()
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.email_pin_sessions
  WHERE expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

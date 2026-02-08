-- Migration v17: Phone Verification System
-- Purpose: Add phone_verified column to track user phone verification status
-- Created: 2026-02-08

-- Add phone_verified column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.phone_verified IS 'Whether the user phone number has been verified via call verification';

-- Create index for faster lookups of verified/unverified phones
CREATE INDEX IF NOT EXISTS idx_profiles_phone_verified
  ON public.profiles(phone_verified)
  WHERE phone_verified = TRUE;

-- ============================================================================
-- PHONE VERIFICATION TRACKING TABLE
-- ============================================================================

-- Track phone verification attempts
CREATE TABLE IF NOT EXISTS public.phone_verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  call_sid TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'initiated', 'completed', 'failed', 'timeout')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_phone_verification_user ON public.phone_verification_attempts(user_id, created_at DESC);
CREATE INDEX idx_phone_verification_status ON public.phone_verification_attempts(status, created_at);

COMMENT ON TABLE public.phone_verification_attempts IS 'Tracks phone verification call attempts during onboarding';

-- Enable RLS
ALTER TABLE public.phone_verification_attempts ENABLE ROW LEVEL SECURITY;

-- Users can view their own verification attempts
CREATE POLICY "Users can view own phone verification attempts"
  ON public.phone_verification_attempts FOR SELECT
  USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role full access to phone verification"
  ON public.phone_verification_attempts FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT SELECT ON public.phone_verification_attempts TO authenticated;
GRANT ALL ON public.phone_verification_attempts TO service_role;

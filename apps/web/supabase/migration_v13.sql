-- Migration v13: Onboarding Backfill
-- Created: 2026-02-06
-- Purpose: Mark existing users as having completed onboarding
-- The new unified onboarding flow (session 15) should only apply to NEW signups

-- Add any missing onboarding-related fields (if they don't exist)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS risk_tolerance INTEGER DEFAULT 50
CHECK (risk_tolerance >= 0 AND risk_tolerance <= 100);

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS legal_accepted_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill: Mark all existing users (created before Feb 7, 2026) as having completed onboarding
-- This ensures only NEW signups (from Feb 7 onward) will see the new unified flow
UPDATE public.profiles
SET
  onboarding_completed = true,
  risk_tolerance = COALESCE(risk_tolerance, 50)
WHERE created_at < '2026-02-07 00:00:00+00'
  AND (onboarding_completed = false OR onboarding_completed IS NULL);

-- Create index for faster onboarding status queries
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding
ON public.profiles(onboarding_completed, created_at)
WHERE onboarding_completed IS NOT NULL;

COMMENT ON COLUMN public.profiles.risk_tolerance IS 'User risk tolerance level (0-100): 0-30=safe, 31-60=balanced, 61-100=YOLO';
COMMENT ON COLUMN public.profiles.legal_accepted_at IS 'Timestamp when user accepted legal terms during onboarding';

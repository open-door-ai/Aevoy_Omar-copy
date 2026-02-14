-- Migration v23: Migrate voice and email PINs from encrypted/plaintext to hashed
-- SECURITY FIX: PINs should be hashed (like passwords), not encrypted or stored as plaintext
-- Issue #6 and #7 from privacy audit

-- Add new hash columns for voice and email PINs
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS voice_pin_hash TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_pin_hash TEXT DEFAULT NULL;

-- Add comment explaining the migration
COMMENT ON COLUMN public.profiles.voice_pin_hash IS 'Bcrypt-hashed voice PIN (4-6 digits) - replaces voice_pin (encrypted)';
COMMENT ON COLUMN public.profiles.email_pin_hash IS 'Bcrypt-hashed email PIN (4-6 digits) - replaces email_pin (encrypted)';

-- NOTE: The actual migration of existing encrypted PINs to hashes will be done
-- by the application layer (packages/agent/src/utils/pin-migration.ts) because:
-- 1. Decryption requires ENCRYPTION_KEY (not available in SQL)
-- 2. Bcrypt hashing is CPU-intensive and better done gradually
-- 3. We can handle migration errors gracefully in code

-- Drop old columns after migration is complete (MANUAL STEP - do this later)
-- ALTER TABLE public.profiles DROP COLUMN voice_pin;
-- ALTER TABLE public.profiles DROP COLUMN email_pin;

-- Indexes for the new hash columns
CREATE INDEX IF NOT EXISTS idx_profiles_voice_pin_hash
  ON public.profiles(voice_pin_hash) WHERE voice_pin_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_email_pin_hash
  ON public.profiles(email_pin_hash) WHERE email_pin_hash IS NOT NULL;

-- Update RLS policies (no changes needed - policies apply to entire row)

-- Grant necessary permissions
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, UPDATE ON public.profiles TO service_role;

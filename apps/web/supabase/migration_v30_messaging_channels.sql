-- Migration v30: Telegram + WhatsApp + Unified PIN
-- Adds messaging channel linkage columns and unified PIN across all channels

-- ============================================================
-- 1. Add messaging columns to profiles
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS unified_pin_hash TEXT,    -- bcrypt hash, replaces separate voice_pin + email_pin
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,    -- Telegram chat ID when linked
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;      -- E.164 phone linked via WhatsApp

-- ============================================================
-- 2. Migrate existing voice PINs → unified PIN
-- ============================================================
UPDATE profiles
  SET unified_pin_hash = voice_pin_hash
  WHERE voice_pin_hash IS NOT NULL
    AND unified_pin_hash IS NULL;

-- ============================================================
-- 3. Telegram link codes (ephemeral, single-use, 10-min expiry)
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code        TEXT         NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL DEFAULT (now() + interval '10 minutes'),
  used        BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE telegram_link_codes ENABLE ROW LEVEL SECURITY;

-- Only service_role can manage link codes (webhook handler uses service key)
CREATE POLICY "Service manage telegram link codes"
  ON telegram_link_codes FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Index for fast lookup by code
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_code
  ON telegram_link_codes(code)
  WHERE used = false;

-- Index for cleanup of expired codes
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_expires
  ON telegram_link_codes(expires_at);

-- ============================================================
-- 4. Rate limit tracker for link code generation (anti-farming)
-- ============================================================
-- We'll use a simple count query on telegram_link_codes for rate limiting
-- (3 per user per hour), no extra table needed.

-- ============================================================
-- 5. Update profiles RLS to allow reading new columns
-- ============================================================
-- The existing "Users can read own profile" policy on profiles already covers all columns.
-- Service role already has full access. No new policies needed.

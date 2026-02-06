-- Migration v14: Phone System Enhancement + Bot Name
-- Created: 2026-02-06
-- Purpose: Enable bidirectional phone communication with security + allow users to name their AI

-- 0. Add bot name (existing from earlier work)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS bot_name TEXT DEFAULT NULL;

-- 1. Add phone number storage (user's personal phone)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS phone_number TEXT DEFAULT NULL;

-- 2. Add voice PIN (user-set or auto-generated)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS voice_pin TEXT DEFAULT NULL;

-- 3. Add PIN attempt tracking (security)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS voice_pin_attempts INTEGER DEFAULT 0;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS voice_pin_locked_until TIMESTAMPTZ DEFAULT NULL;

-- 4. Add daily check-in preferences
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS daily_checkin_enabled BOOLEAN DEFAULT false;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS daily_checkin_morning_time TIME DEFAULT '09:00:00';

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS daily_checkin_evening_time TIME DEFAULT '21:00:00';

-- 5. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_phone_number
ON public.profiles(phone_number)
WHERE phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_pin_locked
ON public.profiles(voice_pin_locked_until)
WHERE voice_pin_locked_until IS NOT NULL;

-- 6. Comments
COMMENT ON COLUMN public.profiles.bot_name IS 'User-chosen name for their AI assistant (e.g., "Jarvis", "Alfred")';
COMMENT ON COLUMN public.profiles.phone_number IS 'User personal phone (E.164 format) for inbound call identification';
COMMENT ON COLUMN public.profiles.voice_pin IS 'Encrypted 4-6 digit PIN for voice auth when calling from unknown number';
COMMENT ON COLUMN public.profiles.voice_pin_attempts IS 'Failed PIN attempts counter (resets on success, locks at 3)';
COMMENT ON COLUMN public.profiles.voice_pin_locked_until IS 'Temporary lockout timestamp after 3 failed PIN attempts (15 min)';
COMMENT ON COLUMN public.profiles.daily_checkin_enabled IS 'Opt-in for morning/evening AI check-in calls';
COMMENT ON COLUMN public.profiles.daily_checkin_morning_time IS 'Preferred morning check-in time (user timezone)';
COMMENT ON COLUMN public.profiles.daily_checkin_evening_time IS 'Preferred evening check-in time (user timezone)';

-- 7. Premium number pricing table (for Stripe integration)
CREATE TABLE IF NOT EXISTS public.twilio_number_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_code TEXT NOT NULL,
  phone_number TEXT NOT NULL UNIQUE,
  friendly_name TEXT,
  monthly_price_cents INTEGER DEFAULT 200, -- $2/mo
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reserved_until TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_twilio_available ON public.twilio_number_products(is_available, area_code);

COMMENT ON TABLE public.twilio_number_products IS 'Available Twilio numbers for premium purchase ($2/mo)';

-- 8. Call history log (for analytics and debugging)
CREATE TABLE IF NOT EXISTS public.call_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  call_sid TEXT NOT NULL,
  direction TEXT NOT NULL, -- 'inbound' | 'outbound'
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  duration_seconds INTEGER,
  call_type TEXT, -- 'task' | 'checkin' | 'interview'
  pin_required BOOLEAN DEFAULT false,
  pin_success BOOLEAN DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_history_user ON public.call_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_history_type ON public.call_history(call_type, created_at DESC);

COMMENT ON TABLE public.call_history IS 'Complete call history for analytics and security audits';

-- 9. RLS policies
ALTER TABLE public.twilio_number_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view available numbers"
ON public.twilio_number_products FOR SELECT
USING (is_available = true);

CREATE POLICY "Users can view their own call history"
ON public.call_history FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to numbers"
ON public.twilio_number_products FOR ALL
USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to call history"
ON public.call_history FOR ALL
USING (auth.role() = 'service_role');

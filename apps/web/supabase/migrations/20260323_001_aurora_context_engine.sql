-- Aurora Context Engine Tables
-- Migration: 20260323_001_aurora_context_engine
-- Creates 9 new tables for Aurora's proactive intelligence system

-- ============================================================
-- 1. user_context — Context Aurora builds from every interaction
-- ============================================================
CREATE TABLE IF NOT EXISTS user_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    context_type TEXT NOT NULL CHECK (context_type IN (
        'routine', 'preference', 'relationship', 'commitment',
        'location', 'habit', 'emotion', 'financial', 'work', 'health'
    )),
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    confidence DECIMAL(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0 AND confidence <= 1),
    source TEXT NOT NULL CHECK (source IN ('stated', 'inferred', 'observed', 'onboarding')),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    times_observed INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, context_type, key)
);
CREATE INDEX IF NOT EXISTS idx_user_context_user ON user_context(user_id);
CREATE INDEX IF NOT EXISTS idx_user_context_type ON user_context(user_id, context_type);
CREATE INDEX IF NOT EXISTS idx_user_context_confidence ON user_context(user_id, confidence DESC);
ALTER TABLE user_context ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_context' AND policyname = 'Users see own context') THEN
        CREATE POLICY "Users see own context" ON user_context FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================
-- 2. detected_patterns — Patterns Aurora detects in user behavior
-- ============================================================
CREATE TABLE IF NOT EXISTS detected_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    pattern_type TEXT NOT NULL CHECK (pattern_type IN (
        'daily_routine', 'weekly_cycle', 'trigger_response',
        'preference', 'relationship', 'financial', 'emotional'
    )),
    description TEXT NOT NULL,
    trigger_conditions JSONB,
    confidence DECIMAL(3,2) NOT NULL DEFAULT 0.50,
    times_matched INTEGER NOT NULL DEFAULT 0,
    last_matched_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patterns_user ON detected_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_patterns_active ON detected_patterns(user_id, is_active) WHERE is_active = true;
ALTER TABLE detected_patterns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'detected_patterns' AND policyname = 'Users see own patterns') THEN
        CREATE POLICY "Users see own patterns" ON detected_patterns FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================
-- 3. commitments — Commitments Aurora tracks
-- ============================================================
CREATE TABLE IF NOT EXISTS commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    who_committed TEXT NOT NULL DEFAULT 'user',
    committed_to TEXT,
    due_date TIMESTAMPTZ,
    due_date_confidence DECIMAL(3,2) DEFAULT 0.50,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'in_progress', 'completed', 'overdue', 'cancelled'
    )),
    source_message_id UUID,
    source_channel TEXT,
    reminder_sent BOOLEAN NOT NULL DEFAULT false,
    follow_up_sent BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commitments_user ON commitments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_commitments_due ON commitments(user_id, due_date) WHERE status = 'pending';
ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'commitments' AND policyname = 'Users see own commitments') THEN
        CREATE POLICY "Users see own commitments" ON commitments FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================
-- 4. proactive_queue — Things Aurora wants to do
-- NOTE: Must come after commitments and detected_patterns (FK refs)
-- ============================================================
CREATE TABLE IF NOT EXISTS proactive_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL CHECK (action_type IN (
        'remind', 'suggest', 'inform', 'ask', 'do', 'check_in', 'follow_up'
    )),
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
    confidence DECIMAL(3,2) NOT NULL DEFAULT 0.50,
    trigger_at TIMESTAMPTZ,
    trigger_condition JSONB,
    pattern_id UUID REFERENCES detected_patterns(id),
    commitment_id UUID REFERENCES commitments(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'scheduled', 'delivered', 'acted_on',
        'dismissed', 'expired', 'failed'
    )),
    preferred_channel TEXT,
    delivered_at TIMESTAMPTZ,
    delivered_via TEXT,
    user_response TEXT,
    user_response_at TIMESTAMPTZ,
    cost_cents INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proactive_pending ON proactive_queue(user_id, status, trigger_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_proactive_delivered ON proactive_queue(user_id, delivered_at DESC);
ALTER TABLE proactive_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'proactive_queue' AND policyname = 'Users see own queue') THEN
        CREATE POLICY "Users see own queue" ON proactive_queue FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================
-- 5. conversation_context — Extracted data from every interaction
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    conversation_id UUID,
    channel TEXT NOT NULL DEFAULT 'in_app',
    role TEXT NOT NULL CHECK (role IN ('user', 'aurora', 'system')),
    content TEXT NOT NULL,
    source TEXT,
    proactive_queue_id UUID,
    extracted_intents JSONB DEFAULT '[]'::jsonb,
    extracted_entities JSONB DEFAULT '{}'::jsonb,
    extracted_commitments JSONB DEFAULT '[]'::jsonb,
    sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'urgent', 'stressed', 'excited')),
    confidence DECIMAL(3,2),
    processed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conv_context_user ON conversation_context(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_context_unprocessed ON conversation_context(user_id, processed) WHERE processed = false;
ALTER TABLE conversation_context ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_context' AND policyname = 'Users see own conversations') THEN
        CREATE POLICY "Users see own conversations" ON conversation_context FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================
-- 6. channel_preferences — Channel preferences Aurora learns
-- ============================================================
CREATE TABLE IF NOT EXISTS channel_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    info_type TEXT NOT NULL,
    preferred_channel TEXT NOT NULL,
    confidence DECIMAL(3,2) NOT NULL DEFAULT 0.50,
    avg_response_time_seconds INTEGER DEFAULT 0,
    preferred_time TEXT,
    times_observed INTEGER NOT NULL DEFAULT 1,
    response_count INTEGER NOT NULL DEFAULT 0,
    positive_count INTEGER NOT NULL DEFAULT 0,
    negative_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, info_type, preferred_channel)
);
ALTER TABLE channel_preferences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'channel_preferences' AND policyname = 'Users see own preferences') THEN
        CREATE POLICY "Users see own preferences" ON channel_preferences FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================
-- 7. investor_profiles — Admin demo system
-- ============================================================
CREATE TABLE IF NOT EXISTS investor_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL REFERENCES profiles(id),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    linkedin_url TEXT,
    portfolio_companies JSONB DEFAULT '[]'::jsonb,
    recent_activity JSONB DEFAULT '[]'::jsonb,
    research_data JSONB DEFAULT '{}'::jsonb,
    personalized_message TEXT,
    demo_sent_at TIMESTAMPTZ,
    demo_response TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE investor_profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'investor_profiles' AND policyname = 'Admin sees investor profiles') THEN
        CREATE POLICY "Admin sees investor profiles" ON investor_profiles FOR ALL USING (auth.uid() = admin_user_id);
    END IF;
END $$;

-- ============================================================
-- 8. daily_spend_tracking — Circuit breaker for cost control
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_spend_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    sms_spend_cents INTEGER NOT NULL DEFAULT 0,
    voice_spend_cents INTEGER NOT NULL DEFAULT 0,
    whatsapp_spend_cents INTEGER NOT NULL DEFAULT 0,
    ai_spend_cents INTEGER NOT NULL DEFAULT 0,
    browser_spend_cents INTEGER NOT NULL DEFAULT 0,
    total_spend_cents INTEGER NOT NULL DEFAULT 0,
    circuit_breaker_triggered BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, date),
    CHECK (total_spend_cents <= 500)
);
CREATE INDEX IF NOT EXISTS idx_daily_spend ON daily_spend_tracking(user_id, date);
ALTER TABLE daily_spend_tracking ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_spend_tracking' AND policyname = 'Users see own spend') THEN
        CREATE POLICY "Users see own spend" ON daily_spend_tracking FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================
-- 9. browser_sessions — Steel.dev browser session tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS browser_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    steel_session_id TEXT NOT NULL,
    task_id UUID REFERENCES tasks(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'completed', 'failed', 'timed_out', 'orphaned'
    )),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    pages_visited INTEGER DEFAULT 0,
    captchas_solved INTEGER DEFAULT 0,
    cost_cents INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_active ON browser_sessions(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_browser_sessions_user ON browser_sessions(user_id, created_at DESC);
ALTER TABLE browser_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'browser_sessions' AND policyname = 'Users see own sessions') THEN
        CREATE POLICY "Users see own sessions" ON browser_sessions FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;

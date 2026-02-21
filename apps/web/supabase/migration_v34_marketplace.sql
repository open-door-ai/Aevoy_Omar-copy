-- =============================================================
-- Migration v34: App Marketplace + Modular Dashboard
-- =============================================================

-- ============================================================
-- MODULAR DASHBOARD
-- ============================================================

CREATE TABLE IF NOT EXISTS dashboard_widget_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  layout JSONB NOT NULL DEFAULT '[]',
  -- layout: [{id, widgetId, col, row, w, h, visible, config}]
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE dashboard_widget_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own layout" ON dashboard_widget_layouts
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service full access layout" ON dashboard_widget_layouts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- MARKETPLACE CATEGORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS marketplace_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
INSERT INTO marketplace_categories (id, name, icon, sort_order) VALUES
  ('productivity', 'Productivity', '⚡', 1),
  ('finance', 'Finance', '💰', 2),
  ('health', 'Health & Fitness', '❤️', 3),
  ('communication', 'Communication', '💬', 4),
  ('analytics', 'Analytics', '📊', 5),
  ('ai-tools', 'AI Tools', '🤖', 6)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- MARKETPLACE APPS
-- ============================================================

CREATE TABLE IF NOT EXISTS marketplace_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  long_description TEXT,
  icon_url TEXT,
  screenshots JSONB DEFAULT '[]',
  category_id TEXT REFERENCES marketplace_categories(id),
  tags TEXT[] DEFAULT '{}',
  version TEXT NOT NULL DEFAULT '1.0.0',
  status TEXT NOT NULL DEFAULT 'draft',
  -- 'draft'|'pending_review'|'approved'|'rejected'|'suspended'
  is_featured BOOLEAN DEFAULT false,
  is_builtin BOOLEAN DEFAULT false,
  price_type TEXT NOT NULL DEFAULT 'free',
  -- 'free'|'one_time'|'monthly'
  price_cents INTEGER DEFAULT 0,
  widget_manifest JSONB,
  -- {size, permissions, api_endpoints, min_w, min_h, default_w, default_h}
  bundle_storage_path TEXT,
  -- Supabase storage path in marketplace-bundles bucket
  install_count INTEGER DEFAULT 0,
  rating_avg NUMERIC(3,2) DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_apps_status ON marketplace_apps(status);
CREATE INDEX IF NOT EXISTS marketplace_apps_category ON marketplace_apps(category_id);
CREATE INDEX IF NOT EXISTS marketplace_apps_featured ON marketplace_apps(is_featured)
  WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS marketplace_apps_slug ON marketplace_apps(slug);

ALTER TABLE marketplace_apps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view approved or suspended apps" ON marketplace_apps
  FOR SELECT USING (status IN ('approved', 'suspended'));
CREATE POLICY "Developers manage own apps" ON marketplace_apps
  FOR ALL TO authenticated
  USING (auth.uid() = developer_id)
  WITH CHECK (auth.uid() = developer_id);
CREATE POLICY "Service full access marketplace_apps" ON marketplace_apps
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- MARKETPLACE INSTALLS
-- ============================================================

CREATE TABLE IF NOT EXISTS marketplace_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  payment_intent_id TEXT,
  installed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, app_id)
);
ALTER TABLE marketplace_installs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own installs" ON marketplace_installs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Developers see own app install counts" ON marketplace_installs
  FOR SELECT TO authenticated
  USING (
    app_id IN (SELECT id FROM marketplace_apps WHERE developer_id = auth.uid())
  );
CREATE POLICY "Service full access installs" ON marketplace_installs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- MARKETPLACE REVIEWS
-- ============================================================

CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, app_id)
);
ALTER TABLE marketplace_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read reviews" ON marketplace_reviews
  FOR SELECT USING (true);
CREATE POLICY "Users manage own reviews" ON marketplace_reviews
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service full access reviews" ON marketplace_reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- DEVELOPER PROFILES
-- ============================================================

CREATE TABLE IF NOT EXISTS developer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  verified BOOLEAN DEFAULT false,
  verification_paid_at TIMESTAMPTZ,
  verification_payment_id TEXT,
  bio TEXT,
  website TEXT,
  github_url TEXT,
  stripe_account_id TEXT,
  total_earned_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE developer_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own dev profile" ON developer_profiles
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Anyone can read verified dev profiles" ON developer_profiles
  FOR SELECT USING (verified = true);
CREATE POLICY "Service full access dev profiles" ON developer_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- APP SUBMISSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS app_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  developer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  code_bundle_storage_path TEXT NOT NULL,
  manifest JSONB NOT NULL,
  review_status TEXT DEFAULT 'queued',
  -- 'queued'|'scanning'|'needs_changes'|'approved'|'rejected'
  ai_review_pass1 JSONB,
  ai_review_pass2 JSONB,
  ai_review_pass3 JSONB,
  security_flags JSONB DEFAULT '[]',
  -- [{severity, type, line, description}]
  reviewer_notes TEXT,
  review_cost_usd NUMERIC(10,4) DEFAULT 0,
  billed_cost_usd NUMERIC(10,4) DEFAULT 0,
  payment_status TEXT DEFAULT 'pending',
  -- 'pending'|'paid'|'waived'
  payment_id TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
ALTER TABLE app_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Developers see own submissions" ON app_submissions
  FOR SELECT TO authenticated USING (auth.uid() = developer_id);
CREATE POLICY "Service full access submissions" ON app_submissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- ADMIN TABLES (no RLS — service role access only)
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '30 minutes',
  last_activity_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address TEXT NOT NULL,
  success BOOLEAN DEFAULT false,
  attempted_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_login_ip ON admin_login_attempts(ip_address, attempted_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_session_id UUID REFERENCES admin_sessions(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SUPABASE STORAGE BUCKET
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketplace-bundles',
  'marketplace-bundles',
  false,
  5242880,   -- 5MB
  ARRAY['application/zip', 'application/octet-stream', 'text/plain', 'application/javascript']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: only service role can read/write bundles
CREATE POLICY "Service role manages marketplace bundles"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'marketplace-bundles')
  WITH CHECK (bucket_id = 'marketplace-bundles');

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Update app rating when review added/updated
CREATE OR REPLACE FUNCTION update_app_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE marketplace_apps SET
    rating_avg = (SELECT ROUND(AVG(rating)::NUMERIC, 2) FROM marketplace_reviews WHERE app_id = NEW.app_id),
    rating_count = (SELECT COUNT(*) FROM marketplace_reviews WHERE app_id = NEW.app_id),
    updated_at = now()
  WHERE id = NEW.app_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS update_rating_on_review ON marketplace_reviews;
CREATE TRIGGER update_rating_on_review
  AFTER INSERT OR UPDATE ON marketplace_reviews
  FOR EACH ROW EXECUTE FUNCTION update_app_rating();

-- Update install count when app installed
CREATE OR REPLACE FUNCTION update_app_install_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE marketplace_apps SET
    install_count = (SELECT COUNT(*) FROM marketplace_installs WHERE app_id = NEW.app_id),
    updated_at = now()
  WHERE id = NEW.app_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS update_install_count ON marketplace_installs;
CREATE TRIGGER update_install_count
  AFTER INSERT ON marketplace_installs
  FOR EACH ROW EXECUTE FUNCTION update_app_install_count();

-- Migration v44: Screenshots bucket + takeover columns + takeover_tokens table
-- Applied via MCP on 2026-03-07

-- Create screenshots storage bucket (public read, service_role write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('screenshots', 'screenshots', true, 2097152, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

-- Add takeover columns to tasks table (idempotent)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS live_view_url text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS needs_takeover boolean DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS takeover_reason text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS takeover_requested_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS takeover_resolved_at timestamptz;

-- Create takeover_tokens table for secure WebSocket auth
CREATE TABLE IF NOT EXISTS takeover_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Storage RLS policies
DO $$ BEGIN
  DROP POLICY IF EXISTS "screenshots_public_read" ON storage.objects;
  CREATE POLICY "screenshots_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'screenshots');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "screenshots_service_write" ON storage.objects;
  CREATE POLICY "screenshots_service_write"
    ON storage.objects FOR ALL
    USING (bucket_id = 'screenshots')
    WITH CHECK (bucket_id = 'screenshots');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_needs_takeover
  ON tasks (needs_takeover) WHERE needs_takeover = true;
CREATE INDEX IF NOT EXISTS idx_takeover_tokens_expires
  ON takeover_tokens (expires_at);

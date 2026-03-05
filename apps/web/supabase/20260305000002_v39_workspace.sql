-- v39: User File Workspace — persistent cross-session file storage

CREATE TABLE IF NOT EXISTS user_workspace_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  size_bytes BIGINT DEFAULT 0,
  mime_type TEXT DEFAULT 'text/plain',
  encrypted BOOLEAN DEFAULT false,
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,  -- null = never expires; set for temp files
  UNIQUE(user_id, filename)
);

-- Index for quota checks
CREATE INDEX idx_workspace_files_user_id ON user_workspace_files(user_id);

-- RLS
ALTER TABLE user_workspace_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own workspace files" ON user_workspace_files FOR ALL USING (auth.uid() = user_id);

-- Add contribute_to_hive_mind to user_settings if the other migration missed it
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS contribute_to_hive_mind BOOLEAN DEFAULT true;

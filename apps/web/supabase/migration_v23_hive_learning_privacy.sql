-- Migration v23: Hive Mind Learning Privacy Controls
-- Add opt-out setting for shared learning uploads

-- Add opt-out column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS allow_hive_learning BOOLEAN DEFAULT true;

-- Comment explaining the feature
COMMENT ON COLUMN profiles.allow_hive_learning IS 'User consent for anonymous learning data to be shared with Hive Mind hub. Defaults to true (opt-in). User data is always scrubbed before upload.';

-- RLS: Users can only update their own settings
DROP POLICY IF EXISTS "Users can update own hive learning setting" ON profiles;
CREATE POLICY "Users can update own hive learning setting"
ON profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

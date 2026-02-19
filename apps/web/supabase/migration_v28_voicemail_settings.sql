-- Migration v28: Voicemail settings

-- 1. Add voicemail columns to user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS voicemail_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS voicemail_greeting_text TEXT,
  ADD COLUMN IF NOT EXISTS voicemail_greeting_url TEXT;

-- 2. Create storage bucket for voicemail greeting audio files
INSERT INTO storage.buckets (id, name, public)
VALUES ('voicemail-greetings', 'voicemail-greetings', false)
ON CONFLICT (id) DO NOTHING;

-- 3. RLS policies for the voicemail-greetings storage bucket

-- Users can upload their own greetings
CREATE POLICY "Users can upload their own voicemail greetings"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'voicemail-greetings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can read their own greetings
CREATE POLICY "Users can read their own voicemail greetings"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'voicemail-greetings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can delete their own greetings
CREATE POLICY "Users can delete their own voicemail greetings"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'voicemail-greetings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

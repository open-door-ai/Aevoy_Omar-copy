-- Migration v33: Fix Telegram link code RLS + expose health webhook token

-- 1. Allow authenticated users to insert their own Telegram link codes
--    (Previously only service_role could write, so every QR generation failed)
CREATE POLICY "Users can insert own telegram link codes"
  ON telegram_link_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 2. Allow authenticated users to read their own (unused, unexpired) link codes
--    so the polling UI can check if a code is still valid
CREATE POLICY "Users can read own telegram link codes"
  ON telegram_link_codes
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

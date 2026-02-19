-- Migration v24: Fix RLS policies
-- 1. user_twilio_numbers: add INSERT/UPDATE/DELETE policies for authenticated users
--    (only SELECT existed, causing phone purchase to fail with 500)

CREATE POLICY "Users can insert own twilio_numbers"
  ON user_twilio_numbers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own twilio_numbers"
  ON user_twilio_numbers FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own twilio_numbers"
  ON user_twilio_numbers FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

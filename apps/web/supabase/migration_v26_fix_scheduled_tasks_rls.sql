-- Migration v26: Fix scheduled_tasks RLS policies
-- Previously only had SELECT; now adds INSERT/UPDATE/DELETE

CREATE POLICY "Users can insert own scheduled tasks"
  ON scheduled_tasks FOR INSERT
  WITH CHECK (user_id = ( SELECT auth.uid() AS uid));

CREATE POLICY "Users can update own scheduled tasks"
  ON scheduled_tasks FOR UPDATE
  USING (user_id = ( SELECT auth.uid() AS uid))
  WITH CHECK (user_id = ( SELECT auth.uid() AS uid));

CREATE POLICY "Users can delete own scheduled tasks"
  ON scheduled_tasks FOR DELETE
  USING (user_id = ( SELECT auth.uid() AS uid));

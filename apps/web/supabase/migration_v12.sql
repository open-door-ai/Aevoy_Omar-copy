-- Migration v12: Browserbase persistent contexts
-- Add context ID per user for always-signed-in browser sessions

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS browserbase_context_id TEXT DEFAULT NULL;

COMMENT ON COLUMN public.profiles.browserbase_context_id IS 'Browserbase persistent context ID for maintaining browser sessions across tasks';

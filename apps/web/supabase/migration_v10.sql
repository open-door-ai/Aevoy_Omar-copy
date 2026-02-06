-- Migration V10: Scale-readiness (distributed locks, email idempotency, DB-backed proactive counters)
-- Applied: 2026-02-06

-- Distributed locks table for multi-instance coordination
CREATE TABLE IF NOT EXISTS public.distributed_locks (
  lock_name TEXT PRIMARY KEY,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.distributed_locks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.distributed_locks TO service_role;

-- Processed emails table for IMAP idempotency
CREATE TABLE IF NOT EXISTS public.processed_emails (
  message_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_addr TEXT,
  to_addr TEXT,
  subject TEXT
);

ALTER TABLE public.processed_emails ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.processed_emails TO service_role;

CREATE INDEX IF NOT EXISTS idx_processed_emails_processed_at
  ON public.processed_emails (processed_at);

CREATE INDEX IF NOT EXISTS idx_distributed_locks_expires_at
  ON public.distributed_locks (expires_at);

-- Move proactive daily counters from in-memory to database
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usage'
    AND column_name = 'proactive_daily_count'
  ) THEN
    ALTER TABLE public.usage ADD COLUMN proactive_daily_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE public.usage ADD COLUMN proactive_daily_date DATE NOT NULL DEFAULT CURRENT_DATE;
  END IF;
END $$;

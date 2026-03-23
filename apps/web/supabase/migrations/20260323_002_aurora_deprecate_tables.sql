-- Aurora: Deprecate unused legacy tables
-- Migration: 20260323_002_aurora_deprecate_tables
-- Soft-deletes by renaming with _deprecated prefix (idempotent)

DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'marketplace_apps') THEN
        ALTER TABLE marketplace_apps RENAME TO _deprecated_marketplace_apps;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'marketplace_installs') THEN
        ALTER TABLE marketplace_installs RENAME TO _deprecated_marketplace_installs;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'marketplace_reviews') THEN
        ALTER TABLE marketplace_reviews RENAME TO _deprecated_marketplace_reviews;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'vents') THEN
        ALTER TABLE vents RENAME TO _deprecated_vents;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'vent_upvotes') THEN
        ALTER TABLE vent_upvotes RENAME TO _deprecated_vent_upvotes;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'failure_memory') THEN
        ALTER TABLE failure_memory RENAME TO _deprecated_failure_memory;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'learnings') THEN
        ALTER TABLE learnings RENAME TO _deprecated_learnings;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'captcha_solves') THEN
        ALTER TABLE captcha_solves RENAME TO _deprecated_captcha_solves;
    END IF;
END $$;

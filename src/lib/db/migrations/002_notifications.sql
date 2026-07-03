-- 002: notification support + snapshot freshness
--
-- Applied on top of 001_init.sql. The deployed DB already has 001, so this file
-- only adds what's new. Apply manually:
--   psql $DATABASE_URL -f src/lib/db/migrations/002_notifications.sql

-- A6: snapshots.upsert re-runs on the same (repo_id, date) but 001 never
-- refreshed a timestamp, so "last updated" was frozen at first insert. Add an
-- explicit updated_at that the upsert bumps on every write.
ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Per-repo notification state machine. We notify on a *change* (new anomaly,
-- escalation, or significant worsening), NOT once per (repo, date) — a repo that
-- stays 'elevated' for 7 days must not fire 7 daily alerts. One row per repo
-- holds the last level/score we actually sent, so the next run can diff against it.
CREATE TABLE IF NOT EXISTS repo_notification_state (
  repo_id        INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  last_level     TEXT NOT NULL,
  last_score     FLOAT,
  -- Bumped every run we observe this repo (even when no alert is sent), so
  -- stale rows for repos that fall out of trending can be aged out. Named
  -- "seen" not "notified" because steady/de-escalated updates touch it too.
  last_seen_date DATE NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log of digest sends (one row per pipeline run that attempted a send).
-- Kept separate from the dedup state so a failed send is still recorded without
-- corrupting the "what did we last tell the user" state.
CREATE TABLE IF NOT EXISTS notification_events (
  id           SERIAL PRIMARY KEY,
  run_date     DATE NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'google_chat',
  status       TEXT NOT NULL,          -- 'sent' | 'failed' | 'dry_run' | 'skipped'
  repo_count   INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

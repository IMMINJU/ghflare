-- 004: repo age + snapshot source
--
-- Applied on top of 003. Apply manually:
--   psql $DATABASE_URL -f src/lib/db/migrations/004_repo_age_snapshot_source.sql
--
-- repos.gh_created_at — the repository's creation date on GitHub (NOT the local
-- row's created_at, which is when *we* first saw it). Drives the anomaly age
-- gate: a repo younger than the 30-day baseline window has its daily average
-- diluted by days it didn't exist, so a merely steady newcomer reads as a
-- spike. NULL until the pipeline backfills it from /repos/{owner}/{name};
-- unknown age never suppresses.
--
-- snapshots.source — 'pipeline' | 'manual'. The feed, Chat digest, and
-- notification candidates are driven by the latest *pipeline* date only. A
-- manual analyze (repo-page button) after UTC midnight used to advance the
-- global MAX(date) and collapse the feed to that single repo until the next
-- run. Existing rows were written by the pipeline, so the default backfills
-- them correctly.

ALTER TABLE repos
  ADD COLUMN IF NOT EXISTS gh_created_at TIMESTAMPTZ;

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'pipeline';

-- Guard against typo'd/out-of-band writes: an unknown source value would be
-- silently excluded from the feed/notification universe. Drop-then-add keeps
-- the migration re-runnable (ADD CONSTRAINT has no IF NOT EXISTS).
ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_source_check;
ALTER TABLE snapshots
  ADD CONSTRAINT snapshots_source_check CHECK (source IN ('pipeline', 'manual'));

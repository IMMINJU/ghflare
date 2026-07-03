-- 003: statistical anomaly fields
--
-- Applied on top of 002. Adds the quasi-Poisson outputs so the feed can rank by
-- statistical significance, not just the raw multiplier. Apply manually:
--   psql $DATABASE_URL -f src/lib/db/migrations/003_anomaly_stats.sql
--
-- anomaly_score stays "multiplier - 1" for backward compatibility (the feed,
-- API, and notifications all reconstruct multiplier as score + 1). These are
-- additive: existing rows keep NULL until the next pipeline run rewrites them.

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS anomaly_p_value FLOAT;

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS expected_count FLOAT;

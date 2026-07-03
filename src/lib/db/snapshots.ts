import { sql } from './client'
import type { SnapshotRow, AnomalyLevel, SnapshotSource } from '@/types'

export async function upsertSnapshot(params: {
  repoId: number
  date: string
  issueCount: number
  anomalyScore: number
  anomalyLevel: AnomalyLevel
  pValue: number
  expectedCount: number
  source: SnapshotSource
}): Promise<void> {
  await sql`
    INSERT INTO snapshots (
      repo_id, date, issue_count, anomaly_score, anomaly_level,
      anomaly_p_value, expected_count, source
    )
    VALUES (
      ${params.repoId},
      ${params.date},
      ${params.issueCount},
      ${params.anomalyScore},
      ${params.anomalyLevel},
      ${params.pValue},
      ${params.expectedCount},
      ${params.source}
    )
    ON CONFLICT (repo_id, date) DO UPDATE SET
      issue_count     = EXCLUDED.issue_count,
      anomaly_score   = EXCLUDED.anomaly_score,
      anomaly_level   = EXCLUDED.anomaly_level,
      anomaly_p_value = EXCLUDED.anomaly_p_value,
      expected_count  = EXCLUDED.expected_count,
      -- A manual analyze on the same date must not demote a pipeline row out of
      -- the feed universe: once 'pipeline', the label sticks (values refresh).
      source          = CASE WHEN snapshots.source = 'pipeline'
                             THEN 'pipeline' ELSE EXCLUDED.source END,
      updated_at      = NOW()
  `
}

// One run's snapshot for a repo, minus the run-scoped fields (date, source)
// that upsertSnapshots applies uniformly.
export type SnapshotUpsert = {
  repoId: number
  issueCount: number
  anomalyScore: number
  anomalyLevel: AnomalyLevel
  pValue: number
  expectedCount: number
}

// Write a whole pipeline run's snapshots in ONE statement. The feed's date
// universe is MAX(date) over pipeline snapshots — written per-repo as the run
// progressed, the first snapshot of a new UTC date shrank the feed to that one
// repo until the run finished. Batching flips the universe atomically, which
// is also why the pipeline persists snapshots only after every repo finishes.
export async function upsertSnapshots(
  runDate: string,
  rows: SnapshotUpsert[]
): Promise<void> {
  if (rows.length === 0) return

  const payload = JSON.stringify(
    rows.map((r) => ({
      repo_id: r.repoId,
      issue_count: r.issueCount,
      anomaly_score: r.anomalyScore,
      anomaly_level: r.anomalyLevel,
      p_value: r.pValue,
      expected_count: r.expectedCount,
    }))
  )

  await sql`
    INSERT INTO snapshots (
      repo_id, date, issue_count, anomaly_score, anomaly_level,
      anomaly_p_value, expected_count, source
    )
    SELECT
      (r->>'repo_id')::int,
      ${runDate}::date,
      (r->>'issue_count')::int,
      (r->>'anomaly_score')::float,
      r->>'anomaly_level',
      (r->>'p_value')::float,
      (r->>'expected_count')::float,
      'pipeline'
    FROM jsonb_array_elements(${payload}::jsonb) AS r
    ON CONFLICT (repo_id, date) DO UPDATE SET
      issue_count     = EXCLUDED.issue_count,
      anomaly_score   = EXCLUDED.anomaly_score,
      anomaly_level   = EXCLUDED.anomaly_level,
      anomaly_p_value = EXCLUDED.anomaly_p_value,
      expected_count  = EXCLUDED.expected_count,
      source          = 'pipeline',
      updated_at      = NOW()
  `
}

export async function getLatestSnapshot(
  repoId: number
): Promise<SnapshotRow | null> {
  const rows = await sql`
    SELECT * FROM snapshots
    WHERE repo_id = ${repoId}
    ORDER BY date DESC
    LIMIT 1
  `
  return (rows[0] as SnapshotRow) ?? null
}

export async function getLastUpdatedAt(): Promise<string | null> {
  const rows = await sql`
    SELECT MAX(updated_at) AS updated_at FROM snapshots
  `
  return rows[0].updated_at as string | null
}

export async function deleteOldSnapshots(): Promise<void> {
  await sql`
    DELETE FROM snapshots WHERE date < NOW() - INTERVAL '30 days'
  `
}

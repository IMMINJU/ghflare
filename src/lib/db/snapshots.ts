import { sql } from './client'
import type { SnapshotRow, AnomalyLevel } from '@/types'

export async function upsertSnapshot(params: {
  repoId: number
  date: string
  issueCount: number
  anomalyScore: number
  anomalyLevel: AnomalyLevel
}): Promise<void> {
  await sql`
    INSERT INTO snapshots (repo_id, date, issue_count, anomaly_score, anomaly_level)
    VALUES (
      ${params.repoId},
      ${params.date},
      ${params.issueCount},
      ${params.anomalyScore},
      ${params.anomalyLevel}
    )
    ON CONFLICT (repo_id, date) DO UPDATE SET
      issue_count   = EXCLUDED.issue_count,
      anomaly_score = EXCLUDED.anomaly_score,
      anomaly_level = EXCLUDED.anomaly_level
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
    SELECT MAX(created_at) AS updated_at FROM snapshots
  `
  return rows[0].updated_at as string | null
}

export async function deleteOldSnapshots(): Promise<void> {
  await sql`
    DELETE FROM snapshots WHERE date < NOW() - INTERVAL '30 days'
  `
}

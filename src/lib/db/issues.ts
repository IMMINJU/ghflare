import { sql } from './client'
import { BODY_TRUNCATE } from '../embeddings/openai'
import type { IssueRow, RawIssue } from '@/types'

// How long an issue is kept, and equally the window the timeline and the
// clustering read. The three have to agree: retaining less than they read
// would show a chart that thins out at its left edge and cluster a partial
// set. Dropped from 90 to 30 days to fit Neon's free tier — 30 is the floor,
// because the anomaly baseline (getBaseline) compares against a 30-day
// average and a shorter window would leave nothing to compare to.
export const ISSUE_RETENTION_DAYS = 30

export async function upsertIssues(
  repoId: number,
  issues: RawIssue[]
): Promise<void> {
  if (issues.length === 0) return

  const payload = JSON.stringify(
    issues.map((i) => ({
      number: i.number,
      title: i.title,
      // Bodies are never rendered, only fed to the embedding input — which
      // reads at most BODY_TRUNCATE chars. Anything past that is dead weight
      // (full bodies were ~3x the bytes actually consumed).
      body: i.body?.slice(0, BODY_TRUNCATE) ?? null,
      labels: i.labels,
      created_at: i.created_at,
    }))
  )

  await sql`
    INSERT INTO issues (repo_id, issue_number, title, body, labels, created_at)
    SELECT
      ${repoId},
      (r->>'number')::int,
      r->>'title',
      r->>'body',
      ARRAY(SELECT jsonb_array_elements_text(r->'labels')),
      (r->>'created_at')::timestamptz
    FROM jsonb_array_elements(${payload}::jsonb) AS r
    ON CONFLICT (repo_id, issue_number) DO UPDATE SET
      title  = EXCLUDED.title,
      body   = EXCLUDED.body,
      labels = EXCLUDED.labels
  `
}

export async function getIssuesWithoutEmbeddings(
  repoId: number
): Promise<IssueRow[]> {
  const rows = await sql`
    SELECT * FROM issues
    WHERE repo_id = ${repoId} AND embedding IS NULL
    ORDER BY created_at DESC
  `
  return rows as IssueRow[]
}

export async function updateEmbedding(
  issueId: number,
  embedding: number[]
): Promise<void> {
  await sql`
    UPDATE issues SET embedding = ${JSON.stringify(embedding)}::vector
    WHERE id = ${issueId}
  `
}

export async function updateEmbeddingsBatch(
  updates: { id: number; embedding: number[] }[]
): Promise<void> {
  if (updates.length === 0) return

  const payload = JSON.stringify(
    updates.map((u) => ({ id: u.id, embedding: u.embedding }))
  )

  await sql`
    UPDATE issues
    SET embedding = (u.e::text)::vector
    FROM (
      SELECT (r->>'id')::int AS id, r->'embedding' AS e
      FROM jsonb_array_elements(${payload}::jsonb) AS r
    ) AS u
    WHERE issues.id = u.id
  `
}

export async function getExistingIssueNumbers(
  repoId: number
): Promise<Set<number>> {
  const rows = await sql`
    SELECT issue_number FROM issues WHERE repo_id = ${repoId}
  `
  return new Set(rows.map((r) => r.issue_number as number))
}

export async function getRecentIssueCount(repoId: number): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count FROM issues
    WHERE repo_id = ${repoId}
      AND created_at >= NOW() - INTERVAL '7 days'
  `
  return rows[0].count as number
}

// Baseline window is the 23 days from 30d ago up to 7d ago. We divide the total
// issue count by the full 23-day span (not by active days only) so that days
// with zero issues correctly pull the average down — otherwise sparse repos get
// an inflated baseline and their anomalies are under-reported.
const BASELINE_DAYS = 23

export type Baseline = {
  dailyAvg: number // issues/day over the 23-day window
  count: number    // raw issue count in the window (drives the confidence gate)
}

// Returns both the daily average and the raw count over the baseline window in a
// single query. The count is what the anomaly gate uses to decide whether we
// know this repo's "normal" at all: a repo with too few baseline issues has no
// trustworthy expectation to compare today against, so it must never alert.
export async function getBaseline(repoId: number): Promise<Baseline> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM issues
    WHERE repo_id = ${repoId}
      AND created_at >= NOW() - INTERVAL '30 days'
      AND created_at < NOW() - INTERVAL '7 days'
  `
  const count = Number(rows[0].count ?? 0)
  return { dailyAvg: count / BASELINE_DAYS, count }
}

export async function getHistoricalDailyAvg(repoId: number): Promise<number> {
  return (await getBaseline(repoId)).dailyAvg
}

export async function getIssuesForClustering(
  repoId: number
): Promise<IssueRow[]> {
  // Deterministic order: k-means seeds its centroids from the first k rows
  // (cluster.ts), so without an explicit ORDER BY the clustering — and the
  // labels shown in the feed and the Chat digest — would drift between runs
  // purely from Postgres row ordering.
  const rows = await sql`
    SELECT * FROM issues
    WHERE repo_id = ${repoId}
      AND embedding IS NOT NULL
      AND created_at >= NOW() - (${ISSUE_RETENTION_DAYS} || ' days')::interval
    ORDER BY created_at DESC, id DESC
  `
  return rows.map((r) => ({
    ...r,
    embedding: typeof r.embedding === 'string'
      ? JSON.parse(r.embedding)
      : r.embedding,
  })) as IssueRow[]
}

export async function getTimelineData(
  repoId: number
): Promise<{ date: string; count: number }[]> {
  const rows = await sql`
    SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
    FROM issues
    WHERE repo_id = ${repoId}
      AND created_at >= NOW() - (${ISSUE_RETENTION_DAYS} || ' days')::interval
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `
  return rows as { date: string; count: number }[]
}

export async function deleteOldIssues(): Promise<void> {
  await sql`
    DELETE FROM issues
    WHERE created_at < NOW() - (${ISSUE_RETENTION_DAYS} || ' days')::interval
  `
}

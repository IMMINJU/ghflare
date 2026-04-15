import { sql } from './client'
import type { IssueRow, RawIssue } from '@/types'

export async function upsertIssues(
  repoId: number,
  issues: RawIssue[]
): Promise<void> {
  if (issues.length === 0) return

  const payload = JSON.stringify(
    issues.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body,
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

export async function getHistoricalDailyAvg(repoId: number): Promise<number> {
  const rows = await sql`
    SELECT AVG(daily_count) AS avg FROM (
      SELECT DATE(created_at), COUNT(*) AS daily_count
      FROM issues
      WHERE repo_id = ${repoId}
        AND created_at >= NOW() - INTERVAL '30 days'
        AND created_at < NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
    ) sub
  `
  return Number(rows[0].avg ?? 0)
}

export async function getIssuesForClustering(
  repoId: number
): Promise<IssueRow[]> {
  const rows = await sql`
    SELECT * FROM issues
    WHERE repo_id = ${repoId}
      AND embedding IS NOT NULL
      AND created_at >= NOW() - INTERVAL '90 days'
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
      AND created_at >= NOW() - INTERVAL '90 days'
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `
  return rows as { date: string; count: number }[]
}

export async function deleteOldIssues(): Promise<void> {
  await sql`
    DELETE FROM issues WHERE created_at < NOW() - INTERVAL '90 days'
  `
}

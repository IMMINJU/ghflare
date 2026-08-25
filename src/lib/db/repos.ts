import { sql } from './client'
import type { RepoRow, TrendingRepo } from '@/types'

export async function upsertRepo(repo: TrendingRepo): Promise<RepoRow> {
  const rows = await sql`
    INSERT INTO repos (owner, name, description, language, stars, updated_at)
    VALUES (${repo.owner}, ${repo.name}, ${repo.description}, ${repo.language}, ${repo.stars}, NOW())
    ON CONFLICT (owner, name) DO UPDATE SET
      description = EXCLUDED.description,
      language    = EXCLUDED.language,
      stars       = EXCLUDED.stars,
      updated_at  = NOW()
    RETURNING *
  `
  return rows[0] as RepoRow
}

// One-time backfill of the GitHub creation date (immutable, so callers only
// invoke this when the row's gh_created_at is still NULL).
export async function setRepoGhCreatedAt(
  repoId: number,
  ghCreatedAt: string
): Promise<void> {
  await sql`
    UPDATE repos SET gh_created_at = ${ghCreatedAt} WHERE id = ${repoId}
  `
}

export async function getRepoByOwnerName(
  owner: string,
  name: string
): Promise<RepoRow | null> {
  const rows = await sql`
    SELECT * FROM repos WHERE owner = ${owner} AND name = ${name} LIMIT 1
  `
  return (rows[0] as RepoRow) ?? null
}

export async function getRepoById(id: number): Promise<RepoRow | null> {
  const rows = await sql`SELECT * FROM repos WHERE id = ${id} LIMIT 1`
  return (rows[0] as RepoRow) ?? null
}

// A repo whose newest snapshot is older than this has fallen out of trending:
// the feed can't surface it (it's pinned to the latest pipeline date), so its
// issues/clusters sit unread until the 90-day issue retention catches up.
// Within this window a returning repo still has its data; past it, the
// pipeline simply re-collects and re-embeds (cents, not dollars).
export const STALE_REPO_DAYS = 14

// Liveness deliberately counts BOTH snapshot sources, unlike the feed/digest
// universe (pipeline-only, see 004): a manual analyze is the user saying "I'm
// looking at this repo", and stripping its issues that same night would undo
// the analyze. Retention stays bounded — snapshots of either source age out
// after 30 days (deleteOldSnapshots), after which the repo goes stale here.
export async function getStaleRepoIds(): Promise<number[]> {
  const rows = await sql`
    SELECT r.id
    FROM repos r
    LEFT JOIN (
      SELECT repo_id, MAX(date) AS last_date
      FROM snapshots
      GROUP BY repo_id
    ) s ON s.repo_id = r.id
    WHERE s.last_date IS NULL OR s.last_date < CURRENT_DATE - ${STALE_REPO_DAYS}::int
  `
  return rows.map((r) => r.id as number)
}

// Drop the repo row itself. Everything hanging off it — issues, clusters,
// cluster_issues, snapshots, notification state — goes with it via ON DELETE
// CASCADE (001_init.sql). Deleting only the issues would strand the repo row:
// the page renders an empty timeline forever, because the GitHub re-fetch runs
// only on the "repo not in DB" branch (page.tsx), so a visit can't rehydrate it.
export async function deleteReposByIds(repoIds: number[]): Promise<void> {
  if (repoIds.length === 0) return
  await sql`DELETE FROM repos WHERE id = ANY(${repoIds})`
}

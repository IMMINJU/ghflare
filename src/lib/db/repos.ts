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

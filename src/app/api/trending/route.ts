import { NextResponse } from 'next/server'
import type { TrendingResponse, AnomalousRepo, ErrorResponse } from '@/types'
import { sql } from '@/lib/db/client'

export const revalidate = 1800

export async function GET() {
  try {
    const rows = await sql`
      SELECT
        r.owner,
        r.name,
        r.description,
        r.stars,
        r.language,
        s.anomaly_score,
        s.anomaly_level,
        s.issue_count,
        s.created_at AS updated_at
      FROM snapshots s
      JOIN repos r ON r.id = s.repo_id
      WHERE s.date = CURRENT_DATE
        AND s.anomaly_level IN ('elevated', 'spike')
      ORDER BY s.anomaly_score DESC
      LIMIT 25
    `

    if (rows.length === 0) {
      const latest = await sql`SELECT MAX(created_at) AS ts FROM snapshots`
      return NextResponse.json<TrendingResponse>({
        repos: [],
        updatedAt: (latest[0]?.ts as string) ?? new Date().toISOString(),
      })
    }

    const repos: AnomalousRepo[] = await Promise.all(
      rows.map(async (row) => {
        const repoRow = await sql`
          SELECT id FROM repos WHERE owner = ${row.owner as string} AND name = ${row.name as string} LIMIT 1
        `
        const repoId = repoRow[0]?.id as number | undefined

        let topTopics: string[] = []
        if (repoId) {
          const clusters = await sql`
            SELECT label FROM clusters
            WHERE repo_id = ${repoId}
            ORDER BY created_at DESC
            LIMIT 2
          `
          topTopics = clusters.map((c) => c.label as string)
        }

        const historicalRows = await sql`
          SELECT AVG(issue_count)::float AS avg
          FROM snapshots
          WHERE repo_id = ${repoId}
            AND date >= CURRENT_DATE - INTERVAL '30 days'
            AND date < CURRENT_DATE - INTERVAL '7 days'
        `
        const historicalAvg = Number(historicalRows[0]?.avg ?? 0)
        const recentCount = row.issue_count as number
        const multiplier = historicalAvg > 0 ? (recentCount / 7) / historicalAvg : 1

        return {
          owner: row.owner as string,
          name: row.name as string,
          description: (row.description as string) ?? '',
          stars: (row.stars as number) ?? 0,
          language: (row.language as string) ?? null,
          detectedAt: (row.updated_at as string) ?? null,
          anomaly: {
            level: row.anomaly_level as 'elevated' | 'spike',
            score: row.anomaly_score as number,
            recentCount,
            historicalAvg,
            multiplier,
          },
          topTopics,
        }
      })
    )

    const updatedAt = rows[0].updated_at as string

    return NextResponse.json<TrendingResponse>({ repos, updatedAt })
  } catch (err) {
    console.error('[api/trending]', err)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}

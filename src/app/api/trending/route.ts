import { NextResponse } from 'next/server'
import type { TrendingResponse, AnomalousRepo, ErrorResponse } from '@/types'
import { sql } from '@/lib/db/client'
import { getHistoricalDailyAvg } from '@/lib/db/issues'

export const revalidate = 1800

export async function GET() {
  try {
    // Pipeline snapshots only: a manual analyze after UTC midnight would
    // otherwise advance MAX(date) and collapse the feed to that one repo.
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
        s.updated_at AS updated_at
      FROM snapshots s
      JOIN repos r ON r.id = s.repo_id
      WHERE s.source = 'pipeline'
        AND s.date = (SELECT MAX(date) FROM snapshots WHERE source = 'pipeline')
        AND s.anomaly_level IN ('elevated', 'spike')
      ORDER BY s.anomaly_p_value ASC NULLS LAST, s.anomaly_score DESC
      LIMIT 25
    `

    if (rows.length === 0) {
      const latest = await sql`SELECT MAX(updated_at) AS ts FROM snapshots WHERE source = 'pipeline'`
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

        // The pipeline already computed the anomaly against the correct baseline
        // and stored score = ratio - 1 (see detectAnomaly). Derive the displayed
        // multiplier from that instead of recomputing from snapshot issue_count,
        // which mixed units (7-day totals vs daily rate) and skewed the figure.
        const recentCount = row.issue_count as number
        const multiplier = ((row.anomaly_score as number) ?? 0) + 1
        // Baseline shown on the card uses the same 23-day definition as the pipeline.
        const historicalAvg = repoId ? await getHistoricalDailyAvg(repoId) : 0

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

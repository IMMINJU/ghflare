import { RepoCard } from '@/components/RepoCard'
import { sql } from '@/lib/db/client'
import type { AnomalousRepo } from '@/types'

export const revalidate = 1800

async function getTrendingData(): Promise<{ repos: AnomalousRepo[]; updatedAt: string | null }> {
  try {
    const rows = await sql`
      SELECT
        r.id AS repo_id,
        r.owner,
        r.name,
        r.description,
        r.stars,
        r.language,
        s.anomaly_score,
        s.anomaly_level,
        s.issue_count,
        s.created_at AS snapshot_time
      FROM snapshots s
      JOIN repos r ON r.id = s.repo_id
      WHERE s.date = CURRENT_DATE
        AND s.anomaly_level IN ('elevated', 'spike')
      ORDER BY s.anomaly_score DESC
      LIMIT 25
    `

    if (rows.length === 0) {
      const latest = await sql`SELECT MAX(created_at) AS ts FROM snapshots`
      return { repos: [], updatedAt: (latest[0]?.ts as string) ?? null }
    }

    const repos: AnomalousRepo[] = await Promise.all(
      rows.map(async (row) => {
        const repoId = row.repo_id as number
        const [clusters, historicalRows, recentRows] = await Promise.all([
          sql`
            SELECT label FROM clusters
            WHERE repo_id = ${repoId}
            ORDER BY created_at DESC
            LIMIT 2
          `,
          sql`
            SELECT AVG(daily_count)::float AS avg FROM (
              SELECT DATE(created_at), COUNT(*) AS daily_count
              FROM issues
              WHERE repo_id = ${repoId}
                AND created_at >= NOW() - INTERVAL '30 days'
                AND created_at < NOW() - INTERVAL '7 days'
              GROUP BY DATE(created_at)
            ) sub
          `,
          sql`
            SELECT COUNT(*)::int AS count FROM issues
            WHERE repo_id = ${repoId}
              AND created_at >= NOW() - INTERVAL '7 days'
          `,
        ])

        const historicalAvg = Number(historicalRows[0]?.avg ?? 0)
        const recentCount = recentRows[0].count as number
        const multiplier = historicalAvg > 0 ? (recentCount / 7) / historicalAvg : 1

        return {
          owner: row.owner as string,
          name: row.name as string,
          description: (row.description as string) ?? '',
          stars: (row.stars as number) ?? 0,
          language: (row.language as string) ?? null,
          detectedAt: (row.snapshot_time as string) ?? null,
          anomaly: {
            level: row.anomaly_level as 'elevated' | 'spike',
            score: row.anomaly_score as number,
            recentCount,
            historicalAvg,
            multiplier,
          },
          topTopics: clusters.map((c) => c.label as string),
        }
      })
    )

    return { repos, updatedAt: rows[0].snapshot_time as string }
  } catch {
    return { repos: [], updatedAt: null }
  }
}

function formatUpdatedAt(updatedAt: string | null): string | null {
  if (!updatedAt) return null
  const diffMs = Date.now() - new Date(updatedAt).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `Updated ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Updated ${hours}h ago`
  return `Updated ${Math.floor(hours / 24)}d ago`
}

export default async function Home() {
  const { repos, updatedAt } = await getTrendingData()
  const updatedLabel = formatUpdatedAt(updatedAt)

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="mb-12">
        <h1 className="font-serif text-5xl font-semibold text-text-primary leading-tight mb-3">
          Active Anomalies
        </h1>
        <p className="text-text-secondary max-w-2xl">
          Real-time monitoring of GitHub Trending repositories detecting unusual spikes in issue activity
        </p>
        {updatedLabel && (
          <p className="text-xs text-text-muted font-mono mt-2">{updatedLabel}</p>
        )}
      </div>

      {repos.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-text-secondary text-sm">No unusual activity detected right now.</p>
          <p className="text-text-muted text-xs font-mono mt-2">
            Check back after the next pipeline run.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-sm font-serif font-semibold text-text-primary">Currently Active</span>
            <span
              className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: 'var(--color-accent-tint)', color: 'var(--color-accent)' }}
            >
              {repos.length}
            </span>
          </div>
          <section className="flex flex-col gap-4">
            {repos.map((repo) => (
              <RepoCard key={`${repo.owner}/${repo.name}`} repo={repo} />
            ))}
          </section>
        </>
      )}
    </div>
  )
}

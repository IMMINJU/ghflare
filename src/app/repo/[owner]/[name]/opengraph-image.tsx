import { ImageResponse } from 'next/og'
import { getRepoByOwnerName } from '@/lib/db/repos'
import { getRecentIssueCount, getHistoricalDailyAvg } from '@/lib/db/issues'
import { detectAnomaly } from '@/lib/analysis/anomaly'
import { sql } from '@/lib/db/client'

export const alt = 'ghflare repo analysis'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

type Props = { params: Promise<{ owner: string; name: string }> }

const LEVEL_COLORS = {
  spike:    '#EF4444',
  elevated: '#F59E0B',
  normal:   '#06B6D4',
}

export default async function OGImage({ params }: Props) {
  const { owner, name } = await params

  let level: 'spike' | 'elevated' | 'normal' = 'normal'
  let multiplier = 1
  let recentCount = 0
  let topTopics: string[] = []

  try {
    const repo = await getRepoByOwnerName(owner, name)
    if (repo) {
      const [rc, ha, clusters] = await Promise.all([
        getRecentIssueCount(repo.id),
        getHistoricalDailyAvg(repo.id),
        sql`
          SELECT label FROM clusters
          WHERE repo_id = ${repo.id}
          ORDER BY created_at DESC
          LIMIT 2
        `,
      ])
      const anomaly = detectAnomaly(rc, ha)
      level = anomaly.level
      multiplier = anomaly.multiplier
      recentCount = rc
      topTopics = clusters.map((c) => c.label as string)
    }
  } catch {
    // fallback: show repo name only
  }

  const color = LEVEL_COLORS[level]

  return new ImageResponse(
    (
      <div
        style={{
          background: '#0A0A0A',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '60px',
          fontFamily: 'monospace',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ color: '#6B6560', fontSize: 14 }}>ghflare</span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <span style={{ color: '#FAFAFA', fontSize: 52, fontWeight: 700 }}>
            {owner}/{name}
          </span>

          {level !== 'normal' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  background: color,
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: 999,
                }}
              >
                ● {level.toUpperCase()}
              </span>
              <span style={{ color: '#9E9893', fontSize: 18 }}>
                {multiplier.toFixed(1)}x usual · {recentCount} issues / 7d
              </span>
            </div>
          )}

          {topTopics.length > 0 && (
            <span style={{ color: '#6B6560', fontSize: 16 }}>
              {topTopics.join(' · ')}
            </span>
          )}
        </div>

        <span style={{ color: '#4B4845', fontSize: 13 }}>
          github.com/{owner}/{name}
        </span>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}

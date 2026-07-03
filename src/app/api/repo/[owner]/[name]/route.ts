import { NextRequest, NextResponse } from 'next/server'
import type { RepoDetailResponse, TimelinePoint, ClusterDetail, ErrorResponse } from '@/types'
import { sql } from '@/lib/db/client'
import { getRepoByOwnerName } from '@/lib/db/repos'
import { getTimelineData, getRecentIssueCount, getBaseline } from '@/lib/db/issues'
import { getClustersWithIssues } from '@/lib/db/clusters'
import { getLatestSnapshot } from '@/lib/db/snapshots'
import { resolveDisplayAnomaly } from '@/lib/analysis/anomaly'

const OWNER_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/
const NAME_REGEX = /^[a-zA-Z0-9._-]{1,100}$/

type Params = { owner: string; name: string }

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  const { owner, name } = await params

  if (!OWNER_REGEX.test(owner) || !NAME_REGEX.test(name)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Invalid repo', code: 'INVALID_REPO' },
      { status: 400 }
    )
  }

  try {
    const repo = await getRepoByOwnerName(owner, name)
    if (!repo) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Repo not found', code: 'REPO_NOT_FOUND' },
        { status: 404 }
      )
    }

    const [timelineData, clusterRows, recentCount, baseline, snapshot] = await Promise.all([
      getTimelineData(repo.id),
      getClustersWithIssues(repo.id),
      getRecentIssueCount(repo.id),
      getBaseline(repo.id),
      getLatestSnapshot(repo.id),
    ])
    const historicalAvg = baseline.dailyAvg

    // Snapshot-first: the stored level already applied the fetch-coverage and
    // age gates, which a live recompute from stored issues can't know.
    const anomaly = resolveDisplayAnomaly(
      snapshot,
      repo.gh_created_at ?? repo.created_at,
      recentCount,
      historicalAvg,
      baseline.count
    )

    // Build 90-day timeline with daily avg for anomaly markers. Use the same
    // floored baseline as detectAnomaly (min ~1 issue/week) so a zero-history
    // repo whose badge reads "spike" also shows highlighted days — otherwise the
    // badge and the timeline disagree. A day needs at least 2 issues to mark, so
    // the floor doesn't light up every single-issue day on a dead repo.
    const dailyBaseline = Math.max(historicalAvg, 1 / 7)
    const countByDate = new Map(timelineData.map((r) => [r.date, r.count]))
    const timeline: TimelinePoint[] = []
    for (let d = 89; d >= 0; d--) {
      const date = new Date()
      date.setDate(date.getDate() - d)
      const dateStr = date.toISOString().slice(0, 10)
      const count = countByDate.get(dateStr) ?? 0
      timeline.push({
        date: dateStr,
        count,
        isAnomalous: count >= 2 && count > dailyBaseline * 2,
      })
    }

    const clusters: ClusterDetail[] = clusterRows.map((cluster) => ({
      id: String(cluster.id),
      label: cluster.label,
      count: cluster.issues.length,
      issues: cluster.issues.map((issue) => ({
        number: issue.issue_number,
        title: issue.title,
        url: `https://github.com/${owner}/${name}/issues/${issue.issue_number}`,
        createdAt: issue.created_at,
      })),
    }))

    return NextResponse.json<RepoDetailResponse>({
      repo: {
        owner: repo.owner,
        name: repo.name,
        description: repo.description ?? '',
        stars: repo.stars,
      },
      anomaly: {
        level: anomaly.level,
        score: anomaly.score,
        recentCount: anomaly.recentCount,
        historicalAvg,
        multiplier: anomaly.multiplier,
        analyzedAt: anomaly.analyzedAt,
      },
      timeline,
      clusters,
    })
  } catch (err) {
    console.error(`[api/repo/${owner}/${name}]`, err)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}

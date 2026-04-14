import { NextRequest, NextResponse } from 'next/server'
import type { ErrorResponse } from '@/types'
import { getRepoByOwnerName, upsertRepo } from '@/lib/db/repos'
import { getRecentIssueCount, getHistoricalDailyAvg, upsertIssues } from '@/lib/db/issues'
import { fetchRepoMeta, fetchRepoIssues } from '@/lib/github/issues'
import { upsertSnapshot } from '@/lib/db/snapshots'
import { detectAnomaly } from '@/lib/analysis/anomaly'

const OWNER_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/
const NAME_REGEX = /^[a-zA-Z0-9._-]{1,100}$/

type Params = { owner: string; name: string }

export async function POST(
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
    let repoRow = await getRepoByOwnerName(owner, name)
    if (!repoRow) {
      const meta = await fetchRepoMeta(owner, name)
      repoRow = await upsertRepo({ owner, name, ...meta })
    }
    const rawIssues = await fetchRepoIssues(owner, name)
    await upsertIssues(repoRow.id, rawIssues)

    const [recentCount, historicalAvg] = await Promise.all([
      getRecentIssueCount(repoRow.id),
      getHistoricalDailyAvg(repoRow.id),
    ])
    const anomaly = detectAnomaly(recentCount, historicalAvg)
    const today = new Date().toISOString().slice(0, 10)
    await upsertSnapshot({
      repoId: repoRow.id,
      date: today,
      issueCount: recentCount,
      anomalyScore: anomaly.score,
      anomalyLevel: anomaly.level,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(`[api/repo/${owner}/${name}/fetch]`, err)
    return NextResponse.json<ErrorResponse>(
      { error: 'Could not fetch repo data', code: 'FETCH_FAILED' },
      { status: 500 }
    )
  }
}

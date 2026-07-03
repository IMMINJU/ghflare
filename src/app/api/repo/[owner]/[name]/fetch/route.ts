import { NextRequest, NextResponse } from 'next/server'
import type { ErrorResponse, RepoRow } from '@/types'
import { getRepoByOwnerName, upsertRepo, setRepoGhCreatedAt } from '@/lib/db/repos'
import { getRecentIssueCount, getBaseline, upsertIssues } from '@/lib/db/issues'
import { fetchRepoMeta, fetchRepoIssues } from '@/lib/github/issues'
import { upsertSnapshot } from '@/lib/db/snapshots'
import { detectAnomaly, repoAgeInDays } from '@/lib/analysis/anomaly'

const OWNER_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/
const NAME_REGEX = /^[a-zA-Z0-9._-]{1,100}$/

type Params = { owner: string; name: string }

// Backfill the GitHub creation date once per repo (age-gate input). On failure
// the gate falls back to the first-seen row age (a lower bound), so a miss only
// over-suppresses a newly-tracked repo — log and swallow.
async function ensureGhCreatedAt(
  repoRow: RepoRow,
  owner: string,
  name: string,
  knownCreatedAt?: string | null
): Promise<RepoRow> {
  if (repoRow.gh_created_at) return repoRow
  try {
    const createdAt = knownCreatedAt ?? (await fetchRepoMeta(owner, name)).createdAt
    if (!createdAt) return repoRow
    await setRepoGhCreatedAt(repoRow.id, createdAt)
    return { ...repoRow, gh_created_at: createdAt }
  } catch (err) {
    console.error(`[api/repo/${owner}/${name}/fetch] repo meta failed:`, err)
    return repoRow
  }
}

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
      repoRow = await upsertRepo({
        owner,
        name,
        description: meta.description,
        stars: meta.stars,
        language: meta.language,
      })
      repoRow = await ensureGhCreatedAt(repoRow, owner, name, meta.createdAt)
    } else {
      repoRow = await ensureGhCreatedAt(repoRow, owner, name)
    }
    const { issues: rawIssues, baselineCovered } = await fetchRepoIssues(owner, name)
    if (!baselineCovered) {
      // Same policy as the pipeline: a fetch that can't cover the 30-day anomaly
      // window undercounts the baseline, so the anomaly is held to 'normal'
      // below instead of firing a false spike.
      console.warn(`[api/repo/${owner}/${name}/fetch] fetch does not cover the 30d anomaly window: anomaly held to normal`)
    }
    await upsertIssues(repoRow.id, rawIssues)

    const [recentCount, baseline] = await Promise.all([
      getRecentIssueCount(repoRow.id),
      getBaseline(repoRow.id),
    ])
    const anomaly = detectAnomaly(
      recentCount,
      baseline.dailyAvg,
      baseline.count,
      !baselineCovered,
      // First-seen fallback — same policy as the pipeline (MIN_REPO_AGE_DAYS).
      repoAgeInDays(repoRow.gh_created_at ?? repoRow.created_at)
    )
    const today = new Date().toISOString().slice(0, 10)
    // source:'manual' keeps this snapshot out of the feed/digest date universe
    // (a post-midnight analyze must not collapse the feed to this one repo);
    // the repo's own detail page still reads it as its latest snapshot.
    await upsertSnapshot({
      repoId: repoRow.id,
      date: today,
      issueCount: recentCount,
      anomalyScore: anomaly.score,
      anomalyLevel: anomaly.level,
      pValue: anomaly.pValue,
      expectedCount: anomaly.expectedCount,
      source: 'manual',
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

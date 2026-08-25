import { fetchTrendingRepos } from '../src/lib/github/trending'
import { fetchRepoIssues, fetchRepoMeta } from '../src/lib/github/issues'
import { generateEmbeddings, generateClusterLabels } from '../src/lib/embeddings/openai'
import { detectAnomaly, repoAgeInDays } from '../src/lib/analysis/anomaly'
import { buildClusterGroups } from '../src/lib/analysis/cluster'
import {
  upsertRepo,
  setRepoGhCreatedAt,
  getStaleRepoIds,
  deleteReposByIds,
} from '../src/lib/db/repos'
import {
  upsertIssues,
  getExistingIssueNumbers,
  getIssuesWithoutEmbeddings,
  getIssuesForClustering,
  updateEmbeddingsBatch,
  getRecentIssueCount,
  getBaseline,
  deleteOldIssues,
} from '../src/lib/db/issues'
import { upsertSnapshots, deleteOldSnapshots } from '../src/lib/db/snapshots'
import type { SnapshotUpsert } from '../src/lib/db/snapshots'
import { replaceCluster } from '../src/lib/db/clusters'
import {
  getNotificationCandidates,
  getNotificationStates,
  decideNotifications,
  applyNotificationState,
  recordNotificationEvent,
  pruneStaleNotificationState,
} from '../src/lib/db/notifications'
import { sendDigest } from '../src/lib/notify/googleChat'
import type { TrendingRepo } from '../src/types'

const CONCURRENCY = 5

type RepoStats = {
  issuesCollected: number
  newEmbeddings: number
  newRawCount: number
  level: string
  snapshot: SnapshotUpsert
}

async function processRepo(trending: TrendingRepo, force: boolean): Promise<RepoStats> {
  let repoRow = await upsertRepo(trending)

  if (!repoRow.gh_created_at) {
    // One-time backfill of the GitHub creation date for the age gate. On
    // failure the gate falls back to the first-seen row age (a lower bound),
    // so a miss only over-suppresses a newly-tracked repo — log and continue.
    try {
      const meta = await fetchRepoMeta(trending.owner, trending.name)
      if (meta.createdAt) {
        await setRepoGhCreatedAt(repoRow.id, meta.createdAt)
        repoRow = { ...repoRow, gh_created_at: meta.createdAt }
      }
    } catch (err) {
      console.error(`[pipeline] repo meta failed ${trending.owner}/${trending.name}:`, err)
    }
  }

  const [fetched, existingNumbers] = await Promise.all([
    fetchRepoIssues(trending.owner, trending.name),
    getExistingIssueNumbers(repoRow.id),
  ])
  const { issues: rawIssues, baselineCovered } = fetched
  if (!baselineCovered) {
    // The page cap stopped the fetch inside the 30-day anomaly window: the
    // baseline is undercounted, so the anomaly below is suppressed to 'normal'
    // rather than firing a false spike. Surface it so a chronically-uncovered
    // repo is visible to operators.
    console.warn(
      `[pipeline] fetch of ${trending.owner}/${trending.name} does not cover the 30d anomaly window: anomaly held to normal`
    )
  } else if (fetched.truncated) {
    // 90-day window truncated but the anomaly windows are fully covered — the
    // level is trustworthy; only clustering/timeline lose the oldest issues.
    console.warn(
      `[pipeline] truncated 90d fetch ${trending.owner}/${trending.name}: clustering/timeline partial, anomaly unaffected`
    )
  }
  const newRawIssues = force
    ? rawIssues
    : rawIssues.filter((i) => !existingNumbers.has(i.number))

  await upsertIssues(repoRow.id, newRawIssues)

  const unembedded = await getIssuesWithoutEmbeddings(repoRow.id)
  let newEmbeddings = 0
  if (unembedded.length > 0) {
    // Embedding failures must not zero out the repo — the anomaly snapshot below
    // only needs the issue rows, which are already persisted. Log and move on.
    try {
      const embedResults = await generateEmbeddings(
        unembedded.map((i) => ({ id: i.id, title: i.title, body: i.body }))
      )
      await updateEmbeddingsBatch(embedResults)
      newEmbeddings = embedResults.length
    } catch (err) {
      console.error(`[pipeline] embeddings failed ${trending.owner}/${trending.name}:`, err)
    }
  }

  // Clustering is best-effort; a failure here must not block the snapshot.
  try {
    const issuesForClustering = await getIssuesForClustering(repoRow.id)

    const clusterable = issuesForClustering.map((i) => ({ ...i, embedding: i.embedding as number[] }))
    const groups = buildClusterGroups(clusterable)

    if (groups.length > 0) {
      const labels = await generateClusterLabels(
        groups.map((g) => g.memberIssues.slice(0, 3).map((i) => i.title))
      )

      const clusters = groups.map((g, i) => ({
        label: labels[i],
        issueIds: g.memberIssues.map((m) => m.id),
        centroid: g.centroid,
      }))

      await replaceCluster(repoRow.id, clusters)
    }
  } catch (err) {
    console.error(`[pipeline] clustering failed ${trending.owner}/${trending.name}:`, err)
  }

  const [recentCount, baseline] = await Promise.all([
    getRecentIssueCount(repoRow.id),
    getBaseline(repoRow.id),
  ])
  const anomaly = detectAnomaly(
    recentCount,
    baseline.dailyAvg,
    baseline.count,
    !baselineCovered,
    // First-seen row age as the fallback: a lower bound on true age, so a
    // failed meta backfill can only over-suppress a newly-tracked repo — never
    // let a young repo alert just because gh_created_at is missing.
    repoAgeInDays(repoRow.gh_created_at ?? repoRow.created_at)
  )

  return {
    issuesCollected: rawIssues.length,
    newEmbeddings,
    newRawCount: newRawIssues.length,
    level: anomaly.level,
    // Persisted by main() in one batch after every repo finishes — see
    // upsertSnapshots for why a run's snapshots must land together.
    snapshot: {
      repoId: repoRow.id,
      issueCount: recentCount,
      anomalyScore: anomaly.score,
      anomalyLevel: anomaly.level,
      pValue: anomaly.pValue,
      expectedCount: anomaly.expectedCount,
    },
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<{ result: R | null; error: unknown; item: T }[]> {
  const results: { result: R | null; error: unknown; item: T }[] = new Array(items.length)
  let cursor = 0

  async function next(): Promise<void> {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      try {
        const result = await worker(items[i])
        results[i] = { result, error: null, item: items[i] }
      } catch (error) {
        results[i] = { result: null, error, item: items[i] }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()))
  return results
}

// Send a Google Chat digest of the anomalies detected this run, then persist
// dedup state. Best-effort: any failure here is logged and swallowed so it
// never fails the data pipeline.
async function runNotifications(runDate: string): Promise<void> {
  try {
    const [candidates, priorStates] = await Promise.all([
      getNotificationCandidates(),
      getNotificationStates(),
    ])
    const { toNotify, notifiedUpserts, steadyUpserts, stateClears } = decideNotifications(
      candidates,
      priorStates
    )

    const result = await sendDigest(toNotify, runDate)

    // Contract (see notifications.ts): steady updates and normal-resets reflect
    // what we observed and must persist regardless of the send outcome, or a
    // later re-escalation / re-alert is missed. The notified repos' state only
    // advances when the digest actually went out (sent/dry_run) — on failure we
    // leave them unnotified so the next run retries them.
    const sendSucceeded = result.status === 'sent' || result.status === 'dry_run'
    const upserts = sendSucceeded ? [...steadyUpserts, ...notifiedUpserts] : steadyUpserts
    await applyNotificationState(runDate, upserts, stateClears)

    await recordNotificationEvent({
      runDate,
      status: result.status,
      repoCount: result.repoCount,
      error: result.status === 'failed' ? result.error : undefined,
    })
    console.log(`[pipeline] notify  status=${result.status}  notified=${toNotify.length}`)

    await pruneStaleNotificationState()
  } catch (err) {
    console.error('[pipeline] notify failed:', err)
  }
}

async function main() {
  const force = process.argv.includes('--force')
  const start = Date.now()
  // One date for the whole run: per-repo dates would split a run that crosses
  // UTC midnight and desync the snapshot universe from the notification reads.
  const runDate = new Date().toISOString().slice(0, 10)

  console.log(`[pipeline] start  date=${runDate}`)

  const trendingRepos = await fetchTrendingRepos()
  console.log(`[pipeline] trending parsed  repos=${trendingRepos.length}  concurrency=${CONCURRENCY}`)

  const outcomes = await runWithConcurrency(trendingRepos, CONCURRENCY, (trending) =>
    processRepo(trending, force)
  )

  let reposProcessed = 0
  let issuesCollected = 0
  let newEmbeddings = 0
  let errors = 0

  for (const outcome of outcomes) {
    const { owner, name } = outcome.item
    if (outcome.error) {
      errors++
      console.error(`[pipeline] error ${owner}/${name}:`, outcome.error)
      continue
    }
    const stats = outcome.result!
    reposProcessed++
    issuesCollected += stats.issuesCollected
    newEmbeddings += stats.newEmbeddings
    console.log(`[pipeline] ${owner}/${name}  level=${stats.level}  new=${stats.newRawCount}`)
  }

  // One batch write for the whole run: the feed's date universe (MAX(date)
  // over pipeline snapshots) must not flip to today until every repo's
  // snapshot can land with it. Repos that errored above are simply absent.
  const snapshots = outcomes
    .filter((o) => !o.error && o.result)
    .map((o) => o.result!.snapshot)
  await upsertSnapshots(runDate, snapshots)
  console.log(`[pipeline] snapshots written  count=${snapshots.length}  date=${runDate}`)

  // Notify before cleanup: the digest reads the snapshots and clusters we just
  // wrote, and keeping it ahead of cleanup separates alert failures from
  // retention failures.
  await runNotifications(runDate)

  // Each step runs in its own try so one failure can't skip the rest. They
  // used to share a block, which meant a throw in the age cleanup silently
  // stopped the stale prune below it — and the swallowed error still let the
  // job finish green.
  let cleanupFailed = false
  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err) {
      cleanupFailed = true
      console.error(`[pipeline] cleanup step failed  step=${label}:`, err)
    }
  }

  await step('deleteOldIssues', deleteOldIssues)
  await step('deleteOldSnapshots', deleteOldSnapshots)

  // Storage guard (Neon free tier is 0.5GB): repos that fell out of trending
  // otherwise hold up to 90 days of unread issues at ~6KB/row of embedding.
  // Runs after deleteOldSnapshots so a repo whose snapshots all just aged out
  // is treated as stale in the same run. Deleting the repo row cascades to its
  // issues, clusters, snapshots and notification state — see deleteReposByIds
  // for why the row itself has to go.
  await step('pruneStaleRepos', async () => {
    const staleRepoIds = await getStaleRepoIds()
    await deleteReposByIds(staleRepoIds)
    if (staleRepoIds.length > 0) {
      console.log(`[pipeline] stale repos pruned  repos=${staleRepoIds.length}`)
    }
  })

  // Surface a broken cleanup instead of ending green: retention failing
  // silently is how the DB filled up in the first place.
  if (cleanupFailed) {
    console.error('[pipeline] cleanup incomplete — see step failures above')
    process.exitCode = 1
  }

  const duration = Date.now() - start
  console.log(
    `[pipeline] done  repos=${reposProcessed}  issues=${issuesCollected}  embeddings=${newEmbeddings}  errors=${errors}  duration=${duration}ms`
  )
}

main().catch((err) => {
  console.error('[pipeline] fatal:', err)
  process.exit(1)
})

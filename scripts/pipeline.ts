import { fetchTrendingRepos } from '../src/lib/github/trending'
import { fetchRepoIssues } from '../src/lib/github/issues'
import { generateEmbeddings, generateClusterLabels } from '../src/lib/embeddings/openai'
import { detectAnomaly } from '../src/lib/analysis/anomaly'
import { calculateK, kMeans } from '../src/lib/analysis/cluster'
import { upsertRepo } from '../src/lib/db/repos'
import {
  upsertIssues,
  getExistingIssueNumbers,
  getIssuesWithoutEmbeddings,
  getIssuesForClustering,
  updateEmbeddingsBatch,
  getRecentIssueCount,
  getHistoricalDailyAvg,
  deleteOldIssues,
} from '../src/lib/db/issues'
import { upsertSnapshot } from '../src/lib/db/snapshots'
import { replaceCluster } from '../src/lib/db/clusters'
import type { TrendingRepo } from '../src/types'

const CONCURRENCY = 5

type RepoStats = {
  issuesCollected: number
  newEmbeddings: number
  newRawCount: number
  level: string
}

async function processRepo(trending: TrendingRepo, force: boolean): Promise<RepoStats> {
  const repoRow = await upsertRepo(trending)

  const [rawIssues, existingNumbers] = await Promise.all([
    fetchRepoIssues(trending.owner, trending.name),
    getExistingIssueNumbers(repoRow.id),
  ])
  const newRawIssues = force
    ? rawIssues
    : rawIssues.filter((i) => !existingNumbers.has(i.number))

  await upsertIssues(repoRow.id, newRawIssues)

  const unembedded = await getIssuesWithoutEmbeddings(repoRow.id)
  let newEmbeddings = 0
  if (unembedded.length > 0) {
    const embedResults = await generateEmbeddings(
      unembedded.map((i) => ({ id: i.id, title: i.title, body: i.body }))
    )
    await updateEmbeddingsBatch(embedResults)
    newEmbeddings = embedResults.length
  }

  const issuesForClustering = await getIssuesForClustering(repoRow.id)

  if (issuesForClustering.length >= 2) {
    const embeddings = issuesForClustering.map((i) => i.embedding as number[])
    const k = calculateK(embeddings.length)
    const { assignments } = kMeans(embeddings, k)

    const groups: { memberIssues: typeof issuesForClustering; centroid: number[] }[] = []
    for (let c = 0; c < k; c++) {
      const memberIndices = assignments
        .map((a, i) => (a === c ? i : -1))
        .filter((i) => i !== -1)
      const memberIssues = memberIndices.map((i) => issuesForClustering[i])
      const centroid = memberIssues
        .reduce(
          (sum, issue) => sum.map((v, d) => v + (issue.embedding as number[])[d]),
          new Array(1536).fill(0)
        )
        .map((v) => v / memberIssues.length)
      groups.push({ memberIssues, centroid })
    }

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

  return {
    issuesCollected: rawIssues.length,
    newEmbeddings,
    newRawCount: newRawIssues.length,
    level: anomaly.level,
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

async function main() {
  const force = process.argv.includes('--force')
  const start = Date.now()

  console.log('[pipeline] start')

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

  try {
    await deleteOldIssues()
  } catch (err) {
    console.error('[pipeline] cleanup failed:', err)
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

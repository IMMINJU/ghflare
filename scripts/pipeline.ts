import { fetchTrendingRepos } from '../src/lib/github/trending'
import { fetchRepoIssues } from '../src/lib/github/issues'
import { generateEmbeddings, generateClusterLabel } from '../src/lib/embeddings/openai'
import { detectAnomaly } from '../src/lib/analysis/anomaly'
import { calculateK, kMeans } from '../src/lib/analysis/cluster'
import { upsertRepo } from '../src/lib/db/repos'
import {
  upsertIssues,
  getExistingIssueNumbers,
  getIssuesWithoutEmbeddings,
  getIssuesForClustering,
  updateEmbedding,
  getRecentIssueCount,
  getHistoricalDailyAvg,
} from '../src/lib/db/issues'
import { upsertSnapshot } from '../src/lib/db/snapshots'
import { replaceCluster } from '../src/lib/db/clusters'

async function main() {
  const force = process.argv.includes('--force')
  const start = Date.now()

  let reposProcessed = 0
  let issuesCollected = 0
  let newEmbeddings = 0
  let errors = 0

  console.log('[pipeline] start')

  const trendingRepos = await fetchTrendingRepos()
  console.log(`[pipeline] trending parsed  repos=${trendingRepos.length}`)

  for (const trending of trendingRepos) {
    try {
      const repoRow = await upsertRepo(trending)

      const rawIssues = await fetchRepoIssues(trending.owner, trending.name)
      const existingNumbers = await getExistingIssueNumbers(repoRow.id)
      const newRawIssues = force
        ? rawIssues
        : rawIssues.filter((i) => !existingNumbers.has(i.number))

      await upsertIssues(repoRow.id, rawIssues)
      issuesCollected += rawIssues.length

      const unembedded = await getIssuesWithoutEmbeddings(repoRow.id)
      if (unembedded.length > 0) {
        const embedResults = await generateEmbeddings(
          unembedded.map((i) => ({ id: i.id, title: i.title, body: i.body }))
        )
        for (const { id, embedding } of embedResults) {
          await updateEmbedding(id, embedding)
        }
        newEmbeddings += embedResults.length
      }

      const issuesForClustering = await getIssuesForClustering(repoRow.id)

      if (issuesForClustering.length >= 2) {
        const embeddings = issuesForClustering.map((i) => i.embedding as number[])
        const k = calculateK(embeddings.length)
        const { assignments } = kMeans(embeddings, k)

        const clusters: { label: string; issueIds: number[]; centroid: number[] }[] = []
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

          const label = await generateClusterLabel(
            memberIssues.slice(0, 3).map((i) => i.title)
          )
          clusters.push({
            label,
            issueIds: memberIssues.map((i) => i.id),
            centroid,
          })
        }

        await replaceCluster(repoRow.id, clusters)
      }

      const recentCount = await getRecentIssueCount(repoRow.id)
      const historicalAvg = await getHistoricalDailyAvg(repoRow.id)
      const anomaly = detectAnomaly(recentCount, historicalAvg)

      const today = new Date().toISOString().slice(0, 10)
      await upsertSnapshot({
        repoId: repoRow.id,
        date: today,
        issueCount: recentCount,
        anomalyScore: anomaly.score,
        anomalyLevel: anomaly.level,
      })

      reposProcessed++
      console.log(
        `[pipeline] ${trending.owner}/${trending.name}  level=${anomaly.level}  new=${newRawIssues.length}`
      )
    } catch (err) {
      errors++
      console.error(`[pipeline] error ${trending.owner}/${trending.name}:`, err)
    }
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

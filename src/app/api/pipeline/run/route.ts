import { NextRequest, NextResponse } from 'next/server'
import type { PipelineRunRequest, PipelineRunResponse, ErrorResponse } from '@/types'

import { fetchTrendingRepos } from '@/lib/github/trending'
import { fetchRepoIssues, fetchRepoMeta } from '@/lib/github/issues'
import { generateEmbeddings, generateClusterLabel } from '@/lib/embeddings/openai'
import { detectAnomaly } from '@/lib/analysis/anomaly'
import { calculateK, kMeans } from '@/lib/analysis/cluster'
import { upsertRepo } from '@/lib/db/repos'
import { upsertIssues, getExistingIssueNumbers, getIssuesWithoutEmbeddings, getIssuesForClustering, updateEmbedding, getRecentIssueCount, getHistoricalDailyAvg } from '@/lib/db/issues'
import { upsertSnapshot } from '@/lib/db/snapshots'
import { replaceCluster } from '@/lib/db/clusters'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.PIPELINE_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  const body = (await req.json().catch(() => ({}))) as PipelineRunRequest
  const start = Date.now()

  let reposProcessed = 0
  let issuesCollected = 0
  let newEmbeddings = 0
  let errors = 0

  console.log('[pipeline] start')

  try {
    // Step 1: Parse trending
    const trendingRepos = await fetchTrendingRepos()
    console.log(`[pipeline] trending parsed  repos=${trendingRepos.length}`)

    // Steps 2–6: Per-repo processing
    for (const trending of trendingRepos) {
      try {
        // Step 2: Upsert repo + fetch issues
        const repoRow = await upsertRepo(trending)

        const rawIssues = await fetchRepoIssues(trending.owner, trending.name)
        const existingNumbers = await getExistingIssueNumbers(repoRow.id)
        const newRawIssues = body.force
          ? rawIssues
          : rawIssues.filter((i) => !existingNumbers.has(i.number))

        await upsertIssues(repoRow.id, rawIssues)
        issuesCollected += rawIssues.length

        // Step 3: Generate embeddings for new issues
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

        // Step 4: K-means clustering — re-fetch from DB to get actual embeddings
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

        // Step 5: Anomaly detection
        const recentCount = await getRecentIssueCount(repoRow.id)
        const historicalAvg = await getHistoricalDailyAvg(repoRow.id)
        const anomaly = detectAnomaly(recentCount, historicalAvg)

        // Step 6: Persist snapshot
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
  } catch (err) {
    console.error('[pipeline] fatal:', err)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }

  const duration = Date.now() - start
  console.log(
    `[pipeline] done  repos=${reposProcessed}  issues=${issuesCollected}  embeddings=${newEmbeddings}  errors=${errors}  duration=${duration}ms`
  )

  return NextResponse.json<PipelineRunResponse>({
    success: true,
    reposProcessed,
    issuesCollected,
    newEmbeddings,
    errors,
    duration,
  })
}

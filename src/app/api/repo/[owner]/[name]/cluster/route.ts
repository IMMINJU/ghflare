import { NextRequest, NextResponse } from 'next/server'
import type { ErrorResponse } from '@/types'
import { getRepoByOwnerName } from '@/lib/db/repos'
import { getIssuesWithoutEmbeddings, getIssuesForClustering, updateEmbedding } from '@/lib/db/issues'
import { generateEmbeddings, generateClusterLabel } from '@/lib/embeddings/openai'
import { calculateK, kMeans } from '@/lib/analysis/cluster'
import { replaceCluster } from '@/lib/db/clusters'

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

  const repo = await getRepoByOwnerName(owner, name)
  if (!repo) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Repo not found', code: 'REPO_NOT_FOUND' },
      { status: 404 }
    )
  }

  try {
    // Generate embeddings for issues that don't have them yet
    const unembedded = await getIssuesWithoutEmbeddings(repo.id)
    if (unembedded.length > 0) {
      const embedResults = await generateEmbeddings(
        unembedded.map((i) => ({ id: i.id, title: i.title, body: i.body }))
      )
      for (const { id, embedding } of embedResults) {
        await updateEmbedding(id, embedding)
      }
    }

    // Cluster
    const issuesForClustering = await getIssuesForClustering(repo.id)
    if (issuesForClustering.length < 2) {
      return NextResponse.json({ success: true })
    }

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
      clusters.push({ label, issueIds: memberIssues.map((i) => i.id), centroid })
    }

    await replaceCluster(repo.id, clusters)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(`[api/repo/${owner}/${name}/cluster]`, err)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}

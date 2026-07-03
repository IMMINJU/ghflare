import { NextRequest, NextResponse } from 'next/server'
import type { ErrorResponse } from '@/types'
import { getRepoByOwnerName } from '@/lib/db/repos'
import { getIssuesWithoutEmbeddings, getIssuesForClustering, updateEmbedding } from '@/lib/db/issues'
import { generateEmbeddings, generateClusterLabel } from '@/lib/embeddings/openai'
import { buildClusterGroups } from '@/lib/analysis/cluster'
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

    // Cluster. buildClusterGroups skips empty clusters, so no NaN centroid can
    // reach replaceCluster and wipe this repo's clusters (see cluster.ts).
    const issuesForClustering = await getIssuesForClustering(repo.id)
    const clusterable = issuesForClustering.map((i) => ({ ...i, embedding: i.embedding as number[] }))
    const groups = buildClusterGroups(clusterable)
    if (groups.length === 0) {
      return NextResponse.json({ success: true })
    }

    const clusters = await Promise.all(
      groups.map(async (g) => ({
        label: await generateClusterLabel(g.memberIssues.slice(0, 3).map((i) => i.title)),
        issueIds: g.memberIssues.map((i) => i.id),
        centroid: g.centroid,
      }))
    )

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

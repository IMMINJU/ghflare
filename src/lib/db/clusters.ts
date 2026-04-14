import { sql } from './client'
import type { ClusterRow, Cluster } from '@/types'

export async function replaceCluster(
  repoId: number,
  clusters: Cluster[]
): Promise<void> {
  await sql`DELETE FROM clusters WHERE repo_id = ${repoId}`

  for (const cluster of clusters) {
    const rows = await sql`
      INSERT INTO clusters (repo_id, label, centroid)
      VALUES (${repoId}, ${cluster.label}, ${JSON.stringify(cluster.centroid)}::vector)
      RETURNING id
    `
    const clusterId = rows[0].id as number

    for (const issueId of cluster.issueIds) {
      await sql`
        INSERT INTO cluster_issues (cluster_id, issue_id)
        VALUES (${clusterId}, ${issueId})
        ON CONFLICT DO NOTHING
      `
    }
  }
}

export async function getClustersWithIssues(repoId: number): Promise<
  (ClusterRow & {
    issues: { id: number; issue_number: number; title: string; created_at: string }[]
  })[]
> {
  const clusterRows = await sql`
    SELECT * FROM clusters WHERE repo_id = ${repoId} ORDER BY created_at DESC
  ` as ClusterRow[]

  const result = []
  for (const cluster of clusterRows) {
    const issues = await sql`
      SELECT i.id, i.issue_number, i.title, i.created_at
      FROM issues i
      JOIN cluster_issues ci ON ci.issue_id = i.id
      WHERE ci.cluster_id = ${cluster.id}
      ORDER BY i.created_at DESC
    `
    result.push({ ...cluster, issues: issues as { id: number; issue_number: number; title: string; created_at: string }[] })
  }

  return result
}

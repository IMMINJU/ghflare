export function calculateK(issueCount: number): number {
  return Math.min(Math.max(Math.floor(issueCount / 10), 2), 8)
}

export function kMeans(
  embeddings: number[][],
  k: number,
  maxIterations = 100
): { assignments: number[]; centroids: number[][] } {
  if (embeddings.length === 0) return { assignments: [], centroids: [] }

  const dim = embeddings[0].length
  let centroids = embeddings.slice(0, k).map((e) => [...e])
  let assignments = new Array(embeddings.length).fill(0)

  for (let iter = 0; iter < maxIterations; iter++) {
    const newAssignments = embeddings.map((embedding) => {
      let minDist = Infinity
      let closest = 0
      for (let c = 0; c < k; c++) {
        const dist = cosineDist(embedding, centroids[c])
        if (dist < minDist) {
          minDist = dist
          closest = c
        }
      }
      return closest
    })

    const converged = newAssignments.every((a, i) => a === assignments[i])
    assignments = newAssignments
    if (converged) break

    centroids = Array.from({ length: k }, (_, c) => {
      const members = embeddings.filter((_, i) => assignments[i] === c)
      if (members.length === 0) return centroids[c]
      const sum = new Array(dim).fill(0)
      for (const e of members) {
        for (let d = 0; d < dim; d++) sum[d] += e[d]
      }
      return sum.map((v) => v / members.length)
    })
  }

  return { assignments, centroids }
}

function cosineDist(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 1 : 1 - dot / denom
}

export function labelCluster(issues: { title: string }[]): string {
  if (issues.length === 0) return 'Uncategorized'
  const first = issues[0].title
    .replace(/^#+\s*/, '')
    .replace(/^\[?\w+\]?:\s*/i, '')
    .trim()
  return first.length > 40 ? first.slice(0, 40) : first || 'Uncategorized'
}

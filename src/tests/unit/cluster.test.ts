import { describe, it, expect } from 'vitest'
import { calculateK, labelCluster, kMeans, buildClusterGroups } from '@/lib/analysis/cluster'

describe('calculateK', () => {
  it('returns minimum of 2 for small issue counts', () => {
    expect(calculateK(0)).toBe(2)
    expect(calculateK(5)).toBe(2)
    expect(calculateK(19)).toBe(2)
  })

  it('scales with issue count', () => {
    expect(calculateK(20)).toBe(2)
    expect(calculateK(50)).toBe(5)
    expect(calculateK(70)).toBe(7)
  })

  it('caps at 8 for large issue counts', () => {
    expect(calculateK(80)).toBe(8)
    expect(calculateK(1000)).toBe(8)
  })
})

describe('labelCluster', () => {
  it('returns Uncategorized for empty issues', () => {
    expect(labelCluster([])).toBe('Uncategorized')
  })

  it('derives the label from the first issue title', () => {
    const issues = [
      { title: 'Login fails' },
      { title: 'OAuth broken' },
      { title: 'Session expired' },
    ]
    expect(labelCluster(issues)).toBe('Login fails')
  })

  it('strips a leading [tag]: / prefix from the title', () => {
    expect(labelCluster([{ title: '[bug]: crash on startup' }])).toBe('crash on startup')
  })

  it('truncates titles longer than 40 characters', () => {
    const longTitle = 'A'.repeat(50)
    expect(labelCluster([{ title: longTitle }])).toBe('A'.repeat(40))
  })

  it('works with a single issue', () => {
    expect(labelCluster([{ title: 'Only issue' }])).toBe('Only issue')
  })
})

describe('kMeans', () => {
  it('returns empty result for empty input', () => {
    const result = kMeans([], 2)
    expect(result.assignments).toEqual([])
    expect(result.centroids).toEqual([])
  })

  it('does not throw with a zero vector (denom=0 branch)', () => {
    // [0,0,0] has zero norm → cosineDist returns 1 (max distance)
    const embeddings = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    expect(() => kMeans(embeddings, 2)).not.toThrow()
  })

  it('retains previous centroid when a cluster becomes empty', () => {
    // k=3 but only 2 natural clusters → one centroid ends up with no members
    const embeddings = [
      [1, 0, 0],
      [0.99, 0.01, 0],
      [0, 0, 1],
      [0, 0.01, 0.99],
    ]
    expect(() => kMeans(embeddings, 3)).not.toThrow()
    const result = kMeans(embeddings, 3)
    expect(result.assignments).toHaveLength(4)
  })

  it('assigns all points when k equals number of points', () => {
    const embeddings = [[1, 0], [0, 1]]
    const result = kMeans(embeddings, 2)
    expect(result.assignments).toHaveLength(2)
    expect(result.centroids).toHaveLength(2)
  })

  it('groups clearly separated clusters correctly', () => {
    // Two tight clusters: near [1,0,0] and near [0,0,1]
    const embeddings = [
      [1, 0.01, 0],
      [0.99, 0, 0.01],
      [0, 0.01, 1],
      [0.01, 0, 0.99],
    ]
    const result = kMeans(embeddings, 2)
    expect(result.assignments[0]).toBe(result.assignments[1])
    expect(result.assignments[2]).toBe(result.assignments[3])
    expect(result.assignments[0]).not.toBe(result.assignments[2])
  })
})

describe('buildClusterGroups', () => {
  const withEmbedding = (id: number, embedding: number[]) => ({ id, title: `t${id}`, embedding })

  it('returns no groups for fewer than 2 issues', () => {
    expect(buildClusterGroups([])).toEqual([])
    expect(buildClusterGroups([withEmbedding(1, [1, 0, 0])])).toEqual([])
  })

  it('never emits a NaN centroid, even when k-means leaves clusters empty', () => {
    // 4 near-duplicate points but calculateK/clamp may request more clusters
    // than there are natural groups; empty clusters must be skipped, not
    // averaged into NaN.
    const issues = [
      withEmbedding(1, [1, 0, 0]),
      withEmbedding(2, [1, 0, 0]),
      withEmbedding(3, [1, 0, 0]),
      withEmbedding(4, [1, 0, 0]),
    ]
    const groups = buildClusterGroups(issues)
    expect(groups.length).toBeGreaterThan(0)
    for (const g of groups) {
      expect(g.memberIssues.length).toBeGreaterThan(0)
      expect(g.centroid.some((v) => Number.isNaN(v))).toBe(false)
    }
  })

  it('assigns every issue to exactly one non-empty group', () => {
    const issues = [
      withEmbedding(1, [1, 0.01, 0]),
      withEmbedding(2, [0.99, 0, 0.01]),
      withEmbedding(3, [0, 0.01, 1]),
      withEmbedding(4, [0.01, 0, 0.99]),
    ]
    const groups = buildClusterGroups(issues)
    const assignedIds = groups.flatMap((g) => g.memberIssues.map((i) => i.id)).sort()
    expect(assignedIds).toEqual([1, 2, 3, 4])
  })

  it('computes the centroid as the mean of member embeddings', () => {
    const issues = [withEmbedding(1, [2, 0]), withEmbedding(2, [4, 0])]
    const groups = buildClusterGroups(issues)
    // k clamps to 2 here (min cluster size), so each point is its own group;
    // centroid equals the single member. Assert the averaging path is sane.
    for (const g of groups) {
      const dim = g.memberIssues[0].embedding.length
      for (let d = 0; d < dim; d++) {
        const mean = g.memberIssues.reduce((s, i) => s + i.embedding[d], 0) / g.memberIssues.length
        expect(g.centroid[d]).toBeCloseTo(mean)
      }
    }
  })
})

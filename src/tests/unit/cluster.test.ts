import { describe, it, expect } from 'vitest'
import { calculateK, labelCluster, kMeans } from '@/lib/analysis/cluster'

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

  it('returns joined titles of up to 3 issues', () => {
    const issues = [
      { title: 'Login fails' },
      { title: 'OAuth broken' },
      { title: 'Session expired' },
    ]
    expect(labelCluster(issues)).toBe('Login fails, OAuth broken, Session expired')
  })

  it('uses only first 3 issues when more are provided', () => {
    const issues = [
      { title: 'A' },
      { title: 'B' },
      { title: 'C' },
      { title: 'D' },
    ]
    expect(labelCluster(issues)).toBe('A, B, C')
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

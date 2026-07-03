import { describe, it, expect } from 'vitest'
import { buildDigest } from '@/lib/notify/googleChat'
import type { NotificationCandidate } from '@/lib/db/notifications'

function cand(partial: Partial<NotificationCandidate> & { repoId: number; level: NotificationCandidate['level'] }): NotificationCandidate {
  return {
    owner: 'o',
    name: `r${partial.repoId}`,
    score: 2,
    multiplier: 3,
    recentCount: 12,
    topTopics: [],
    ...partial,
  }
}

describe('buildDigest', () => {
  it('lists spikes under a SPIKE heading with multiplier and issue count', () => {
    const text = buildDigest([cand({ repoId: 1, level: 'spike', multiplier: 5, recentCount: 20 })], '2026-07-01')
    expect(text).toContain('*SPIKE*')
    expect(text).toContain('o/r1')
    expect(text).toContain('20 new issues/7d')
    expect(text).toContain('5.0x')
    expect(text).toContain('+400%')
  })

  it('includes topic labels when present', () => {
    const text = buildDigest(
      [cand({ repoId: 1, level: 'spike', topTopics: ['install failures', 'auth errors'] })],
      '2026-07-01'
    )
    expect(text).toContain('Topics: install failures, auth errors')
  })

  it('separates spike and elevated sections', () => {
    const text = buildDigest(
      [cand({ repoId: 1, level: 'spike' }), cand({ repoId: 2, level: 'elevated' })],
      '2026-07-01'
    )
    expect(text).toContain('*SPIKE*')
    expect(text).toContain('*ELEVATED*')
    expect(text.indexOf('*SPIKE*')).toBeLessThan(text.indexOf('*ELEVATED*'))
  })

  it('caps elevated at 10 and notes the overflow', () => {
    const many = Array.from({ length: 14 }, (_, i) => cand({ repoId: i + 1, level: 'elevated' }))
    const text = buildDigest(many, '2026-07-01')
    const shown = (text.match(/o\/r\d+/g) ?? []).length
    expect(shown).toBe(10)
    expect(text).toContain('and 4 more elevated repos')
  })

  it('never exceeds the length cap', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      cand({ repoId: i + 1, level: 'spike', topTopics: ['a very long topic label here', 'another one'] })
    )
    const text = buildDigest(many, '2026-07-01')
    expect(text.length).toBeLessThanOrEqual(3800)
  })
})

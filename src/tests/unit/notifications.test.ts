import { describe, it, expect } from 'vitest'
import { decideNotifications, type NotificationCandidate, type RepoNotificationState } from '@/lib/db/notifications'

function cand(partial: Partial<NotificationCandidate> & { repoId: number; level: NotificationCandidate['level']; score: number }): NotificationCandidate {
  return {
    owner: 'o',
    name: `r${partial.repoId}`,
    multiplier: partial.score + 1,
    recentCount: 10,
    topTopics: [],
    ...partial,
  }
}

describe('decideNotifications', () => {
  it('notifies a brand-new anomaly with no prior state', () => {
    const { toNotify, notifiedUpserts } = decideNotifications(
      [cand({ repoId: 1, level: 'elevated', score: 1 })],
      []
    )
    expect(toNotify.map((c) => c.repoId)).toEqual([1])
    expect(notifiedUpserts).toContainEqual({ repoId: 1, level: 'elevated', score: 1 })
  })

  it('does NOT re-notify a repo that stays at the same level', () => {
    const prior: RepoNotificationState[] = [{ repoId: 1, lastLevel: 'elevated', lastScore: 1 }]
    const { toNotify, steadyUpserts, notifiedUpserts } = decideNotifications(
      [cand({ repoId: 1, level: 'elevated', score: 1.1 })],
      prior
    )
    expect(toNotify).toHaveLength(0)
    expect(notifiedUpserts).toHaveLength(0)
    // steady state still advances so a future escalation is measured against latest
    expect(steadyUpserts).toContainEqual({ repoId: 1, level: 'elevated', score: 1.1 })
  })

  it('notifies on escalation elevated -> spike', () => {
    const prior: RepoNotificationState[] = [{ repoId: 1, lastLevel: 'elevated', lastScore: 1 }]
    const { toNotify } = decideNotifications(
      [cand({ repoId: 1, level: 'spike', score: 3 })],
      prior
    )
    expect(toNotify.map((c) => c.repoId)).toEqual([1])
  })

  it('does NOT notify on de-escalation spike -> elevated, but keeps state', () => {
    const prior: RepoNotificationState[] = [{ repoId: 1, lastLevel: 'spike', lastScore: 3 }]
    const { toNotify, steadyUpserts, stateClears } = decideNotifications(
      [cand({ repoId: 1, level: 'elevated', score: 1 })],
      prior
    )
    expect(toNotify).toHaveLength(0)
    expect(stateClears).toHaveLength(0)
    // de-escalation is a steady (always-apply) update, not a notified one
    expect(steadyUpserts).toContainEqual({ repoId: 1, level: 'elevated', score: 1 })
  })

  it('notifies on significant worsening at the same level (score >= last*1.5)', () => {
    const prior: RepoNotificationState[] = [{ repoId: 1, lastLevel: 'elevated', lastScore: 1 }]
    // 1.6 >= 1 * 1.5 → worsened
    const { toNotify } = decideNotifications(
      [cand({ repoId: 1, level: 'elevated', score: 1.6 })],
      prior
    )
    expect(toNotify.map((c) => c.repoId)).toEqual([1])
  })

  it('does NOT notify on mild worsening below the factor', () => {
    const prior: RepoNotificationState[] = [{ repoId: 1, lastLevel: 'elevated', lastScore: 1 }]
    // 1.4 < 1 * 1.5 → not enough
    const { toNotify } = decideNotifications(
      [cand({ repoId: 1, level: 'elevated', score: 1.4 })],
      prior
    )
    expect(toNotify).toHaveLength(0)
  })

  it('clears state when a tracked repo returns to normal', () => {
    const prior: RepoNotificationState[] = [{ repoId: 1, lastLevel: 'spike', lastScore: 3 }]
    const { toNotify, stateClears, steadyUpserts, notifiedUpserts } = decideNotifications(
      [cand({ repoId: 1, level: 'normal', score: -0.5 })],
      prior
    )
    expect(toNotify).toHaveLength(0)
    expect(stateClears).toEqual([1])
    expect(steadyUpserts).toHaveLength(0)
    expect(notifiedUpserts).toHaveLength(0)
  })

  it('re-alerts as new after a normal reset (elevated -> normal -> elevated)', () => {
    // day 2: dropped to normal → cleared. day 3 prior state is empty again.
    const { toNotify } = decideNotifications(
      [cand({ repoId: 1, level: 'elevated', score: 1 })],
      [] // state was cleared on the normal day
    )
    expect(toNotify.map((c) => c.repoId)).toEqual([1])
  })

  it('ignores normal repos that were never tracked (no spurious clear)', () => {
    const { toNotify, stateClears, steadyUpserts, notifiedUpserts } = decideNotifications(
      [cand({ repoId: 9, level: 'normal', score: -0.5 })],
      []
    )
    expect(toNotify).toHaveLength(0)
    expect(stateClears).toHaveLength(0)
    expect(steadyUpserts).toHaveLength(0)
    expect(notifiedUpserts).toHaveLength(0)
  })

  it('splits notified vs steady updates so a failed send can retry notified repos', () => {
    // repo 1 escalates (notified), repo 2 de-escalates (steady, always-apply).
    const prior: RepoNotificationState[] = [
      { repoId: 1, lastLevel: 'elevated', lastScore: 1 },
      { repoId: 2, lastLevel: 'spike', lastScore: 3 },
    ]
    const { notifiedUpserts, steadyUpserts } = decideNotifications(
      [
        cand({ repoId: 1, level: 'spike', score: 3 }),
        cand({ repoId: 2, level: 'elevated', score: 1 }),
      ],
      prior
    )
    // Only repo 1 is gated on send success; repo 2's de-escalation applies regardless.
    expect(notifiedUpserts.map((u) => u.repoId)).toEqual([1])
    expect(steadyUpserts.map((u) => u.repoId)).toEqual([2])
  })

  it('handles a mixed batch correctly', () => {
    const prior: RepoNotificationState[] = [
      { repoId: 1, lastLevel: 'elevated', lastScore: 1 }, // stays elevated → skip
      { repoId: 2, lastLevel: 'elevated', lastScore: 1 }, // escalates → notify
      { repoId: 3, lastLevel: 'spike', lastScore: 3 },    // back to normal → clear
    ]
    const { toNotify, stateClears } = decideNotifications(
      [
        cand({ repoId: 1, level: 'elevated', score: 1.1 }),
        cand({ repoId: 2, level: 'spike', score: 3 }),
        cand({ repoId: 3, level: 'normal', score: -0.2 }),
        cand({ repoId: 4, level: 'elevated', score: 0.8 }), // brand new → notify
      ],
      prior
    )
    expect(toNotify.map((c) => c.repoId).sort()).toEqual([2, 4])
    expect(stateClears).toEqual([3])
  })
})

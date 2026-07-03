import { describe, it, expect } from 'vitest'
import {
  detectAnomaly,
  classifyLevel,
  upperTailNormal,
  repoAgeInDays,
  resolveDisplayAnomaly,
  MIN_REPO_AGE_DAYS,
} from '@/lib/analysis/anomaly'

describe('upperTailNormal', () => {
  it('is 0.5 at z=0', () => {
    expect(upperTailNormal(0)).toBeCloseTo(0.5, 4)
  })

  it('matches known standard-normal tail probabilities', () => {
    expect(upperTailNormal(1)).toBeCloseTo(0.1587, 3)
    expect(upperTailNormal(1.645)).toBeCloseTo(0.05, 3)
    expect(upperTailNormal(1.96)).toBeCloseTo(0.025, 3)
    expect(upperTailNormal(2.326)).toBeCloseTo(0.01, 3)
  })

  it('is symmetric: tail(-z) = 1 - tail(z)', () => {
    expect(upperTailNormal(-1.5)).toBeCloseTo(1 - upperTailNormal(1.5), 5)
  })
})

describe('classifyLevel (dual gate)', () => {
  it('needs both a large multiplier and a small p-value for spike', () => {
    expect(classifyLevel(4, 0.001)).toBe('spike')
    expect(classifyLevel(4, 0.03)).toBe('elevated') // big effect, not significant enough for spike
    expect(classifyLevel(1.4, 0.001)).toBe('normal') // significant but effect too small
  })

  it('flags elevated for a moderate, significant jump', () => {
    expect(classifyLevel(1.6, 0.04)).toBe('elevated')
    expect(classifyLevel(1.6, 0.06)).toBe('normal') // not significant
  })
})

describe('detectAnomaly', () => {
  // A known repo with a trustworthy baseline: 23-day window ≈ 23 issues for a
  // 1/day baseline. Passed as baselineCount so the confidence gate is satisfied
  // and the significance logic itself is what's under test.
  const KNOWN = 23
  // A busy repo (50/7 per day ≈ 164 over 23 days).
  const BUSY = 164

  it('reports the multiplier against the floored 7-day expectation', () => {
    // historicalAvg 1/day → λ₇ = 7, so 28 issues = 4x.
    const r = detectAnomaly(28, 1, KNOWN)
    expect(r.expectedCount).toBeCloseTo(7)
    expect(r.multiplier).toBeCloseTo(4)
    expect(r.score).toBeCloseTo(3)
  })

  it('flags a big, highly significant jump as spike', () => {
    // 28 vs λ₇=7: z≈4.47, p≈4e-6, multiplier 4 → spike.
    const r = detectAnomaly(28, 1, KNOWN)
    expect(r.level).toBe('spike')
    expect(r.pValue).toBeLessThan(0.01)
  })

  it('treats a modest 2x jump on a small baseline as within noise (overdispersion)', () => {
    // 14 vs λ₇=7: multiplier 2 but z≈1.42, p≈0.078 → not significant at 0.05.
    const r = detectAnomaly(14, 1, KNOWN)
    expect(r.multiplier).toBeCloseTo(2)
    expect(r.pValue).toBeGreaterThan(0.05)
    expect(r.level).toBe('normal')
  })

  it('flags a modest 1.5x jump on a BUSY repo as elevated (baseline-aware)', () => {
    // 75 vs λ₇=50: multiplier 1.5, z≈2.0, p≈0.023 → significant despite small ratio.
    const r = detectAnomaly(75, 50 / 7, BUSY)
    expect(r.multiplier).toBeCloseTo(1.5)
    expect(r.pValue).toBeLessThan(0.05)
    expect(r.level).toBe('elevated')
  })

  it('does not flag a 1.2x jump on a busy repo', () => {
    // 60 vs λ₇=50: multiplier 1.2, z≈0.78, p≈0.22 → normal.
    const r = detectAnomaly(60, 50 / 7, BUSY)
    expect(r.level).toBe('normal')
  })

  it('holds a repo with too little baseline at normal (confidence gate)', () => {
    // A hot trending repo with only 4 issues in the whole baseline window: we
    // don't know its "normal", so even a huge apparent jump must not alert. The
    // figures are still computed for display.
    const r = detectAnomaly(30, 4 / 23, 4)
    expect(r.multiplier).toBeGreaterThan(3)
    expect(r.pValue).toBeLessThan(0.01)
    expect(r.level).toBe('normal')
  })

  it('would flag the same jump once the baseline is trustworthy', () => {
    // Identical recent volume/rate as the gated case above, but with a baseline
    // count at the threshold → the gate opens and significance drives the level.
    const r = detectAnomaly(30, 5 / 23, 5)
    expect(r.level).not.toBe('normal')
  })

  it('holds an uncovered fetch at normal even with a strong signal', () => {
    // Same inputs that spike on a covered fetch, but the page cap stopped the
    // fetch inside the 30-day anomaly window (baselineUncovered=true) so the
    // baseline is undercounted — the "spike" is an artifact of missing older
    // issues, not real, and must be suppressed.
    const spiky = detectAnomaly(28, 1, KNOWN, false)
    expect(spiky.level).toBe('spike')
    const uncovered = detectAnomaly(28, 1, KNOWN, true)
    expect(uncovered.level).toBe('normal')
    // Figures are still computed for display; only the level is suppressed.
    expect(uncovered.multiplier).toBeCloseTo(spiky.multiplier)
    expect(uncovered.pValue).toBeCloseTo(spiky.pValue)
  })

  it('defaults baselineUncovered to false (stored-issue callers unchanged)', () => {
    // The display-side callers recompute from already-stored issues and omit the
    // 4th arg; the result must match passing false explicitly.
    expect(detectAnomaly(28, 1, KNOWN)).toEqual(detectAnomaly(28, 1, KNOWN, false))
  })

  it('holds a young repo at normal even with a strong signal (age gate)', () => {
    // A 15-day-old repo posting steadily: only ~8 of the 23 baseline days
    // existed, so the daily average is diluted ~3x and a merely steady rate
    // reads as a spike. Newcomers are out of scope by premise — suppress the
    // level, keep the figures.
    const r = detectAnomaly(28, 1, KNOWN, false, 15)
    expect(r.level).toBe('normal')
    expect(r.multiplier).toBeCloseTo(4)
  })

  it('opens the age gate at exactly MIN_REPO_AGE_DAYS', () => {
    expect(detectAnomaly(28, 1, KNOWN, false, MIN_REPO_AGE_DAYS).level).toBe('spike')
    expect(detectAnomaly(28, 1, KNOWN, false, MIN_REPO_AGE_DAYS - 0.5).level).toBe('normal')
  })

  it('falls back to first-seen age when gh_created_at is missing (caller convention)', () => {
    // Callers pass repoAgeInDays(gh_created_at ?? created_at): tracking age is
    // a lower bound on true age, so ≥30d of tracking opens the gate even if
    // the meta backfill keeps failing…
    const seen40dAgo = new Date(Date.now() - 40 * 86_400_000).toISOString()
    expect(detectAnomaly(28, 1, KNOWN, false, repoAgeInDays(seen40dAgo)).level).toBe('spike')
    // …while a newly-tracked repo without meta stays conservatively suppressed.
    const seen10dAgo = new Date(Date.now() - 10 * 86_400_000).toISOString()
    expect(detectAnomaly(28, 1, KNOWN, false, repoAgeInDays(seen10dAgo)).level).toBe('normal')
  })

  it('gates out low recent volume regardless of significance', () => {
    expect(detectAnomaly(0, 0, KNOWN).level).toBe('normal')
    expect(detectAnomaly(4, 0, KNOWN).level).toBe('normal')
    // 4 vs λ₇=1 would be a huge ratio, but < 5 issues never alerts.
    expect(detectAnomaly(4, 1 / 7, KNOWN).level).toBe('normal')
  })

  it('never throws and returns finite figures for a zero baseline', () => {
    const r = detectAnomaly(5, 0, 0)
    expect(Number.isFinite(r.pValue)).toBe(true)
    expect(Number.isFinite(r.multiplier)).toBe(true)
    expect(Number.isFinite(r.expectedCount)).toBe(true)
    // Zero baseline count → gated to normal.
    expect(r.level).toBe('normal')
  })
})

describe('repoAgeInDays', () => {
  it('is undefined for missing or invalid dates', () => {
    expect(repoAgeInDays(null)).toBeUndefined()
    expect(repoAgeInDays(undefined)).toBeUndefined()
    expect(repoAgeInDays('not-a-date')).toBeUndefined()
  })

  it('measures days since creation', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString()
    expect(repoAgeInDays(tenDaysAgo)).toBeCloseTo(10, 1)
  })
})

describe('resolveDisplayAnomaly', () => {
  const KNOWN = 23

  it('prefers the stored snapshot over a live recompute', () => {
    // Live figures would spike, but the pipeline suppressed this repo (e.g.
    // uncovered fetch) — the badge must agree with the feed/digest.
    const snapshot = {
      anomaly_level: 'normal' as const,
      anomaly_score: 3,
      issue_count: 28,
      updated_at: '2026-07-01T02:00:00.000Z',
    }
    const r = resolveDisplayAnomaly(snapshot, null, 28, 1, KNOWN)
    expect(r.level).toBe('normal')
    expect(r.multiplier).toBeCloseTo(4) // score + 1, straight from the snapshot
    expect(r.recentCount).toBe(28)
    expect(r.analyzedAt).toBe('2026-07-01T02:00:00.000Z')
  })

  it('falls back to a live recompute (with the age gate) when no snapshot exists', () => {
    const spiky = resolveDisplayAnomaly(null, null, 28, 1, KNOWN)
    expect(spiky.level).toBe('spike')
    expect(spiky.analyzedAt).toBeNull() // live — nothing stored to date it by
    const young = new Date(Date.now() - 10 * 86_400_000).toISOString()
    expect(resolveDisplayAnomaly(null, young, 28, 1, KNOWN).level).toBe('normal')
  })

  it('falls back when the snapshot predates the anomaly fields (level NULL)', () => {
    const legacy = {
      anomaly_level: null,
      anomaly_score: null,
      issue_count: 10,
      updated_at: '2026-06-01T02:00:00.000Z',
    }
    const r = resolveDisplayAnomaly(legacy, null, 28, 1, KNOWN)
    expect(r.level).toBe('spike')
    expect(r.recentCount).toBe(28)
    expect(r.analyzedAt).toBeNull() // legacy level was unusable → live figures
  })
})

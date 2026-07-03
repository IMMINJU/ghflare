import type { AnomalyLevel, AnomalyResult, SnapshotRow } from '@/types'

// Floor the daily baseline at one issue per week. Without it a near-dead repo
// divides by ~0 and any handful of issues reads as a 20x+ spike. It also keeps
// the Poisson expectation λ₇ ≥ 1 so the tail is always defined.
const MIN_BASELINE_DAILY = 1 / 7

// Overdispersion factor. GitHub issue arrivals are not pure Poisson — releases,
// outages, and link-driven traffic cluster arrivals, so the variance runs above
// the mean. Measured on this project's data the variance/mean ratio averaged
// ~2.4 (max ~57). A plain Poisson tail would therefore understate p-values and
// over-alert; inflating the variance by PHI (quasi-Poisson) corrects for it. A
// conservative 3.0 sits just above the measured mean without needing an
// unstable per-repo estimate off a 23-day baseline.
const PHI = 3.0

// Dual-gate thresholds: an anomaly must clear BOTH a practical effect size
// (multiplier) and a statistical-significance bar (p-value). Multiplier alone
// treats a 1.5x on a busy repo the same as on a quiet one; the p-value tells
// them apart. p-value alone over-fires on overdispersed bursts; the multiplier
// keeps a floor on how big the jump must be.
const SPIKE_MULTIPLIER = 3.0
const SPIKE_P = 0.01
const ELEVATED_MULTIPLIER = 1.5
const ELEVATED_P = 0.05

// Minimum recent volume to alert at all. Below this the counts are too small to
// act on regardless of significance — it keeps low-volume noise out of alerts.
const MIN_RECENT_COUNT = 5

// Minimum baseline volume required to trust this repo's "normal" at all. The
// whole premise of this project is "a repo I already know is unusually busy
// today". If the 23-day baseline window holds fewer than this many issues, we
// have no reliable expectation to compare today against — the quasi-Poisson tail
// off a near-empty baseline would just rediscover that every hot trending repo
// is "spiking", which is noise, not signal. Such repos are held at 'normal' and
// never alert. ("New but hot" is deliberately out of scope: the input is already
// GitHub Trending, so that signal is redundant.)
export const MIN_BASELINE_COUNT = 5

// A repo must have existed for the whole baseline window before we can claim
// to know its "normal". Younger than this, the [30d, 7d) window is only
// partially covered by the repo's lifetime while the daily average still
// divides by the full 23 days — the baseline deflates and a merely *steady*
// young repo reads as a spike. The founding premise excludes newcomers anyway:
// the input is already GitHub Trending, so "new and hot" is redundant signal.
// Callers pass `gh_created_at ?? created_at` (first-seen row time): tracking
// age is a lower bound on true age, so a repo tracked ≥30 days opens the gate
// even if the meta backfill keeps failing, while a newly-tracked repo with no
// meta stays conservatively suppressed. `undefined` (no basis at all — pure
// callers/tests only) remains permissive.
export const MIN_REPO_AGE_DAYS = 30

/** Days since the repo was created on GitHub; undefined when unknown/invalid. */
export function repoAgeInDays(
  ghCreatedAt: string | null | undefined
): number | undefined {
  if (!ghCreatedAt) return undefined
  const ageMs = Date.now() - new Date(ghCreatedAt).getTime()
  return Number.isFinite(ageMs) ? ageMs / 86_400_000 : undefined
}

/**
 * Complementary error function, Abramowitz & Stegun 7.1.26 (|error| ≤ 1.5e-7).
 */
function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const tau =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t *
                                  (1.48851587 +
                                    t * (-0.82215223 + t * 0.17087277))))))))
    )
  return x >= 0 ? tau : 2 - tau
}

/** Upper-tail probability of the standard normal, P(Z ≥ z) = 0.5·erfc(z/√2). */
export function upperTailNormal(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2)
}

export function classifyLevel(multiplier: number, pValue: number): AnomalyLevel {
  if (multiplier >= SPIKE_MULTIPLIER && pValue <= SPIKE_P) return 'spike'
  if (multiplier >= ELEVATED_MULTIPLIER && pValue <= ELEVATED_P) return 'elevated'
  return 'normal'
}

export function detectAnomaly(
  recentCount: number,
  historicalAvg: number,
  baselineCount: number,
  // True when the issue fetch could not cover the 30-day anomaly window (see
  // FetchIssuesResult.baselineCovered): the oldest issues are missing, so the
  // baseline is undercounted and the multiplier inflated — exactly the
  // false-spike we must not emit. Defaults false for display-side callers that
  // recompute from already-stored issues.
  baselineUncovered = false,
  // Days since the repo was created on GitHub (repoAgeInDays); undefined when
  // unknown. Repos younger than MIN_REPO_AGE_DAYS are held at 'normal'.
  repoAgeDays?: number
): AnomalyResult {
  const baselineDaily = Math.max(historicalAvg, MIN_BASELINE_DAILY)
  const expectedCount = 7 * baselineDaily // λ₇, ≥ 1
  const multiplier = recentCount / expectedCount
  const score = multiplier - 1

  // Quasi-Poisson upper-tail significance via a normal approximation with the
  // variance inflated by PHI. Continuity correction (−0.5) makes low counts a
  // touch more conservative. This is why the count is treated as one 7-day
  // observation rather than seven daily ones — the weekly total has enough mass
  // for the normal approximation while the daily counts would be too sparse.
  const z = (recentCount - 0.5 - expectedCount) / Math.sqrt(PHI * expectedCount)
  const pValue = upperTailNormal(z)

  // Confidence gate: hold at 'normal' (still keeping the computed figures for
  // display/inspection) when we can't trust the comparison —
  //  · uncovered fetch → baseline undercounted, multiplier inflated (false spike)
  //  · too few baseline issues → we don't know this repo's "normal" at all
  //  · too little recent volume → nothing worth acting on
  //  · repo younger than the baseline window → baseline diluted by days the
  //    repo didn't exist (and newcomers are out of scope by premise)
  if (
    baselineUncovered ||
    baselineCount < MIN_BASELINE_COUNT ||
    recentCount < MIN_RECENT_COUNT ||
    (repoAgeDays !== undefined && repoAgeDays < MIN_REPO_AGE_DAYS)
  ) {
    return { score, level: 'normal', multiplier, pValue, expectedCount }
  }

  return {
    score,
    level: classifyLevel(multiplier, pValue),
    multiplier,
    pValue,
    expectedCount,
  }
}

export type DisplayAnomaly = {
  level: AnomalyLevel
  score: number
  multiplier: number
  recentCount: number
  // When the displayed level was computed (snapshot.updated_at); null when it
  // came from a live recompute (i.e. it is current as of the request).
  analyzedAt: string | null
}

/**
 * What a repo's badge should show. The stored snapshot wins: it was written by
 * a path (pipeline or manual analyze) that knew the fetch-coverage and repo-age
 * gates at fetch time. A live recompute from stored issues can't know coverage
 * (truncation is not persisted), so it could resurrect a suppressed spike and
 * contradict the feed/digest. Live recompute — with the age gate, the only
 * fetch-independent gate — remains as the fallback for repos with no snapshot.
 */
export function resolveDisplayAnomaly(
  snapshot: Pick<SnapshotRow, 'anomaly_level' | 'anomaly_score' | 'issue_count' | 'updated_at'> | null,
  // Age-gate basis: pass `repo.gh_created_at ?? repo.created_at` (see
  // MIN_REPO_AGE_DAYS for why first-seen is the fallback).
  ghCreatedAt: string | null,
  liveRecentCount: number,
  historicalAvg: number,
  baselineCount: number
): DisplayAnomaly {
  if (snapshot && snapshot.anomaly_level != null) {
    const score = snapshot.anomaly_score ?? 0
    return {
      level: snapshot.anomaly_level,
      score,
      multiplier: score + 1,
      recentCount: snapshot.issue_count,
      analyzedAt: snapshot.updated_at,
    }
  }
  const anomaly = detectAnomaly(
    liveRecentCount,
    historicalAvg,
    baselineCount,
    false,
    repoAgeInDays(ghCreatedAt)
  )
  return {
    level: anomaly.level,
    score: anomaly.score,
    multiplier: anomaly.multiplier,
    recentCount: liveRecentCount,
    analyzedAt: null,
  }
}

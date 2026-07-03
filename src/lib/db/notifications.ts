import { sql } from './client'
import type { AnomalyLevel } from '@/types'

// A repo's anomaly status for one pipeline run, plus the topic labels we'd show
// in the digest. Built from the latest snapshot + clusters.
export type NotificationCandidate = {
  repoId: number
  owner: string
  name: string
  level: AnomalyLevel
  score: number
  multiplier: number
  recentCount: number
  topTopics: string[]
}

// What we last told the user about a repo, so we can notify only on a change.
export type RepoNotificationState = {
  repoId: number
  lastLevel: AnomalyLevel
  lastScore: number | null
}

// Alerting levels only — 'normal' is not an alert, it resets state.
const LEVEL_RANK: Record<AnomalyLevel, number> = { normal: 0, elevated: 1, spike: 2 }

// A repo must worsen by this factor (at the same level) to re-alert, so a repo
// that merely stays 'elevated' day after day doesn't spam the channel.
const WORSEN_FACTOR = 1.5

export type StateUpsert = { repoId: number; level: AnomalyLevel; score: number }

/**
 * Pure decision core (no I/O, unit-testable): given every repo that has a
 * snapshot this run and what we last sent, decide which repos to notify and how
 * state should change.
 *
 * Rules:
 *  - new anomaly (no prior alert state)              → notify
 *  - escalation (rank went up, e.g. elevated→spike)  → notify
 *  - significant worsening at same level (score ≥ last*1.5) → notify
 *  - de-escalation / steady                          → don't notify, but keep state
 *  - dropped to 'normal'                             → don't notify, clear state
 *
 * State changes are split by whether they depend on the send succeeding:
 *  - `notifiedUpserts` — the repos in the digest. Apply ONLY after a successful
 *    send, so a failed webhook leaves them "unnotified" and they retry next run.
 *  - `steadyUpserts` / `stateClears` — observations that are true regardless of
 *    the digest (a de-escalation happened, a repo went normal). Apply ALWAYS,
 *    even when nothing is sent, or a later re-escalation / re-alert is missed.
 */
export function decideNotifications(
  today: NotificationCandidate[],
  priorStates: RepoNotificationState[]
): {
  toNotify: NotificationCandidate[]
  notifiedUpserts: StateUpsert[]
  steadyUpserts: StateUpsert[]
  stateClears: number[]
} {
  const priorByRepo = new Map(priorStates.map((s) => [s.repoId, s]))
  const toNotify: NotificationCandidate[] = []
  const notifiedUpserts: StateUpsert[] = []
  const steadyUpserts: StateUpsert[] = []
  const stateClears: number[] = []

  for (const cand of today) {
    if (cand.level === 'normal') {
      // Only clear if we were tracking it, so it re-alerts as "new" next time.
      if (priorByRepo.has(cand.repoId)) stateClears.push(cand.repoId)
      continue
    }

    const prior = priorByRepo.get(cand.repoId)
    const isNew = !prior
    const escalated = prior ? LEVEL_RANK[cand.level] > LEVEL_RANK[prior.lastLevel] : false
    const worsened =
      prior != null &&
      LEVEL_RANK[cand.level] === LEVEL_RANK[prior.lastLevel] &&
      prior.lastScore != null &&
      cand.score >= prior.lastScore * WORSEN_FACTOR

    if (isNew || escalated || worsened) {
      toNotify.push(cand)
      notifiedUpserts.push({ repoId: cand.repoId, level: cand.level, score: cand.score })
    } else {
      // Steady or de-escalated: keep the row current (so a later escalation is
      // measured against the latest level/score) but send nothing.
      steadyUpserts.push({ repoId: cand.repoId, level: cand.level, score: cand.score })
    }
  }

  return { toNotify, notifiedUpserts, steadyUpserts, stateClears }
}

/**
 * Load every repo that has a snapshot on the latest *pipeline* date, with topic
 * labels for the anomalous ones. Normal repos are included (with empty topics)
 * so decideNotifications can reset their state. Manual-analyze snapshots are
 * excluded — they'd otherwise advance the date universe mid-day and shrink the
 * candidate set to whatever was analyzed by hand.
 */
export async function getNotificationCandidates(): Promise<NotificationCandidate[]> {
  const rows = await sql`
    SELECT
      s.repo_id,
      r.owner,
      r.name,
      s.anomaly_level,
      s.anomaly_score,
      s.issue_count
    FROM snapshots s
    JOIN repos r ON r.id = s.repo_id
    WHERE s.source = 'pipeline'
      AND s.date = (SELECT MAX(date) FROM snapshots WHERE source = 'pipeline')
    ORDER BY s.anomaly_p_value ASC NULLS LAST, s.anomaly_score DESC
  `

  const candidates: NotificationCandidate[] = []
  for (const row of rows) {
    const repoId = row.repo_id as number
    const level = (row.anomaly_level as AnomalyLevel) ?? 'normal'
    const score = (row.anomaly_score as number) ?? 0

    let topTopics: string[] = []
    if (level !== 'normal') {
      const clusters = await sql`
        SELECT label FROM clusters
        WHERE repo_id = ${repoId}
        ORDER BY created_at DESC
        LIMIT 2
      `
      topTopics = clusters.map((c) => c.label as string)
    }

    candidates.push({
      repoId,
      owner: row.owner as string,
      name: row.name as string,
      level,
      score,
      multiplier: score + 1,
      recentCount: (row.issue_count as number) ?? 0,
      topTopics,
    })
  }

  return candidates
}

export async function getNotificationStates(): Promise<RepoNotificationState[]> {
  const rows = await sql`
    SELECT repo_id, last_level, last_score FROM repo_notification_state
  `
  return rows.map((r) => ({
    repoId: r.repo_id as number,
    lastLevel: r.last_level as AnomalyLevel,
    lastScore: r.last_score as number | null,
  }))
}

/**
 * Persist dedup state. `upserts` should be steadyUpserts ∪ (notifiedUpserts iff
 * the send succeeded) — the caller decides which notified rows to include based
 * on send outcome. Upserts are batched into one statement to shrink the window
 * where a partial failure could leave state inconsistent (Neon HTTP has no
 * interactive transaction).
 */
export async function applyNotificationState(
  runDate: string,
  upserts: StateUpsert[],
  stateClears: number[]
): Promise<void> {
  if (upserts.length > 0) {
    const payload = JSON.stringify(
      upserts.map((u) => ({ repo_id: u.repoId, level: u.level, score: u.score }))
    )
    await sql`
      INSERT INTO repo_notification_state (repo_id, last_level, last_score, last_seen_date)
      SELECT
        (r->>'repo_id')::int,
        r->>'level',
        (r->>'score')::float,
        ${runDate}::date
      FROM jsonb_array_elements(${payload}::jsonb) AS r
      ON CONFLICT (repo_id) DO UPDATE SET
        last_level     = EXCLUDED.last_level,
        last_score     = EXCLUDED.last_score,
        last_seen_date = EXCLUDED.last_seen_date,
        updated_at     = NOW()
    `
  }
  if (stateClears.length > 0) {
    await sql`
      DELETE FROM repo_notification_state WHERE repo_id = ANY(${stateClears})
    `
  }
}

// Age out state for repos we haven't seen in a while (e.g. they dropped off
// trending entirely, so no snapshot resets them). Without this, a stale spike
// state could suppress a genuine "new" alert when the repo returns months later.
export async function pruneStaleNotificationState(maxAgeDays = 30): Promise<void> {
  await sql`
    DELETE FROM repo_notification_state
    WHERE last_seen_date < NOW() - (${maxAgeDays} || ' days')::interval
  `
}

export async function recordNotificationEvent(params: {
  runDate: string
  status: 'sent' | 'failed' | 'dry_run' | 'skipped'
  repoCount: number
  error?: string
}): Promise<void> {
  await sql`
    INSERT INTO notification_events (run_date, status, repo_count, error)
    VALUES (${params.runDate}, ${params.status}, ${params.repoCount}, ${params.error ?? null})
  `
}

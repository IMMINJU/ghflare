import type { NotificationCandidate } from '@/lib/db/notifications'

const WEBHOOK_ENV = 'GOOGLE_CHAT_WEBHOOK_URL'
const DRY_RUN_ENV = 'NOTIFY_DRY_RUN'
// Google Chat rejects messages whose text exceeds ~4096 chars. Stay well under.
const MAX_TEXT_LEN = 3800
// Spikes always shown; elevated capped so a busy day doesn't blow the limit.
const MAX_ELEVATED = 10
const RETRY_DELAYS_MS = [1000, 3000, 10000]

export type SendResult =
  | { status: 'sent'; repoCount: number }
  | { status: 'dry_run'; repoCount: number; preview: string }
  | { status: 'skipped'; repoCount: 0 }
  | { status: 'failed'; repoCount: number; error: string }

function repoLine(c: NotificationCandidate): string {
  const pct = Math.round((c.multiplier - 1) * 100)
  const topics = c.topTopics.filter((t) => t.length > 0).slice(0, 2)
  const topicSuffix = topics.length > 0 ? `\n  Topics: ${topics.join(', ')}` : ''
  return `• ${c.owner}/${c.name}: ${c.recentCount} new issues/7d, +${pct}% (${c.multiplier.toFixed(1)}x)${topicSuffix}`
}

/**
 * Build the digest text. Pure and testable. Spikes are listed first and in
 * full; elevated repos are capped at MAX_ELEVATED with an overflow note. The
 * whole thing is truncated to MAX_TEXT_LEN as a final backstop.
 */
export function buildDigest(candidates: NotificationCandidate[], dateLabel: string): string {
  const spikes = candidates.filter((c) => c.level === 'spike')
  const elevated = candidates.filter((c) => c.level === 'elevated')
  const shownElevated = elevated.slice(0, MAX_ELEVATED)
  const hiddenElevated = elevated.length - shownElevated.length

  const parts: string[] = [`*GitHub issue anomalies — ${dateLabel}*`]

  if (spikes.length > 0) {
    parts.push('', '*SPIKE*', ...spikes.map(repoLine))
  }
  if (shownElevated.length > 0) {
    parts.push('', '*ELEVATED*', ...shownElevated.map(repoLine))
  }
  if (hiddenElevated > 0) {
    parts.push('', `…and ${hiddenElevated} more elevated repo${hiddenElevated === 1 ? '' : 's'}.`)
  }

  const text = parts.join('\n')
  if (text.length <= MAX_TEXT_LEN) return text
  return text.slice(0, MAX_TEXT_LEN - 1) + '…'
}

async function postWithRetry(url: string, body: string): Promise<void> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body,
      })
      if (res.status >= 200 && res.status < 300) return
      lastErr = new Error(`Google Chat responded ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/**
 * Send the digest to Google Chat. Returns a discriminated result instead of
 * throwing so the pipeline can record the outcome and continue — an alerting
 * failure must not fail the data pipeline.
 *
 *  - no candidates            → 'skipped'
 *  - NOTIFY_DRY_RUN set        → 'dry_run' (logs preview, sends nothing)
 *  - webhook missing           → 'skipped' with a warning (treated as not configured)
 *  - POST fails after retries  → 'failed'
 */
export async function sendDigest(
  candidates: NotificationCandidate[],
  dateLabel: string
): Promise<SendResult> {
  if (candidates.length === 0) {
    return { status: 'skipped', repoCount: 0 }
  }

  const text = buildDigest(candidates, dateLabel)

  if (process.env[DRY_RUN_ENV]) {
    console.log(`[notify] DRY RUN — would send digest for ${candidates.length} repo(s):\n${text}`)
    return { status: 'dry_run', repoCount: candidates.length, preview: text }
  }

  const url = process.env[WEBHOOK_ENV]
  if (!url) {
    console.warn(`[notify] ${WEBHOOK_ENV} not set — skipping send`)
    return { status: 'skipped', repoCount: 0 }
  }

  try {
    await postWithRetry(url, JSON.stringify({ text }))
    return { status: 'sent', repoCount: candidates.length }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[notify] send failed after retries: ${error}`)
    return { status: 'failed', repoCount: candidates.length, error }
  }
}

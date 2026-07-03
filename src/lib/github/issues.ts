import type { RawIssue } from '@/types'

const GITHUB_API = 'https://api.github.com'
const LOOKBACK_DAYS = 90
const PER_PAGE = 100
// Cap pagination so a single huge repo (e.g. 7k+ open issues) can't stall the
// whole pipeline or blow the embedding budget. Issues come newest-first, so the
// most recent — and most relevant for anomaly/clustering — are always kept.
const MAX_PAGES = 10
// The anomaly windows (recent 7d + baseline [30d, 7d)) only need the last 30
// days — keep in sync with getBaseline / getRecentIssueCount (db/issues.ts). A
// fetch covering these 30 days yields a trustworthy anomaly even when the full
// 90-day clustering window is truncated.
const ANOMALY_WINDOW_DAYS = 30

function githubHeaders(): HeadersInit {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN environment variable is not set')
  }
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function fetchWithRetry(url: string, attempt = 1): Promise<Response> {
  const res = await fetch(url, { headers: githubHeaders() })

  if (res.status === 403 || res.status === 429) {
    throw new Error(`GitHub rate limit exceeded (${res.status})`)
  }

  if (res.status === 404) {
    throw new Error(`Repo not found: ${url}`)
  }

  if (!res.ok) {
    if (attempt >= 3) {
      throw new Error(`GitHub API error ${res.status} after ${attempt} attempts`)
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    return fetchWithRetry(url, attempt + 1)
  }

  return res
}

export type FetchIssuesResult = {
  issues: RawIssue[]
  // True when pagination stopped at MAX_PAGES before reaching the LOOKBACK_DAYS
  // cutoff — the 90-day window is missing its OLDER end, so clustering and the
  // timeline are partial. This is NOT the anomaly gate: that's baselineCovered
  // below, which only needs the last ANOMALY_WINDOW_DAYS. If the cutoff was
  // reached normally this is false, even at exactly MAX_PAGES pages.
  truncated: boolean
  // True when the fetch is known to include every issue created in the last
  // ANOMALY_WINDOW_DAYS: either the cutoff was reached, or the oldest raw item
  // seen (issues AND pull requests — sort=created makes the response a
  // contiguous newest-first prefix) is already older than the anomaly window.
  // When false the stored baseline is undercounted and the multiplier inflated
  // — callers must pass baselineUncovered=true to detectAnomaly so the repo is
  // held at 'normal' instead of firing a false spike.
  baselineCovered: boolean
}

export async function fetchRepoIssues(
  owner: string,
  name: string
): Promise<FetchIssuesResult> {
  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS)
  const since = cutoff.toISOString()

  const issues: RawIssue[] = []
  let page = 1
  // Did we stop because we ran out of in-window issues (reached the cutoff), or
  // because we hit the page cap first? Only the latter leaves the 90-day window
  // partially fetched.
  let reachedCutoff = false
  // Oldest raw item (issue or PR) seen so far. Pages are created-desc, so each
  // page's last row is its oldest and every later page is older still.
  let oldestRawCreatedAt: string | null = null

  while (true) {
    // state=all so both the baseline and recent windows count issues by CREATION,
    // not by "still open at fetch time" — closed issues are what the baseline is
    // mostly made of, and dropping them biased the baseline toward zero. `since`
    // is an updated_at filter (network reduction only), so the created_at cutoff
    // below is still what bounds the window; do not treat `since` as the boundary.
    const url =
      `${GITHUB_API}/repos/${owner}/${name}/issues` +
      `?state=all&per_page=${PER_PAGE}&sort=created&direction=desc&since=${since}&page=${page}`

    const res = await fetchWithRetry(url)
    const data = (await res.json()) as Array<{
      id: number
      number: number
      title: string
      body: string | null
      created_at: string
      labels: { name: string }[]
      pull_request?: unknown
    }>

    if (!Array.isArray(data) || data.length === 0) {
      // Ran out of results before the page cap → the window is fully covered.
      reachedCutoff = true
      break
    }

    oldestRawCreatedAt = data[data.length - 1].created_at

    for (const item of data) {
      // skip pull requests (GitHub issues API returns both)
      if (item.pull_request) continue

      const created = new Date(item.created_at)
      if (created < cutoff) {
        reachedCutoff = true
        break
      }

      issues.push({
        id: item.id,
        number: item.number,
        title: item.title,
        body: item.body,
        created_at: item.created_at,
        labels: item.labels.map((l) => l.name),
      })
    }

    // A short page (fewer than a full per_page) means GitHub has no more results
    // — the window is fully covered even if we never saw an item past the cutoff,
    // so this is NOT truncation. Without this, a repo whose in-window issues end
    // exactly on the MAX_PAGES-th page (e.g. 950 rows) would fall through to the
    // page-cap break below with reachedCutoff still false and be wrongly gated to
    // 'normal' (a false negative).
    if (data.length < PER_PAGE) {
      reachedCutoff = true
      break
    }

    // stop if we already crossed the cutoff inside this page, or the last item
    // of the page is older than the cutoff (next page would be entirely older)
    const last = data[data.length - 1]
    if (reachedCutoff || !last || new Date(last.created_at) < cutoff) {
      reachedCutoff = true
      break
    }

    if (page >= MAX_PAGES) break
    page++
  }

  // Strictly older than the boundary: an item exactly ON it could still have
  // same-second siblings on the next, unfetched page.
  const anomalyCutoff = new Date(now)
  anomalyCutoff.setDate(anomalyCutoff.getDate() - ANOMALY_WINDOW_DAYS)
  const baselineCovered =
    reachedCutoff ||
    (oldestRawCreatedAt !== null && new Date(oldestRawCreatedAt) < anomalyCutoff)

  return { issues, truncated: !reachedCutoff, baselineCovered }
}

export async function fetchRepoMeta(
  owner: string,
  name: string
): Promise<{
  description: string
  stars: number
  language: string | null
  // Repo creation date on GitHub — feeds the anomaly age gate (repos younger
  // than the baseline window must never alert; see anomaly.ts).
  createdAt: string | null
}> {
  const res = await fetchWithRetry(`${GITHUB_API}/repos/${owner}/${name}`)
  const data = (await res.json()) as {
    description: string | null
    stargazers_count: number
    language: string | null
    created_at: string | null
  }
  return {
    description: data.description ?? '',
    stars: data.stargazers_count,
    language: data.language ?? null,
    createdAt: data.created_at ?? null,
  }
}

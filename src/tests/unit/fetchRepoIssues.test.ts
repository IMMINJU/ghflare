import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchRepoIssues } from '@/lib/github/issues'

// The collector paginates GitHub's issues API newest-first and must report
// `truncated` iff it stopped at the page cap (MAX_PAGES=10, per_page=100)
// BEFORE covering the 90-day window, and `baselineCovered` iff the fetch is
// known to include everything created in the last 30 days (the anomaly
// windows) — either the cutoff was reached or the oldest raw item seen is
// older than 30 days. These tests drive it with a mocked fetch so both flags
// are verified without network. MAX_PAGES/PER_PAGE mirror module constants.
const MAX_PAGES = 10
const PER_PAGE = 100

const DAY_MS = 24 * 60 * 60 * 1000
const now = Date.now()
// Comfortably inside the 90-day window.
const recentISO = new Date(now - 5 * DAY_MS).toISOString()
// Past the 30-day anomaly window but inside the 90-day one.
const fortyDaysISO = new Date(now - 40 * DAY_MS).toISOString()
// Comfortably outside it.
const oldISO = new Date(now - 200 * DAY_MS).toISOString()

function issue(n: number, createdISO: string, isPR = false) {
  return {
    id: n,
    number: n,
    title: `issue ${n}`,
    body: null,
    created_at: createdISO,
    labels: [] as { name: string }[],
    ...(isPR ? { pull_request: { url: 'x' } } : {}),
  }
}

// Build a mock fetch that serves the given array of pages by ?page= query param.
function mockPages(pages: Array<ReturnType<typeof issue>[]>) {
  return vi.fn(async (url: string) => {
    const m = /[?&]page=(\d+)/.exec(url)
    const page = m ? Number(m[1]) : 1
    const body = pages[page - 1] ?? []
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response
  })
}

function fullPage(startN: number, createdISO: string) {
  return Array.from({ length: PER_PAGE }, (_, i) => issue(startN + i, createdISO))
}

beforeEach(() => {
  vi.stubEnv('GITHUB_TOKEN', 'test-token')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fetchRepoIssues truncation flag', () => {
  it('is NOT truncated when the window ends on a short final page at the page cap', async () => {
    // Regression: pages 1..9 full & in-window, page 10 short (50 rows, in-window).
    // A short page means GitHub is exhausted → fully covered, not truncated.
    const pages: ReturnType<typeof issue>[][] = []
    for (let p = 0; p < MAX_PAGES - 1; p++) pages.push(fullPage(p * PER_PAGE + 1, recentISO))
    pages.push(Array.from({ length: 50 }, (_, i) => issue(9000 + i, recentISO)))
    vi.stubGlobal('fetch', mockPages(pages))

    const res = await fetchRepoIssues('o', 'r')
    expect(res.truncated).toBe(false)
    expect(res.baselineCovered).toBe(true)
    expect(res.issues.length).toBe((MAX_PAGES - 1) * PER_PAGE + 50)
  })

  it('is truncated when MAX_PAGES full in-window pages never reach the cutoff', async () => {
    // 10 full pages, all just days old, none older than cutoff → there may be
    // more, and the unfetched remainder can hold issues 6..30 days old — so
    // the anomaly baseline is NOT covered either.
    const pages = Array.from({ length: MAX_PAGES }, (_, p) => fullPage(p * PER_PAGE + 1, recentISO))
    vi.stubGlobal('fetch', mockPages(pages))

    const res = await fetchRepoIssues('o', 'r')
    expect(res.truncated).toBe(true)
    expect(res.baselineCovered).toBe(false)
    expect(res.issues.length).toBe(MAX_PAGES * PER_PAGE)
  })

  it('is NOT truncated when an item older than the cutoff is reached', async () => {
    // Page 1 full & in-window; page 2 begins with an out-of-window item.
    const pages = [
      fullPage(1, recentISO),
      [issue(9999, oldISO), issue(10000, recentISO)],
    ]
    vi.stubGlobal('fetch', mockPages(pages))

    const res = await fetchRepoIssues('o', 'r')
    expect(res.truncated).toBe(false)
    expect(res.baselineCovered).toBe(true)
    // The old item and everything after it are dropped.
    expect(res.issues.some((i) => i.number === 9999)).toBe(false)
    expect(res.issues.length).toBe(PER_PAGE)
  })

  it('is NOT truncated for an empty repo', async () => {
    vi.stubGlobal('fetch', mockPages([[]]))
    const res = await fetchRepoIssues('o', 'r')
    expect(res.truncated).toBe(false)
    expect(res.baselineCovered).toBe(true)
    expect(res.issues).toEqual([])
  })

  it('skips pull requests but still counts them toward pagination', async () => {
    // A short page with a mix of issues and PRs is still exhausted (not truncated).
    const pages = [[issue(1, recentISO), issue(2, recentISO, true), issue(3, recentISO)]]
    vi.stubGlobal('fetch', mockPages(pages))
    const res = await fetchRepoIssues('o', 'r')
    expect(res.truncated).toBe(false)
    expect(res.baselineCovered).toBe(true)
    expect(res.issues.map((i) => i.number)).toEqual([1, 3])
  })
})

describe('fetchRepoIssues baseline coverage (30d anomaly window)', () => {
  it('is covered when the cap stops past 30 days even though 90d is truncated', async () => {
    // Pages are created-desc, so reaching a 40-day-old item means every issue
    // of the last 30 days was already fetched — the anomaly is trustworthy;
    // only clustering/timeline lose the 40..90d tail.
    const pages = Array.from({ length: MAX_PAGES }, (_, p) =>
      fullPage(p * PER_PAGE + 1, p < MAX_PAGES - 1 ? recentISO : fortyDaysISO)
    )
    vi.stubGlobal('fetch', mockPages(pages))

    const res = await fetchRepoIssues('o', 'r')
    expect(res.truncated).toBe(true)
    expect(res.baselineCovered).toBe(true)
  })

  it('counts raw pull requests toward coverage', async () => {
    // The oldest raw item on the capped last page is a 40-day-old PR. PRs are
    // dropped from the result but sit in the same created-desc sequence, so
    // they still prove the fetch passed the 30-day boundary.
    const lastPage = [
      ...Array.from({ length: PER_PAGE - 1 }, (_, i) => issue(9000 + i, recentISO)),
      issue(9999, fortyDaysISO, true),
    ]
    const pages = [
      ...Array.from({ length: MAX_PAGES - 1 }, (_, p) => fullPage(p * PER_PAGE + 1, recentISO)),
      lastPage,
    ]
    vi.stubGlobal('fetch', mockPages(pages))

    const res = await fetchRepoIssues('o', 'r')
    expect(res.truncated).toBe(true)
    expect(res.baselineCovered).toBe(true)
    expect(res.issues.some((i) => i.number === 9999)).toBe(false)
  })
})

import type { RawIssue } from '@/types'

const GITHUB_API = 'https://api.github.com'
const LOOKBACK_DAYS = 90

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

export async function fetchRepoIssues(
  owner: string,
  name: string
): Promise<RawIssue[]> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS)
  const since = cutoff.toISOString()

  const issues: RawIssue[] = []
  let page = 1

  while (true) {
    const url =
      `${GITHUB_API}/repos/${owner}/${name}/issues` +
      `?state=open&per_page=100&sort=created&direction=desc&since=${since}&page=${page}`

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

    if (!Array.isArray(data) || data.length === 0) break

    for (const item of data) {
      // skip pull requests (GitHub issues API returns both)
      if (item.pull_request) continue

      const created = new Date(item.created_at)
      if (created < cutoff) break

      issues.push({
        id: item.id,
        number: item.number,
        title: item.title,
        body: item.body,
        created_at: item.created_at,
        labels: item.labels.map((l) => l.name),
      })
    }

    // stop if last item is older than cutoff
    const last = data[data.length - 1]
    if (!last || new Date(last.created_at) < cutoff) break

    page++
  }

  return issues
}

export async function fetchRepoMeta(
  owner: string,
  name: string
): Promise<{ description: string; stars: number; language: string | null }> {
  const res = await fetchWithRetry(`${GITHUB_API}/repos/${owner}/${name}`)
  const data = (await res.json()) as {
    description: string | null
    stargazers_count: number
    language: string | null
  }
  return {
    description: data.description ?? '',
    stars: data.stargazers_count,
    language: data.language ?? null,
  }
}

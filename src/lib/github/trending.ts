import type { TrendingRepo } from '@/types'

const TRENDING_URL = 'https://github.com/trending'

export async function fetchTrendingRepos(): Promise<TrendingRepo[]> {
  const res = await fetch(TRENDING_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ghflare/1.0)' },
    next: { revalidate: 3600 },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch trending: ${res.status}`)
  }

  const html = await res.text()
  const repos = parseTrendingHtml(html)

  if (repos.length < 5) {
    throw new Error(
      `Trending parse yielded ${repos.length} repos — possible structure change`
    )
  }

  return repos
}

export function parseTrendingHtml(html: string): TrendingRepo[] {
  const repos: TrendingRepo[] = []

  // Match each repo article block
  const articleRegex = /<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/g
  let articleMatch

  while ((articleMatch = articleRegex.exec(html)) !== null) {
    const article = articleMatch[1]

    // owner/repo from the h2 link: /owner/repo
    // Scope to the <h2> so sponsor avatars (/sponsors/<user>) earlier in the
    // article don't get picked up as the repo identity.
    const repoLinkMatch = article.match(
      /<h2[^>]*>[\s\S]*?href="\/([^/"]+)\/([^/"]+)"/
    )
    if (!repoLinkMatch) continue
    const owner = repoLinkMatch[1]
    const name = repoLinkMatch[2]

    // description
    const descMatch = article.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/p>/)
    const description = descMatch
      ? descMatch[1].replace(/\s+/g, ' ').trim()
      : ''

    // language
    const langMatch = article.match(
      /itemprop="programmingLanguage"[^>]*>\s*([^<]+)\s*<\/span>/
    )
    const language = langMatch ? langMatch[1].trim() : null

    // stars (total)
    const starsMatch = article.match(/\/([^/]+)\/([^/]+)\/stargazers[^>]*>\s*([\d,]+)\s*/)
    const stars = starsMatch ? parseInt(starsMatch[3].replace(/,/g, ''), 10) : 0

    repos.push({ owner, name, description, language, stars })
  }

  return repos
}

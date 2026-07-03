import { describe, it, expect } from 'vitest'
import { parseTrendingHtml } from '@/lib/github/trending'

// Minimal fixture mirroring the parts of github.com/trending the parser reads.
// Covers the regressions documented in trending.ts: a sponsor avatar link
// BEFORE the <h2> repo link, and a non-repo /sponsors/... h2 target.
function articleHtml(opts: {
  owner: string
  name: string
  description?: string
  language?: string
  stars?: string
  sponsorBefore?: boolean
}): string {
  const { owner, name, description = '', language, stars = '1,234', sponsorBefore } = opts
  return `
<article class="Box-row">
  ${sponsorBefore ? '<a href="/sponsors/somebody"><img alt="@somebody"></a>' : ''}
  <h2 class="h3 lh-condensed">
    <a href="/${owner}/${name}" data-view-component="true">
      ${owner} / ${name}
    </a>
  </h2>
  ${description ? `<p class="col-9 color-fg-muted my-1 pr-4">\n    ${description}\n  </p>` : ''}
  ${language ? `<span itemprop="programmingLanguage">${language}</span>` : ''}
  <a href="/${owner}/${name}/stargazers"> ${stars} </a>
</article>`
}

describe('parseTrendingHtml', () => {
  it('extracts owner, name, description, language, and stars per article', () => {
    const html =
      articleHtml({
        owner: 'vercel',
        name: 'next.js',
        description: 'The React Framework',
        language: 'TypeScript',
        stars: '132,001',
      }) + articleHtml({ owner: 'rust-lang', name: 'rust', language: 'Rust', stars: '99,000' })

    const repos = parseTrendingHtml(html)
    expect(repos).toHaveLength(2)
    expect(repos[0]).toEqual({
      owner: 'vercel',
      name: 'next.js',
      description: 'The React Framework',
      language: 'TypeScript',
      stars: 132001,
    })
    expect(repos[1].owner).toBe('rust-lang')
    expect(repos[1].description).toBe('')
    expect(repos[1].stars).toBe(99000)
  })

  it('is not fooled by a sponsor avatar link before the repo link', () => {
    const html = articleHtml({ owner: 'octo', name: 'toolkit', sponsorBefore: true, language: 'Go' })
    const repos = parseTrendingHtml(html)
    expect(repos).toHaveLength(1)
    expect(repos[0].owner).toBe('octo')
    expect(repos[0].name).toBe('toolkit')
  })

  it('skips GitHub non-repo paths appearing as the h2 link', () => {
    const html = articleHtml({ owner: 'sponsors', name: 'somebody' })
    expect(parseTrendingHtml(html)).toHaveLength(0)
  })

  it('returns [] on unrecognized markup', () => {
    expect(parseTrendingHtml('<html><body>redesign!</body></html>')).toEqual([])
  })
})

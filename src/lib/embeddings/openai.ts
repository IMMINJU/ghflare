import OpenAI from 'openai'

const MODEL = 'text-embedding-3-small'
const BATCH_SIZE = 100
const BODY_TRUNCATE = 500

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set')
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return client
}

function buildInput(title: string, body: string | null): string {
  return `${title} ${body?.slice(0, BODY_TRUNCATE) ?? ''}`.trim()
}

export async function generateEmbeddings(
  issues: { id: number; title: string; body: string | null }[]
): Promise<{ id: number; embedding: number[] }[]> {
  const results: { id: number; embedding: number[] }[] = []

  for (let i = 0; i < issues.length; i += BATCH_SIZE) {
    const batch = issues.slice(i, i + BATCH_SIZE)
    const inputs = batch.map((issue) => buildInput(issue.title, issue.body))

    const response = await getClient().embeddings.create({
      model: MODEL,
      input: inputs,
    })

    for (let j = 0; j < batch.length; j++) {
      results.push({
        id: batch[j].id,
        embedding: response.data[j].embedding,
      })
    }
  }

  return results
}

function fallbackLabel(titles: string[]): string {
  const first = (titles[0] ?? '')
    .replace(/^#+\s*/, '')
    .replace(/^\[?\w+\]?:\s*/i, '')
    .trim()
  return first.length > 40 ? first.slice(0, 40) : first || 'Uncategorized'
}

export async function generateClusterLabel(titles: string[]): Promise<string> {
  if (titles.length === 0) return 'Uncategorized'
  try {
    const prompt = `Summarize the common theme of these GitHub issue titles in 2–4 words. Return only the label, nothing else:\n${titles.map((t) => `- "${t}"`).join('\n')}`
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 20,
      temperature: 0,
    })
    return response.choices[0]?.message?.content?.trim() || fallbackLabel(titles)
  } catch {
    return fallbackLabel(titles)
  }
}

export async function generateClusterLabels(
  clusters: string[][]
): Promise<string[]> {
  if (clusters.length === 0) return []
  if (clusters.length === 1) return [await generateClusterLabel(clusters[0])]

  const prompt =
    `You will receive ${clusters.length} groups of GitHub issue titles. For each group, summarize the common theme in 2–4 words. ` +
    `Return a JSON object shaped like {"labels": ["...", "..."]} with exactly ${clusters.length} entries in the same order, and nothing else.\n\n` +
    clusters
      .map(
        (titles, i) =>
          `Group ${i + 1}:\n${titles.map((t) => `- "${t}"`).join('\n')}`
      )
      .join('\n\n')

  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 30 * clusters.length,
      temperature: 0,
      response_format: { type: 'json_object' },
    })
    const content = response.choices[0]?.message?.content ?? ''
    const parsed = JSON.parse(content) as { labels?: unknown }
    const labels = Array.isArray(parsed.labels) ? parsed.labels : []
    return clusters.map((titles, i) => {
      const label = typeof labels[i] === 'string' ? (labels[i] as string).trim() : ''
      return label || fallbackLabel(titles)
    })
  } catch {
    return clusters.map((titles) => fallbackLabel(titles))
  }
}

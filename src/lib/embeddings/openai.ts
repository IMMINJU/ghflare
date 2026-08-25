import OpenAI from 'openai'

const MODEL = 'text-embedding-3-small'
const BATCH_SIZE = 100
// Exported because the storage layer truncates persisted bodies to this same
// bound (upsertIssues): bodies exist only to be embedded, and a re-embed must
// see the same text the original embed saw.
export const BODY_TRUNCATE = 500

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

async function embedBatch(
  batch: { id: number; title: string; body: string | null }[],
  attempt = 1
): Promise<{ id: number; embedding: number[] }[]> {
  const inputs = batch.map((issue) => buildInput(issue.title, issue.body))
  try {
    const response = await getClient().embeddings.create({ model: MODEL, input: inputs })
    return batch.map((issue, j) => ({ id: issue.id, embedding: response.data[j].embedding }))
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 1000))
      return embedBatch(batch, attempt + 1)
    }
    throw err
  }
}

export async function generateEmbeddings(
  issues: { id: number; title: string; body: string | null }[]
): Promise<{ id: number; embedding: number[] }[]> {
  const results: { id: number; embedding: number[] }[] = []

  // Embed batch-by-batch with isolation: one failing batch (e.g. a transient
  // rate-limit) must not discard the issues that did embed successfully. Stuck
  // issues are simply retried on the next run via getIssuesWithoutEmbeddings.
  for (let i = 0; i < issues.length; i += BATCH_SIZE) {
    const batch = issues.slice(i, i + BATCH_SIZE)
    try {
      results.push(...(await embedBatch(batch)))
    } catch (err) {
      console.error(
        `[embeddings] batch failed after retries (issues ${batch[0]?.id}..${batch[batch.length - 1]?.id}):`,
        err
      )
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

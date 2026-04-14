import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, TrendingUp, AlertTriangle, Clock, Star, ExternalLink } from 'lucide-react'
import { IssueTimeline } from '@/components/IssueTimeline'
import { ClusterList } from '@/components/ClusterList'
import { AnalyzeButton } from '@/components/AnalyzeButton'
import { AnomalyBadge } from '@/components/AnomalyBadge'
import { FetchRepoData } from '@/components/FetchRepoData'
import { getRepoByOwnerName, upsertRepo } from '@/lib/db/repos'
import { getTimelineData, getRecentIssueCount, getHistoricalDailyAvg } from '@/lib/db/issues'
import { getClustersWithIssues } from '@/lib/db/clusters'
import { detectAnomaly } from '@/lib/analysis/anomaly'
import { fetchRepoMeta } from '@/lib/github/issues'
import type { TimelinePoint, ClusterDetail } from '@/types'

const OWNER_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/
const NAME_REGEX = /^[a-zA-Z0-9._-]{1,100}$/

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Go: '#00ADD8',
  Rust: '#dea584',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Ruby: '#701516',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Shell: '#89e051',
  Vue: '#41b883',
}

type Props = { params: Promise<{ owner: string; name: string }> }

export async function generateMetadata({ params }: Props) {
  const { owner, name } = await params
  return { title: `${owner}/${name}` }
}

function StatCard({
  icon,
  label,
  value,
  valueColor,
  muted,
}: {
  icon: React.ReactNode
  label: string
  value: string
  valueColor?: string
  muted?: boolean
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-text-muted">{icon}</span>
        <span className="text-xs text-text-muted uppercase tracking-wider font-mono">{label}</span>
      </div>
      <div
        className="font-serif text-3xl font-semibold leading-none"
        style={{
          color: valueColor ?? (muted ? 'var(--color-text-muted)' : 'var(--color-text-primary)'),
        }}
      >
        {value}
      </div>
    </div>
  )
}

export default async function RepoPage({ params }: Props) {
  const { owner, name } = await params

  if (!OWNER_REGEX.test(owner) || !NAME_REGEX.test(name)) {
    notFound()
  }

  const repo = await getRepoByOwnerName(owner, name)

  if (!repo) {
    // Fetch just the repo metadata — single GitHub API call, fast (~0.5s)
    // Issue data fetches in the background via FetchRepoData
    let newRepo
    try {
      const meta = await fetchRepoMeta(owner, name)
      newRepo = await upsertRepo({ owner, name, ...meta })
    } catch {
      notFound()
    }
    if (!newRepo) notFound()

    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>

        <div className="mb-10">
          <h1 className="font-serif text-5xl font-semibold text-text-primary leading-tight">
            {owner}/{name}
          </h1>
          {newRepo.description && (
            <p className="text-text-secondary text-lg mb-4 leading-relaxed">{newRepo.description}</p>
          )}
          <div className="flex items-center gap-4 text-sm text-text-muted flex-wrap">
            {newRepo.language && (
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: LANGUAGE_COLORS[newRepo.language] ?? '#9E9893' }}
                />
                <span>{newRepo.language}</span>
              </div>
            )}
            {newRepo.stars > 0 && (
              <div className="flex items-center gap-1.5">
                <Star className="w-4 h-4" />
                <span>
                  {newRepo.stars >= 1000 ? `${(newRepo.stars / 1000).toFixed(0)}k` : newRepo.stars} stars
                </span>
              </div>
            )}
            <a
              href={`https://github.com/${owner}/${name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-accent hover:underline underline-offset-4 transition-colors"
            >
              View on GitHub
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        <FetchRepoData owner={owner} name={name} />
      </div>
    )
  }

  const [timelineData, clusterRows, recentCount, historicalAvg] = await Promise.all([
    getTimelineData(repo.id),
    getClustersWithIssues(repo.id),
    getRecentIssueCount(repo.id),
    getHistoricalDailyAvg(repo.id),
  ])

  const anomaly = detectAnomaly(recentCount, historicalAvg)

  const countByDate = new Map(timelineData.map((r) => [r.date, r.count]))
  const timeline: TimelinePoint[] = []
  for (let d = 89; d >= 0; d--) {
    const date = new Date()
    date.setDate(date.getDate() - d)
    const dateStr = date.toISOString().slice(0, 10)
    const count = countByDate.get(dateStr) ?? 0
    timeline.push({
      date: dateStr,
      count,
      isAnomalous: historicalAvg > 0 && count > historicalAvg * 2,
    })
  }

  const clusters: ClusterDetail[] = clusterRows.map((cluster) => ({
    id: String(cluster.id),
    label: cluster.label,
    count: cluster.issues.length,
    issues: cluster.issues.map((issue) => ({
      number: issue.issue_number,
      title: issue.title,
      url: `https://github.com/${owner}/${name}/issues/${issue.issue_number}`,
      createdAt: issue.created_at,
    })),
  }))

  const increaseLabel =
    historicalAvg === 0 ? '—' : `+${Math.round((anomaly.multiplier - 1) * 100)}%`
  const currentRate = (recentCount / 7).toFixed(1)
  const baselineRate = historicalAvg > 0 ? historicalAvg.toFixed(1) : '—'

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to dashboard
      </Link>

      {/* Header */}
      <div className="mb-10">
        <div className="flex items-start gap-4 mb-4 flex-wrap">
          <h1 className="font-serif text-5xl font-semibold text-text-primary leading-tight">
            {owner}/{name}
          </h1>
          <div className="mt-2">
            <AnomalyBadge level={anomaly.level} multiplier={anomaly.multiplier} />
          </div>
        </div>

        {repo.description && (
          <p className="text-text-secondary text-lg mb-4 leading-relaxed">{repo.description}</p>
        )}

        <div className="flex items-center gap-4 text-sm text-text-muted flex-wrap">
          {repo.language && (
            <div className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: LANGUAGE_COLORS[repo.language] ?? '#9E9893' }}
              />
              <span>{repo.language}</span>
            </div>
          )}
          {repo.stars > 0 && (
            <div className="flex items-center gap-1.5">
              <Star className="w-4 h-4" />
              <span>
                {repo.stars >= 1000 ? `${(repo.stars / 1000).toFixed(0)}k` : repo.stars} stars
              </span>
            </div>
          )}
          <a
            href={`https://github.com/${owner}/${name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-accent hover:underline underline-offset-4 transition-colors"
          >
            View on GitHub
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-12">
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Increase"
          value={increaseLabel}
          valueColor="var(--color-accent)"
        />
        <StatCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Current"
          value={`${currentRate}/day`}
        />
        <StatCard
          icon={<Clock className="w-4 h-4" />}
          label="Baseline"
          value={`${baselineRate}/day`}
          muted
        />
        <StatCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Issues / 7d"
          value={recentCount.toLocaleString()}
        />
      </div>

      {/* Timeline */}
      <section className="mb-12">
        <h2 className="font-serif text-2xl font-semibold text-text-primary mb-6">
          Issue Activity Timeline
        </h2>
        <div className="bg-surface border border-border rounded-xl p-6">
          <IssueTimeline timeline={timeline} historicalAvg={historicalAvg} />
          <div className="flex items-center gap-6 mt-4 text-xs text-text-muted">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-accent inline-block" />
              <span>Issues per day</span>
            </div>
            {historicalAvg > 0 && (
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3 h-0.5 inline-block"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(90deg, #9E9893 0, #9E9893 3px, transparent 3px, transparent 7px)',
                  }}
                />
                <span>30-day avg</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-spike inline-block" />
              <span>Anomalous day</span>
            </div>
          </div>
        </div>
      </section>

      {/* Clusters */}
      <section>
        <h2 className="font-serif text-2xl font-semibold text-text-primary mb-6">
          Issue Topic Clusters
        </h2>
        {clusters.length > 0 ? (
          <ClusterList clusters={clusters} owner={owner} name={name} />
        ) : (
          <AnalyzeButton owner={owner} name={name} />
        )}
      </section>
    </div>
  )
}

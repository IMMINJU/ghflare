import Link from 'next/link'
import { TrendingUp, AlertTriangle, Clock, Star } from 'lucide-react'
import { AnomalyBadge } from '@/components/AnomalyBadge'
import type { AnomalousRepo } from '@/types'

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

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

type Props = { repo: AnomalousRepo }

export function RepoCard({ repo }: Props) {
  const { owner, name, description, anomaly, topTopics, stars, language, detectedAt } = repo
  const validTopics = topTopics.filter((t) => t.length <= 40)

  const increaseLabel =
    anomaly.historicalAvg === 0 ? '—' : `+${Math.round((anomaly.multiplier - 1) * 100)}%`
  const currentRate = (anomaly.recentCount / 7).toFixed(1)
  const baselineRate = anomaly.historicalAvg > 0 ? anomaly.historicalAvg.toFixed(1) : '—'

  return (
    <Link
      href={`/repo/${owner}/${name}`}
      data-testid="repo-card"
      className="block bg-surface border border-border rounded-xl p-6 hover:border-border-2 hover:shadow-sm transition-all duration-150"
    >
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h2 className="font-serif text-2xl font-semibold text-text-primary">
            {owner}/{name}
          </h2>
          <AnomalyBadge level={anomaly.level} />
        </div>

        {description && (
          <p className="text-text-secondary text-sm line-clamp-1 mb-3">{description}</p>
        )}

        <div className="flex items-center gap-4 text-sm text-text-muted">
          {language && (
            <div className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: LANGUAGE_COLORS[language] ?? '#9E9893' }}
              />
              <span>{language}</span>
            </div>
          )}
          {stars > 0 && (
            <div className="flex items-center gap-1">
              <Star className="w-3.5 h-3.5" />
              <span>{stars >= 1000 ? `${(stars / 1000).toFixed(0)}k` : stars}</span>
            </div>
          )}
          {detectedAt && <span>{timeAgo(detectedAt)}</span>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 pt-4 border-t border-border">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs text-text-muted uppercase tracking-wide font-mono">Increase</span>
          </div>
          <div className="font-serif text-2xl font-semibold" style={{ color: 'var(--color-accent)' }}>
            {increaseLabel}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-xs text-text-muted uppercase tracking-wide font-mono">Current</span>
          </div>
          <div className="font-serif text-2xl font-semibold text-text-primary">
            {currentRate}
            <span className="text-sm text-text-muted font-sans ml-1">/day</span>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-xs text-text-muted uppercase tracking-wide font-mono">Baseline</span>
          </div>
          <div className="font-serif text-2xl font-semibold text-text-muted">
            {baselineRate}
            <span className="text-sm font-sans ml-1">/day</span>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-xs text-text-muted uppercase tracking-wide font-mono">Issues</span>
          </div>
          <div className="font-serif text-2xl font-semibold text-text-primary">
            {anomaly.recentCount.toLocaleString()}
            <span className="text-sm text-text-muted font-sans ml-1">/7d</span>
          </div>
        </div>
      </div>

      {/* Topics */}
      {validTopics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-4">
          {validTopics.map((topic) => (
            <span
              key={topic}
              className="px-2 py-0.5 rounded-md bg-surface-2 text-text-secondary text-xs"
            >
              {topic}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}

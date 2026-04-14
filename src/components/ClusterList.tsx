import type { ClusterDetail } from '@/types'

const CLUSTER_COLORS = ['#E5541B', '#D97706', '#6366F1', '#10B981', '#8B5CF6', '#EC4899']

type Props = {
  clusters: ClusterDetail[]
  owner: string
  name: string
}

export function ClusterList({ clusters }: Props) {
  if (clusters.length === 0) {
    return <p className="text-sm text-text-muted">No analysis data yet.</p>
  }

  const totalCount = clusters.reduce((sum, c) => sum + c.count, 0)

  return (
    <div className="bg-surface border border-border rounded-xl p-6 flex flex-col gap-6">
      {clusters.map((cluster, i) => {
        const pct = totalCount > 0 ? Math.round((cluster.count / totalCount) * 100) : 0
        const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length]

        return (
          <div
            key={cluster.id}
            className="border-b border-border last:border-b-0 pb-6 last:pb-0"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: color }}
                />
                <h3 className="font-serif text-lg font-semibold text-text-primary">
                  {cluster.label}
                </h3>
              </div>
              <div className="text-right ml-6 shrink-0">
                <div className="font-serif text-3xl font-semibold text-text-primary leading-none">
                  {cluster.count}
                </div>
                <div className="text-xs text-text-muted mt-0.5">{pct}% of issues</div>
              </div>
            </div>

            <div className="relative h-1.5 bg-surface-2 rounded-full overflow-hidden mb-4">
              <div
                className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>

            <ul className="flex flex-col gap-1.5">
              {cluster.issues.slice(0, 4).map((issue) => (
                <li key={issue.number}>
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-baseline gap-2 text-sm hover:text-accent transition-colors group"
                  >
                    <span className="font-mono text-xs text-text-muted shrink-0 group-hover:text-accent/70">
                      #{issue.number}
                    </span>
                    <span className="text-text-secondary group-hover:text-accent line-clamp-1">
                      {issue.title}
                    </span>
                  </a>
                </li>
              ))}
              {cluster.count > 4 && (
                <li className="text-xs text-text-muted mt-0.5 font-mono">
                  +{cluster.count - 4} more
                </li>
              )}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

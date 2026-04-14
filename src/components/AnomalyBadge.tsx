import type { AnomalyLevel } from '@/types'

type Props = {
  level: AnomalyLevel
  multiplier?: number
}

const styles: Record<Exclude<AnomalyLevel, 'normal'>, string> = {
  elevated:
    'bg-[var(--color-elevated-tint)] text-elevated border border-elevated/20',
  spike:
    'bg-[var(--color-spike-tint)] text-spike border border-spike/20',
}

export function AnomalyBadge({ level, multiplier }: Props) {
  if (level === 'normal') return null

  const label =
    level === 'spike' ? 'SPIKE' : 'ELEVATED'
  const suffix =
    multiplier && multiplier > 1
      ? ` · ${multiplier.toFixed(1)}x`
      : ''

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold font-mono ${styles[level]}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}{suffix}
    </span>
  )
}

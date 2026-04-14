import type { AnomalyLevel, AnomalyResult } from '@/types'

export function classifyLevel(score: number): AnomalyLevel {
  if (score < 0.5) return 'normal'
  if (score < 2.0) return 'elevated'
  return 'spike'
}

export function detectAnomaly(
  recentCount: number,
  historicalAvg: number
): AnomalyResult {
  if (historicalAvg === 0) {
    const level = recentCount >= 5 ? 'elevated' : 'normal'
    return { score: 0, level, multiplier: 1 }
  }

  const recentDailyRate = recentCount / 7
  const ratio = recentDailyRate / historicalAvg
  const score = ratio - 1

  if (recentCount < 5) {
    return { score, level: 'normal', multiplier: ratio }
  }

  return {
    score,
    level: classifyLevel(score),
    multiplier: ratio,
  }
}

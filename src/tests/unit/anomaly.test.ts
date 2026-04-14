import { describe, it, expect } from 'vitest'
import { detectAnomaly, classifyLevel } from '@/lib/analysis/anomaly'

describe('classifyLevel', () => {
  it('returns normal when score is below 0.5', () => {
    expect(classifyLevel(0)).toBe('normal')
    expect(classifyLevel(0.49)).toBe('normal')
  })

  it('returns elevated when score is between 0.5 and 2.0', () => {
    expect(classifyLevel(0.5)).toBe('elevated')
    expect(classifyLevel(1.0)).toBe('elevated')
    expect(classifyLevel(1.99)).toBe('elevated')
  })

  it('returns spike when score is 2.0 or above', () => {
    expect(classifyLevel(2.0)).toBe('spike')
    expect(classifyLevel(5.0)).toBe('spike')
  })
})

describe('detectAnomaly', () => {
  it('returns normal when daily rate matches historical average', () => {
    // 7 issues in 7 days = 1/day, historicalAvg = 1/day → ratio 1.0, score 0.0
    const result = detectAnomaly(7, 1)
    expect(result.level).toBe('normal')
    expect(result.score).toBeCloseTo(0)
    expect(result.multiplier).toBeCloseTo(1)
  })

  it('returns elevated when recent daily rate is ~2x historical average', () => {
    // 14 issues in 7 days = 2/day, historicalAvg = 1/day → ratio 2.0, score 1.0
    const result = detectAnomaly(14, 1)
    expect(result.level).toBe('elevated')
    expect(result.score).toBeCloseTo(1.0)
    expect(result.multiplier).toBeCloseTo(2.0)
  })

  it('returns spike when recent daily rate is 4x historical average', () => {
    // 28 issues in 7 days = 4/day, historicalAvg = 1/day → ratio 4.0, score 3.0
    const result = detectAnomaly(28, 1)
    expect(result.level).toBe('spike')
    expect(result.score).toBeCloseTo(3.0)
    expect(result.multiplier).toBeCloseTo(4.0)
  })

  it('does not throw when historicalAvg is zero', () => {
    expect(() => detectAnomaly(5, 0)).not.toThrow()
  })

  it('returns elevated for new repo when recentCount >= 5', () => {
    expect(detectAnomaly(5, 0).level).toBe('elevated')
    expect(detectAnomaly(10, 0).level).toBe('elevated')
  })

  it('returns normal for new repo when recentCount < 5', () => {
    expect(detectAnomaly(0, 0).level).toBe('normal')
    expect(detectAnomaly(4, 0).level).toBe('normal')
  })

  it('returns score 0 and multiplier 1 for new repo', () => {
    const result = detectAnomaly(5, 0)
    expect(result.score).toBe(0)
    expect(result.multiplier).toBe(1)
  })

  it('returns normal when recentCount < 5 even if ratio is high', () => {
    // 4 issues vs historicalAvg 0.1 → ratio 5.7x, but too few absolute issues
    const result = detectAnomaly(4, 0.1)
    expect(result.level).toBe('normal')
  })

  it('classifies correctly when recentCount >= 5', () => {
    // 5 issues vs historicalAvg 0.1 → ratio 7.1x → spike
    const result = detectAnomaly(5, 0.1)
    expect(result.level).toBe('spike')
  })
})

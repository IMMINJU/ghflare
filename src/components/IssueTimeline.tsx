'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { TimelinePoint } from '@/types'

type Props = {
  timeline: TimelinePoint[]
  historicalAvg: number
}

export function IssueTimeline({ timeline, historicalAvg }: Props) {
  const formatXAxis = (dateStr: string, index: number) => {
    if (index % 30 !== 0) return ''
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={timeline} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="issueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#E5541B" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#E5541B" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#E8E4DE" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatXAxis}
          stroke="#9E9893"
          tick={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', fill: '#9E9893' }}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis
          stroke="#9E9893"
          tick={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', fill: '#9E9893' }}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip
          cursor={{ stroke: '#E8E4DE', strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <div
                style={{
                  backgroundColor: '#111111',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  color: '#FAFAFA',
                  fontSize: '12px',
                  fontFamily: 'var(--font-geist-mono)',
                }}
              >
                <div style={{ color: '#9E9893', marginBottom: '2px' }}>{label}</div>
                <div>{payload[0]?.value} issues</div>
              </div>
            )
          }}
        />
        {historicalAvg > 0 && (
          <ReferenceLine
            y={historicalAvg}
            stroke="#9E9893"
            strokeDasharray="4 4"
          />
        )}
        <Area
          type="monotone"
          dataKey="count"
          stroke="#E5541B"
          strokeWidth={1.5}
          fill="url(#issueGradient)"
          dot={(props) => {
            const { cx, cy, payload } = props as { cx: number; cy: number; payload: TimelinePoint }
            if (!payload.isAnomalous) return <g key={`dot-${payload.date}`} />
            return (
              <circle
                key={`dot-${payload.date}`}
                cx={cx}
                cy={cy}
                r={3}
                fill="#DC2626"
                stroke="none"
              />
            )
          }}
          activeDot={{ r: 4, fill: '#E5541B', stroke: 'none' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

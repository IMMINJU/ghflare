'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = { owner: string; name: string }

export function FetchRepoData({ owner, name }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'error'>('loading')

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/repo/${owner}/${name}/fetch`, { method: 'POST' })
        if (!res.ok) throw new Error('Fetch failed')
        router.refresh()
      } catch {
        setStatus('error')
      }
    }
    fetchData()
  }, [owner, name, router])

  if (status === 'error') {
    return (
      <div className="bg-surface border border-border rounded-xl p-8 text-center">
        <p className="text-sm text-text-secondary mb-2">Could not fetch repo data.</p>
        <p className="text-xs text-text-muted font-mono">
          This repo may not exist or GitHub Issues may be disabled.
        </p>
      </div>
    )
  }

  return (
    <div className="animate-pulse">
      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-8">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        <span className="text-sm text-text-secondary">Fetching issue data from GitHub...</span>
      </div>

      {/* Stat cards skeleton */}
      <div className="grid grid-cols-4 gap-4 mb-12">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-4 h-4 rounded bg-border" />
              <div className="h-3 w-16 rounded bg-border" />
            </div>
            <div className="h-8 w-20 rounded bg-border" />
          </div>
        ))}
      </div>

      {/* Timeline skeleton */}
      <section className="mb-12">
        <div className="h-7 w-52 rounded bg-border mb-6" />
        <div className="bg-surface border border-border rounded-xl p-6">
          <div className="h-40 w-full rounded bg-border" />
        </div>
      </section>

      {/* Clusters skeleton */}
      <section>
        <div className="h-7 w-44 rounded bg-border mb-6" />
        <div className="flex flex-col gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-border" />
                  <div className="h-4 w-36 rounded bg-border" />
                </div>
                <div className="h-4 w-8 rounded bg-border" />
              </div>
              <div className="h-1.5 w-full rounded-full bg-border mb-3" />
              <div className="flex flex-col gap-1.5">
                <div className="h-3.5 w-3/4 rounded bg-border" />
                <div className="h-3.5 w-2/3 rounded bg-border" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

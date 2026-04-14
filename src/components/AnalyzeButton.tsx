'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = { owner: string; name: string }

export function AnalyzeButton({ owner, name }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  async function handleAnalyze() {
    setStatus('loading')
    try {
      const res = await fetch(`/api/repo/${owner}/${name}/cluster`, { method: 'POST' })
      if (!res.ok) throw new Error('Analysis failed')
      router.refresh()
    } catch {
      setStatus('error')
    }
  }

  if (status === 'loading') {
    return (
      <div className="bg-surface border border-border rounded-xl p-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-sm text-text-secondary">Analyzing issue topics...</span>
        </div>
        <p className="text-xs text-text-muted font-mono">
          Generating embeddings and clustering — this may take a minute
        </p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="bg-surface border border-border rounded-xl p-8 text-center">
        <p className="text-sm text-text-secondary mb-3">Analysis failed.</p>
        <button
          onClick={handleAnalyze}
          className="text-xs text-accent font-mono hover:underline underline-offset-4"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-8 text-center">
      <p className="text-sm text-text-secondary mb-1">Topic clusters not yet generated.</p>
      <p className="text-xs text-text-muted font-mono mb-5">
        Takes 20–60s depending on issue volume.
      </p>
      <button
        onClick={handleAnalyze}
        className="px-5 py-2 rounded-full bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Analyze Topics
      </button>
    </div>
  )
}

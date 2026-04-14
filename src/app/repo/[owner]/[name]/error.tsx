'use client'

import Link from 'next/link'
import { useEffect } from 'react'

type Props = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function RepoError({ error, reset }: Props) {
  useEffect(() => {
    console.error('[repo page error]', error)
  }, [error])

  return (
    <main className="flex-1 px-6 py-12 max-w-3xl mx-auto w-full">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors mb-8 font-mono"
      >
        ← Back
      </Link>
      <div className="py-16 text-center">
        <p className="text-text-secondary text-sm mb-2">Failed to load repo analysis.</p>
        <p className="text-text-muted text-xs font-mono mb-6">
          {error.digest ? `Error ID: ${error.digest}` : 'An unexpected error occurred.'}
        </p>
        <button
          onClick={reset}
          className="text-xs text-accent font-mono hover:underline underline-offset-4"
        >
          Try again
        </button>
      </div>
    </main>
  )
}

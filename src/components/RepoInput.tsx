'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function RepoInput() {
  const router = useRouter()
  const [value, setValue] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return

    // Accept "owner/repo" or full GitHub URL
    const match = trimmed.match(/(?:github\.com\/)?([^/\s]+)\/([^/\s]+)/)
    if (!match) return

    const [, owner, name] = match
    router.push(`/repo/${owner}/${name}`)
    setValue('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        data-testid="repo-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="owner/repo"
        aria-label="Navigate to repo"
        className="w-44 px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-2 transition-colors"
      />
    </form>
  )
}

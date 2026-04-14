export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="h-4 w-32 bg-surface-2 rounded animate-pulse mb-8" />

      <div className="mb-10">
        <div className="h-12 w-96 bg-surface-2 rounded-lg animate-pulse mb-4" />
        <div className="h-5 w-80 bg-surface-2 rounded animate-pulse mb-4" />
        <div className="h-4 w-48 bg-surface-2 rounded animate-pulse" />
      </div>

      <div className="grid grid-cols-4 gap-4 mb-12">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-5">
            <div className="h-3 w-16 bg-surface-2 rounded animate-pulse mb-3" />
            <div className="h-8 w-24 bg-surface-2 rounded animate-pulse" />
          </div>
        ))}
      </div>

      <div className="mb-12">
        <div className="h-7 w-56 bg-surface-2 rounded animate-pulse mb-6" />
        <div className="bg-surface border border-border rounded-xl p-6 h-64 animate-pulse" />
      </div>

      <div>
        <div className="h-7 w-48 bg-surface-2 rounded animate-pulse mb-6" />
        <div className="bg-surface border border-border rounded-xl p-6 flex flex-col gap-6">
          {[1, 2].map((i) => (
            <div key={i} className="border-b border-border last:border-b-0 pb-6 last:pb-0">
              <div className="flex justify-between mb-3">
                <div className="h-6 w-48 bg-surface-2 rounded animate-pulse" />
                <div className="h-8 w-12 bg-surface-2 rounded animate-pulse" />
              </div>
              <div className="h-1.5 w-full bg-surface-2 rounded-full animate-pulse mb-4" />
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: `${75 - j * 10}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

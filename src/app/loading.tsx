export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="mb-12">
        <div className="h-12 w-72 bg-surface-2 rounded-lg animate-pulse mb-3" />
        <div className="h-4 w-96 bg-surface-2 rounded animate-pulse" />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-1.5 h-1.5 rounded-full bg-surface-2" />
        <div className="h-4 w-32 bg-surface-2 rounded animate-pulse" />
      </div>

      <div className="flex flex-col gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-6">
            <div className="mb-4">
              <div className="h-7 w-64 bg-surface-2 rounded animate-pulse mb-2" />
              <div className="h-4 w-80 bg-surface-2 rounded animate-pulse mb-3" />
              <div className="h-3 w-32 bg-surface-2 rounded animate-pulse" />
            </div>
            <div className="grid grid-cols-4 gap-4 pt-4 border-t border-border">
              {[1, 2, 3, 4].map((j) => (
                <div key={j}>
                  <div className="h-3 w-16 bg-surface-2 rounded animate-pulse mb-2" />
                  <div className="h-7 w-20 bg-surface-2 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

'use client'

/** Loading-state primitives. Every list/registry screen previously showed a
 *  bare "Loading…" line on first fetch, which reads as an empty state for a
 *  beat. These render the *shape* of the incoming content instead, using the
 *  existing `.skel` pulse (globals.css) — and respect prefers-reduced-motion
 *  because that rule already disables the animation there. */

/** A single pulsing placeholder block. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skel rounded-md bg-white/10 ${className}`} />
}

/** A card-shaped placeholder matching the registry card grid. */
export function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="h-6 w-16" />
      </div>
      <Skeleton className="mt-4 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-4/5" />
    </div>
  )
}

/** A responsive grid of card skeletons — the drop-in first-load state for the
 *  registry views. `role="status"` + a visually-hidden label announce it. */
export function CardGridSkeleton({ count = 6, cols = 'sm:grid-cols-2 xl:grid-cols-3' }: { count?: number; cols?: string }) {
  return (
    <div role="status" aria-busy="true" className={`grid grid-cols-1 gap-4 ${cols}`}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
    </div>
  )
}

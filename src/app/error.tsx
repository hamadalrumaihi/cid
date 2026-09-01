'use client'

/** Route-level error boundary — a crash inside any screen shows this instead
 *  of a blank page. `reset()` re-renders the segment; a reload link covers
 *  the stale-deployment case (new build shipped while the tab was open). */
import { Button } from '@/components/ui/Button'
import { AlertIcon } from '@/components/shell/icons'

export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    // A route error replaces the app shell (and its <main>), so this boundary
    // supplies the page's sole main landmark itself.
    <main className="grid min-h-[60vh] place-items-center p-6">
      <div className="w-full max-w-md rounded-lg border border-rose-500/20 bg-ink-900/80 p-8 text-center">
        <div className="flex justify-center" aria-hidden><AlertIcon className="h-8 w-8 text-amber-400" /></div>
        <h1 className="mt-2 text-lg font-semibold text-white">Something broke on this screen</h1>
        <p className="mt-1 text-sm text-slate-400">
          The rest of the portal is fine and no data was lost.
          {error.digest && <span className="mt-1 block font-mono text-[11px] text-slate-600">ref {error.digest}</span>}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Button
            onClick={() => window.location.assign('/command') /* hard reload — picks up a new deployment if that's what crashed us */}
          >
            Reload the portal
          </Button>
        </div>
      </div>
    </main>
  )
}
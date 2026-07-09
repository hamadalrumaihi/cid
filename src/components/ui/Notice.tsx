'use client'

/** Shared status panels — the `Notice` card was copy-pasted into 23 files with
 *  drifting text. One implementation, three intents:
 *   - <Notice> — neutral message (loading text, info).
 *   - <EmptyState> — nothing here yet; explains what to do next, optional CTA.
 *   - <ErrorNotice> — a load failed; humanised message + optional Retry.
 *  All render the canonical card surface so they line up with real content. */
import { humanizeError } from '@/lib/toast'
import { Button } from './Button'

const CARD = 'rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center'

export function Notice({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`${CARD} text-sm text-slate-400 ${className}`}>{text}</div>
}

/** Empty state: an optional icon, a headline, an explanation of what to do
 *  next, and an optional call to action. Prefer this over a bare "No X". */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className = '',
}: {
  icon?: string
  title: string
  hint?: string
  action?: { label: string; onClick: () => void }
  className?: string
}) {
  return (
    <div className={`${CARD} ${className}`}>
      {icon && (
        <div className="mb-2 text-2xl" aria-hidden>
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">{hint}</p>}
      {action && (
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Load-failure panel: routes the raw error through humanizeError (so DB
 *  internals never reach the user) and offers Retry when a handler is given. */
export function ErrorNotice({
  message,
  onRetry,
  className = '',
}: {
  message: unknown
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-rose-500/20 bg-rose-500/5 p-8 text-center ${className}`}>
      <p className="text-sm text-rose-200">{humanizeError(message)}</p>
      {onRetry && (
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}

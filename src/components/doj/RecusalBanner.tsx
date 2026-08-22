'use client'

/** Recusal / conflict-of-interest banner — shown when a justice action is
 *  refused by the server's permanent-user-ID conflict detection
 *  (private.legal_is_conflicted / legal_is_prosecution_side). The server
 *  message is surfaced VERBATIM: these refusals are the integrity story
 *  (a former investigator can never prosecute or judge their own case) and
 *  paraphrasing them loses the recorded reason. Dismissable; presentation
 *  only — the refusal already happened server-side. */
import { Button } from '@/components/ui/Button'

/** True when an RPC error is the server's conflict/recusal refusal (the
 *  literal raise strings in 20260816120000: 'recusal required',
 *  'conflict of role', 'conflict of interest'). */
export function isRecusalError(message: string | null | undefined): boolean {
  return !!message && /recusal|conflict of (role|interest)/i.test(message)
}

export function RecusalBanner({ message, onDismiss }: {
  /** The server error message, verbatim. */
  message: string
  onDismiss?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-rose-500/25 bg-rose-500/5 px-4 py-3"
    >
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-rose-300">Recusal required</p>
        <p className="mt-1 text-sm text-rose-200">{message}</p>
        <p className="mt-1 text-xs text-slate-400">
          Conflict detection follows the permanent user ID — role changes never clear a genuine conflict,
          and the Attorney General cannot override it.
        </p>
      </div>
      {onDismiss && (
        <Button size="sm" variant="ghost" aria-label="Dismiss recusal notice" onClick={onDismiss}>
          ✕
        </Button>
      )}
    </div>
  )
}

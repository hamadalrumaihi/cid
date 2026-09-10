'use client'

/** The permanent-deletion flow for ONE member — the single implementation.
 *
 *  There is exactly one deletion system in this app and this is it. The Owner
 *  console renders it after picking a member; the Manage Officer modal and the
 *  Field Intelligence access roster render it inline for the member already in
 *  front of them. A second implementation living next to a member list is how
 *  two deletion paths end up with two different sets of safeguards.
 *
 *  ── Everything here is a shell over three RPCs ─────────────────────────────
 *  permanent_delete_preview / _arm / _execute. Every rule — Owner-only, a
 *  sign-in fresher than five minutes, a recorded reason, blocker re-checks, a
 *  single-use token that expires in five minutes, and a typed confirmation
 *  containing the member's exact display name — is enforced server-side. This
 *  component sequences the steps and shows the server's errors VERBATIM,
 *  because they are written to be read by a person.
 *
 *  Soft removal stays the default and the recommendation: it keeps history and
 *  can be undone. This is the exception, and the copy says so before the button
 *  does anything.
 *
 *  CALLERS MUST PASS `key={targetId}`. An armed token belongs to one member;
 *  remounting on a target change is how this component guarantees a token or a
 *  half-typed confirmation cannot be inherited by the next person selected.
 *
 *  See docs/AUTHORIZATION.md §4 and
 *  supabase/migrations/20260726010000_phase_b_permanent_deletion.sql.
 */
import { useState } from 'react'
import type { Json } from '@/lib/database.types'
import { rpc } from '@/lib/db'
import { useProfilesStore } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { inputCls, labelCls } from '@/components/ui/Field'

export interface PreviewTarget {
  id: string
  display_name: string
  badge_number: string | null
  // Null for an account nobody ever assigned a bureau or a rank -- a Field
  // Intelligence submitter, or a sign-in still waiting on a decision.
  role: string | null
  division: string | null
  active: boolean
  removed_at: string | null
  is_test: boolean
  is_system: boolean
}

export interface DeletePreview {
  blockers: Record<string, number>
  active_work: Record<string, number>
  repoint: Record<string, number>
  cascade: Record<string, number>
  deleted: Record<string, number>
  set_null: Record<string, number>
  blocker_total: number
  target: PreviewTarget
  eligible: boolean
  ineligible_reasons: string[]
}

interface ArmedToken {
  token: string
  /** The server's five-minute window. Nothing on screen counts it down any
   *  more: the token is minted and spent inside one action, so it never sits
   *  around long enough to expire. */
  expires_at: string
  display_name: string
}

const FRESHNESS_RE = /fresh sign-in/i

/** Server errors verbatim + the sign-out/in hint on freshness failures. */
export function ServerError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3">
      <p className="text-sm text-rose-200">{message}</p>
      {FRESHNESS_RE.test(message) && (
        <p className="mt-1 text-xs text-rose-300/80">
          Your session is older than 5 minutes. Sign out, sign back in, and retry — arming and
          executing both require a fresh sign-in, by design.
        </p>
      )}
    </div>
  )
}

/** The three steps, for one member.
 *
 *  `renderPreview` lets the Owner console show its full per-table reference
 *  breakdown while the inline callers show the short version. The counts are
 *  the same object either way — the console is not seeing a different truth,
 *  only more of it. */
export function PermanentDelete({ targetId, targetName, renderPreview, onDeleted }: {
  targetId: string
  targetName: string
  renderPreview?: (preview: DeletePreview) => React.ReactNode
  onDeleted?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<DeletePreview | null>(null)
  const [reason, setReason] = useState('')
  const [armed, setArmed] = useState<ArmedToken | null>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const doPreview = async () => {
    setError(null)
    const res = await rpc('permanent_delete_preview', { p_target: targetId })
    if (res.error) { setPreview(null); setError(res.error.message); return }
    setPreview(res.data as unknown as DeletePreview)
  }

  // One action. The server still runs its two-phase contract underneath —
  // permanent_delete_arm mints a single-use token bound to this target and
  // permanent_delete_execute spends it — because that is what writes the ledger
  // entry and re-checks eligibility at the moment of the write. What is gone is
  // the ARMING as something the Owner performs: no second button, no five-minute
  // countdown to race, no name to retype. The preview above already says what
  // will happen, and the reason below is what the audit keeps.
  // Arm first (audit row + single-use token + the display name the server
  // expects), then the Owner TYPES `DELETE <name>` and that text goes to the
  // server verbatim — the client never echoes the server's phrase back (the
  // Phase 8 security review found the earlier one-click flow made the
  // "typed confirmation" a no-op).
  const doArm = async () => {
    setError(null)
    setBusy(true)
    const armRes = await rpc('permanent_delete_arm', { p_target: targetId, p_reason: reason })
    setBusy(false)
    if (armRes.error) { setError(armRes.error.message); return }
    setArmed(armRes.data as unknown as ArmedToken); setTyped('')
  }
  const doDelete = async () => {
    if (!armed) return
    setError(null)
    setBusy(true)
    const res = await rpc('permanent_delete_execute', { p_token: armed.token, p_confirm: typed.trim() })
    setBusy(false)
    if (res.error) { setError(res.error.message); return }
    const summary = res.data as unknown as { display_name: string; ledger_id: string; references: Json }
    toast(`${summary.display_name} was permanently deleted — ledger entry ${summary.ledger_id}.`, 'success')
    setOpen(false); setPreview(null); setReason(''); setArmed(null); setTyped('')
    void useProfilesStore.getState().fetch()
    onDeleted?.()
  }

  if (!open) {
    return (
      <Button size="sm" variant="danger" onClick={() => { setOpen(true); void doPreview() }}>
        Permanently delete account
      </Button>
    )
  }

  return (
    <div className="mt-2 w-full space-y-3 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
      <div>
        <p className="text-sm font-bold text-rose-200">
          This permanently deletes {targetName}&rsquo;s account login and cannot be undone.
        </p>
        <p className="mt-1 text-xs text-rose-200/80">
          Investigative history is preserved: cases, reports, evidence, Field Intelligence
          submissions and their reporting identity snapshots all remain, with references
          repointed to the shared &ldquo;Deleted Member&rdquo; record and an owner-only ledger
          entry holding the identity snapshot and the reason. Removing from the portal is
          reversible and remains the recommended action.
        </p>
      </div>

      {preview && (
        <>
          <p className="text-sm text-slate-300">
            {preview.eligible
              ? <span className="text-emerald-300">Eligible for permanent deletion.</span>
              : <span className="font-semibold text-rose-300">
                  Not eligible: {preview.ineligible_reasons.join('; ')}
                </span>}
          </p>
          {renderPreview?.(preview)}
        </>
      )}

      <div>
        <label htmlFor={`pd-reason-${targetId}`} className={labelCls}>
          Reason (required — lands in the audit log and the ledger)
        </label>
        <textarea
          id={`pd-reason-${targetId}`} rows={2} value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this account must be erased rather than removed…"
          className={inputCls}
        />
      </div>

      {armed && (
        <div>
          <label htmlFor={`pd-confirm-${targetId}`} className={labelCls}>
            Type <span className="font-mono">DELETE {armed.display_name}</span> to confirm (the token expires in five minutes)
          </label>
          <input id={`pd-confirm-${targetId}`} value={typed} onChange={(e) => setTyped(e.target.value)}
            autoComplete="off" spellCheck={false} className={`${inputCls} font-mono`} placeholder={`DELETE ${armed.display_name}`} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!armed ? (
          <Button variant="danger" disabled={!preview?.eligible || !reason.trim() || busy} onAction={doArm}>
            {busy ? 'Arming…' : 'Arm permanent deletion'}
          </Button>
        ) : (
          <Button variant="danger" disabled={typed.trim() !== `DELETE ${armed.display_name}` || busy} onAction={doDelete}>
            {busy ? 'Deleting…' : `Permanently delete ${targetName}`}
          </Button>
        )}
        <Button variant="ghost" onClick={() => { setOpen(false); setError(null); setArmed(null); setTyped('') }}>
          Cancel
        </Button>
      </div>

      {error && <ServerError message={error} />}
    </div>
  )
}

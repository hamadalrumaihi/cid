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
import { useEffect, useState } from 'react'
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
  expires_at: string
  display_name: string
}

const FRESHNESS_RE = /fresh sign-in/i

/** Server errors verbatim + the sign-out/in hint on freshness failures. */
export function ServerError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3">
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
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())

  // Token-expiry countdown — ticks only while armed.
  useEffect(() => {
    if (!armed) return
    const t = window.setInterval(() => setNowTs(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [armed])

  const secondsLeft = armed ? Math.max(0, Math.floor((Date.parse(armed.expires_at) - nowTs) / 1000)) : 0
  const expectedConfirm = armed ? `DELETE ${armed.display_name}` : ''
  const confirmOk = !!armed && confirmText === expectedConfirm

  const doPreview = async () => {
    setError(null); setArmed(null); setConfirmText('')
    const res = await rpc('permanent_delete_preview', { p_target: targetId })
    if (res.error) { setPreview(null); setError(res.error.message); return }
    setPreview(res.data as unknown as DeletePreview)
  }

  const doArm = async () => {
    setError(null)
    const res = await rpc('permanent_delete_arm', { p_target: targetId, p_reason: reason })
    if (res.error) { setError(res.error.message); return }
    setArmed(res.data as unknown as ArmedToken)
    setConfirmText('')
  }

  const doExecute = async () => {
    if (!armed) return
    setError(null)
    const res = await rpc('permanent_delete_execute', { p_token: armed.token, p_confirm: confirmText })
    if (res.error) { setError(res.error.message); return }
    const summary = res.data as unknown as { display_name: string; ledger_id: string; references: Json }
    toast(`${summary.display_name} was permanently deleted — ledger entry ${summary.ledger_id}.`, 'success')
    setOpen(false); setPreview(null); setArmed(null); setConfirmText(''); setReason('')
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
    <div className="mt-2 w-full space-y-3 rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
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

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="danger" disabled={!preview?.eligible || !reason.trim()} onAction={doArm}>
          Arm permanent deletion
        </Button>
        <Button variant="ghost" onClick={() => { setOpen(false); setArmed(null); setError(null) }}>
          Cancel
        </Button>
        {armed && secondsLeft > 0 && (
          <span className="text-xs text-amber-300">
            Armed for <b className="font-mono">
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            </b> — single-use, expires after 5 minutes.
          </span>
        )}
        {armed && secondsLeft === 0 && (
          <span className="text-xs text-rose-300">The token expired — arm again.</span>
        )}
      </div>

      {armed && (
        <div>
          <label htmlFor={`pd-confirm-${targetId}`} className={labelCls}>
            Type <span className="font-mono text-rose-300">{expectedConfirm}</span> to confirm
          </label>
          <input
            id={`pd-confirm-${targetId}`} type="text" value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={secondsLeft === 0}
            autoComplete="off" spellCheck={false}
            placeholder={expectedConfirm}
            className={inputCls}
          />
          <div className="mt-2">
            <Button variant="danger" disabled={!confirmOk || secondsLeft === 0} onAction={doExecute}>
              Permanently delete {targetName}
            </Button>
          </div>
        </div>
      )}

      {error && <ServerError message={error} />}
    </div>
  )
}

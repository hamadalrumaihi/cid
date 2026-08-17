'use client'

/** Penal Code administration — publish, roll back, and see what is in force.
 *
 *  Rendered only for a Penal Code administrator, and the panel does not decide
 *  that: `penal_admin_overview()` reports it from `private.penal_is_admin()`,
 *  the same helper the policies use. Every action here is a SECURITY DEFINER
 *  RPC that re-checks the same thing, so hiding this panel is tidiness, not
 *  the boundary.
 *
 *  ── Publishing is spelled out before it happens ────────────────────────────
 *  It changes the law in force for CID, SIU, JTF, DOJ, the AG, prosecutors and
 *  judges at once, and supersedes whatever was in force. So the confirm step
 *  states the consequences rather than asking "are you sure?" — including the
 *  one that is easy to miss: a version carrying codeless charges publishes an
 *  INCOMPLETE code, because a charge with no code reaches no picker.
 *
 *  A reason is required for a rollback and optional for a publish, matching
 *  what the RPCs themselves demand.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { ensurePenalCode } from '@/lib/penal'
import {
  type PenalVersionSummary,
  canPublish,
  canRollBack,
  inForceVersion,
  loadPenalAdminOverview,
  publishPenalVersion,
  publishWarnings,
  rollBackPenalVersion,
} from '@/lib/penalAdmin'
import { toast } from '@/lib/toast'
import { useAction } from '@/lib/useAction'
import { Button } from '@/components/ui/Button'
import { ErrorNotice } from '@/components/ui/Notice'

const STATUS_TINT: Record<string, string> = {
  published: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  draft: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  superseded: 'border-white/10 bg-white/5 text-slate-400',
}

export function PenalAdminPanel() {
  const { state } = useAuth()
  const [versions, setVersions] = useState<PenalVersionSummary[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ v: PenalVersionSummary; mode: 'publish' | 'rollback' } | null>(null)
  const [reason, setReason] = useState('')

  const refresh = useCallback(async () => {
    // Every setState here follows the await, which is the repo's rule and also
    // the only ordering that cannot show a half-loaded panel.
    const res = await loadPenalAdminOverview().catch((e: unknown) => e instanceof Error ? e : new Error('load failed'))
    if (res instanceof Error) {
      setError('Could not load the penal code versions.')
      setLoading(false)
      return
    }
    setError(null)
    setIsAdmin(res.isAdmin)
    setVersions(res.versions)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (state !== 'in') return
    // Deferred, matching useRegistry: keeps the first paint unblocked and
    // keeps the setState out of the effect body.
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [state, refresh])

  const { run: commit, busy } = useAction(async () => {
    if (!confirming) return
    const { v, mode } = confirming
    const err = mode === 'publish'
      ? await publishPenalVersion(v.id, reason.trim() || null)
      : await rollBackPenalVersion(v.id, reason.trim())
    if (err) { toast(err, 'danger'); return }
    // The catalog every other screen reads is now stale — it still holds the
    // code that was in force a moment ago. Re-fetch before saying it worked.
    await ensurePenalCode(true)
    await refresh()
    setConfirming(null)
    setReason('')
    toast(mode === 'publish' ? `“${v.name}” is now in force.` : `Rolled back to “${v.name}”.`, 'success')
  })

  if (loading || !isAdmin) return null
  if (error) return <ErrorNotice message={error} onRetry={() => void refresh()} />

  const inForce = inForceVersion(versions)
  const warnings = confirming ? publishWarnings(confirming.v, inForce) : []
  const needReason = confirming?.mode === 'rollback'

  return (
    <section className="mt-8 rounded-2xl border border-white/10 bg-ink-950/40 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Penal code administration</h2>
        <p className="t-readout text-[11px] text-slate-500">
          PUBLISHING CHANGES THE LAW IN FORCE FOR EVERY UNIT
        </p>
      </div>

      <div className="space-y-2">
        {versions.map((v) => (
          <div key={v.id} className="rounded-xl border border-white/10 bg-ink-900 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-slate-200">
                  {v.name}{' '}
                  <span className={`ml-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_TINT[v.status] ?? ''}`}>
                    {v.status}
                  </span>
                </p>
                <p className="t-readout mt-1 text-[11px] text-slate-500">
                  EFFECTIVE {v.effective_date} · {v.active_charges} SELECTABLE
                  {v.needs_code > 0 && <span className="text-amber-300"> · {v.needs_code} AWAITING A CODE</span>}
                  {v.archived_charges > 0 && ` · ${v.archived_charges} ARCHIVED`}
                  {v.rules > 0 && ` · ${v.rules} RULES`}
                </p>
              </div>
              <div className="flex gap-2">
                {canPublish(v) && (
                  <Button size="sm" variant={v.status === 'draft' ? 'primary' : 'secondary'}
                    onClick={() => { setConfirming({ v, mode: 'publish' }); setReason('') }}>
                    Publish
                  </Button>
                )}
                {canRollBack(v) && (
                  <Button size="sm" variant="warn"
                    onClick={() => { setConfirming({ v, mode: 'rollback' }); setReason('') }}>
                    Roll back to this
                  </Button>
                )}
              </div>
            </div>
            {v.change_summary && <p className="mt-2 text-xs text-slate-500">{v.change_summary}</p>}
          </div>
        ))}
      </div>

      {confirming && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-white">
            {confirming.mode === 'publish' ? 'Publish' : 'Roll back to'} “{confirming.v.name}”?
          </p>
          <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
            <li>
              Every unit — CID, SIU, JTF, DOJ, the Attorney General, prosecutors and
              judges — reads this code from the moment it is published.
            </li>
            {warnings.map((w) => <li key={w}>{w}</li>)}
            <li>
              Charges already on a case keep the snapshot they were filed under and
              do not change.
            </li>
          </ul>
          <label className="mt-3 block">
            <span className="t-readout text-[11px] text-slate-400">
              {needReason ? 'REASON (REQUIRED)' : 'NOTE (OPTIONAL)'}
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={needReason ? 'Why the code in force is being changed back' : 'Recorded in the audit log'}
              className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-badge-500"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant={confirming.mode === 'publish' ? 'primary' : 'warn'}
              loading={busy}
              disabled={needReason && !reason.trim()}
              onClick={() => void commit()}
            >
              {confirming.mode === 'publish' ? 'Publish this code' : 'Roll back'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setConfirming(null); setReason('') }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

'use client'

/** Command Center → Promotions & Transfers. Three panels: (1) officer picker
 *  opening Manage Officer (role changes via change_member_role, transfers via
 *  request_transfer — transfers apply immediately on initiation); (2) the
 *  open transfer queue, kept for any pre-existing open requests, which can
 *  still be completed or rejected here; (3) role/assignment history from
 *  role_events (reason + source recorded since v1.16). All decisions are
 *  RPC-enforced; buttons are UX only. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { type RosterProfile, useProfilesStore, officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { ROLE_LABEL, canDecideTransferSide, roleLabel, type RoleParty } from '@/lib/roles'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { useAction } from '@/lib/useAction'
import { uiPrompt, uiConfirm } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorNotice } from '@/components/ui/Notice'
import { AssignModal } from '@/components/personnel/AssignModal'

type RoleEvent = Tables<'role_events'>
type TransferRow = Tables<'transfer_requests'>

const TRANSFER_BADGE: Record<string, { label: string; tone: 'warn' | 'neutral' | 'good' }> = {
  pending_source: { label: 'Awaiting source bureau', tone: 'warn' },
  pending_target: { label: 'Awaiting destination bureau', tone: 'warn' },
  approved: { label: 'Approved — awaiting completion', tone: 'good' },
}

export function PromotionsTransfers() {
  const { profile, isOwner } = useAuth()
  const actor: RoleParty = { ...(profile ?? {}), is_owner: isOwner || profile?.is_owner }
  const isHigherCommand = !!actor.is_owner || actor.role === 'deputy_director' || actor.role === 'director'
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [target, setTarget] = useState<RosterProfile | null>(null)
  const [events, setEvents] = useState<RoleEvent[]>([])
  const [transfers, setTransfers] = useState<TransferRow[]>([])
  // Transfer-queue load state: a FAILED load must render an error notice,
  // never the green "✓ No open transfers" all-clear (BUG-027).
  const [transfersLoading, setTransfersLoading] = useState(true)
  const [transfersError, setTransfersError] = useState(false)
  const [q, setQ] = useState('')
  const v = useTableVersion('profiles')
  const vE = useTableVersion('role_events')
  const vT = useTableVersion('transfer_requests')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    try { setEvents(await list('role_events', { order: 'created_at', ascending: false })) } catch { setEvents([]) }
    try { setTransfers(await list('transfer_requests', { order: 'created_at', ascending: false })); setTransfersError(false) }
    catch { setTransfersError(true) }
    finally { setTransfersLoading(false) }
  }, [fetchProfiles])
  useEffect(() => { const t = window.setTimeout(() => { void refresh() }, 0); return () => window.clearTimeout(t) }, [refresh, v, vE, vT])

  const roster = useMemo(() => profiles.filter((p) => !p.removed_at && p.active), [profiles])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return roster.filter((p) => !s || (p.display_name || '').toLowerCase().includes(s) || (p.role || '').includes(s) || (p.division || '').toLowerCase().includes(s))
  }, [roster, q])

  const open = useMemo(() => transfers.filter((t) => t.status in TRANSFER_BADGE), [transfers])

  // Busy-guarded (useAction): the queue's buttons disable while a decision RPC
  // is in flight, so a double-click can't record it twice.
  const { run: act, busy: actBusy } = useAction(async (t: TransferRow, action: 'approve_source' | 'approve_target' | 'complete' | 'reject' | 'cancel') => {
    if (action === 'reject') {
      const note = await uiPrompt(`Reject the transfer of ${officerName(t.target_id) || 'this officer'} to ${t.to_bureau}?`, {
        title: 'Reject transfer', placeholder: 'Reason (recorded)', confirmText: 'Reject',
      })
      if (note === null) return
      const r = await rpc('reject_transfer', { p_id: t.id, p_note: note || undefined })
      if (r.error) { toast(`Reject failed: ${r.error.message}`, 'danger'); return }
      toast('Transfer rejected', 'warn'); void refresh(); return
    }
    if (action === 'cancel') {
      const ok = await uiConfirm('Cancel this transfer request?', { confirmText: 'Cancel request' })
      if (!ok) return
      const r = await rpc('cancel_transfer', { p_id: t.id })
      if (r.error) { toast(`Cancel failed: ${r.error.message}`, 'danger'); return }
      toast('Transfer cancelled', 'info'); void refresh(); return
    }
    const rpcName = action === 'approve_source' ? 'approve_transfer_source'
      : action === 'approve_target' ? 'approve_transfer_target' : 'complete_transfer'
    const confirmMsg = action === 'complete'
      ? `Complete this transfer now (higher-command authority)? ${officerName(t.target_id) || 'The officer'} moves to ${t.to_bureau} immediately.`
      : action === 'approve_target'
        ? `Approve as the destination bureau? Both bureaus have then consented and the move is applied immediately.`
        : `Approve as the source bureau? The destination bureau decides next.`
    const ok = await uiConfirm(confirmMsg, { confirmText: 'Approve' })
    if (!ok) return
    const r = await rpc(rpcName, { p_id: t.id })
    if (r.error) { toast(`Action failed: ${r.error.message}`, 'danger'); return }
    toast(action === 'approve_source' ? 'Source approval recorded' : 'Transfer completed', 'success')
    void refresh()
  })

  const SOURCE_LABEL: Record<string, string> = {
    membership_approval: 'membership approval',
    role_change: 'role change',
    transfer: 'transfer',
    activation: 'activation',
  }

  const describe = (e: RoleEvent) => {
    const parts: string[] = []
    if (e.old_role !== e.new_role) parts.push(`${ROLE_LABEL[e.old_role ?? ''] || e.old_role || '—'} → ${ROLE_LABEL[e.new_role ?? ''] || e.new_role || '—'}`)
    if (e.old_division !== e.new_division) parts.push(`${e.old_division || '—'} → ${e.new_division || '—'}`)
    if (e.old_active !== e.new_active) parts.push(e.new_active ? 'activated' : 'deactivated')
    return parts.join(' · ') || 'no change'
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/5 bg-ink-900/45 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-white">Change rank or bureau</h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find officer…" aria-label="Find officer" className="w-52 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, 24).map((p) => (
            <button key={p.id} onClick={() => setTarget(p)} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-950/50 px-3 py-2 text-left transition hover:border-badge-400/50">
              <span><span className="block text-sm font-semibold text-white">{p.display_name}</span><span className="text-[11px] text-slate-400">{roleLabel(p.role)} · {p.division}</span></span>
              <span className="text-xs font-semibold text-badge-200">Manage</span>
            </button>
          ))}
          {!filtered.length && <p className="text-sm text-slate-500">No matching officers.</p>}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Promotions and demotions go through <b>Change role</b> (audited, reason required); department moves go through <b>Transfer department</b> and apply immediately. Every change is recorded with who, why, and when.</p>
      </section>

      <section className="rounded-2xl border border-white/5 bg-ink-900/45 p-5">
        <h3 className="mb-1 font-bold text-white">Open transfers <span className="text-slate-500">({open.length})</span></h3>
        <p className="mb-3 text-xs text-slate-400">Cross-bureau moves awaiting approval. Bureau Leads decide for their own bureau; Deputy Director+ may complete or reject directly.</p>
        {open.length ? (
          <div className="space-y-3">
            {open.map((t) => {
              const badge = TRANSFER_BADGE[t.status]
              const canSource = t.status === 'pending_source' && canDecideTransferSide(actor, t.from_bureau) && t.target_id !== actor.id
              const canTarget = t.status === 'pending_target' && canDecideTransferSide(actor, t.to_bureau) && t.target_id !== actor.id
              const canComplete = isHigherCommand && t.target_id !== actor.id
              const canReject = (canDecideTransferSide(actor, t.from_bureau) || canDecideTransferSide(actor, t.to_bureau)) && t.target_id !== actor.id
              const canCancel = t.requested_by === actor.id || isHigherCommand
              return (
                <div key={t.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {officerName(t.target_id) || 'Officer'}
                        <span className="ml-2 text-slate-300">{roleLabel(t.from_role)} · {t.from_bureau} → {roleLabel(t.to_role)} · {t.to_bureau}</span>
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Requested by {officerName(t.requested_by) || '—'} · {timeAgo(t.created_at)}
                        {t.source_approved_by ? ` · source ✓ ${officerName(t.source_approved_by) || ''}` : ''}
                        {t.target_approved_by ? ` · destination ✓ ${officerName(t.target_approved_by) || ''}` : ''}
                      </p>
                    </div>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-300"><span className="text-xs font-semibold text-slate-400">Reason:</span> {t.reason}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canSource && <Button size="sm" variant="primary" disabled={actBusy} onClick={() => void act(t, 'approve_source')}>Approve (source)</Button>}
                    {canTarget && <Button size="sm" variant="primary" disabled={actBusy} onClick={() => void act(t, 'approve_target')}>Approve (destination)</Button>}
                    {canComplete && <Button size="sm" disabled={actBusy} onClick={() => void act(t, 'complete')}>Complete now</Button>}
                    {canReject && <Button size="sm" variant="danger" disabled={actBusy} onClick={() => void act(t, 'reject')}>Reject</Button>}
                    {canCancel && <Button size="sm" disabled={actBusy} onClick={() => void act(t, 'cancel')}>Cancel</Button>}
                  </div>
                </div>
              )
            })}
          </div>
        ) : transfersLoading ? (
          <p className="text-sm text-slate-400">Loading transfers…</p>
        ) : transfersError ? (
          <ErrorNotice message="Could not load the transfer queue." onRetry={() => { void refresh() }} />
        ) : <p className="text-sm text-emerald-300">✓ No open transfers.</p>}
      </section>

      <section className="rounded-2xl border border-white/5 bg-ink-900/45 p-5">
        <h3 className="mb-1 font-bold text-white">Role & assignment history <span className="text-slate-500">({events.length})</span></h3>
        {events.length ? (
          <div className="space-y-1.5">
            {events.slice(0, 50).map((e) => (
              <div key={e.id} className="rounded-lg bg-ink-950/50 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-200">
                    {officerName(e.target_id) || 'Officer'} — <span className="text-slate-400">{describe(e)}</span>
                    {e.source && <span className="ml-1.5 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{SOURCE_LABEL[e.source] || e.source}</span>}
                  </span>
                  <span className="text-[11px] text-slate-500">by {officerName(e.actor_id) || 'command'} · {timeAgo(e.created_at)}</span>
                </div>
                {e.reason && <p className="mt-0.5 text-[11px] text-slate-500">Reason: {e.reason}</p>}
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">No role changes recorded yet.</p>}
      </section>

      {target && (
        <AssignModal p={target} email="" onClose={() => setTarget(null)} onChanged={() => void refresh()} />
      )}
    </div>
  )
}

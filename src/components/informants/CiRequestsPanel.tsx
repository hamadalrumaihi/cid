'use client'

/** Capacity / assignment requests (`?requests=1`). RLS shapes the list: a
 *  requester sees their own rows, full access sees every row. Reviewers get
 *  Approve / Deny / Return with a note on pending rows (approving a capacity
 *  request lets them set the new capacity and an optional expiry; approving an
 *  assignment with a proposed person designates the CI as the requester's
 *  primary). A requester may withdraw their own pending request. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import {
  CI_MAX_CAPACITY, CI_MOTIVE_LABEL, CI_REQUEST_STATUS_LABEL, capacityLabel, ciHref, ciRefused, ciRequestDecide,
  ciRequestWithdraw, fetchCiRequests, type CiContext, type CiRequestRow,
} from '@/lib/ci'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { bureauShort } from '@/lib/roles'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { riskLabel } from './ciShared'

const statusTone = (s: string): 'neutral' | 'good' | 'warn' | 'danger' | 'accent' =>
  s === 'approved' ? 'good' : s === 'denied' ? 'danger' : s === 'returned' ? 'warn' : s === 'pending' ? 'accent' : 'neutral'

type Decision = 'approved' | 'denied' | 'returned'

export function CiRequestsPanel({ open, onClose, ctx, version, onNewCapacity, onNewAssignment, onChanged, onOpenCi }: {
  open: boolean
  onClose: () => void
  ctx: CiContext
  /** `ci_events` version — refetch when it moves. */
  version: number
  onNewCapacity?: () => void
  onNewAssignment: () => void
  onChanged?: () => void
  onOpenCi: (href: string) => void
}) {
  const { profile } = useAuth()
  const uid = profile?.id
  const [rows, setRows] = useState<CiRequestRow[] | null>(null)
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [deciding, setDeciding] = useState<{ row: CiRequestRow; decision: Decision } | null>(null)
  const loaded = useProfilesStore((s) => s.loaded)

  const refresh = useCallback(async () => { setRows(await fetchCiRequests()) }, [])
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [open, refresh, version])
  useEffect(() => { if (open && !loaded) void useProfilesStore.getState().fetch() }, [open, loaded])

  const visible = useMemo(() => (rows ?? []).filter((r) => tab === 'all' || r.status === 'pending'), [rows, tab])

  const withdraw = async (r: CiRequestRow) => {
    const res = await ciRequestWithdraw(r.id)
    if (ciRefused(res)) return
    toast('Request withdrawn.', 'success')
    void refresh(); onChanged?.()
  }

  return (
    <Modal open={open} onClose={onClose} slide>
      <div className="p-5">
        <ModalHeader title="CI requests" onClose={onClose} />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show" className="flex gap-1.5">
            {(['pending', 'all'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}
                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition ${tab === t ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                {t === 'pending' ? 'Pending' : 'All'}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {ctx.is_handler && onNewCapacity && <Button size="sm" onClick={onNewCapacity}>Request capacity</Button>}
            <Button size="sm" variant="primary" onClick={onNewAssignment}>Request assignment</Button>
          </div>
        </div>

        {rows === null ? (
          <ListSkeleton count={3} />
        ) : !visible.length ? (
          <EmptyState title={tab === 'pending' ? 'No pending requests' : 'No requests yet'} hint={ctx.full_access ? 'Requests from handlers in your bureau land here for review.' : 'Your capacity and assignment requests appear here with their decisions.'} />
        ) : (
          <ul className="space-y-3">
            {visible.map((r) => {
              const mine = r.requester_id === uid
              const reviewer = ctx.full_access && r.status === 'pending' && !mine
              return (
                <li key={r.id}>
                  <Card pad="sm" className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">{r.kind === 'capacity' ? 'Capacity' : 'Assignment'}</span>
                      <Badge tone={statusTone(r.status)}>{CI_REQUEST_STATUS_LABEL[r.status as keyof typeof CI_REQUEST_STATUS_LABEL] ?? r.status}</Badge>
                      {r.bureau && <Badge tone="neutral">{bureauShort(r.bureau)}</Badge>}
                      <time dateTime={r.created_at} title={fmtDateTime(r.created_at)} className="ml-auto text-[11px] text-slate-400">{timeAgo(r.created_at)}</time>
                    </div>
                    <p className="text-xs text-slate-400">
                      {mine ? 'You' : officerName(r.requester_id) ?? 'Member'}
                      {r.kind === 'capacity' && r.requested_capacity != null && <> · currently {r.current_count} active, asks for <span className="font-semibold text-slate-200">{r.requested_capacity}</span></>}
                      {r.kind === 'assignment' && <> · currently {r.current_count} active{r.estimated_risk ? ` · risk ${riskLabel(r.estimated_risk).toLowerCase()}` : ''}{r.proposed_motive ? ` · ${(CI_MOTIVE_LABEL as Record<string, string>)[r.proposed_motive] ?? r.proposed_motive}` : ''}</>}
                    </p>
                    <p className="text-sm text-slate-200">{r.reason}</p>
                    {r.operational_need && <p className="text-xs text-slate-300"><span className="text-slate-400">Need:</span> {r.operational_need}</p>}
                    {r.expected_usefulness && <p className="text-xs text-slate-300"><span className="text-slate-400">Usefulness:</span> {r.expected_usefulness}</p>}
                    {r.comments && <p className="text-xs text-slate-300"><span className="text-slate-400">Comments:</span> {r.comments}</p>}
                    {r.decision_note && (
                      <p className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-200">
                        <span className="font-semibold">{officerName(r.decided_by) ?? 'Reviewer'}:</span> {r.decision_note}
                        {r.decided_at && <span className="text-slate-400"> · {fmtDateTime(r.decided_at)}</span>}
                      </p>
                    )}
                    {r.created_ci_id && (
                      <Button size="sm" onClick={() => onOpenCi(ciHref(r.created_ci_id!))}>Open the new source</Button>
                    )}
                    {(reviewer || (mine && r.status === 'pending')) && (
                      <div className="flex flex-wrap justify-end gap-2 pt-1">
                        {mine && r.status === 'pending' && <Button size="sm" onAction={() => withdraw(r)}>Withdraw</Button>}
                        {reviewer && (
                          <>
                            <Button size="sm" onClick={() => setDeciding({ row: r, decision: 'returned' })}>Return</Button>
                            <Button size="sm" variant="danger" onClick={() => setDeciding({ row: r, decision: 'denied' })}>Deny</Button>
                            <Button size="sm" variant="success" onClick={() => setDeciding({ row: r, decision: 'approved' })}>Approve</Button>
                          </>
                        )}
                      </div>
                    )}
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {deciding && (
        <DecideDialog
          row={deciding.row}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={() => { setDeciding(null); void refresh(); onChanged?.() }}
        />
      )}
    </Modal>
  )
}

function DecideDialog({ row, decision, onClose, onDone }: { row: CiRequestRow; decision: Decision; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [cap, setCap] = useState(String(row.requested_capacity ?? ''))
  const [expires, setExpires] = useState('')
  const [err, setErr] = useState<string | undefined>()
  const capacityApproval = decision === 'approved' && row.kind === 'capacity'
  const label = decision === 'approved' ? 'Approve' : decision === 'denied' ? 'Deny' : 'Return'

  const submit = async () => {
    if (decision !== 'approved' && note.trim().length < 3) { setErr('A note is required to deny or return.'); return }
    const n = capacityApproval ? Number(cap) : null
    if (capacityApproval && (!Number.isInteger(n) || (n as number) < 1 || (n as number) > CI_MAX_CAPACITY)) { setErr(`Capacity must be 1–${CI_MAX_CAPACITY}.`); return }
    setErr(undefined)
    const r = await ciRequestDecide(row.id, decision, note.trim() || null, n, expires ? new Date(expires).toISOString() : null)
    if (ciRefused(r)) return
    toast(`Request ${decision}.`, decision === 'approved' ? 'success' : 'info')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => note.trim() !== ''}>
      <div className="p-5">
        <ModalHeader title={`${label} request`} onClose={onClose} />
        <div className="space-y-3">
          {capacityApproval && (
            <>
              <p className="text-sm text-slate-300">
                {officerName(row.requester_id) ?? 'The handler'} holds {capacityLabel(row.current_count, row.requested_capacity ?? 0).replace(/\/ \d+/, `/ ${row.requested_capacity ?? '?'} requested`)}.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="New capacity" required error={err && !note && cap ? err : undefined}>
                  {(id) => <Input id={id} type="number" min={1} max={CI_MAX_CAPACITY} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} />}
                </Field>
                <Field label="Expires (optional)">
                  {(id) => <Input id={id} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />}
                </Field>
              </div>
            </>
          )}
          {decision === 'approved' && row.kind === 'assignment' && (
            <p className="text-sm text-slate-300">
              {row.proposed_person_id
                ? 'Approving designates the proposed person as a new source with the requester as primary handler — with a capacity override if they are full.'
                : 'No person was proposed; approving records the decision only.'}
            </p>
          )}
          <Field label={decision === 'approved' ? 'Note (optional)' : 'Note'} required={decision !== 'approved'} error={err && (decision !== 'approved' || !capacityApproval) ? err : undefined}>
            {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} invalid={!!err && note.trim().length < 3 && decision !== 'approved'} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={decision === 'approved' ? 'success' : decision === 'denied' ? 'danger' : 'warn'} onAction={submit}>{label}</Button>
        </div>
      </div>
    </Modal>
  )
}

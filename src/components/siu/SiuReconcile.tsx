'use client'

/** Reconcile queue — the honest residue of compartmentation against a live
 *  registry (P2-03). When CID creates a record that collides with one SIB has
 *  hidden (same plate, same phone, same name…), CID's insert succeeds (the
 *  partial unique index does not see the hidden row — nothing leaks) and a
 *  queue row lands here, visible to SIB only. An agent decides:
 *   · Link — the two are related; both stay, the relationship is recorded.
 *   · Dismiss — a coincidence.
 *   · Merge into compartment (SIB command only, reason required) — the CID
 *     copy becomes a tombstone pointing at the hidden record, so CID loses
 *     sight of what it wrote; that is why it is the guarded option.
 *  RLS and `siu_reconcile_resolve` are the authority; the standing check
 *  here only decides which button to draw. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { listReconcileQueue, refusalText, resolveReconcile } from '@/lib/entity'
import { fmtDateTime } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiPrompt } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { SectionHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { signalLabel } from '@/components/entity/labels'

type QueueRow = Tables<'siu_reconcile_queue'>

const KIND_LABEL: Record<string, string> = { person: 'Person', vehicle: 'Vehicle', gang: 'Organisation', place: 'Place' }
const RESOLUTION_LABEL: Record<string, string> = { link: 'Linked', merge: 'Merged into compartment', dismiss: 'Dismissed' }

export function SiuReconcileSection() {
  const { perms } = usePermissions()
  const canMerge = perms.sib_standing === 'owner' || perms.sib_standing === 'special_agent_in_charge'
  return <SiuReconcilePanel canMerge={canMerge} />
}

export function SiuReconcilePanel({ canMerge }: { canMerge: boolean }) {
  const [rows, setRows] = useState<QueueRow[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [merging, setMerging] = useState<QueueRow | null>(null)

  const load = useCallback(async () => {
    try { setRows(await listReconcileQueue(true)) } catch { setRows([]) }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => { await Promise.resolve(); if (live) await load() })()
    return () => { live = false }
  }, [load])

  const resolve = async (row: QueueRow, resolution: 'link' | 'dismiss') => {
    const note = await uiPrompt(
      resolution === 'link'
        ? 'Both records stay. The relationship is recorded on the SIB side only — CID keeps seeing its own record and nothing else.'
        : 'A coincidence: nothing changes for either record.',
      { title: resolution === 'link' ? 'Link the two records' : 'Dismiss this match', placeholder: 'Optional note', confirmText: resolution === 'link' ? 'Link' : 'Dismiss' },
    )
    if (note === null) return
    setBusyId(row.id)
    const res = await resolveReconcile(row.id, resolution, note.trim() || null)
    setBusyId(null)
    if (res.error || !res.data) { toast(res.error?.message ?? 'Not recorded.', 'danger'); return }
    if (!res.data.ok) { toast(refusalText(res.data), 'danger'); return }
    toast('Recorded.', 'success')
    await load()
  }

  if (rows === null) return <ListSkeleton count={3} />
  const open = rows.filter((r) => !r.resolved_at)
  const resolved = rows.filter((r) => r.resolved_at)

  return (
    <Card>
      <SectionHeader
        title="Reconcile"
        subtitle="CID records that collide with something compartmented here. CID sees only its own copy."
        actions={open.length ? <Badge tone="warn">{open.length}</Badge> : undefined}
      />

      {open.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Nothing to reconcile.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {open.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 bg-ink-900 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                <Badge tone="warn">{signalLabel(r.signal)}</Badge>
                <span className="text-xs text-slate-400">{fmtDateTime(r.created_at)}</span>
                <span className="ml-auto flex flex-wrap gap-2">
                  <Button size="sm" disabled={busyId === r.id} onClick={() => void resolve(r, 'dismiss')}>Dismiss</Button>
                  <Button size="sm" variant="primary" loading={busyId === r.id} onClick={() => void resolve(r, 'link')}>Link</Button>
                  {canMerge && <Button size="sm" variant="danger" disabled={busyId === r.id} onClick={() => setMerging(r)}>Merge into compartment</Button>}
                </span>
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">CID record</dt>
                  <dd className="text-slate-200">{r.cid_label || r.cid_record_id}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Compartmented record</dt>
                  <dd className="text-slate-200">{r.hidden_label || r.hidden_record_id}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-200">Resolved ({resolved.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {resolved.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-ink-900/60 px-3 py-2 text-xs text-slate-400">
                <Badge tone="neutral">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                <span className="text-slate-300">{r.cid_label || r.cid_record_id}</span>
                <span>· {RESOLUTION_LABEL[r.resolution ?? ''] ?? r.resolution}</span>
                <span>· {officerName(r.resolved_by) ?? 'somebody'} · {fmtDateTime(r.resolved_at)}</span>
                {r.note && <span className="w-full text-slate-500">{r.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {merging && (
        <MergeIntoCompartment row={merging} onClose={() => setMerging(null)} onDone={() => { void load() }} />
      )}
    </Card>
  )
}

function MergeIntoCompartment({ row, onClose, onDone }: { row: QueueRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const go = async () => {
    if (!reason.trim()) return
    setBusy(true)
    const res = await resolveReconcile(row.id, 'merge', reason.trim())
    setBusy(false)
    if (res.error || !res.data) { toast(res.error?.message ?? 'Merge failed.', 'danger'); return }
    if (!res.data.ok) { toast(refusalText(res.data), 'danger'); return }
    toast('Merged. The CID copy is now a tombstone.', 'success')
    onDone()
    onClose()
  }

  return (
    <Modal open onClose={onClose} dirty={() => reason.trim().length > 0}>
      <div className="p-6">
        <ModalHeader title="Merge into the compartment" onClose={onClose} />
        <p className="text-sm leading-relaxed text-slate-300">
          The CID record <span className="font-semibold text-white">{row.cid_label || row.cid_record_id}</span> becomes a
          read-only tombstone pointing at the compartmented record. Its links move across. CID loses sight of what it
          wrote — from their side the record simply disappears. Reversible for 30 days through the merge ledger.
        </p>
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void go() }}>
          <Field label="Why" required hint="Recorded permanently against your name.">
            {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Same subject; CID's intake duplicates our target file." />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!reason.trim()}>Merge</Button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

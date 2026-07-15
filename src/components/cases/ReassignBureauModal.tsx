'use client'

/** Bureau reassignment modal — the client face of `case_reassign_bureau`
 *  (migration 20260725010000). cases.bureau / originating_bureau are frozen
 *  against direct writes by trg_block_direct_case_bureau, so this modal never
 *  patches the case; the RPC is the only path. Visibility of the trigger
 *  button (CaseDetail) mirrors the server rule — Deputy Director+/Owner —
 *  but is cosmetic: the RPC re-validates the caller and every rule.
 *
 *  Destinations are the permanent bureaus only. 'JTF' is deliberately not
 *  offered (and the server rejects it): bureau='JTF' means visible to every
 *  active member, so it can never be a reassignment destination. */
import { useEffect, useState } from 'react'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { rpc } from '@/lib/db'
import { bureauLabel, PERMANENT_BUREAUS } from '@/lib/roles'
import { toast } from '@/lib/toast'
import type { CaseRow } from './tabs/shared'

export interface ReassignBureauModalProps {
  open: boolean
  c: CaseRow
  onClose: () => void
  onDone: () => void
}

export function ReassignBureauModal({ open, c, onClose, onDone }: ReassignBureauModalProps) {
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const [updateOriginating, setUpdateOriginating] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) queueMicrotask(() => { setTo(''); setReason(''); setUpdateOriginating(false) })
  }, [open])

  const options = PERMANENT_BUREAUS.filter((b) => b !== c.bureau)
  // The provenance choice only exists when there is provenance to move —
  // joint-history cases carry originating_bureau; everything else passes the
  // server default (preserve).
  const hasProvenance = !!c.originating_bureau || c.is_joint_case

  const run = async () => {
    if (!to || !reason.trim() || busy) return
    setBusy(true)
    const res = await rpc('case_reassign_bureau', {
      p_case: c.id,
      p_to_bureau: to as CaseRow['bureau'],
      p_reason: reason.trim(),
      ...(updateOriginating ? { p_update_originating: true } : {}),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`Case reassigned to ${bureauLabel(to)}.`, 'success')
    onDone()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => !!(to || reason.trim())}>
      <div className="p-5">
        <ModalHeader title="Reassign bureau" onClose={onClose} />
        <p className="text-sm text-slate-300">
          Move <span className="font-mono font-bold text-white">{c.case_number}</span> out of{' '}
          <span className="text-slate-200">{bureauLabel(c.bureau)}</span> into another bureau. The case, its
          reports, evidence, and tasks follow; officers on the case are notified. The action is recorded in the
          audit log with your reason.
        </p>
        <label className="mt-4 block text-sm text-slate-300">Destination bureau
          <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white">
            <option value="">Select a bureau…</option>
            {options.map((b) => <option key={b} value={b}>{b} — {bureauLabel(b)}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-sm text-slate-300">Reason (required)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why this case belongs to the destination bureau" className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
        </label>
        {hasProvenance && (
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={updateOriginating} onChange={(e) => setUpdateOriginating(e.target.checked)} className="mt-1" />
            <span>
              Also set the originating department to the destination. Leave unchecked to preserve{' '}
              <span className="text-slate-200">{bureauLabel(c.originating_bureau ?? c.bureau)}</span> as the
              responsible bureau of record (joint-case history and legal routing key off it).
            </span>
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-60">Cancel</button>
          <button onClick={() => void run()} disabled={busy || !to || !reason.trim()} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Reassigning…' : 'Reassign case'}</button>
        </div>
      </div>
    </Modal>
  )
}

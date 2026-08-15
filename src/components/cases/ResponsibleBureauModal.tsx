'use client'

/** Responsible-bureau modal — the client face of `resolve_case_originating_bureau`
 *  (migration 20260815120000). `cases.bureau = 'JTF'` is an OPERATIONAL
 *  assignment; legal routing rides `cases.originating_bureau` (the responsible
 *  bureau — always LSB/BCB/SAB). Both columns are frozen against direct writes
 *  by trg_block_direct_case_bureau, so this modal never patches the case; the
 *  RPC is the only path. Two modes, mirroring the server bar: SET a missing
 *  value (Senior Detective+), CHANGE an already-set one (Deputy Director+/
 *  Owner, reason required). The gating here is cosmetic — the RPC re-validates
 *  the caller and every rule. */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { rpc } from '@/lib/db'
import { CID_ROUTING_BUREAUS, isRoutingBureau } from '@/lib/legalWorkflow'
import { bureauLabel } from '@/lib/roles'
import { toast } from '@/lib/toast'
import type { CaseRow } from './tabs/shared'

export interface ResponsibleBureauModalProps {
  open: boolean
  c: CaseRow
  onClose: () => void
  /** Called with the updated case row the RPC returns. */
  onDone: (updated: CaseRow) => void
}

export function ResponsibleBureauModal({ open, c, onClose, onDone }: ResponsibleBureauModalProps) {
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) queueMicrotask(() => { setTo(''); setReason('') })
  }, [open])

  // Change mode: a valid responsible bureau is already recorded — the server
  // demands Deputy Director+ AND a reason; setting a missing one does not.
  const changing = isRoutingBureau(c.originating_bureau)
  const options = CID_ROUTING_BUREAUS.filter((b) => b !== c.originating_bureau)

  const run = async () => {
    if (!to || busy || (changing && !reason.trim())) return
    setBusy(true)
    const res = await rpc('resolve_case_originating_bureau', {
      p_case: c.id,
      p_bureau: to as CaseRow['bureau'],
      ...(changing ? { p_reason: reason.trim() } : {}),
    })
    setBusy(false)
    if (res.error || !res.data) { toast(res.error?.message ?? 'Could not save the responsible bureau.', 'danger'); return }
    toast(`Responsible bureau ${changing ? 'changed' : 'set'} to ${bureauLabel(to)}.`, 'success')
    onDone(res.data)
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => !!(to || reason.trim())}>
      <div className="p-5">
        <ModalHeader title={changing ? 'Change responsible bureau' : 'Set responsible bureau'} onClose={onClose} />
        <p className="text-sm text-slate-300">
          <span className="font-mono font-bold text-white">{c.case_number}</span> is assigned to{' '}
          <span className="text-slate-200">JTF (operational)</span>
          {changing ? (
            <> and currently routes its legal requests through <span className="text-slate-200">{bureauLabel(c.originating_bureau)}</span>.</>
          ) : (
            <> with no responsible bureau on record.</>
          )}{' '}
          The responsible bureau routes the case&apos;s legal requests — its Bureau Lead reviews them. The
          action is recorded in the audit log.
        </p>
        <label className="mt-4 block text-sm text-slate-300">Responsible bureau
          <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white">
            <option value="">Select a bureau…</option>
            {options.map((b) => <option key={b} value={b}>{b} — {bureauLabel(b)}</option>)}
          </select>
        </label>
        {changing && (
          <label className="mt-3 block text-sm text-slate-300">Reason (required)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why legal routing moves to the new bureau" className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy || !to || (changing && !reason.trim())}>
            {busy ? 'Saving…' : changing ? 'Change responsible bureau' : 'Set responsible bureau'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

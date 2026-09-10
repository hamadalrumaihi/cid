'use client'

/** Ask for a higher personal capacity → `ci_capacity_request_submit`
 *  (kind 'capacity'; a current handler only). Current `n / c` is read-only;
 *  the request must exceed it and stay ≤ 30; one pending per requester. The
 *  bureau's leads, every deputy director / director and SIB command review. */
import { useState } from 'react'
import type { EntityHit } from '@/lib/entitySearch'
import { toast } from '@/lib/toast'
import { CI_MAX_CAPACITY, capacityLabel, ciRequestSubmit, ciRefused } from '@/lib/ci'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { CasePicker } from './ciShared'

export function CapacityRequestDialog({ open, onClose, active, capacity, onSaved }: {
  open: boolean
  onClose: () => void
  active: number
  capacity: number
  onSaved?: () => void
}) {
  const [requested, setRequested] = useState(String(Math.min(CI_MAX_CAPACITY, capacity + 1)))
  const [reason, setReason] = useState('')
  const [need, setNeed] = useState('')
  const [caseHit, setCaseHit] = useState<EntityHit | null>(null)
  const [comments, setComments] = useState('')
  const [err, setErr] = useState<{ requested?: string; reason?: string }>({})

  const submit = async () => {
    const n = Number(requested)
    const e: typeof err = {}
    if (!Number.isInteger(n) || n <= capacity || n > CI_MAX_CAPACITY) e.requested = `Between ${capacity + 1} and ${CI_MAX_CAPACITY}.`
    if (reason.trim().length < 3) e.reason = 'A reason is required.'
    setErr(e)
    if (e.requested || e.reason) return
    const r = await ciRequestSubmit({
      kind: 'capacity', reason: reason.trim(), requestedCapacity: n, operationalNeed: need.trim() || null,
      caseId: caseHit?.id ?? null, comments: comments.trim() || null,
    })
    if (ciRefused(r)) return
    toast('Capacity request submitted for review.', 'success')
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => reason !== '' || need !== '' || comments !== ''}>
      <div className="p-5">
        <ModalHeader title="Request additional capacity" onClose={onClose} />
        <div className="space-y-3">
          <div className="rounded-lg border border-white/10 bg-ink-900/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Current</p>
            <p className="text-lg font-bold tabular-nums text-white">{capacityLabel(active, capacity)}</p>
          </div>
          <Field label="Requested capacity" required error={err.requested} hint={`Normal limit ${capacity}; the maximum anyone may hold is ${CI_MAX_CAPACITY}.`}>
            {(id) => <Input id={id} type="number" min={capacity + 1} max={CI_MAX_CAPACITY} inputMode="numeric" value={requested} onChange={(e) => setRequested(e.target.value)} invalid={!!err.requested} required />}
          </Field>
          <Field label="Reason" required error={err.reason}>
            {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!err.reason} placeholder="Why the normal capacity is not enough" />}
          </Field>
          <Field label="Operational need">
            {(id) => <Textarea id={id} rows={2} value={need} onChange={(e) => setNeed(e.target.value)} placeholder="The investigation or operation this supports" />}
          </Field>
          <CasePicker value={caseHit} onChange={setCaseHit} />
          <Field label="Comments">
            {(id) => <Textarea id={id} rows={2} value={comments} onChange={(e) => setComments(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={submit}>Submit request</Button>
        </div>
      </div>
    </Modal>
  )
}

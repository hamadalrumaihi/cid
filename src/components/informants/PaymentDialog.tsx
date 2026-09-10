'use client'

/** Record a payment to a source → `ci_payment_record`. Recordkeeping only:
 *  `approved_by` is stamped server-side when the recorder has full access;
 *  otherwise full access approves later from the Payments section. */
import { useState } from 'react'
import type { EntityHit } from '@/lib/entitySearch'
import { todayISO } from '@/lib/format'
import { toast } from '@/lib/toast'
import { ciPaymentRecord, ciRefused, type CiIntelRow } from '@/lib/ci'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { CasePicker } from './ciShared'

export function PaymentDialog({ open, onClose, ciId, intelOptions, onSaved }: {
  open: boolean
  onClose: () => void
  ciId: string
  /** The source's intelligence rows, to tie the payment to a product. */
  intelOptions?: CiIntelRow[]
  onSaved?: () => void
}) {
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(todayISO)
  const [reason, setReason] = useState('')
  const [intelId, setIntelId] = useState('')
  const [caseHit, setCaseHit] = useState<EntityHit | null>(null)
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState<{ amount?: string; reason?: string }>({})

  const submit = async () => {
    const n = Number(amount)
    const e: typeof err = {}
    if (!Number.isFinite(n) || n < 0) e.amount = 'Enter a non-negative amount.'
    if (reason.trim().length < 3) e.reason = 'A reason is required.'
    setErr(e)
    if (e.amount || e.reason) return
    const r = await ciPaymentRecord(ciId, {
      amount: n, paidAt, reason: reason.trim(), intelId: intelId || null, caseId: caseHit?.id ?? null, notes: notes.trim() || null,
    })
    if (ciRefused(r)) return
    toast('Payment recorded.', 'success')
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => amount !== '' || reason !== '' || notes !== ''}>
      <div className="p-5">
        <ModalHeader title="Record payment" onClose={onClose} />
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount (USD)" required error={err.amount}>
              {(id) => <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!err.amount} required />}
            </Field>
            <Field label="Paid on" required>
              {(id) => <Input id={id} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />}
            </Field>
          </div>
          <Field label="Reason" required error={err.reason}>
            {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!err.reason} placeholder="What the payment was for" />}
          </Field>
          {!!intelOptions?.length && (
            <Field label="Related intelligence">
              {(id) => (
                <Select id={id} value={intelId} onChange={(e) => setIntelId(e.target.value)}>
                  <option value="">None</option>
                  {intelOptions.map((i) => <option key={i.id} value={i.id}>{i.summary.slice(0, 80)}</option>)}
                </Select>
              )}
            </Field>
          )}
          <CasePicker value={caseHit} onChange={setCaseHit} />
          <Field label="Notes">
            {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={submit}>Record payment</Button>
        </div>
      </div>
    </Modal>
  )
}

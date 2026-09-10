'use client'

/** Change a source's status → `ci_set_status` (full access only; the server
 *  raises P0403 for anyone else). Leaving `active` frees the handler's
 *  capacity by derivation. `compromised` is the one alarm: it notifies the
 *  handlers, the supervising lead and CI command, so it asks twice. */
import { useState } from 'react'
import { toast } from '@/lib/toast'
import { CI_STATUSES, CI_STATUS_LABEL, ciRefused, ciSetStatus, type CiStatus } from '@/lib/ci'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

export function StatusDialog({ open, onClose, ciId, ciNumber, current, onSaved }: {
  open: boolean
  onClose: () => void
  ciId: string
  ciNumber: string
  current: string
  onSaved?: () => void
}) {
  const [status, setStatus] = useState<CiStatus>((CI_STATUSES as readonly string[]).includes(current) ? (current as CiStatus) : 'active')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | undefined>()
  const [confirmed, setConfirmed] = useState(false)
  const alarming = status === 'compromised'

  const submit = async () => {
    if (reason.trim().length < 3) { setErr('A reason of at least 3 characters is required.'); return }
    if (status === current) { setErr('Pick a different status.'); return }
    if (alarming && !confirmed) { setErr('Confirm the compromise below.'); return }
    setErr(undefined)
    const r = await ciSetStatus(ciId, status, reason.trim())
    if (ciRefused(r)) return
    toast(`${ciNumber} is now ${CI_STATUS_LABEL[status].toLowerCase()}.`, alarming ? 'warn' : 'success')
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => reason.trim() !== ''}>
      <div className="p-5">
        <ModalHeader title={`Change status — ${ciNumber}`} onClose={onClose} />
        <div className="space-y-3">
          <Field label="New status" required>
            {(id) => (
              <Select id={id} value={status} onChange={(e) => { setStatus(e.target.value as CiStatus); setConfirmed(false) }}>
                {CI_STATUSES.map((s) => <option key={s} value={s}>{CI_STATUS_LABEL[s]}{s === current ? ' (current)' : ''}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Reason" required error={err}>
            {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!err} placeholder="Recorded on the status change" />}
          </Field>
          {alarming && (
            <div className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4" role="alert">
              <p className="text-sm font-semibold text-rose-200">Marking {ciNumber} compromised</p>
              <p className="text-sm text-slate-200">
                Every active handler, the supervising lead and CI command are notified immediately. The source&apos;s
                intelligence stays restricted; nothing is declassified.
              </p>
              <label className="flex min-h-11 items-center gap-2 text-sm text-slate-100">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4" />
                I confirm the source is compromised.
              </label>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={alarming ? 'danger' : 'primary'} onAction={submit}>
            {alarming ? 'Mark compromised' : 'Change status'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

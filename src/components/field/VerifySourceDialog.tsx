'use client'

/** Analyst verification — status + reliability + a note, through
 *  `external_source_verify` (audited). Verifying records an assessment of
 *  the source; it changes nothing on any registry record. */
import { useState } from 'react'
import {
  RELIABILITIES, VERIFICATION_STATUSES, reliabilityLabel, verificationLabel, verifySource,
  type Reliability, type SourceRow, type VerificationStatus,
} from '@/lib/externalSources'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

export function VerifySourceDialog({ open, onClose, source, onVerified }: {
  open: boolean
  onClose: () => void
  source: SourceRow
  onVerified: () => void
}) {
  const [status, setStatus] = useState<VerificationStatus>(
    (VERIFICATION_STATUSES as readonly string[]).includes(source.verification_status) && source.verification_status !== 'unverified'
      ? (source.verification_status as VerificationStatus) : 'verified',
  )
  const [reliability, setReliability] = useState<Reliability>(
    (RELIABILITIES as readonly string[]).includes(source.reliability) ? (source.reliability as Reliability) : 'unknown',
  )
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const res = await verifySource(source.id, status, reliability, notes)
    setBusy(false)
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast(`${source.source_number} marked ${verificationLabel(status).toLowerCase()}.`, 'success')
    onVerified()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => !!notes.trim()}>
      <form className="p-6" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <ModalHeader title={`Verify ${source.source_number}`} onClose={onClose} />
        <p className="mb-4 text-sm text-slate-400">
          Record your assessment of this source. Verification never updates a person, vehicle or any other registry record — it only says how far this page can be trusted.
        </p>
        <div className="space-y-3">
          <Field label="Verification">
            {(id) => (
              <Select id={id} name="verification" value={status} onChange={(e) => setStatus(e.target.value as VerificationStatus)}>
                {VERIFICATION_STATUSES.map((s) => <option key={s} value={s}>{verificationLabel(s)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Reliability">
            {(id) => (
              <Select id={id} name="reliability" value={reliability} onChange={(e) => setReliability(e.target.value as Reliability)}>
                {RELIABILITIES.map((r) => <option key={r} value={r}>{reliabilityLabel(r)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Assessment note (optional)">
            {(id) => (
              <Textarea id={id} name="notes" rows={3} autoComplete="off" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="What you checked and against what…" />
            )}
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Save assessment</Button>
        </div>
      </form>
    </Modal>
  )
}

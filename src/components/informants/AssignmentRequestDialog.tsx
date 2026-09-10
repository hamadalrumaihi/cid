'use client'

/** Propose a new source when at capacity (or without CI standing) →
 *  `ci_capacity_request_submit` (kind 'assignment'; any active member). An
 *  approved request with a proposed person becomes a CI with the requester as
 *  primary — the reviewer's approval carries the capacity override. */
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import type { Database } from '@/lib/database.types'
import type { EntityHit } from '@/lib/entitySearch'
import { toast } from '@/lib/toast'
import { CI_MOTIVES, CI_MOTIVE_LABEL, CI_RISK, CI_RISK_LABEL, ciRequestSubmit, ciRefused } from '@/lib/ci'
import { BUREAUS } from '@/lib/roles'
import { EntityPicker } from '@/components/entity/EntityPicker'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { CasePicker } from './ciShared'

type Bureau = Database['public']['Enums']['bureau']

export function AssignmentRequestDialog({ open, onClose, onSaved }: {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const { profile } = useAuth()
  const [person, setPerson] = useState<EntityHit | null>(null)
  const [reason, setReason] = useState('')
  const [usefulness, setUsefulness] = useState('')
  const [bureau, setBureau] = useState<string>(profile?.division ?? '')
  const [caseHit, setCaseHit] = useState<EntityHit | null>(null)
  const [risk, setRisk] = useState('medium')
  const [motive, setMotive] = useState('')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState<string | undefined>()

  const submit = async () => {
    if (reason.trim().length < 3) { setErr('A reason is required.'); return }
    setErr(undefined)
    const r = await ciRequestSubmit({
      kind: 'assignment', reason: reason.trim(), proposedPerson: person?.id ?? null,
      expectedUsefulness: usefulness.trim() || null, bureau: (bureau || null) as Bureau | null,
      caseId: caseHit?.id ?? null, estimatedRisk: risk || null, proposedMotive: motive || null, comments: notes.trim() || null,
    })
    if (ciRefused(r)) return
    toast('Assignment request submitted for review.', 'success')
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => reason !== '' || usefulness !== '' || notes !== '' || !!person}>
      <div className="p-5">
        <ModalHeader title="Request an assignment" onClose={onClose} />
        <div className="space-y-3">
          <EntityPicker kind="person" label="Proposed person" value={person} onChange={setPerson}
            hint="Optional at this stage; a person is needed before approval can designate them." />
          <Field label="Reason" required error={err}>
            {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!err} placeholder="Why this source should be designated to you" />}
          </Field>
          <Field label="Expected usefulness">
            {(id) => <Textarea id={id} rows={2} value={usefulness} onChange={(e) => setUsefulness(e.target.value)} placeholder="What the source can provide" />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bureau">
              {(id) => (
                <Select id={id} value={bureau} onChange={(e) => setBureau(e.target.value)}>
                  <option value="">Unspecified</option>
                  {Object.entries(BUREAUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Estimated risk">
              {(id) => (
                <Select id={id} value={risk} onChange={(e) => setRisk(e.target.value)}>
                  {CI_RISK.map((r) => <option key={r} value={r}>{CI_RISK_LABEL[r]}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Proposed motive">
            {(id) => (
              <Select id={id} value={motive} onChange={(e) => setMotive(e.target.value)}>
                <option value="">Unknown</option>
                {CI_MOTIVES.map((m) => <option key={m} value={m}>{CI_MOTIVE_LABEL[m]}</option>)}
              </Select>
            )}
          </Field>
          <CasePicker value={caseHit} onChange={setCaseHit} />
          <Field label="Notes">
            {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
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

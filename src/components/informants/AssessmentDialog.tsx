'use client'

/** Periodic source assessment → `ci_assess`. The server copies reliability
 *  and risk onto the CI row, so the roster reflects the latest grading. */
import { useState } from 'react'
import { toast } from '@/lib/toast'
import {
  CI_ASSESSMENT_LABEL, CI_ASSESSMENT_SCALE, CI_RELIABILITY, CI_RELIABILITY_LABEL, CI_RISK, CI_RISK_LABEL,
  ciAssess, ciRefused, type CiAssessmentRow,
} from '@/lib/ci'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

export function AssessmentDialog({ open, onClose, ciId, previous, onSaved }: {
  open: boolean
  onClose: () => void
  ciId: string
  /** The latest assessment — prefills the grades so a review edits, not retypes. */
  previous?: CiAssessmentRow | null
  onSaved?: () => void
}) {
  const [reliability, setReliability] = useState(previous?.reliability ?? 'unknown')
  const [credibility, setCredibility] = useState(previous?.credibility ?? 'unknown')
  const [access, setAccess] = useState(previous?.access ?? 'unknown')
  const [risk, setRisk] = useState(previous?.risk ?? 'medium')
  const [compromise, setCompromise] = useState(previous?.compromise_likelihood ?? 'unknown')
  const [usefulness, setUsefulness] = useState(previous?.usefulness ?? 'unknown')
  const [note, setNote] = useState('')

  const grade = (label: string, value: string, set: (v: string) => void) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => set(e.target.value)}>
          {CI_ASSESSMENT_SCALE.map((g) => <option key={g} value={g}>{CI_ASSESSMENT_LABEL[g]}</option>)}
        </Select>
      )}
    </Field>
  )

  const submit = async () => {
    const r = await ciAssess(ciId, { reliability, credibility, access, risk, compromiseLikelihood: compromise, usefulness, note: note.trim() || null })
    if (ciRefused(r)) return
    toast('Assessment recorded.', 'success')
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => note.trim() !== ''}>
      <div className="p-5">
        <ModalHeader title="Assess source" onClose={onClose} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reliability" hint="How the source has held up over time.">
            {(id) => (
              <Select id={id} value={reliability} onChange={(e) => setReliability(e.target.value)}>
                {CI_RELIABILITY.map((g) => <option key={g} value={g}>{CI_RELIABILITY_LABEL[g]}</option>)}
              </Select>
            )}
          </Field>
          {grade('Credibility', credibility, setCredibility)}
          {grade('Access', access, setAccess)}
          <Field label="Risk">
            {(id) => (
              <Select id={id} value={risk} onChange={(e) => setRisk(e.target.value)}>
                {CI_RISK.map((g) => <option key={g} value={g}>{CI_RISK_LABEL[g]}</option>)}
              </Select>
            )}
          </Field>
          {grade('Compromise likelihood', compromise, setCompromise)}
          {grade('Usefulness', usefulness, setUsefulness)}
        </div>
        <Field label="Note" className="mt-3">
          {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed since the last assessment" />}
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={submit}>Record assessment</Button>
        </div>
      </div>
    </Modal>
  )
}

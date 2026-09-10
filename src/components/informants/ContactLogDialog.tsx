'use client'

/** Log a contact with a source → `ci_contact_log`. The handler is the caller
 *  (server-stamped); the case, if any, must be readable by the caller (the
 *  picker is RLS-scoped, the RPC re-checks). Opened from a profile (ciId) or
 *  from the roster's "Log Contact" action (pick one of MY sources). */
import { useState } from 'react'
import type { EntityHit } from '@/lib/entitySearch'
import { toast } from '@/lib/toast'
import { CI_CONTACT_METHODS, CI_CONTACT_METHOD_LABEL, ciContactLog, ciRefused, type CiListRow } from '@/lib/ci'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { CasePicker, fromLocalInput, nowLocalInput } from './ciShared'

export function ContactLogDialog({ open, onClose, ciId, ciOptions, onSaved }: {
  open: boolean
  onClose: () => void
  /** The source; omit to offer a select over `ciOptions`. */
  ciId?: string | null
  ciOptions?: CiListRow[]
  onSaved?: () => void
}) {
  const [ci, setCi] = useState(ciId ?? '')
  const [occurredAt, setOccurredAt] = useState(nowLocalInput)
  const [method, setMethod] = useState<string>('in_person')
  const [location, setLocation] = useState('')
  const [summary, setSummary] = useState('')
  const [followUp, setFollowUp] = useState(false)
  const [nextAt, setNextAt] = useState('')
  const [caseHit, setCaseHit] = useState<EntityHit | null>(null)
  const [restricted, setRestricted] = useState('')
  const [err, setErr] = useState<string | undefined>()

  const target = ciId ?? ci
  const dirty = () => summary.trim() !== '' || location !== '' || restricted !== ''

  const submit = async () => {
    if (!target) { setErr('Choose a source.'); return }
    if (summary.trim().length < 3) { setErr('A summary is required.'); return }
    const occurred = fromLocalInput(occurredAt)
    if (!occurred) { setErr('When did the contact happen?'); return }
    setErr(undefined)
    const r = await ciContactLog(target, {
      occurredAt: occurred, method, summary: summary.trim(), location: location.trim() || null,
      followUpRequired: followUp, nextContactAt: fromLocalInput(nextAt), caseId: caseHit?.id ?? null,
      restrictedNotes: restricted.trim() || null,
    })
    if (ciRefused(r)) return
    toast('Contact logged.', 'success')
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={dirty}>
      <div className="p-5">
        <ModalHeader title="Log contact" onClose={onClose} />
        <div className="space-y-3">
          {!ciId && (
            <Field label="Source" required error={!target && err ? err : undefined}>
              {(id) => (
                <Select id={id} value={ci} onChange={(e) => setCi(e.target.value)}>
                  <option value="">Select a source…</option>
                  {(ciOptions ?? []).map((r) => <option key={r.id} value={r.id}>{r.ci_number}{r.alias ? ` · ${r.alias}` : ''}</option>)}
                </Select>
              )}
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="When" required>
              {(id) => <Input id={id} type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />}
            </Field>
            <Field label="Method" required>
              {(id) => (
                <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>
                  {CI_CONTACT_METHODS.map((m) => <option key={m} value={m}>{CI_CONTACT_METHOD_LABEL[m]}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Location">
            {(id) => <Input id={id} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where the meeting took place" />}
          </Field>
          <Field label="Summary" required error={target && err && summary.trim().length < 3 ? err : undefined}>
            {(id) => <Textarea id={id} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} invalid={!!err && summary.trim().length < 3} placeholder="What was discussed, what was tasked" />}
          </Field>
          <CasePicker value={caseHit} onChange={setCaseHit} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} className="h-4 w-4" />
              Follow-up required
            </label>
            <Field label="Next contact">
              {(id) => <Input id={id} type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />}
            </Field>
          </div>
          <Field label="Restricted notes" hint="Handler-only detail; never leaves the compartment.">
            {(id) => <Textarea id={id} rows={2} value={restricted} onChange={(e) => setRestricted(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={submit}>Log contact</Button>
        </div>
      </div>
    </Modal>
  )
}

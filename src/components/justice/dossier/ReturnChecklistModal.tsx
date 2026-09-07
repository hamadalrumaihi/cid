'use client'

/** Return-for-revision capture (P4-06). Replaces the single free-text
 *  prompt: the reviewer writes the return note AND a structured checklist —
 *  rows of `field` (a request form key, or General) + `note` — sent as
 *  `p_revision_items` so the investigator gets a list to work through, not
 *  a paragraph to interpret. Shared by the Bureau Lead / SIB command return
 *  (review_legal_request_as_cid) and the judge's return
 *  (decide_legal_request_as_judge), which adds an optional signature. */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

export interface RevisionItemInput { field: string | null; note: string }
interface DraftRow { field: string; note: string }

export function ReturnChecklistModal({ title, requestNumber, intro, fieldOptions, busy, withSignature = false, onSubmit, onClose }: {
  title: string
  requestNumber: string
  intro?: string
  /** Form keys of the request (title, narrative, pc_statement, charges,
   *  exhibits + the subtype's field keys) — the labels the checklist picks from. */
  fieldOptions: { key: string; label: string }[]
  busy: boolean
  withSignature?: boolean
  onSubmit: (v: { note: string; items: RevisionItemInput[]; signature: string }) => void
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([{ field: '', note: '' }])
  const [signature, setSignature] = useState('')
  const items = rows.filter((r) => r.note.trim()).map((r): RevisionItemInput => ({ field: r.field || null, note: r.note.trim() }))
  const ready = note.trim() !== ''
  const dirty = () => note.trim() !== '' || items.length > 0
  const patch = (i: number, p: Partial<DraftRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  return (
    <Modal open onClose={onClose} wide dirty={dirty}>
      <div className="p-5">
        <ModalHeader title={title} onClose={onClose} />
        <p className="text-sm text-slate-400">
          Request <span className="font-semibold text-slate-200">{requestNumber}</span>.{intro ? ` ${intro}` : ''}
        </p>
        <div className="mt-4 space-y-4">
          <Field label="Return note" required hint="What the investigator needs to change, in plain words.">
            {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-400">
              Revision checklist<span className="ml-1 font-normal text-slate-500">(optional — one row per item to fix)</span>
            </legend>
            {rows.map((r, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
                <Select aria-label={`Field for item ${i + 1}`} value={r.field} onChange={(e) => patch(i, { field: e.target.value })}>
                  <option value="">General</option>
                  {fieldOptions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </Select>
                <Input aria-label={`Note for item ${i + 1}`} value={r.note} placeholder="What must change here" onChange={(e) => patch(i, { note: e.target.value })} />
                <Button variant="ghost" aria-label={`Remove item ${i + 1}`} disabled={rows.length === 1 && !r.note && !r.field} onClick={() => setRows((rs) => rs.length === 1 ? [{ field: '', note: '' }] : rs.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            ))}
            <Button size="sm" onClick={() => setRows((rs) => [...rs, { field: '', note: '' }])}>+ Add item</Button>
          </fieldset>
          {withSignature && (
            <Field label="Signature" hint="Optional — type your name to sign this decision.">
              {(id) => <Input id={id} value={signature} onChange={(e) => setSignature(e.target.value)} autoComplete="off" />}
            </Field>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={busy || !ready} onClick={() => onSubmit({ note: note.trim(), items, signature: signature.trim() })}>
            {busy ? 'Recording…' : 'Return for revision'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

'use client'

/** ObservationForm — record a case-scoped observation about a registry
 *  record ("in this case, his phone was 555-0142") without touching the
 *  master record. The row lands in entity_field_observations under the
 *  case's RLS; promoting it to the record is a separate, reviewed step
 *  (SuggestedUpdates → Promote). Meant for the case tabs; nothing mounts it
 *  yet. `recorded_by` must be the caller (RLS insists), so it reads useAuth. */
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { insert } from '@/lib/db'
import { EDITABLE_FIELDS, type MergeKind } from '@/lib/entity'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { fieldLabel } from './labels'

export interface ObservationFormProps {
  kind: MergeKind
  refId: string
  caseId: string
  onSaved?: () => void
  onCancel?: () => void
}

export function ObservationForm({ kind, refId, caseId, onSaved, onCancel }: ObservationFormProps) {
  const { profile } = useAuth()
  const fields = EDITABLE_FIELDS[kind]
  const [field, setField] = useState<string>(fields[0] ?? '')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!field || !value.trim()) { toast('Pick a field and give the value you observed.', 'warn'); return }
    setBusy(true)
    const res = await insert('entity_field_observations', {
      kind, ref_id: refId, case_id: caseId, field, value: value.trim(),
      note: note.trim() || null, recorded_by: profile?.id ?? null,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Observation recorded on this case.', 'success')
    setValue(''); setNote('')
    onSaved?.()
  }

  return (
    <form className="grid gap-3 rounded-lg border border-white/10 bg-ink-950/40 p-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <Field label="Field" required>
        {(id) => (
          <Select id={id} value={field} onChange={(e) => setField(e.target.value)}>
            {fields.map((f) => <option key={f} value={f}>{fieldLabel(f)}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Observed value" required>
        {(id) => <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} />}
      </Field>
      <div className="sm:col-span-2">
        <Field label="Note" hint="Where this came from — the stop, the interview, the document.">
          {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" loading={busy} disabled={!value.trim()}>Record observation</Button>
        {onCancel && <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}

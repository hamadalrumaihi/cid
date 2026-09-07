'use client'

import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Field'
import type { FormField, FormFieldType, FormGridCol, FormSchema, FormSection } from '@/lib/forms'
import { formValueKeys } from '@/lib/forms'
import { FORM_FIELD_TYPES, FORM_SECTION_TYPES } from '@/lib/reportTemplates'

type SectionType = FormSection['type']

export interface SectionEditorValue {
  schema: FormSchema
  required: string[]
  advisory: string[]
}

const TYPE_LABEL: Record<SectionType, string> = { kv: 'Fields (key / value)', grid: 'Table (rows)', textarea: 'Narrative (long text)', note: 'Note (static text)' }
const FIELD_LABEL: Record<FormFieldType, string> = { text: 'Text', date: 'Date', money: 'Money', select: 'Select', textarea: 'Long text', checks: 'Checkboxes' }

/** Converting a section keeps its id + label and starts the new type fresh. */
function convertSection(s: FormSection, type: SectionType): FormSection {
  if (type === s.type) return s
  const head = { id: s.id, label: s.label }
  if (type === 'kv') return { ...head, type, fields: [{ key: `${s.id}_field`, label: 'Field', type: 'text' }] }
  if (type === 'grid') return { ...head, type, cols: [{ key: 'item', label: 'Item', type: 'text' }] }
  if (type === 'textarea') return { ...head, type, key: s.id }
  return { ...head, type, text: '' }
}

const optsText = (opts?: string[]) => (opts ?? []).join(', ')
const parseOpts = (raw: string) => raw.split(',').map((t) => t.trim())

/** Sections / fields / columns editor over a FormSchema, plus the per-key
 *  required and advisory toggles. Pure UI: the parent owns the draft and
 *  lib/reportTemplates validates the result before it is saved. */
export function TemplateSectionEditor({ schema, required, advisory, onChange }: SectionEditorValue & { onChange: (next: SectionEditorValue) => void }) {
  // Keys that leave the schema (removed / renamed) drop out of the lists —
  // the server refuses a required key it cannot find.
  const setSections = (sections: FormSection[]) => {
    const next = { ...schema, sections }
    const known = new Set(formValueKeys(next).map((k) => k.key))
    onChange({ schema: next, required: required.filter((k) => known.has(k)), advisory: advisory.filter((k) => known.has(k)) })
  }
  const update = (i: number, next: FormSection) => setSections(schema.sections.map((s, idx) => (idx === i ? next : s)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= schema.sections.length) return
    const next = [...schema.sections]
    const tmp = next[i]; next[i] = next[j]; next[j] = tmp
    setSections(next)
  }
  const remove = (i: number) => setSections(schema.sections.filter((_, idx) => idx !== i))
  const add = (type: SectionType) => {
    const id = `section_${schema.sections.length + 1}`
    setSections([...schema.sections, convertSection({ id, label: 'New section', type: 'note', text: '' }, type)])
  }
  // One key is required OR advisory, never both.
  const toggle = (list: 'required' | 'advisory', key: string) => {
    const without = (xs: string[]) => xs.filter((k) => k !== key)
    const on = (list === 'required' ? required : advisory).includes(key)
    if (on) onChange({ schema, required: list === 'required' ? without(required) : required, advisory: list === 'advisory' ? without(advisory) : advisory })
    else onChange({ schema, required: list === 'required' ? [...required, key] : without(required), advisory: list === 'advisory' ? [...advisory, key] : without(advisory) })
  }
  const flags = (key: string) => (
    <span className="flex shrink-0 items-center gap-2 text-xs text-slate-300">
      <label className="inline-flex min-h-9 cursor-pointer items-center gap-1"><input type="checkbox" checked={required.includes(key)} onChange={() => toggle('required', key)} className="accent-rose-500" /> Required</label>
      <label className="inline-flex min-h-9 cursor-pointer items-center gap-1"><input type="checkbox" checked={advisory.includes(key)} onChange={() => toggle('advisory', key)} className="accent-amber-500" /> Advisory</label>
    </span>
  )
  const fieldRow = (f: FormField | FormGridCol, sid: string, i: number, onField: (next: FormField | FormGridCol) => void, onRemove: () => void, withFlags: boolean) => (
    <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-ink-950/40 p-2">
      <Input aria-label={`Key of field ${i + 1} in ${sid}`} value={f.key} onChange={(e) => onField({ ...f, key: e.target.value.trim() })} className="w-36 font-mono text-xs" placeholder="key" />
      <Input aria-label={`Label of field ${i + 1} in ${sid}`} value={f.label} onChange={(e) => onField({ ...f, label: e.target.value })} className="min-w-40 flex-1" placeholder="Label" />
      <Select aria-label={`Type of field ${i + 1} in ${sid}`} value={f.type ?? 'text'} onChange={(e) => onField({ ...f, type: e.target.value as FormFieldType })} className="w-36">
        {FORM_FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_LABEL[t]}</option>)}
      </Select>
      {(f.type === 'select' || f.type === 'checks') && <Input aria-label={`Options of field ${i + 1} in ${sid} (comma separated)`} value={optsText(f.opts)} onChange={(e) => onField({ ...f, opts: parseOpts(e.target.value) })} className="min-w-48 flex-1" placeholder="Options, comma separated" />}
      <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={!!f.person} onChange={(e) => onField({ ...f, person: e.target.checked || undefined })} className="accent-amber-500" /> Person</label>
      {withFlags && flags(f.key)}
      <button type="button" onClick={onRemove} aria-label={`Remove field ${i + 1} from ${sid}`} title="Remove" className="grid h-9 w-9 place-items-center rounded-lg text-rose-300 hover:bg-rose-500/10">✕</button>
    </div>
  )
  return (
    <div className="space-y-3">
      {schema.sections.map((s, i) => (
        <div key={i} className="rounded-lg border border-white/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Id of section ${i + 1}`} value={s.id} onChange={(e) => update(i, { ...s, id: e.target.value.trim() })} className="w-36 font-mono text-xs" placeholder="section_id" />
            <Input aria-label={`Label of section ${i + 1}`} value={s.label} onChange={(e) => update(i, { ...s, label: e.target.value })} className="min-w-40 flex-1" placeholder="Section label" />
            <Select aria-label={`Type of section ${i + 1}`} value={s.type} onChange={(e) => update(i, convertSection(s, e.target.value as SectionType))} className="w-44">
              {FORM_SECTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </Select>
            <span className="flex shrink-0 gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move section ${i + 1} up`} title="Move up" className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-40">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === schema.sections.length - 1} aria-label={`Move section ${i + 1} down`} title="Move down" className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-40">↓</button>
              <button type="button" onClick={() => remove(i)} aria-label={`Remove section ${i + 1}`} title="Remove section" className="grid h-9 w-9 place-items-center rounded-lg text-rose-300 hover:bg-rose-500/10">✕</button>
            </span>
          </div>
          {s.type === 'kv' && (
            <div className="mt-2 space-y-2">
              {s.fields.map((f, j) => fieldRow(f, s.id, j, (next) => update(i, { ...s, fields: s.fields.map((x, k) => (k === j ? (next as FormField) : x)) }), () => update(i, { ...s, fields: s.fields.filter((_, k) => k !== j) }), true))}
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={() => update(i, { ...s, fields: [...s.fields, { key: `${s.id}_${s.fields.length + 1}`, label: 'Field', type: 'text' }] })}>Add field</Button>
                <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={!!s.evidenceLookup} onChange={(e) => update(i, { ...s, evidenceLookup: e.target.checked || undefined })} className="accent-amber-500" /> Evidence lookup (ev_items / ev_files pickers)</label>
              </div>
            </div>
          )}
          {s.type === 'grid' && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <span>Columns — the table is required when at least one row exists.</span>
                {flags(s.id)}
              </div>
              {s.cols.map((col, j) => fieldRow(col, s.id, j, (next) => update(i, { ...s, cols: s.cols.map((x, k) => (k === j ? (next as FormGridCol) : x)) }), () => update(i, { ...s, cols: s.cols.filter((_, k) => k !== j) }), false))}
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={() => update(i, { ...s, cols: [...s.cols, { key: `col_${s.cols.length + 1}`, label: 'Column', type: 'text' }] })}>Add column</Button>
                <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={!!s.evidencePick} onChange={(e) => update(i, { ...s, evidencePick: e.target.checked || undefined })} className="accent-amber-500" /> Offer case evidence as rows</label>
              </div>
            </div>
          )}
          {s.type === 'textarea' && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Input aria-label={`Value key of section ${i + 1}`} value={s.key} onChange={(e) => update(i, { ...s, key: e.target.value.trim() })} className="w-40 font-mono text-xs" placeholder="value_key" />
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={!!s.mediaPick} onChange={(e) => update(i, { ...s, mediaPick: e.target.checked || undefined })} className="accent-amber-500" /> Attachment picker (media refs)</label>
              {flags(s.key)}
            </div>
          )}
          {s.type === 'note' && (
            <Textarea aria-label={`Text of note section ${i + 1}`} rows={3} value={s.text} onChange={(e) => update(i, { ...s, text: e.target.value })} className="mt-2" placeholder="Static text shown on the form (e.g. a statement of understanding)" />
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Add section:</span>
        {FORM_SECTION_TYPES.map((t) => <Button key={t} size="sm" onClick={() => add(t)}>{TYPE_LABEL[t]}</Button>)}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { RichEditor } from '@/components/ui/RichEditor'
import { RecordPeekButton } from '@/components/shared/RecordPeekButton'
import { RecordSearchPicker } from '@/components/shared/RecordSearchPicker'
import { RelatedRecordPicker } from '@/components/shared/RelatedRecordPicker'
import { list } from '@/lib/db'
import { searchPersonHits, type EntityHit } from '@/lib/entitySearch'
import { reportTitle, type FormSchema, type FormValues } from '@/lib/forms'
import { mediaRefLine } from '@/lib/mediaRefs'
import type { MentionLabels } from '@/lib/mentions'
import { toast } from '@/lib/toast'
import type { EvidenceRow, MediaRow, ReportRow } from '../shared'

/** kv text-field keys that get a one-click "Now" timestamp fill. */
const DATE_QUICK = new Set(['date', 'filed_at', 'submitted', 'seizure_date', 'dist_date', 'return_date', 'start_time', 'end_time', 'rights_dt', 'inc_dt'])

/** The fillable form for one report, rendered from the PINNED template
 *  version's schema (never FORM_SCHEMAS by key — a template can change after
 *  a report was filed). `template` only seeds stable element ids;
 *  `requiredKeys` marks the fields the version hard-blocks submit on. */
export function FormEditor({ template, schema, caseId, reportId, values, onChange, requiredKeys = [], advisoryKeys = [], mentions, onInsertFromCase }: {
  template: string
  schema: FormSchema
  caseId: string
  reportId?: string
  values: FormValues
  onChange: (v: FormValues) => void
  requiredKeys?: readonly string[]
  advisoryKeys?: readonly string[]
  /** Present → narrative (textarea) sections render the markdown RichEditor
   *  with @-mentions (P5-05); `labels` are the labels already known (entity
   *  snapshots), `onLabels` receives every label the editor learns. */
  mentions?: { labels: MentionLabels; onLabels: (labels: MentionLabels) => void }
  /** "Insert from case" per narrative section — the tab opens the drawer
   *  and appends the rendered lines to `targetKey`. */
  onInsertFromCase?: (targetKey: string) => void
}) {
  // Case-scoped evidence/attachment pool for sections flagged evidenceLookup,
  // evidencePick or mediaPick. Loaded once per editor; a load failure shows a
  // muted notice (kv lookup) or hides the pickers, never blocks the form.
  const needsLookup = schema.sections.some((s) => (s.type === 'kv' && s.evidenceLookup) || (s.type === 'grid' && s.evidencePick) || (s.type === 'textarea' && s.mediaPick))
  const [pool, setPool] = useState<{ evidence: EvidenceRow[]; media: MediaRow[]; reports: ReportRow[] } | null>(null)
  const [poolErr, setPoolErr] = useState(false)
  useEffect(() => {
    if (!needsLookup || !caseId) return
    let alive = true
    void (async () => {
      try {
        const [ev, m, rp] = await Promise.all([
          list('evidence', { eq: { case_id: caseId }, order: 'created_at' }),
          // Pickers offer live media only — archived rows stay resolvable in
          // saved reports but are not offered for new attachments.
          list('media', { eq: { case_id: caseId }, is: { archived_at: null } }),
          list('reports', { eq: { case_id: caseId }, order: 'created_at' }).catch(() => [] as ReportRow[]),
        ])
        if (alive) setPool({ evidence: ev, media: m, reports: rp.filter((r) => r.finalized) })
      } catch { if (alive) setPoolErr(true) }
    })()
    return () => { alive = false }
  }, [caseId, needsLookup])
  const req = new Set(requiredKeys)
  const adv = new Set(advisoryKeys)
  const mark = (key: string) => req.has(key)
    ? <span className="ml-0.5 text-rose-300" aria-hidden>*</span>
    : adv.has(key) ? <span className="ml-1 text-[10px] font-semibold uppercase text-amber-300/80">advisory</span> : null
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value })
  // Free-text append into a single-line field: join picks with '; '.
  const append = (key: string, text: string) => { const cur = String(values[key] ?? '').trim(); set(key, cur ? `${cur}; ${text}` : text) }
  const evLabel = (ev: EvidenceRow) => [ev.item_code, ev.description].filter(Boolean).join(' — ') || 'Untitled item'
  // Added entries render as removable chips — the fields stay '; '-joined
  // strings underneath, so free text and saved reports are unaffected.
  const entriesOf = (key: string) => String(values[key] ?? '').split(';').map((t) => t.trim()).filter(Boolean)
  const removeEntry = (key: string, idx: number) => set(key, entriesOf(key).filter((_, i) => i !== idx).join('; '))
  const chips = (key: string, label: string) => {
    const es = entriesOf(key)
    return es.length ? <div className="mb-2 flex flex-wrap gap-1.5">{es.map((t, i) => <span key={`${t}-${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200"><span className="min-w-0 truncate">{t}</span><button onClick={() => removeEntry(key, i)} aria-label={`Remove ${t} from ${label}`} title="Remove" className="shrink-0 font-bold text-rose-300 hover:text-rose-200">✕</button></span>)}</div> : null
  }
  const lookup = poolErr
    ? <p className="mb-2 text-xs text-slate-400">Case evidence lookup unavailable — enter items manually.</p>
    : pool && !pool.evidence.length && !pool.media.length
      ? <p className="mb-2 text-xs text-slate-400">No photos or attachments on this case yet — add them in the Photos &amp; Media tab first.</p>
      : pool && <div className="mb-2">
          <RelatedRecordPicker
            sources={[
              { kind: 'evidence', label: 'Case evidence', options: pool.evidence.map((ev) => ({ id: ev.id, label: evLabel(ev) })) },
              { kind: 'attachment', label: 'Case attachments', options: pool.media.map((m) => ({ id: m.id, label: m.title || m.type || 'Attachment' })) },
              { kind: 'finalized_report', label: 'Case reports', options: pool.reports.map((fr) => ({ id: fr.id, label: reportTitle(fr) })) },
            ]}
            onPick={(kind, opt) => {
              if (kind === 'evidence') append('ev_items', opt.label)
              else if (kind === 'attachment') append('ev_files', opt.label)
              else append('ev_files', `${opt.label} — finalized report`)
            }}
          />
        </div>
  const labelCls = 'mb-1 block text-xs font-medium text-slate-400'
  const inputCls = 'w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white'
  // Tolerant read for checks: legacy reports stored comma-joined strings.
  const checksVal = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? v.split(',').map((t) => t.trim()).filter(Boolean) : [])
  const moneyInput = (id: string, val: string, on: (t: string) => void, label: string) => (
    <div className="relative"><span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">$</span><input id={id} value={val} onChange={(e) => on(e.target.value)} inputMode="decimal" placeholder={label} className="w-full rounded-lg border border-white/10 bg-ink-950 py-2 pl-7 pr-3 text-sm text-white" /></div>
  )
  return <div className="space-y-4">{schema.sections.map((s) => {
    if (s.type === 'note') return <p key={s.id} className="rounded-lg bg-white/5 p-3 text-sm text-slate-300">{s.text}</p>
    if (s.type === 'textarea') {
      const taId = `${template}-${s.key}`
      // Narratives use the markdown RichEditor (mentions as [kind:id] chips);
      // media_refs sections keep the plain textarea their token lines expect.
      const rich = !!mentions && !s.mediaPick
      return <div key={s.id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {rich
            ? <span id={`${taId}-label`} className="block text-sm font-semibold text-white">{s.label}{mark(s.key)}</span>
            : <label htmlFor={taId} className="block text-sm font-semibold text-white">{s.label}{mark(s.key)}</label>}
          {onInsertFromCase && !s.mediaPick && <Button size="sm" onClick={() => onInsertFromCase(s.key)}>Insert from case</Button>}
        </div>
        {rich && (
          <div role="group" aria-labelledby={`${taId}-label`} className="mt-2">
            <RichEditor id={taId} value={String(values[s.key] ?? '')} onChange={(md: string) => set(s.key, md)} minHeight="10rem" mentions={mentions} />
          </div>
        )}
        {s.mediaPick && pool && pool.media.length > 0 && <select aria-label={`Add attachment reference to ${s.label}`} value="" onChange={(e) => { const m = pool.media.find((x) => x.id === e.target.value); if (!m) return; /* Id-bearing token — render/export resolve the CURRENT title/url, so renames never orphan the reference. Legacy "title — url" lines keep rendering as plain text. */ const line = mediaRefLine(m.id, m.title || m.type || 'Attachment'); if (m.report_id && m.report_id !== reportId) toast('Already attached to another report — added as a text reference only.', 'info'); const cur = String(values[s.key] ?? '').trimEnd(); set(s.key, cur ? `${cur}\n${line}` : line) }} className="mt-2 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"><option value="">Add from case attachments…</option>{pool.media.map((m) => <option key={m.id} value={m.id}>{m.title || m.type || 'Attachment'}</option>)}</select>}
        {!rich && <textarea id={taId} value={String(values[s.key] ?? '')} onChange={(e) => set(s.key, e.target.value)} rows={5} className="mt-2 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm font-normal text-white" />}
      </div>
    }
    if (s.type === 'grid') {
      const rows = (Array.isArray(values[s.id]) ? values[s.id] : [{}]) as Record<string, string>[]
      const setCell = (i: number, key: string, val: string) => set(s.id, rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)))
      // Display-only per-column sums; a column with no parseable cells is omitted.
      const totals = s.cols.filter((col) => col.type === 'money').map((col) => {
        const nums = rows.map((r) => parseFloat(String(r[col.key] ?? '').replace(/[$,\s]/g, ''))).filter((n) => Number.isFinite(n))
        return nums.length ? { label: col.label, sum: nums.reduce((a, b) => a + b, 0) } : null
      }).filter((t): t is { label: string; sum: number } => !!t)
      return <div key={s.id} className="rounded-lg border border-white/10 p-3">
        <h4 className="mb-2 font-semibold text-white">{s.label}{mark(s.id)}</h4>
        {s.evidencePick && pool && pool.evidence.length > 0 && <select aria-label={`Add case evidence to ${s.label}`} value="" onChange={(e) => { const ev = pool.evidence.find((x) => x.id === e.target.value); if (!ev || !s.cols[0]) return; const row: Record<string, string> = { [s.cols[0].key]: ev.item_code || 'Untitled item' }; if (s.cols[1]) row[s.cols[1].key] = ev.description || ''; set(s.id, [...rows, row]) }} className="mb-2 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"><option value="">Add from case evidence…</option>{pool.evidence.map((ev) => <option key={ev.id} value={ev.id}>{evLabel(ev)}</option>)}</select>}
        {rows.map((row, i) => <div key={i} className="mb-2 flex items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">{s.cols.map((col) => {
            const cellId = `${template}-${s.id}-${i}-${col.key}`
            // Person columns: registry picker (writes the name snapshot AND the
            // row's canonical person_id in one commit). PersonField labels
            // itself, so the cell's own <label> is skipped.
            if (col.person) return <PersonField key={col.key} label={col.label} name={row[col.key] || ''} personId={row.person_id || ''}
              onCommit={(nm, pid) => set(s.id, rows.map((r, idx) => (idx === i ? { ...r, [col.key]: nm, person_id: pid } : r)))} />
            return <div key={col.key}>
              <label htmlFor={cellId} className={labelCls}>{col.label}</label>
              {col.type === 'select' && col.opts
                ? <select id={cellId} value={row[col.key] || ''} onChange={(e) => setCell(i, col.key, e.target.value)} className={inputCls}><option value="">{col.label || '—'}</option>{col.opts.filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                : col.type === 'money'
                  ? moneyInput(cellId, row[col.key] || '', (t) => setCell(i, col.key, t), col.label)
                  : <input id={cellId} value={row[col.key] || ''} onChange={(e) => setCell(i, col.key, e.target.value)} placeholder={col.label} className={inputCls} />}
            </div>
          })}</div>
          <button onClick={() => set(s.id, rows.filter((_, idx) => idx !== i))} aria-label={`Remove row ${i + 1} from ${s.label}`} title="Remove row" className="mt-5 shrink-0 rounded-lg border border-white/10 px-2.5 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/10">✕</button>
        </div>)}
        <Button size="sm" onClick={() => set(s.id, [...rows, {}])}>Add row</Button>
        {totals.length > 0 && <div className="mt-2 space-y-0.5">{totals.map((t) => <p key={t.label} className="text-xs font-bold text-slate-400">{t.label}: ${t.sum.toLocaleString('en-US', { maximumFractionDigits: 2 })}</p>)}</div>}
      </div>
    }
    return <div key={s.id} className="rounded-lg border border-white/10 p-3"><h4 className="mb-2 font-semibold text-white">{s.label}</h4>{s.evidenceLookup && lookup}{s.evidenceLookup && chips('ev_items', 'items')}{s.evidenceLookup && chips('ev_files', 'files')}<div className="grid gap-2 md:grid-cols-2">{s.fields.map((f) => {
      const id = `${template}-${f.key}`
      if (f.type === 'select') return <div key={f.key}><label htmlFor={id} className={labelCls}>{f.label}{mark(f.key)}</label><select id={id} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className={inputCls}><option value="">{f.label}</option>{(f.opts || []).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
      if (f.type === 'checks') {
        const cur = checksVal(values[f.key])
        return <fieldset key={f.key} className="md:col-span-2"><legend className={labelCls}>{f.label}{mark(f.key)}</legend><div className="flex flex-wrap gap-2">{(f.opts || []).filter(Boolean).map((o) => { const on = cur.includes(o); return <label key={o} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${on ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}><input type="checkbox" checked={on} onChange={() => set(f.key, on ? cur.filter((x) => x !== o) : [...cur, o])} className="accent-amber-500" /> {o}</label> })}</div></fieldset>
      }
      if (f.type === 'money') return <div key={f.key}><label htmlFor={id} className={labelCls}>{f.label}{mark(f.key)}</label>{moneyInput(id, String(values[f.key] ?? ''), (t) => set(f.key, t), f.label)}</div>
      // Person fields: registry picker — the display-name snapshot stays in
      // values[f.key] exactly as before, and the picker's commit writes the
      // canonical id into the `_${f.key}_person_id` companion key.
      if (f.person) return <PersonField key={f.key} label={f.label}
        name={Array.isArray(values[f.key]) ? (values[f.key] as string[]).join(', ') : String(values[f.key] ?? '')}
        personId={String(values[`_${f.key}_person_id`] ?? '')}
        onCommit={(nm, pid) => onChange({ ...values, [f.key]: nm, [`_${f.key}_person_id`]: pid })} />
      const quickNow = (f.type === 'text' || f.type === 'date') && DATE_QUICK.has(f.key)
      return <div key={f.key}><label htmlFor={id} className={labelCls}>{f.label}{mark(f.key)}</label><div className="flex gap-2"><input id={id} value={Array.isArray(values[f.key]) ? (values[f.key] as string[]).join(', ') : String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} placeholder={f.label} className={`${inputCls} min-w-0 flex-1`} />{quickNow && <button type="button" onClick={() => set(f.key, new Date().toLocaleString('en-US'))} aria-label={`Set ${f.label} to now`} className="shrink-0 rounded-lg border border-white/10 px-2.5 py-2 text-xs font-bold text-slate-200 hover:bg-white/10">Now</button>}</div></div>
    })}</div></div>
  })}</div>
}

/** Person-typed report field — the smart-picker replacement for the audit's
 *  worst offender (the whole-registry datalist + exact-name-match id capture).
 *  A committed value shows as a summary row: a "Registry profile" badge (with
 *  quick preview) when the canonical id is attached, a muted "Not linked" hint
 *  when it's free text. Editing opens the bounded RecordSearchPicker; picking
 *  a profile commits name + id together, and the "Use as typed" escape hatch
 *  commits free text with an EMPTY id — every commit writes both, so a changed
 *  name can never carry a stale person id. */
function PersonField({ label, name, personId, onCommit }: { label: string; name: string; personId: string; onCommit: (name: string, personId: string) => void }) {
  const [editing, setEditing] = useState(false)
  if (name && !editing) {
    return (
      <Field label={label}>
        {(id) => (
          <div className="flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-ink-900 py-1 pl-3 pr-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-white">{name}</span>
            {personId
              ? <Badge tone="good">Registry profile</Badge>
              : <span className="flex-shrink-0 text-xs text-slate-500" title="Free text — not linked to a Persons-registry record">Not linked</span>}
            {personId && <RecordPeekButton type="person" id={personId} label={name} />}
            <Button id={id} size="sm" onClick={() => setEditing(true)}>Change</Button>
            <button type="button" aria-label={`Clear ${label}`} title="Clear" onClick={() => onCommit('', '')} className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white">✕</button>
          </div>
        )}
      </Field>
    )
  }
  return (
    <div>
      <RecordSearchPicker<EntityHit>
        label={label}
        value={null}
        onChange={(hit) => { if (hit) { onCommit(hit.label, hit.id); setEditing(false) } }}
        search={searchPersonHits}
        getThumb={(h) => h.thumbUrl}
        peekType="person"
        initialQuery={name}
        placeholder="Search the Persons registry…"
        allowFreeText={{ label: 'Use as typed (not linked)', onPick: (t) => { onCommit(t, ''); setEditing(false) } }}
      />
      {editing && name && <Button size="sm" variant="ghost" className="mt-1" onClick={() => setEditing(false)}>Cancel — keep &ldquo;{name}&rdquo;</Button>}
    </div>
  )
}

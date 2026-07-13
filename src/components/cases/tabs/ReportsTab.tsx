'use client'

import { useCallback, useEffect, useState } from 'react'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { deleteWithUndo, insert, list, rpc, update } from '@/lib/db'
import type { Json } from '@/lib/database.types'
import { downloadTextFile, timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { FORM_SCHEMAS, REPORT_TEMPLATES, formToText, reportTitle, type FormSchema, type FormValues } from '@/lib/forms'
import { parseFormValues } from '@/lib/jsonShapes'
import { Drafts } from '@/lib/drafts'
import { toast } from '@/lib/toast'
import type { CaseRow, EvidenceRow, MediaRow, ReportRow } from './shared'

export function ReportsTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const { profile } = useAuth()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [editing, setEditing] = useState<{ template: string; values: FormValues; report?: ReportRow } | null>(null)
  const [view, setView] = useState<ReportRow | null>(null)
  const v = useTableVersion('reports')
  const refresh = useCallback(async () => { try { setReports(await list('reports', { eq: { case_id: c.id }, order: 'created_at', ascending: false })) } catch { /* stale */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  const seed = (): FormValues => ({ case_number: c.case_number, report_type: 'Initial', filed_at: new Date().toLocaleString('en-US'), det_name: profile?.display_name || '', narrative: c.summary || '', summary: c.summary || '' })
  // Never-lose-work: field values are stashed per case+template (or per
  // report when editing) while typing, restored when the editor reopens,
  // and cleared on a successful save. Closing/cancelling keeps the draft.
  const draftKey = (template: string, report?: ReportRow) => (report ? `report:edit:${report.id}` : `report:${c.id}:${template}`)
  const openEditor = (template: string, report?: ReportRow) => {
    const d = Drafts.load<FormValues>(draftKey(template, report))
    const base = report ? parseFormValues(report.fields) : seed()
    const useDraft = !!d?.data && (!report || d.at > new Date(report.updated_at ?? report.created_at).getTime())
    if (useDraft) toast('Unsaved draft restored.', 'info')
    setEditing({ template, values: useDraft ? d!.data : base, report })
  }
  const save = async () => {
    if (!editing) return
    const seq = reports.filter((r) => r.template === editing.template).length + 1
    const patch = { case_id: c.id, template: editing.template, kind: 'initial' as const, seq, fields: editing.values as Json, author_id: profile?.id ?? null }
    const res = editing.report ? await update('reports', editing.report.id, patch) : await insert('reports', patch)
    if (res.error) toast(res.error.message, 'danger')
    else { Drafts.clear(draftKey(editing.template, editing.report)); setEditing(null); toast('Report saved.', 'success'); void refresh() }
  }
  const finalize = async (r: ReportRow) => {
    const res = await rpc('report_finalize', { p_report: r.id, p_badge: profile?.badge_number || undefined })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Report finalized.', 'success'); void refresh() }
  }
  return (
    <div className="space-y-4">
      {canEdit && <div className="flex flex-wrap gap-2">{REPORT_TEMPLATES.map((tpl) => <button key={tpl.id} onClick={() => openEditor(tpl.id)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">{tpl.icon} {tpl.name}</button>)}</div>}
      <div className="space-y-2">
        {reports.map((r) => <div key={r.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-3"><button onClick={() => setView(r)} className="min-w-0 flex-1 text-left"><p className="font-bold text-white">{reportTitle(r)}</p><p className="text-xs text-slate-500">{r.finalized ? 'Finalized' : 'Draft'} - {timeAgo(r.created_at)}</p></button>{!r.finalized && canEdit && <button onClick={() => void finalize(r)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Finalize</button>}{canEdit && <button onClick={() => openEditor(r.template, r)} className="text-sm font-bold text-badge-200">Edit</button>}{canDelete && <button onClick={() => { void deleteWithUndo('reports', r, { label: reportTitle(r), after: refresh }) }} className="text-sm font-bold text-rose-300">Delete</button>}</div>)}
        {!reports.length && <p className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-500">No reports yet.</p>}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} wide>
        <div className="p-5">
          <ModalHeader title={editing ? FORM_SCHEMAS[editing.template]?.title || 'Report' : 'Report'} onClose={() => setEditing(null)} />
          {editing && <FormEditor template={editing.template} caseId={c.id} values={editing.values} onChange={(values) => { setEditing({ ...editing, values }); Drafts.save(draftKey(editing.template, editing.report), values) }} />}
          <div className="mt-5 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">Cancel</button><button onClick={save} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Save</button></div>
        </div>
      </Modal>
      <Modal open={!!view} onClose={() => setView(null)} wide>
        <div className="p-5">
          <ModalHeader title={view ? reportTitle(view) : 'Report'} onClose={() => setView(null)} />
          {view && (FORM_SCHEMAS[view.template]
            ? <ReportView schema={FORM_SCHEMAS[view.template]} values={parseFormValues(view.fields)} />
            : <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-ink-950 p-4 text-sm text-slate-200">{JSON.stringify(view.fields, null, 2)}</pre>)}
          {view && <div className="mt-4 flex justify-end"><button onClick={() => downloadTextFile(`${c.case_number}-${view.template}.md`, formToText(FORM_SCHEMAS[view.template], parseFormValues(view.fields)), 'text/markdown')} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Download .md</button></div>}
        </div>
      </Modal>
    </div>
  )
}

function FormEditor({ template, caseId, values, onChange }: { template: string; caseId: string; values: FormValues; onChange: (v: FormValues) => void }) {
  const schema = FORM_SCHEMAS[template]
  // Case-scoped evidence/attachment pool for kv sections flagged evidenceLookup.
  // Loaded once per editor; a load failure shows a muted notice, never blocks the form.
  const needsLookup = !!schema?.sections.some((s) => s.type === 'kv' && s.evidenceLookup)
  const [pool, setPool] = useState<{ evidence: EvidenceRow[]; media: MediaRow[] } | null>(null)
  const [poolErr, setPoolErr] = useState(false)
  useEffect(() => {
    if (!needsLookup) return
    let alive = true
    void (async () => {
      try {
        const [ev, m] = await Promise.all([list('evidence', { eq: { case_id: caseId }, order: 'created_at' }), list('media', { eq: { case_id: caseId } })])
        if (alive) setPool({ evidence: ev, media: m })
      } catch { if (alive) setPoolErr(true) }
    })()
    return () => { alive = false }
  }, [caseId, needsLookup])
  if (!schema) return <p className="text-sm text-slate-400">Unknown report template.</p>
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value })
  // Free-text append into a single-line field: join picks with '; '.
  const append = (key: string, text: string) => { const cur = String(values[key] ?? '').trim(); set(key, cur ? `${cur}; ${text}` : text) }
  const evLabel = (ev: EvidenceRow) => [ev.item_code, ev.description].filter(Boolean).join(' — ') || 'Untitled item'
  const lookup = poolErr
    ? <p className="mb-2 text-xs text-slate-400">Case evidence lookup unavailable — enter items manually.</p>
    : pool && !pool.evidence.length && !pool.media.length
      ? <p className="mb-2 text-xs text-slate-400">No evidence or attachments on this case yet — log them in the Evidence tab first.</p>
      : pool && <div className="mb-2 grid gap-2 md:grid-cols-2">
          <select aria-label="Add from case evidence" value="" onChange={(e) => { const ev = pool.evidence.find((x) => x.id === e.target.value); if (ev) append('ev_items', evLabel(ev)) }} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"><option value="">Add from case evidence…</option>{pool.evidence.map((ev) => <option key={ev.id} value={ev.id}>{evLabel(ev)}</option>)}</select>
          <select aria-label="Add from case attachments" value="" onChange={(e) => { const m = pool.media.find((x) => x.id === e.target.value); if (m) append('ev_files', m.title || m.type || 'Attachment') }} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"><option value="">Add from case attachments…</option>{pool.media.map((m) => <option key={m.id} value={m.id}>{m.title || m.type || 'Attachment'}</option>)}</select>
        </div>
  return <div className="space-y-4">{schema.sections.map((s) => {
    if (s.type === 'note') return <p key={s.id} className="rounded-lg bg-white/5 p-3 text-sm text-slate-300">{s.text}</p>
    if (s.type === 'textarea') return <label key={s.id} className="block text-sm font-bold text-white">{s.label}<textarea value={String(values[s.key] ?? '')} onChange={(e) => set(s.key, e.target.value)} rows={5} className="mt-2 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 font-normal text-white" /></label>
    if (s.type === 'grid') {
      const rows = (Array.isArray(values[s.id]) ? values[s.id] : [{}]) as Record<string, string>[]
      return <div key={s.id} className="rounded-xl border border-white/10 p-3"><h4 className="mb-2 font-bold text-white">{s.label}</h4>{rows.map((row, i) => <div key={i} className="mb-2 flex items-start gap-2"><div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">{s.cols.map((col) => <input key={col.key} value={row[col.key] || ''} onChange={(e) => set(s.id, rows.map((r, idx) => idx === i ? { ...r, [col.key]: e.target.value } : r))} placeholder={col.label} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white" />)}</div><button onClick={() => set(s.id, rows.filter((_, idx) => idx !== i))} aria-label={`Remove row ${i + 1} from ${s.label}`} title="Remove row" className="mt-0.5 shrink-0 rounded-lg border border-white/10 px-2.5 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/10">✕</button></div>)}<button onClick={() => set(s.id, [...rows, {}])} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-200">Add row</button></div>
    }
    return <div key={s.id} className="rounded-xl border border-white/10 p-3"><h4 className="mb-2 font-bold text-white">{s.label}</h4>{s.evidenceLookup && lookup}<div className="grid gap-2 md:grid-cols-2">{s.fields.map((f) => f.type === 'select' ? <select key={f.key} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white"><option value="">{f.label}</option>{(f.opts || []).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select> : <input key={f.key} value={Array.isArray(values[f.key]) ? (values[f.key] as string[]).join(', ') : String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} placeholder={f.label} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white" />)}</div></div>
  })}</div>
}

/** Read-only rendering of a saved report — walks the same FORM_SCHEMAS the
 *  editor uses and presents each section styled like the rest of the site.
 *  The markdown flattening (formToText) is kept for the Download .md action. */
function ReportView({ schema, values }: { schema: FormSchema; values: FormValues }) {
  const V = values || {}
  const text = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')).trim()
  return (
    <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
      <p className="text-xs uppercase tracking-wider text-slate-500">{schema.subtitle}</p>
      {schema.sections.map((s) => {
        if (s.type === 'note') return <p key={s.id} className="rounded-lg bg-white/5 p-3 text-sm text-slate-300">{s.text}</p>
        return (
          <section key={s.id} className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{s.label}</h4>
            {s.type === 'textarea' && (text(V[s.key]) ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{text(V[s.key])}</p> : <p className="text-sm text-slate-500">—</p>)}
            {s.type === 'kv' && <dl className="divide-y divide-white/5">{s.fields.map((f) => { const v = text(V[f.key]); return <div key={f.key} className="flex items-start justify-between gap-4 py-1.5"><dt className="text-sm text-slate-400">{f.label}</dt><dd className={`text-right text-sm ${v ? 'text-white' : 'text-slate-500'}`}>{v || '—'}</dd></div> })}</dl>}
            {s.type === 'grid' && (() => {
              const rows = (Array.isArray(V[s.id]) ? V[s.id] : []) as Record<string, string>[]
              const filled = rows.filter((r) => s.cols.some((c) => text(r[c.key])))
              return filled.length
                ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{s.cols.map((c) => <th key={c.key} className="pb-1.5 pr-4 text-left text-xs font-bold uppercase tracking-wider text-slate-500">{c.label}</th>)}</tr></thead><tbody className="divide-y divide-white/5">{filled.map((r, i) => <tr key={i}>{s.cols.map((c) => <td key={c.key} className="py-1.5 pr-4 text-slate-200">{text(r[c.key]) || '—'}</td>)}</tr>)}</tbody></table></div>
                : <p className="text-sm text-slate-500">—</p>
            })()}
          </section>
        )
      })}
    </div>
  )
}

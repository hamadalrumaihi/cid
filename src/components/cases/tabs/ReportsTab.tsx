'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { deleteWithUndo, insert, list, rpc, update } from '@/lib/db'
import type { Json } from '@/lib/database.types'
import { downloadTextFile, timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { FORM_SCHEMAS, REPORT_TEMPLATES, WARRANT_TINT, WARRANT_TPLS, formToText, reportFinalizeGaps, reportTitle, warrantStatusOf, type FormSchema, type FormValues } from '@/lib/forms'
import { isCommandRole } from '@/lib/roles'
import { parseFormValues } from '@/lib/jsonShapes'
import { Drafts } from '@/lib/drafts'
import { toast } from '@/lib/toast'
import type { CaseRow, EvidenceRow, MediaRow, PersonRow, ReportRow } from './shared'

export function ReportsTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const { profile } = useAuth()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [editing, setEditing] = useState<{ template: string; values: FormValues; report?: ReportRow } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  // Sealing and reopening both go through an explicit confirmation.
  const [confirm, setConfirm] = useState<{ kind: 'finalize' | 'reopen'; r: ReportRow } | null>(null)
  const v = useTableVersion('reports')
  const refresh = useCallback(async () => { try { setReports(await list('reports', { eq: { case_id: c.id }, order: 'created_at', ascending: false })) } catch { /* stale */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  // The in-page detail derives from the id, so a realtime refresh shows the
  // REFRESHED row (Finalize flips the chip live) and a deleted report falls
  // back to the list.
  const open = openId ? reports.find((r) => r.id === openId) ?? null : null
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
    if (editing.report) {
      // Editing changes only what was typed — kind/seq/author stay as filed.
      const res = await update('reports', editing.report.id, { fields: editing.values as Json })
      if (res.error) { toast(res.error.message, 'danger'); return }
    } else {
      const rt = String(editing.values.report_type ?? '').toLowerCase()
      const kind = rt.startsWith('supplemental') ? ('supplemental' as const) : rt.startsWith('follow') ? ('followup' as const) : ('initial' as const)
      const seq = reports.filter((r) => r.template === editing.template && r.kind === kind).length + 1
      const res = await insert('reports', { case_id: c.id, template: editing.template, kind, seq, fields: editing.values as Json, author_id: profile?.id ?? null })
      if (res.error) { toast(res.error.message, 'danger'); return }
    }
    Drafts.clear(draftKey(editing.template, editing.report)); setEditing(null); toast('Report saved.', 'success'); void refresh()
  }
  const finalize = async (r: ReportRow) => {
    const res = await rpc('report_finalize', { p_report: r.id, p_badge: profile?.badge_number || undefined })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Report sealed.', 'success'); void refresh() }
  }
  const reopen = async (r: ReportRow) => {
    const res = await rpc('report_reopen', { p_report: r.id })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Report reopened — it can be edited again.', 'success'); void refresh() }
  }
  return (
    <div className="space-y-4">
      {open ? (
        <ReportDetail r={open} c={c} canEdit={canEdit} canDelete={canDelete}
          onBack={() => setOpenId(null)}
          onEdit={() => openEditor(open.template, open)}
          onFinalize={() => setConfirm({ kind: 'finalize', r: open })}
          onReopen={() => setConfirm({ kind: 'reopen', r: open })}
          onChanged={() => void refresh()}
          onDelete={() => { void deleteWithUndo('reports', open, { label: reportTitle(open), after: refresh }); setOpenId(null) }} />
      ) : (<>
        {canEdit && <div className="flex flex-wrap gap-2">{REPORT_TEMPLATES.map((tpl) => <button key={tpl.id} onClick={() => openEditor(tpl.id)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">{tpl.icon} {tpl.name}</button>)}</div>}
        <div className="space-y-2">
          {reports.map((r) => <div key={r.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-3"><button onClick={() => setOpenId(r.id)} className="min-w-0 flex-1 text-left"><p className="font-bold text-white">{reportTitle(r)}</p><p className="text-xs text-slate-500">{r.finalized ? 'Finalized' : 'Draft'} - {timeAgo(r.created_at)}</p></button>{!r.finalized && canEdit && <button onClick={() => setConfirm({ kind: 'finalize', r })} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Finalize</button>}{!r.finalized && canEdit && <button onClick={() => openEditor(r.template, r)} className="text-sm font-bold text-badge-200">Edit</button>}{canDelete && <button onClick={() => { void deleteWithUndo('reports', r, { label: reportTitle(r), after: refresh }) }} className="text-sm font-bold text-rose-300">Delete</button>}</div>)}
          {!reports.length && <p className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-500">No reports yet.</p>}
        </div>
      </>)}
      <Modal open={!!editing} onClose={() => setEditing(null)} wide>
        <div className="p-5">
          <ModalHeader title={editing ? FORM_SCHEMAS[editing.template]?.title || 'Report' : 'Report'} onClose={() => setEditing(null)} />
          {editing && <FormEditor template={editing.template} caseId={c.id} values={editing.values} onChange={(values) => { setEditing({ ...editing, values }); Drafts.save(draftKey(editing.template, editing.report), values) }} />}
          <div className="mt-5 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">Cancel</button><button onClick={save} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Save</button></div>
        </div>
      </Modal>
      <Modal open={!!confirm} onClose={() => setConfirm(null)}>
        <div className="p-5">
          <ModalHeader title={confirm?.kind === 'reopen' ? 'Reopen this report?' : 'Finalize & seal this report?'} onClose={() => setConfirm(null)} />
          {confirm?.kind === 'reopen'
            ? <p className="text-sm text-slate-300">The seal is removed and the report becomes editable again. The previous signature is kept in the report&apos;s history, and the reopen is audit-logged.</p>
            : confirm && (() => { const gaps = reportFinalizeGaps(confirm.r); return <div className="space-y-2 text-sm text-slate-300">
                <p>Finalizing seals the report: its contents lock and it is signed in your name. Bureau lead and above can reopen it later.</p>
                {gaps.length > 0 && <p className="rounded-lg bg-amber-500/10 p-3 text-amber-200">Still empty: {gaps.join(', ')}. You can seal it anyway.</p>}
              </div> })()}
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setConfirm(null)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">Cancel</button>
            <button onClick={() => { if (!confirm) return; const { kind, r } = confirm; setConfirm(null); if (kind === 'finalize') void finalize(r); else void reopen(r) }} className={`rounded-lg px-3 py-2 text-sm font-bold text-white ${confirm?.kind === 'reopen' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>{confirm?.kind === 'reopen' ? 'Reopen report' : 'Finalize & seal'}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** In-page read view of one report — replaces the template row + list while
 *  open. Loads case evidence/attachments + the persons registry so ReportView
 *  can make referenced items clickable; every load is best-effort. */
function ReportDetail({ r, c, canEdit, canDelete, onBack, onEdit, onFinalize, onReopen, onChanged, onDelete }: { r: ReportRow; c: CaseRow; canEdit: boolean; canDelete: boolean; onBack: () => void; onEdit: () => void; onFinalize: () => void; onReopen: () => void; onChanged: () => void; onDelete: () => void }) {
  const router = useRouter()
  const { profile } = useAuth()
  const schema = FORM_SCHEMAS[r.template]
  const status = warrantStatusOf(r)
  // Warrant lifecycle goes through a validating RPC — the status whitelist
  // and the actor stamped into fields._warrant_log are server-side, and it's
  // the only path that can touch a sealed warrant.
  const setWarrant = async (next: string) => {
    if (next === status) return
    const res = await rpc('warrant_set_status', { p_report: r.id, p_status: next })
    if (res.error) toast(res.error.message, 'danger')
    else { toast(`Warrant marked ${next}.`, 'success'); onChanged() }
  }
  const [pools, setPools] = useState<{ evidence: EvidenceRow[]; media: MediaRow[]; persons: PersonRow[] }>({ evidence: [], media: [], persons: [] })
  useEffect(() => {
    let alive = true
    void (async () => {
      const [ev, m, p] = await Promise.all([
        list('evidence', { eq: { case_id: c.id }, order: 'created_at' }).catch(() => [] as EvidenceRow[]),
        list('media', { eq: { case_id: c.id } }).catch(() => [] as MediaRow[]),
        list('persons', { select: 'id,name', order: 'name' }).catch(() => [] as PersonRow[]),
      ])
      if (alive) setPools({ evidence: ev, media: m, persons: p })
    })()
    return () => { alive = false }
  }, [c.id, r.id])
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button onClick={onBack} className="rounded-lg py-2 pr-2 text-sm font-bold text-badge-200 hover:text-white">← Back to reports</button>
          <h3 className="min-w-0 truncate font-bold text-white">{reportTitle(r)}</h3>
          <Badge tone={r.finalized ? 'good' : 'neutral'}>{r.finalized ? 'Sealed' : 'Draft'}</Badge>
          {WARRANT_TPLS[r.template] && <Badge tint={WARRANT_TINT[status] || WARRANT_TINT.draft} className="uppercase">{status}</Badge>}
          {WARRANT_TPLS[r.template] && canEdit && <select aria-label="Set warrant status" value={status} onChange={(e) => void setWarrant(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-xs font-bold text-white">{['draft', 'signed', 'executed', 'returned'].map((o) => <option key={o} value={o}>{o}</option>)}</select>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!r.finalized && canEdit && <button onClick={onFinalize} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Finalize</button>}
          {r.finalized && isCommandRole(profile?.role) && <button onClick={onReopen} className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm font-bold text-amber-300 hover:bg-amber-500/10">Reopen</button>}
          {!r.finalized && canEdit && <button onClick={onEdit} className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-badge-200 hover:bg-white/5">Edit</button>}
          {canDelete && <button onClick={onDelete} className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-rose-300 hover:bg-rose-500/10">Delete</button>}
          <button onClick={() => downloadTextFile(`${c.case_number}-${r.template}.md`, formToText(schema, parseFormValues(r.fields)), 'text/markdown')} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Download .md</button>
        </div>
      </div>
      {schema
        ? <ReportView schema={schema} values={parseFormValues(r.fields)} evidence={pools.evidence} media={pools.media} persons={pools.persons} onOpenPerson={(id) => router.push(`/persons?person=${encodeURIComponent(id)}`)} />
        : <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-ink-950 p-4 text-sm text-slate-200">{JSON.stringify(r.fields, null, 2)}</pre>}
    </div>
  )
}

/** kv text-field keys that get a one-click "Now" timestamp fill. */
const DATE_QUICK = new Set(['date', 'filed_at', 'submitted', 'seizure_date', 'dist_date', 'return_date', 'start_time', 'end_time', 'rights_dt', 'inc_dt'])

function FormEditor({ template, caseId, values, onChange }: { template: string; caseId: string; values: FormValues; onChange: (v: FormValues) => void }) {
  const schema = FORM_SCHEMAS[template]
  // Case-scoped evidence/attachment pool for sections flagged evidenceLookup,
  // evidencePick or mediaPick. Loaded once per editor; a load failure shows a
  // muted notice (kv lookup) or hides the pickers, never blocks the form.
  const needsLookup = !!schema?.sections.some((s) => (s.type === 'kv' && s.evidenceLookup) || (s.type === 'grid' && s.evidencePick) || (s.type === 'textarea' && s.mediaPick))
  const needsPersons = !!schema?.sections.some((s) => (s.type === 'kv' && s.fields.some((f) => f.person)) || (s.type === 'grid' && s.cols.some((col) => col.person)))
  const [pool, setPool] = useState<{ evidence: EvidenceRow[]; media: MediaRow[] } | null>(null)
  const [poolErr, setPoolErr] = useState(false)
  const [personNames, setPersonNames] = useState<string[]>([])
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
  useEffect(() => {
    if (!needsPersons) return
    let alive = true
    void (async () => {
      try { const p = await list('persons', { select: 'id,name', order: 'name' }); if (alive) setPersonNames(Array.from(new Set(p.map((x) => (x.name || '').trim()).filter(Boolean)))) }
      catch { /* autocomplete is optional */ }
    })()
    return () => { alive = false }
  }, [needsPersons])
  if (!schema) return <p className="text-sm text-slate-400">Unknown report template.</p>
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
      ? <p className="mb-2 text-xs text-slate-400">No evidence or attachments on this case yet — log them in the Evidence tab first.</p>
      : pool && <div className="mb-2 grid gap-2 md:grid-cols-2">
          <select aria-label="Add from case evidence" value="" onChange={(e) => { const ev = pool.evidence.find((x) => x.id === e.target.value); if (ev) append('ev_items', evLabel(ev)) }} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"><option value="">Add from case evidence…</option>{pool.evidence.map((ev) => <option key={ev.id} value={ev.id}>{evLabel(ev)}</option>)}</select>
          <select aria-label="Add from case attachments" value="" onChange={(e) => { const m = pool.media.find((x) => x.id === e.target.value); if (m) append('ev_files', m.title || m.type || 'Attachment') }} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"><option value="">Add from case attachments…</option>{pool.media.map((m) => <option key={m.id} value={m.id}>{m.title || m.type || 'Attachment'}</option>)}</select>
        </div>
  const dlId = `persons-${template}`
  const dlAttr = (person?: boolean) => (person && personNames.length ? dlId : undefined)
  const labelCls = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500'
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
      return <div key={s.id}>
        <label htmlFor={taId} className="block text-sm font-bold text-white">{s.label}</label>
        {s.mediaPick && pool && pool.media.length > 0 && <select aria-label={`Add attachment reference to ${s.label}`} value="" onChange={(e) => { const m = pool.media.find((x) => x.id === e.target.value); if (!m) return; const title = m.title || m.type || 'Attachment'; const url = m.external_url ? safeUrl(m.external_url) : ''; const line = url ? `${title} — ${url}` : title; const cur = String(values[s.key] ?? '').trimEnd(); set(s.key, cur ? `${cur}\n${line}` : line) }} className="mt-2 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"><option value="">Add from case attachments…</option>{pool.media.map((m) => <option key={m.id} value={m.id}>{m.title || m.type || 'Attachment'}</option>)}</select>}
        <textarea id={taId} value={String(values[s.key] ?? '')} onChange={(e) => set(s.key, e.target.value)} rows={5} className="mt-2 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm font-normal text-white" />
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
      return <div key={s.id} className="rounded-xl border border-white/10 p-3">
        <h4 className="mb-2 font-bold text-white">{s.label}</h4>
        {s.evidencePick && pool && pool.evidence.length > 0 && <select aria-label={`Add case evidence to ${s.label}`} value="" onChange={(e) => { const ev = pool.evidence.find((x) => x.id === e.target.value); if (!ev || !s.cols[0]) return; const row: Record<string, string> = { [s.cols[0].key]: ev.item_code || 'Untitled item' }; if (s.cols[1]) row[s.cols[1].key] = ev.description || ''; set(s.id, [...rows, row]) }} className="mb-2 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"><option value="">Add from case evidence…</option>{pool.evidence.map((ev) => <option key={ev.id} value={ev.id}>{evLabel(ev)}</option>)}</select>}
        {rows.map((row, i) => <div key={i} className="mb-2 flex items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">{s.cols.map((col) => {
            const cellId = `${template}-${s.id}-${i}-${col.key}`
            return <div key={col.key}>
              <label htmlFor={cellId} className={labelCls}>{col.label}</label>
              {col.type === 'select' && col.opts
                ? <select id={cellId} value={row[col.key] || ''} onChange={(e) => setCell(i, col.key, e.target.value)} className={inputCls}><option value="">{col.label || '—'}</option>{col.opts.filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                : col.type === 'money'
                  ? moneyInput(cellId, row[col.key] || '', (t) => setCell(i, col.key, t), col.label)
                  : <input id={cellId} value={row[col.key] || ''} onChange={(e) => setCell(i, col.key, e.target.value)} placeholder={col.label} list={dlAttr(col.person)} className={inputCls} />}
            </div>
          })}</div>
          <button onClick={() => set(s.id, rows.filter((_, idx) => idx !== i))} aria-label={`Remove row ${i + 1} from ${s.label}`} title="Remove row" className="mt-5 shrink-0 rounded-lg border border-white/10 px-2.5 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/10">✕</button>
        </div>)}
        <button onClick={() => set(s.id, [...rows, {}])} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-200">Add row</button>
        {totals.length > 0 && <div className="mt-2 space-y-0.5">{totals.map((t) => <p key={t.label} className="text-xs font-bold text-slate-400">{t.label}: ${t.sum.toLocaleString('en-US', { maximumFractionDigits: 2 })}</p>)}</div>}
      </div>
    }
    return <div key={s.id} className="rounded-xl border border-white/10 p-3"><h4 className="mb-2 font-bold text-white">{s.label}</h4>{s.evidenceLookup && lookup}{s.evidenceLookup && chips('ev_items', 'items')}{s.evidenceLookup && chips('ev_files', 'files')}<div className="grid gap-2 md:grid-cols-2">{s.fields.map((f) => {
      const id = `${template}-${f.key}`
      if (f.type === 'select') return <div key={f.key}><label htmlFor={id} className={labelCls}>{f.label}</label><select id={id} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className={inputCls}><option value="">{f.label}</option>{(f.opts || []).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
      if (f.type === 'checks') {
        const cur = checksVal(values[f.key])
        return <fieldset key={f.key} className="md:col-span-2"><legend className={labelCls}>{f.label}</legend><div className="flex flex-wrap gap-2">{(f.opts || []).filter(Boolean).map((o) => { const on = cur.includes(o); return <label key={o} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${on ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}><input type="checkbox" checked={on} onChange={() => set(f.key, on ? cur.filter((x) => x !== o) : [...cur, o])} className="accent-amber-500" /> {o}</label> })}</div></fieldset>
      }
      if (f.type === 'money') return <div key={f.key}><label htmlFor={id} className={labelCls}>{f.label}</label>{moneyInput(id, String(values[f.key] ?? ''), (t) => set(f.key, t), f.label)}</div>
      const quickNow = f.type === 'text' && DATE_QUICK.has(f.key)
      return <div key={f.key}><label htmlFor={id} className={labelCls}>{f.label}</label><div className="flex gap-2"><input id={id} value={Array.isArray(values[f.key]) ? (values[f.key] as string[]).join(', ') : String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} placeholder={f.label} list={dlAttr(f.person)} className={`${inputCls} min-w-0 flex-1`} />{quickNow && <button type="button" onClick={() => set(f.key, new Date().toLocaleString('en-US'))} aria-label={`Set ${f.label} to now`} className="shrink-0 rounded-lg border border-white/10 px-2.5 py-2 text-xs font-bold text-slate-200 hover:bg-white/10">Now</button>}</div></div>
    })}</div></div>
  })}{needsPersons && personNames.length > 0 && <datalist id={dlId}>{personNames.map((n) => <option key={n} value={n} />)}</datalist>}</div>
}

/** Read-only rendering of a saved report — walks the same FORM_SCHEMAS the
 *  editor uses and presents each section styled like the rest of the site.
 *  With evidence/media/persons pools it makes referenced items clickable;
 *  without them it renders exactly as before. The markdown flattening
 *  (formToText) is kept for the Download .md action. */
function ReportView({ schema, values, evidence = [], media = [], persons = [], onOpenPerson }: { schema: FormSchema; values: FormValues; evidence?: EvidenceRow[]; media?: MediaRow[]; persons?: { id: string; name: string | null }[]; onOpenPerson?: (id: string) => void }) {
  const V = values || {}
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const text = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')).trim()
  const personOf = (v: string) => { const t = v.trim().toLowerCase(); return t ? persons.find((p) => (p.name || '').trim().toLowerCase() === t) : undefined }
  const personText = (v: string) => { const p = onOpenPerson ? personOf(v) : undefined; return p ? <button onClick={() => onOpenPerson!(p.id)} className="font-semibold text-badge-200 hover:underline">{v}</button> : v }
  const findEvidence = (entry: string) => evidence.find((ev) => (!!ev.item_code && !!ev.description && entry === `${ev.item_code} — ${ev.description}`) || (!!ev.item_code && entry.startsWith(ev.item_code)))
  const detailPanel = (line: string) => <span className="mt-1 block rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5 text-left text-xs text-slate-300">{line}</span>
  // ev_items/ev_files render '; '-separated entries; entries that match a
  // logged evidence item or attachment become expandable/linked.
  const lookupEntries = (key: 'ev_items' | 'ev_files', raw: string) => (
    <div className="flex flex-col items-end gap-0.5">{raw.split(';').map((t) => t.trim()).filter(Boolean).map((entry, i) => {
      const k = `${key}:${i}`
      if (key === 'ev_items') {
        const ev = findEvidence(entry)
        if (!ev) return <span key={k}>{entry}</span>
        return <span key={k} className="flex flex-col items-end">
          <button onClick={() => toggle(k)} aria-expanded={expanded.has(k)} className="text-badge-200 hover:underline">{entry}</button>
          {expanded.has(k) && detailPanel([ev.description, ev.type, ev.collected_by ? `collected by ${ev.collected_by}` : '', `seal ${ev.tamper}`, timeAgo(ev.created_at)].filter(Boolean).join(' · '))}
        </span>
      }
      const m = media.find((x) => !!x.title && x.title === entry)
      if (!m) return <span key={k}>{entry}</span>
      const url = m.external_url ? safeUrl(m.external_url) : ''
      if (url) return <a key={k} href={url} target="_blank" rel="noreferrer" className="text-badge-200 hover:underline">{entry} ↗</a>
      return <span key={k} className="flex flex-col items-end">
        <button onClick={() => toggle(k)} aria-expanded={expanded.has(k)} className="text-badge-200 hover:underline">{entry}</button>
        {expanded.has(k) && detailPanel([m.type, timeAgo(m.created_at)].filter(Boolean).join(' · '))}
      </span>
    })}</div>
  )
  return (
    <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
      <p className="text-xs uppercase tracking-wider text-slate-500">{schema.subtitle}</p>
      {schema.sections.map((s) => {
        if (s.type === 'note') return <p key={s.id} className="rounded-lg bg-white/5 p-3 text-sm text-slate-300">{s.text}</p>
        return (
          <section key={s.id} className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{s.label}</h4>
            {s.type === 'textarea' && (text(V[s.key]) ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{text(V[s.key])}</p> : <p className="text-sm text-slate-500">—</p>)}
            {s.type === 'kv' && <dl className="divide-y divide-white/5">{s.fields.map((f) => {
              const v = text(V[f.key])
              const lookupKey = s.evidenceLookup && (f.key === 'ev_items' || f.key === 'ev_files') ? f.key : null
              const hasPool = lookupKey === 'ev_items' ? evidence.length > 0 : lookupKey === 'ev_files' ? media.length > 0 : false
              return <div key={f.key} className="flex items-start justify-between gap-4 py-1.5"><dt className="text-sm text-slate-400">{f.label}</dt><dd className={`text-right text-sm ${v ? 'text-white' : 'text-slate-500'}`}>{!v ? '—' : lookupKey && hasPool ? lookupEntries(lookupKey, v) : f.person ? personText(v) : v}</dd></div>
            })}</dl>}
            {s.type === 'grid' && (() => {
              const rows = (Array.isArray(V[s.id]) ? V[s.id] : []) as Record<string, string>[]
              const filled = rows.filter((r) => s.cols.some((c) => text(r[c.key])))
              return filled.length
                ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{s.cols.map((c) => <th key={c.key} className="pb-1.5 pr-4 text-left text-xs font-bold uppercase tracking-wider text-slate-500">{c.label}</th>)}</tr></thead><tbody className="divide-y divide-white/5">{filled.map((r, i) => <tr key={i}>{s.cols.map((c) => { const cv = text(r[c.key]); return <td key={c.key} className="py-1.5 pr-4 text-slate-200">{cv ? (c.person ? personText(cv) : cv) : '—'}</td> })}</tr>)}</tbody></table></div>
                : <p className="text-sm text-slate-500">—</p>
            })()}
          </section>
        )
      })}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { insert, list, update, deleteWithUndo } from '@/lib/db'
import { todayISO } from '@/lib/format'
import { PENAL_CODE } from '@/lib/penal'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { RelatedRecordPicker } from '@/components/shared/RelatedRecordPicker'
import { type CaseRow, type EvidenceRow, type GangRow, type PredicateRow, type RicoRow } from './shared'

const evLabel = (ev: EvidenceRow) => `${ev.item_code ?? ''} ${ev.description ?? ''}`.trim() || 'Untitled item'

export function RicoTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const [rico, setRico] = useState<RicoRow | null>(null)
  const [preds, setPreds] = useState<PredicateRow[]>([])
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [evidence, setEvidence] = useState<EvidenceRow[]>([])
  const [form, setForm] = useState({ predicate_type: '', evidence_id: '', evidence_ref: '', act_date: todayISO(), note: '' })
  const vR = useTableVersion('rico_cases')
  const vP = useTableVersion('predicate_acts')
  const refresh = useCallback(async () => {
    try {
      const [rc, g, ev] = await Promise.all([list('rico_cases', { eq: { case_id: c.id } }), list('gangs', { order: 'name' }), list('evidence', { eq: { case_id: c.id } })])
      const row = rc[0] ?? null
      setRico(row); setGangs(g); setEvidence(ev)
      setPreds(row ? await list('predicate_acts', { eq: { rico_case_id: row.id }, order: 'act_date', ascending: false }) : [])
    } catch { /* stale */ }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vR, vP])
  const ensure = async () => {
    if (rico) return rico
    const res = await insert('rico_cases', { case_id: c.id })
    if (res.error || !res.data?.[0]) { toast(res.error?.message || 'Could not create RICO tracker.', 'danger'); return null }
    setRico(res.data[0]); return res.data[0]
  }
  const saveEnterprise = async (gangId: string) => {
    const row = await ensure(); if (!row) return
    const res = await update('rico_cases', row.id, { enterprise_gang_id: gangId || null })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Enterprise updated.', 'success'); void refresh() }
  }
  const addPredicate = async () => {
    const row = await ensure(); if (!row) return
    if (!form.predicate_type) { toast('Choose a predicate type.', 'warn'); return }
    const res = await insert('predicate_acts', { rico_case_id: row.id, predicate_type: form.predicate_type, evidence_id: form.evidence_id || null, evidence_ref: form.evidence_ref || null, act_date: form.act_date || null, note: form.note || null })
    if (res.error) toast(res.error.message, 'danger')
    else { setForm({ predicate_type: '', evidence_id: '', evidence_ref: '', act_date: todayISO(), note: '' }); toast('Predicate added.', 'success'); void refresh() }
  }
  const score = Math.min(100, (rico?.enterprise_gang_id ? 30 : 0) + Math.min(60, preds.length * 20) + (preds.some((p) => p.evidence_id || p.evidence_ref) ? 10 : 0))
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <div className="mb-2 flex items-center justify-between"><h3 className="font-bold text-white">RICO Readiness</h3><span className="font-mono text-sm text-badge-200">{score}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-white/5"><span className="block h-full bg-emerald-400" style={{ width: `${score}%` }} /></div>
        <label className="mt-4 block text-sm text-slate-300">Enterprise gang
          <select disabled={!canEdit} value={rico?.enterprise_gang_id ?? ''} onChange={(e) => void saveEnterprise(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white disabled:opacity-70">
            <option value="">None linked</option>{gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      </div>
      {canEdit && <div className="grid gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-4 md:grid-cols-2">
        <select value={form.predicate_type} onChange={(e) => setForm({ ...form, predicate_type: e.target.value })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white"><option value="">Predicate type</option>{PENAL_CODE.filter((p) => p.rico).map((p) => <option key={p.code} value={`${p.code} ${p.title}`}>{p.code} {p.title}</option>)}</select>
        <div className="flex min-h-[42px] items-center">
          {form.evidence_id ? (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200">
              <span className="min-w-0 truncate">{(() => { const ev = evidence.find((x) => x.id === form.evidence_id); return ev ? evLabel(ev) : 'Linked evidence' })()}</span>
              <button onClick={() => setForm({ ...form, evidence_id: '' })} aria-label="Clear evidence link" title="Clear" className="shrink-0 font-bold text-rose-300 hover:text-rose-200">✕</button>
            </span>
          ) : (
            <RelatedRecordPicker
              sources={[{ kind: 'evidence', label: 'Evidence link', options: evidence.map((ev) => ({ id: ev.id, label: evLabel(ev) })) }]}
              onPick={(kind, opt) => { if (kind === 'evidence') setForm({ ...form, evidence_id: opt.id }) }}
            />
          )}
        </div>
        <input type="date" value={form.act_date} onChange={(e) => setForm({ ...form, act_date: e.target.value })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
        <input value={form.evidence_ref} onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })} placeholder="Text ref" className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
        <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Predicate note" rows={2} className="md:col-span-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
        <Button variant="primary" className="md:col-span-2" onClick={addPredicate}>Add predicate act</Button>
      </div>}
      <div className="space-y-2">
        {preds.map((p) => <div key={p.id} className="rounded-xl border border-white/10 bg-ink-950/50 p-3"><p className="font-bold text-white">{p.predicate_type}</p><p className="text-sm text-slate-500">{p.act_date || 'No date'}{p.evidence_ref ? ` - ${p.evidence_ref}` : ''}</p>{p.note && <p className="mt-1 text-sm text-slate-300">{p.note}</p>}{canDelete && <button aria-label={`Delete predicate act: ${p.predicate_type}`} onClick={() => void deleteWithUndo('predicate_acts', p, { confirmTitle: 'Delete predicate act', confirmMessage: `Delete the predicate act “${p.predicate_type}”? You can undo this for a few seconds.`, confirmText: 'Delete act', label: 'predicate act', after: refresh })} className="mt-2 text-xs font-bold text-rose-300 hover:text-rose-200">Delete</button>}</div>)}
        {!preds.length && <p className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-500">No predicate acts recorded.</p>}
      </div>
    </div>
  )
}

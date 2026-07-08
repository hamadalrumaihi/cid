'use client'

/** Narcotics Intelligence — port of vanilla narcotics.js. Accordion registry
 *  (first drug open), what-if purity sliders (client-only calc, never
 *  persisted), pricing matrix bars, hotspot list with density tint + case
 *  links, and the CRUD modal with dynamic precursor/hotspot row editors
 *  using the delete-then-reinsert children pattern. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { insert, list, remove, removeWhere, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { fmtUSD } from '@/lib/format'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'

type NarcoticRow = Tables<'narcotics'>
type PrecursorRow = Tables<'narcotic_precursors'>
type HotspotRow = Tables<'narcotic_hotspots'>
interface CaseOption { id: string; case_number: string }

interface Drug {
  row: NarcoticRow
  precursors: PrecursorRow[]
  hotspots: HotspotRow[]
}

const inputCls = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'
const labelCls = 'mb-1 block text-xs font-semibold text-slate-400'
const rowInputCls = 'rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white'

const densTint = (d: string | null) =>
  d === 'high' ? 'text-rose-300 bg-rose-500/10' : d === 'medium' ? 'text-amber-300 bg-amber-500/10' : 'text-emerald-300 bg-emerald-500/10'
const cap = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

export function NarcoticsView() {
  const { state, canEdit, canDelete } = useAuth()
  const [drugs, setDrugs] = useState<Drug[]>([])
  const [cases, setCases] = useState<CaseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ drug: Drug | null } | null>(null)
  const version = useTableVersion('narcotics')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      const [narc, prec, hot, cs] = await Promise.all([
        withRetry(() => list('narcotics', { order: 'name' })),
        list('narcotic_precursors', {}).catch(() => [] as PrecursorRow[]),
        list('narcotic_hotspots', {}).catch(() => [] as HotspotRow[]),
        list('cases', { select: 'id,case_number', order: 'case_number' }).catch(() => [] as Tables<'cases'>[]),
      ])
      setDrugs(narc.map((n) => ({
        row: n,
        precursors: prec.filter((p) => p.narcotic_id === n.id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
        hotspots: hot.filter((h) => h.narcotic_id === n.id),
      })))
      setCases(cs as unknown as CaseOption[])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  const caseNum = useCallback((id: string | null) => cases.find((c) => c.id === id)?.case_number ?? null, [cases])
  const hotspotCount = useMemo(() => drugs.reduce((n, d) => n + d.hotspots.length, 0), [drugs])

  if (state !== 'in') return <Notice text="Live narcotics registry requires sign-in." />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <div>
          <h3 className="text-xl font-bold text-white">💊 Narcotics Intelligence</h3>
          <p className="text-sm text-slate-400">Street-narcotics registry, deep processing analyzer &amp; market analytics</p>
        </div>
        <div className="flex items-center gap-3 text-center">
          <div className="rounded-xl border border-white/10 bg-ink-850 px-4 py-2">
            <p className="font-mono text-lg font-bold text-emerald-300">{drugs.length}</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Tracked</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-850 px-4 py-2">
            <p className="font-mono text-lg font-bold text-blue-300">{hotspotCount}</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Hotspots</p>
          </div>
          {canEdit && (
            <button onClick={() => setEditor({ drug: null })} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
              + New Narcotic
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <Notice text="Loading narcotics registry…" />
      ) : err ? (
        <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-rose-300">Could not load narcotics: {err}</div>
      ) : !drugs.length ? (
        <Notice text={`No narcotics on file.${canEdit ? ' Use “+ New Narcotic”.' : ''}`} />
      ) : (
        <div className="space-y-4">
          {drugs.map((d, i) => (
            <DrugCard key={d.row.id} drug={d} defaultOpen={i === 0} canEdit={canEdit} caseNum={caseNum} onEdit={() => setEditor({ drug: d })} />
          ))}
        </div>
      )}

      {editor && (
        <NarcoticModal
          drug={editor.drug}
          cases={cases}
          canDelete={canDelete}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void refresh() }}
        />
      )}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">{text}</div>
}

function DrugCard({ drug, defaultOpen, canEdit, caseNum, onEdit }: {
  drug: Drug
  defaultOpen: boolean
  canEdit: boolean
  caseNum: (id: string | null) => string | null
  onEdit: () => void
}) {
  const { row: n, precursors, hotspots } = drug
  // What-if purity sliders — client-only calc, never persisted (vanilla
  // parity). Overrides are keyed by precursor id so a registry refetch keeps
  // slider positions without needing a sync effect.
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const purity = precursors.map((p) => overrides[p.id] ?? p.default_purity ?? 0)
  const street = Number(n.street_price) || 0
  const wholesale = Number(n.wholesale_price) || 0
  const pop = n.popularity ?? 0
  const avg = purity.length ? purity.reduce((a, b) => a + b, 0) / purity.length : 0

  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60">
      <summary className="flex cursor-pointer flex-wrap items-center gap-4 px-6 py-4">
        <span className="text-2xl" aria-hidden>{n.icon || '💊'}</span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">{n.name}</h3>
          <p className="text-xs text-slate-400">{n.classification || ''}</p>
        </div>
        <div className="ml-auto flex items-center gap-4 text-right">
          <div><p className="text-[10px] uppercase tracking-wider text-slate-500">Street</p><p className="font-mono text-sm font-bold text-emerald-300">{fmtUSD(street)}</p></div>
          <div className="hidden sm:block"><p className="text-[10px] uppercase tracking-wider text-slate-500">Popularity</p><p className="font-mono text-sm font-bold text-blue-300">{pop}</p></div>
        </div>
      </summary>
      <div className="grid grid-cols-1 gap-6 border-t border-white/5 px-6 py-5 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Chemical Precursors — adjust purity</p>
          <div className="space-y-3">
            {precursors.length ? precursors.map((p, pi) => (
              <div key={p.id}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-300">{p.name}</span>
                  <span className="font-mono text-slate-400">{purity[pi] ?? 0}%</span>
                </div>
                <input
                  type="range" min={0} max={100} value={purity[pi] ?? 0}
                  onChange={(e) => setOverrides((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))}
                  aria-label={`${p.name} purity`}
                  className="w-full"
                />
              </div>
            )) : <p className="text-xs text-slate-500">No precursors logged.</p>}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-white/10 bg-ink-850 p-3">
            <span className="text-xs font-semibold text-slate-300">Batch Purity → Adj. Street Value</span>
            <span className="font-mono text-sm font-bold text-emerald-300">{Math.round(avg)}% · {fmtUSD(street * avg / 100)}</span>
          </div>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Pricing Matrix</p>
          <div className="space-y-3">
            <Bar label="Street Price" value={fmtUSD(street)} tint="text-emerald-300" bar="bg-emerald-500" pct={100} />
            <Bar label="Wholesale" value={fmtUSD(wholesale)} tint="text-blue-300" bar="bg-blue-500" pct={street ? Math.round(wholesale / street * 100) : 0} />
            <Bar label="Popularity Index" value={`${pop}/100`} tint="text-violet-300" bar="bg-violet-500" pct={pop} />
          </div>
          <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Geographic Selling Hotspots</p>
          <div className="space-y-2">
            {hotspots.length ? hotspots.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-ink-850 px-3 py-2 text-sm">
                <span className="text-slate-200">{h.area}</span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${densTint(h.density)}`}>{cap(h.density)}</span>
                  {caseNum(h.case_id) ? <span className="font-mono text-[11px] text-blue-300">{caseNum(h.case_id)}</span> : <span className="text-[11px] text-slate-500">unlinked</span>}
                </span>
              </div>
            )) : <p className="text-xs text-slate-500">No hotspots logged.</p>}
          </div>
          {canEdit && (
            <div className="mt-4 text-right">
              <button onClick={onEdit} className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit narcotic</button>
            </div>
          )}
        </div>
      </div>
    </details>
  )
}

function Bar({ label, value, tint, bar, pct }: { label: string; value: string; tint: string; bar: string; pct: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="text-slate-300">{label}</span><span className={`font-mono ${tint}`}>{value}</span></div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div className={`h-full ${bar}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
    </div>
  )
}

/* ---- CRUD modal with dynamic precursor / hotspot rows -------------------- */

interface PrecDraft { name: string; purity: string }
interface HotDraft { area: string; density: string; caseId: string }

function NarcoticModal({ drug, cases, canDelete, onClose, onSaved }: {
  drug: Drug | null
  cases: CaseOption[]
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const n = drug?.row ?? null
  const [name, setName] = useState(n?.name ?? '')
  const [icon, setIcon] = useState(n?.icon ?? '💊')
  const [classification, setClassification] = useState(n?.classification ?? '')
  const [popularity, setPopularity] = useState(String(n?.popularity ?? 0))
  const [street, setStreet] = useState(String(n?.street_price ?? 0))
  const [wholesale, setWholesale] = useState(String(n?.wholesale_price ?? 0))
  const [precs, setPrecs] = useState<PrecDraft[]>(() => (drug?.precursors ?? []).map((p) => ({ name: p.name, purity: String(p.default_purity ?? 0) })))
  const [hots, setHots] = useState<HotDraft[]>(() => (drug?.hotspots ?? []).map((h) => ({ area: h.area, density: h.density ?? 'low', caseId: h.case_id ?? '' })))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) { toast('Name is required.', 'warn'); return }
    setBusy(true)
    const payload = {
      name: name.trim(), icon: icon.trim() || '💊', classification: classification.trim() || null,
      popularity: Number(popularity) || 0, street_price: Number(street) || 0, wholesale_price: Number(wholesale) || 0,
    }
    const res = n ? await update('narcotics', n.id, payload) : await insert('narcotics', payload)
    if (res.error) { setBusy(false); toast(`Save failed: ${res.error.message}`, 'danger'); return }
    const nid = n?.id ?? res.data?.[0]?.id
    if (nid) {
      // Replace children (vanilla delete-then-reinsert pattern). Every step is
      // checked: a failed re-insert after a successful delete would otherwise
      // silently wipe purity/hotspot data behind a "saved" toast. On failure,
      // best-effort restore the snapshot the modal was opened with.
      const precRows = precs.map((p, i) => ({ narcotic_id: nid, name: p.name.trim(), default_purity: Number(p.purity) || 0, sort_order: i })).filter((p) => p.name)
      const hotRows = hots.map((h) => ({ narcotic_id: nid, area: h.area.trim(), density: h.density as HotspotRow['density'], case_id: h.caseId || null })).filter((h) => h.area)
      const restore = async () => {
        await removeWhere('narcotic_precursors', { narcotic_id: nid })
        await removeWhere('narcotic_hotspots', { narcotic_id: nid })
        if (drug?.precursors.length) await insert('narcotic_precursors', drug.precursors)
        if (drug?.hotspots.length) await insert('narcotic_hotspots', drug.hotspots)
      }
      const steps: (() => Promise<{ error: { message: string } | null }>)[] = [
        () => removeWhere('narcotic_precursors', { narcotic_id: nid }),
        () => removeWhere('narcotic_hotspots', { narcotic_id: nid }),
        ...(precRows.length ? [() => insert('narcotic_precursors', precRows)] : []),
        ...(hotRows.length ? [() => insert('narcotic_hotspots', hotRows)] : []),
      ]
      for (const step of steps) {
        const r = await step()
        if (r.error) {
          await restore()
          setBusy(false)
          toast(`Save failed (precursors/hotspots): ${r.error.message} — previous rows restored.`, 'danger')
          return
        }
      }
    }
    setBusy(false)
    toast(n ? 'Narcotic updated' : 'Narcotic created', 'success')
    onSaved()
  }

  const del = async () => {
    if (!n) return
    if (!(await uiConfirm(`Delete ${n.name}?`, { confirmText: 'Delete' }))) return
    const r = await remove('narcotics', n.id)
    if (r.error) { toast(`Delete failed: ${r.error.message}`, 'danger'); return }
    toast('Narcotic deleted', 'warn')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader title={n ? 'Edit Narcotic' : 'New Narcotic'} onClose={onClose} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2"><label className={labelCls}>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Icon</label><input value={icon} onChange={(e) => setIcon(e.target.value)} className={inputCls} /></div>
        <div className="sm:col-span-3"><label className={labelCls}>Classification</label><input value={classification} onChange={(e) => setClassification(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Popularity</label><input type="number" value={popularity} onChange={(e) => setPopularity(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Street $</label><input type="number" value={street} onChange={(e) => setStreet(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Wholesale $</label><input type="number" value={wholesale} onChange={(e) => setWholesale(e.target.value)} className={inputCls} /></div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-400">Precursors (name + default purity %)</label>
          <button onClick={() => setPrecs((p) => [...p, { name: '', purity: '0' }])} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">+ Precursor</button>
        </div>
        <div className="space-y-2">
          {precs.map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input value={p.name} onChange={(e) => setPrecs((prev) => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Precursor" className={`col-span-8 ${rowInputCls}`} />
              <input type="number" value={p.purity} onChange={(e) => setPrecs((prev) => prev.map((x, j) => j === i ? { ...x, purity: e.target.value } : x))} placeholder="%" className={`col-span-3 ${rowInputCls}`} />
              <button onClick={() => setPrecs((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove precursor" className="col-span-1 rounded bg-white/5 text-xs text-rose-300 hover:bg-rose-500/10">✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-400">Hotspots (area · density · case)</label>
          <button onClick={() => setHots((h) => [...h, { area: '', density: 'low', caseId: '' }])} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">+ Hotspot</button>
        </div>
        <div className="space-y-2">
          {hots.map((h, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input value={h.area} onChange={(e) => setHots((prev) => prev.map((x, j) => j === i ? { ...x, area: e.target.value } : x))} placeholder="Area" className={`col-span-5 ${rowInputCls}`} />
              <select value={h.density} onChange={(e) => setHots((prev) => prev.map((x, j) => j === i ? { ...x, density: e.target.value } : x))} aria-label="Density" className={`col-span-3 ${rowInputCls}`}>
                {['low', 'medium', 'high'].map((d) => <option key={d} value={d}>{cap(d)}</option>)}
              </select>
              <select value={h.caseId} onChange={(e) => setHots((prev) => prev.map((x, j) => j === i ? { ...x, caseId: e.target.value } : x))} aria-label="Linked case" className={`col-span-3 ${rowInputCls}`}>
                <option value="">— no case —</option>
                {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
              </select>
              <button onClick={() => setHots((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove hotspot" className="col-span-1 rounded bg-white/5 text-xs text-rose-300 hover:bg-rose-500/10">✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <button onClick={() => void save()} disabled={busy} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
          {n ? 'Save changes' : 'Create narcotic'}
        </button>
        {n && canDelete && (
          <button onClick={() => void del()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>
        )}
      </div>
    </Modal>
  )
}

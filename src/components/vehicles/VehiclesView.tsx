'use client'

/** Vehicle Registry + cross-reference engine — port of vanilla vehicles.js
 *  §1–2. Plates as first-class intel records (owner/gang links, notes,
 *  follow), plus the deconfliction scanner that flags phones, registered
 *  plates and linked persons appearing in two or more cases the viewer can
 *  see (all inputs RLS-scoped, so alerts never leak inaccessible cases). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { deleteWithUndo, insert, list, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { inputCls, labelCls } from '@/components/ui/Field'
import { WatchButton } from '@/components/cases/WatchButton'

type VehicleRow = Tables<'vehicles'>
interface PersonOption { id: string; name: string }
interface GangOption { id: string; name: string }
interface CaseOption { id: string; case_number: string }

export function VehiclesView() {
  const { state, canEdit, canDelete } = useAuth()
  const sp = useSearchParams()
  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [persons, setPersons] = useState<PersonOption[]>([])
  const [gangs, setGangs] = useState<GangOption[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // `?q=` seeds the filter — how global-search results land here prefiltered.
  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const [editor, setEditor] = useState<{ record: VehicleRow | null } | null>(null)
  const vVehicles = useTableVersion('vehicles')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      const [v, p, g] = await Promise.all([
        withRetry(() => list('vehicles', { order: 'updated_at', ascending: false })),
        list('persons', { select: 'id,name', order: 'name' }).catch(() => [] as Tables<'persons'>[]),
        list('gangs', { select: 'id,name', order: 'name' }).catch(() => [] as Tables<'gangs'>[]),
      ])
      setVehicles(v)
      setPersons(p as unknown as PersonOption[])
      setGangs(g as unknown as GangOption[])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vVehicles])

  const ownerName = useCallback((id: string | null) => persons.find((p) => p.id === id)?.name ?? null, [persons])
  const gangName = useCallback((id: string | null) => gangs.find((g) => g.id === id)?.name ?? null, [gangs])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return vehicles
    return vehicles.filter((v) =>
      [v.plate, v.model, v.color, v.notes, ownerName(v.owner_id), gangName(v.gang_id)].some((s) => (s || '').toLowerCase().includes(q)),
    )
  }, [vehicles, query, ownerName, gangName])

  const onDelete = async (v: VehicleRow) => {
    if (!(await uiConfirm(`Delete vehicle ${v.plate}? Restorable via Undo.`, { confirmText: 'Delete' }))) return
    await deleteWithUndo('vehicles', v, { label: `Vehicle ${v.plate}`, noConfirm: true, after: refresh })
  }

  if (state !== 'in') return <Notice text="Live vehicle records require sign-in." />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <div>
          <h3 className="text-xl font-bold text-white">🚗 Vehicle Registry</h3>
          <p className="text-sm text-slate-400">Plates as first-class intel — owners, gang links &amp; automatic cross-case matching</p>
        </div>
        <div className="flex items-center gap-3">
          {vehicles.length > 0 && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter plate, owner, gang…"
              aria-label="Filter vehicles"
              className="w-56 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"
            />
          )}
          {canEdit && (
            <button onClick={() => setEditor({ record: null })} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">
              + New Vehicle
            </button>
          )}
        </div>
      </div>

      <CrossrefPanel vehicles={vehicles} persons={persons} ownerName={ownerName} />

      {loading ? (
        <Notice text="Loading vehicle registry…" />
      ) : err ? (
        <ErrorNotice message={err} onRetry={refresh} />
      ) : !vehicles.length ? (
        <EmptyState
          title="No vehicles on file yet"
          hint={canEdit ? 'Log the first plate with the New Vehicle button.' : undefined}
        />
      ) : !rows.length ? (
        <Notice text={`No vehicles match “${query.trim()}”.`} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((v) => {
            const owner = ownerName(v.owner_id)
            const gang = gangName(v.gang_id)
            return (
              <div key={v.id} className="rounded-2xl border border-white/5 bg-ink-900/60 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="inline-block rounded-md border border-white/15 bg-ink-800 px-2.5 py-1 font-mono text-sm font-bold tracking-widest text-white">{v.plate}</p>
                    <p className="mt-1.5 text-sm font-semibold text-slate-200">
                      {v.model || 'Unknown model'}
                      {v.color && <span className="text-slate-500"> · {v.color}</span>}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <WatchButton type="vehicle" id={v.id} label={v.plate} compact />
                    {canEdit && <button onClick={() => setEditor({ record: v })} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10">Edit</button>}
                    {canDelete && <button onClick={() => void onDelete(v)} aria-label="Delete vehicle" className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10">✕</button>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  {owner ? <span className="rounded-md bg-blue-500/10 px-2 py-1 text-blue-300">👤 {owner}</span> : <span className="rounded-md bg-white/5 px-2 py-1 text-slate-500">owner unknown</span>}
                  {gang && <span className="rounded-md bg-violet-500/10 px-2 py-1 text-violet-300">🚩 {gang}</span>}
                </div>
                {v.notes && <p className="mt-3 text-xs text-slate-400">{v.notes}</p>}
              </div>
            )
          })}
        </div>
      )}

      {editor && (
        <VehicleModal
          record={editor.record}
          persons={persons}
          gangs={gangs}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void refresh() }}
        />
      )}
    </div>
  )
}

/* ---- Create / edit modal ------------------------------------------------ */

function VehicleModal({ record, persons, gangs, onClose, onSaved }: {
  record: VehicleRow | null
  persons: PersonOption[]
  gangs: GangOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const [plate, setPlate] = useState(record?.plate ?? '')
  const [model, setModel] = useState(record?.model ?? '')
  const [color, setColor] = useState(record?.color ?? '')
  const [ownerId, setOwnerId] = useState(record?.owner_id ?? '')
  const [gangId, setGangId] = useState(record?.gang_id ?? '')
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [busy, setBusy] = useState(false)

  // FK-preservation guard (vanilla vehicles.js): if the linked owner/gang
  // isn't in the loaded options (fetch failed / stale), keep a synthetic
  // option so an unrelated save can't silently null the link.
  const ownerKnown = !record?.owner_id || persons.some((p) => p.id === record.owner_id)
  const gangKnown = !record?.gang_id || gangs.some((g) => g.id === record.gang_id)

  const dirty = () =>
    plate !== (record?.plate ?? '') || model !== (record?.model ?? '') || color !== (record?.color ?? '') ||
    ownerId !== (record?.owner_id ?? '') || gangId !== (record?.gang_id ?? '') || notes !== (record?.notes ?? '')

  const save = async () => {
    const p = plate.trim().toUpperCase()
    if (!p) { toast('Plate is required.', 'warn'); return }
    setBusy(true)
    const payload = { plate: p, model: model.trim() || null, color: color.trim() || null, owner_id: ownerId || null, gang_id: gangId || null, notes: notes.trim() || null }
    const res = record ? await update('vehicles', record.id, payload) : await insert('vehicles', payload)
    setBusy(false)
    if (res.error) {
      toast(/duplicate|unique|23505/i.test(res.error.message) ? 'That plate is already registered.' : `Save failed: ${res.error.message}`, 'danger')
      return
    }
    toast(record ? 'Vehicle updated' : 'Vehicle registered', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <ModalHeader title={record ? 'Edit Vehicle' : 'New Vehicle'} onClose={onClose} />
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="vehicle-plate" className={labelCls}>Plate *</label>
            <input id="vehicle-plate" value={plate} onChange={(e) => setPlate(e.target.value)} className={`${inputCls} font-mono uppercase tracking-widest`} />
          </div>
          <div>
            <label htmlFor="vehicle-model" className={labelCls}>Model</label>
            <input id="vehicle-model" value={model} onChange={(e) => setModel(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="vehicle-color" className={labelCls}>Color</label>
            <input id="vehicle-color" value={color} onChange={(e) => setColor(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="vehicle-owner" className={labelCls}>Registered Owner</label>
            <select id="vehicle-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputCls}>
              <option value="">— unknown —</option>
              {!ownerKnown && record?.owner_id && <option value={record.owner_id}>(current owner — loading…)</option>}
              {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="vehicle-gang" className={labelCls}>Gang Association</label>
          <select id="vehicle-gang" value={gangId} onChange={(e) => setGangId(e.target.value)} className={inputCls}>
            <option value="">— none —</option>
            {!gangKnown && record?.gang_id && <option value={record.gang_id}>(current gang — loading…)</option>}
            {gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="vehicle-notes" className={labelCls}>Notes</label>
          <textarea id="vehicle-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
        </div>
      </div>
      <div className="mt-5">
        <button onClick={() => void save()} disabled={busy} className="w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
          {record ? 'Save changes' : 'Register vehicle'}
        </button>
      </div>
    </Modal>
  )
}

/* ---- Cross-reference engine ----------------------------------------------
   Scans every report the viewer can see (RLS-scoped) and raises an alert when
   the same phone number, registered plate, or linked person appears in two or
   more different cases. A failed scan shows a Retry banner — it must never
   masquerade as an authoritative "no matches" (dangerous false negative). */

interface CrossrefAlert { icon: string; label: string; kind: string; cases: string[] }

function CrossrefPanel({ vehicles, persons, ownerName }: {
  vehicles: VehicleRow[]
  persons: PersonOption[]
  ownerName: (id: string | null) => string | null
}) {
  const { state } = useAuth()
  const [scan, setScan] = useState<'loading' | 'failed' | 'done'>('loading')
  const [alerts, setAlerts] = useState<CrossrefAlert[]>([])
  const [caseNums, setCaseNums] = useState<Record<string, string>>({})
  const [retry, setRetry] = useState(0)
  const router = useRouter()

  useEffect(() => {
    if (state !== 'in') return
    let cancelled = false
    const t = window.setTimeout(async () => {
      setScan('loading')
      let reports: Tables<'reports'>[] = []
      let links: Tables<'case_intel_links'>[] = []
      let cases: CaseOption[] = []
      let failed = false
      try {
        ;[reports, links, cases] = await Promise.all([
          list('reports', {}),
          list('case_intel_links', {}),
          list('cases', { select: 'id,case_number' }) as unknown as Promise<CaseOption[]>,
        ])
      } catch { failed = true }
      if (cancelled) return
      if (failed) { setScan('failed'); return }
      setCaseNums(Object.fromEntries(cases.map((c) => [c.id, c.case_number])))

      // Flatten each case's report fields into one searchable text blob.
      const textByCase: Record<string, string> = {}
      for (const r of reports) {
        if (r.case_id) textByCase[r.case_id] = (textByCase[r.case_id] || '') + ' ' + JSON.stringify(r.fields ?? {})
      }
      const caseIds = Object.keys(textByCase)
      const found: CrossrefAlert[] = []

      // Phones: (###) ###-#### appearing in 2+ cases.
      const phoneCases: Record<string, Set<string>> = {}
      for (const cid of caseIds) {
        const m = textByCase[cid].match(/\(\d{3}\)\s?\d{3}[- ]?\d{4}/g) ?? []
        for (const ph of new Set(m)) (phoneCases[ph] = phoneCases[ph] ?? new Set()).add(cid)
      }
      for (const [ph, s] of Object.entries(phoneCases)) {
        if (s.size >= 2) found.push({ icon: '📞', label: ph, kind: 'Phone number', cases: [...s] })
      }

      // Registered plates mentioned in 2+ cases' reports.
      for (const v of vehicles) {
        if (!v.plate || v.plate.length < 5) continue
        const re = new RegExp('\\b' + v.plate.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')
        const hits = caseIds.filter((cid) => re.test(textByCase[cid].toUpperCase()))
        if (hits.length >= 2) {
          const owner = ownerName(v.owner_id)
          found.push({ icon: '🚗', label: v.plate + (owner ? ` — ${owner}` : ''), kind: 'Registered plate', cases: hits })
        }
      }

      // Persons linked (Intel tab) to 2+ cases.
      const personCases: Record<string, Set<string>> = {}
      for (const l of links) {
        if (l.kind === 'person') (personCases[l.ref_id] = personCases[l.ref_id] ?? new Set()).add(l.case_id)
      }
      for (const [pid, s] of Object.entries(personCases)) {
        if (s.size < 2) continue
        found.push({ icon: '👤', label: persons.find((p) => p.id === pid)?.name ?? 'Linked person', kind: 'Person in multiple cases', cases: [...s] })
      }

      setAlerts(found)
      setScan('done')
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rescan when data or retry changes
  }, [state, vehicles, persons, retry])

  if (state !== 'in') return null
  if (scan === 'loading') return <p className="mb-6 text-sm text-slate-400">Scanning for cross-case matches…</p>
  if (scan === 'failed') {
    return (
      <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 text-sm text-amber-200">
        ⚠ Could not scan for cross-case matches (connection issue).{' '}
        <button onClick={() => setRetry((n) => n + 1)} className="underline">Retry</button>
      </div>
    )
  }
  if (!alerts.length) {
    return (
      <EmptyState
        title="No cross-case matches yet"
        hint="Alerts appear here when the same phone, plate, or person surfaces in two or more cases."
        className="mb-6"
      />
    )
  }
  return (
    <div className="mb-6">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">⚡ Cross-reference alerts ({alerts.length})</p>
      <div className="space-y-2">
        {alerts.map((a, i) => (
          <div key={`${a.kind}:${a.label}:${i}`} className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <p className="text-sm font-semibold text-white">
              {a.icon} {a.label} <span className="ml-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-400">{a.kind}</span>
            </p>
            <p className="mt-1 text-xs text-slate-300">
              Appears in {a.cases.length} cases:{' '}
              {a.cases.map((cid, j) => (
                <span key={cid}>
                  {j > 0 && ' · '}
                  <button onClick={() => router.push(`/cases?case=${cid}`)} className="font-mono text-blue-300 hover:underline">
                    {caseNums[cid] ?? 'a case'}
                  </button>
                </span>
              ))}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

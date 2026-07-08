'use client'

/** Criminal Places & Production - port of vanilla places.js. Live place cards,
 * FK-preserving create/edit modal, generated lab production recipes, linked
 * gang/case/narcotic chips, attach-to-case, and undo-backed deletes. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Database, Tables } from '@/lib/database.types'
import { deleteWithUndo, insert, list, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'

type PlaceRow = Tables<'places'>
type GangRow = Tables<'gangs'>
type NarcoticRow = Tables<'narcotics'>
type PrecursorRow = Tables<'narcotic_precursors'>
type HotspotRow = Tables<'narcotic_hotspots'>
type ProcessStepRow = Tables<'place_process_steps'>
type LocationType = Database['public']['Enums']['location_type']
type CaseOption = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title'>

const LOC_TYPES: { value: LocationType; label: string }[] = [
  { value: 'drug_lab', label: 'Drug Lab' },
  { value: 'stash_house', label: 'Stash House' },
  { value: 'dead_drop', label: 'Dead Drop' },
  { value: 'front_business', label: 'Front Business' },
  { value: 'chop_shop', label: 'Chop Shop' },
]

const locLabel = (value: string | null | undefined) => LOC_TYPES.find((t) => t.value === value)?.label || value || 'Location'

const PLACE_DELETE_CHILDREN = [{ table: 'place_process_steps' as const, column: 'place_id' }]

interface DrugBundle {
  row: NarcoticRow
  precursors: PrecursorRow[]
  hotspots: HotspotRow[]
}

function recipeFor(drug: DrugBundle | null): string[] {
  if (!drug) return []
  const precursors = drug.precursors
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((p) => p.name)
    .join(', ') || 'TBD'
  const hotspot = drug.hotspots[0]?.area || 'TBD'
  return [
    `Acquire precursors: ${precursors}`,
    `Synthesize / cook ${drug.row.name} base`,
    'Cut to street purity grade',
    'Package into distribution units',
    `Distribute to hotspot: ${hotspot}`,
  ]
}

export function PlacesView() {
  const { state, canEdit, canDelete } = useAuth()
  const [places, setPlaces] = useState<PlaceRow[]>([])
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [cases, setCases] = useState<CaseOption[]>([])
  const [drugs, setDrugs] = useState<DrugBundle[]>([])
  const [steps, setSteps] = useState<ProcessStepRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [editor, setEditor] = useState<PlaceRow | 'new' | null>(null)
  const [attach, setAttach] = useState<PlaceRow | null>(null)

  const vPlaces = useTableVersion('places')
  const vGangs = useTableVersion('gangs')
  const vCases = useTableVersion('cases')
  const vNarcotics = useTableVersion('narcotics')
  const vSteps = useTableVersion('place_process_steps')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      const [pl, g, c, n, prec, hot, ps] = await Promise.all([
        withRetry(() => list('places', { order: 'updated_at', ascending: false })),
        list('gangs', { order: 'name' }).catch(() => [] as GangRow[]),
        list('cases', { select: 'id,case_number,title', order: 'updated_at', ascending: false })
          .then((rows) => rows as unknown as CaseOption[])
          .catch(() => [] as CaseOption[]),
        list('narcotics', { order: 'name' }).catch(() => [] as NarcoticRow[]),
        list('narcotic_precursors', {}).catch(() => [] as PrecursorRow[]),
        list('narcotic_hotspots', {}).catch(() => [] as HotspotRow[]),
        list('place_process_steps', {}).catch(() => [] as ProcessStepRow[]),
      ])
      setPlaces(pl)
      setGangs(g)
      setCases(c)
      setSteps(ps)
      setDrugs(n.map((row) => ({
        row,
        precursors: prec.filter((p) => p.narcotic_id === row.id),
        hotspots: hot.filter((h) => h.narcotic_id === row.id),
      })))
      setSelected((sel) => new Set([...sel].filter((id) => pl.some((x) => x.id === id))))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vPlaces, vGangs, vCases, vNarcotics, vSteps])

  const gangName = (id: string | null) => (id && gangs.find((g) => g.id === id)?.name) || null
  const caseNum = (id: string | null) => (id && cases.find((c) => c.id === id)?.case_number) || null
  const drugById = (id: string | null) => (id && drugs.find((d) => d.row.id === id)) || null
  const stepsByPlace = useMemo(() => {
    const m = new Map<string, ProcessStepRow[]>()
    steps.forEach((s) => m.set(s.place_id, [...(m.get(s.place_id) ?? []), s]))
    m.forEach((rows) => rows.sort((a, b) => (a.step_order || 0) - (b.step_order || 0)))
    return m
  }, [steps])

  const toggleSelect = (id: string, on: boolean) =>
    setSelected((sel) => { const next = new Set(sel); if (on) next.add(id); else next.delete(id); return next })

  const deleteRows = async (rows: PlaceRow[]) => {
    if (!rows.length) return
    const n = rows.length
    if (!(await uiConfirm(`Delete ${n} selected location${n > 1 ? 's' : ''}? Restorable via Undo.`, { confirmText: `Delete ${n}` }))) return
    setSelected(new Set())
    await deleteWithUndo('places', rows, {
      label: `${n} location${n > 1 ? 's' : ''}`,
      noConfirm: true,
      after: () => void refresh(),
      children: PLACE_DELETE_CHILDREN,
    })
  }

  const deleteOne = async (place: PlaceRow) => {
    if (!(await uiConfirm(`Delete location "${place.name}"?`, { confirmText: 'Delete' }))) return
    await deleteWithUndo('places', place, {
      label: `Location "${place.name}"`,
      noConfirm: true,
      after: () => void refresh(),
      children: PLACE_DELETE_CHILDREN,
    })
  }

  return (
    <section className="view-in space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold text-white">
            Criminal Places &amp; Production
            {state === 'in' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />live
              </span>
            )}
          </h3>
          <p className="text-sm text-slate-400">Drug labs, stash houses, dead drops and fronts with production process flows.</p>
        </div>
        {canEdit && (
          <button onClick={() => setEditor('new')} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">
            + New Location
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 backdrop-blur">
          <span className="text-sm font-semibold text-rose-200">{selected.size} selected</span>
          <span className="flex gap-2">
            <button onClick={() => void deleteRows(places.filter((p) => selected.has(p.id)))} className="rounded-md bg-rose-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-rose-500">Delete selected</button>
            <button onClick={() => setSelected(new Set())} className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Clear</button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {state !== 'in' ? (
          <Notice text="Live location records require sign-in." />
        ) : err ? (
          <Notice text={`Could not load locations: ${err}`} />
        ) : loading && !places.length ? (
          <Notice text="Loading locations..." />
        ) : !places.length ? (
          <Notice text={`No locations logged.${canEdit ? ' Use "+ New Location".' : ''}`} />
        ) : (
          places.map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              gang={gangName(place.controlling_gang_id)}
              caseNumber={caseNum(place.case_id)}
              drug={drugById(place.narcotic_id)}
              customSteps={stepsByPlace.get(place.id) ?? []}
              canEdit={canEdit}
              canDelete={canDelete}
              selected={selected.has(place.id)}
              onSelect={(on) => toggleSelect(place.id, on)}
              onEdit={() => setEditor(place)}
              onDelete={() => void deleteOne(place)}
              onAttach={() => setAttach(place)}
            />
          ))
        )}
      </div>

      {editor && (
        <PlaceModal
          record={editor === 'new' ? null : editor}
          gangs={gangs}
          cases={cases}
          drugs={drugs}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void refresh() }}
        />
      )}
      {attach && <AttachPlaceModal place={attach} caseOptions={cases} onClose={() => setAttach(null)} />}
    </section>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400 lg:col-span-2">{text}</div>
}

function PlaceCard({ place, gang, caseNumber, drug, customSteps, canEdit, canDelete, selected, onSelect, onEdit, onDelete, onAttach }: {
  place: PlaceRow
  gang: string | null
  caseNumber: string | null
  drug: DrugBundle | null
  customSteps: ProcessStepRow[]
  canEdit: boolean
  canDelete: boolean
  selected: boolean
  onSelect: (on: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onAttach: () => void
}) {
  const generated = place.type === 'drug_lab' ? recipeFor(drug) : []
  const recipe = customSteps.length ? customSteps.map((s) => s.description) : generated
  return (
    <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-base font-semibold text-white">{place.name}</h4>
          <p className="mt-0.5 text-xs text-slate-400">{locLabel(place.type)} · {place.area || '-'}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {canEdit && <button onClick={onAttach} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-blue-200 transition hover:bg-white/10" title="Attach to case">Attach</button>}
          {canEdit && <button onClick={onEdit} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10">Edit</button>}
          {canDelete && <button aria-label="Remove location" onClick={onDelete} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10">Delete</button>}
          {canDelete && (
            <label className="flex items-center pl-0.5" title="Select for bulk delete">
              <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${place.name} for bulk delete`} className="h-4 w-4 accent-rose-500" />
            </label>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        {gang && <span className="rounded-md bg-violet-500/10 px-2 py-1 text-violet-300">{gang}</span>}
        {caseNumber && <span className="rounded-md bg-blue-500/10 px-2 py-1 font-mono text-blue-300">{caseNumber}</span>}
        {drug && <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300">{drug.row.name}</span>}
      </div>
      {place.notes && <p className="mt-3 text-xs text-slate-400">{place.notes}</p>}
      {recipe.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">Production Process</p>
          <div className="space-y-1.5">
            {recipe.map((step, index) => (
              <div key={`${step}-${index}`} className="flex items-center gap-2 text-xs text-slate-300">
                <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-blue-500/15 font-mono text-[10px] text-blue-300">{index + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PlaceModal({ record, gangs, cases, drugs, onClose, onSaved }: {
  record: PlaceRow | null
  gangs: GangRow[]
  cases: CaseOption[]
  drugs: DrugBundle[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(record?.name || '')
  const [type, setType] = useState<LocationType>(record?.type || 'drug_lab')
  const [area, setArea] = useState(record?.area || '')
  const [gangId, setGangId] = useState(record?.controlling_gang_id || '')
  const [caseId, setCaseId] = useState(record?.case_id || '')
  const [narcoticId, setNarcoticId] = useState(record?.narcotic_id || '')
  const [notes, setNotes] = useState(record?.notes || '')
  const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'
  const gangKnown = !gangId || gangs.some((g) => g.id === gangId)
  const caseKnown = !caseId || cases.some((c) => c.id === caseId)
  const drugKnown = !narcoticId || drugs.some((d) => d.row.id === narcoticId)

  const save = async () => {
    if (!name.trim()) { toast('Location name is required.', 'warn'); return }
    const payload = {
      name: name.trim(),
      type,
      area: area.trim() || null,
      controlling_gang_id: gangId || null,
      case_id: caseId || null,
      narcotic_id: type === 'drug_lab' && narcoticId ? narcoticId : null,
      notes: notes.trim() || null,
    }
    const res = record ? await update('places', record.id, payload) : await insert('places', payload)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'Location updated' : 'Location created', 'success')
    onSaved()
  }

  const dirty = () =>
    name.trim() !== (record?.name || '') || type !== (record?.type || 'drug_lab') ||
    area.trim() !== (record?.area || '') || gangId !== (record?.controlling_gang_id || '') ||
    caseId !== (record?.case_id || '') || narcoticId !== (record?.narcotic_id || '') ||
    notes.trim() !== (record?.notes || '')

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={`${record ? 'Edit' : 'New'} Location`} onClose={onClose} />
        <div className="space-y-3">
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as LocationType)} className={input}>
                {LOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-400">Area</label><input value={area} onChange={(e) => setArea(e.target.value)} className={input} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Controlling Gang</label>
              <select value={gangId} onChange={(e) => setGangId(e.target.value)} className={input}>
                <option value="">- none -</option>
                {!gangKnown && <option value={gangId}>(current gang - loading...)</option>}
                {gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Linked Case</label>
              <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className={input}>
                <option value="">- none -</option>
                {!caseKnown && <option value={caseId}>(linked case - other bureau)</option>}
                {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
              </select>
            </div>
          </div>
          {type === 'drug_lab' && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Produced Narcotic</label>
              <select value={narcoticId} onChange={(e) => setNarcoticId(e.target.value)} className={input}>
                <option value="">- none -</option>
                {!drugKnown && <option value={narcoticId}>(current narcotic - loading...)</option>}
                {drugs.map((d) => <option key={d.row.id} value={d.row.id}>{d.row.name}</option>)}
              </select>
            </div>
          )}
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} /></div>
        </div>
        <button onClick={() => void save()} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
          {record ? 'Save changes' : 'Create location'}
        </button>
      </div>
    </Modal>
  )
}

function AttachPlaceModal({ place, caseOptions, onClose }: { place: PlaceRow; caseOptions: CaseOption[]; onClose: () => void }) {
  const { profile } = useAuth()
  const sorted = useMemo(
    () => caseOptions.slice().sort((a, b) => (a.case_number || '').localeCompare(b.case_number || '')),
    [caseOptions],
  )
  const [caseId, setCaseId] = useState(place.case_id || sorted[0]?.id || '')
  const label = `Place - ${place.name} (${locLabel(place.type)})${place.area ? ` · ${place.area}` : ''}`

  const go = async () => {
    if (!caseId) return
    const res = await insert('case_messages', {
      case_id: caseId,
      author_name: profile?.display_name || 'CID',
      body: `Intel reference - ${label}`,
      mentions: [],
      links: [],
    })
    if (res.error) { toast(`Attach failed: ${res.error.message}`, 'danger'); return }
    const num = sorted.find((c) => c.id === caseId)?.case_number || 'case'
    toast(`Reference posted to ${num} channel`, 'success')
    onClose()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Attach to case" onClose={onClose} />
        <p className="mb-3 text-sm text-slate-400">Posts a reference to <span className="text-white">{label}</span> into the case channel.</p>
        {sorted.length ? (
          <>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Case to attach the reference to" className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">
              {sorted.map((c) => <option key={c.id} value={c.id}>{c.case_number} · {c.title || ''}</option>)}
            </select>
            <button onClick={() => void go()} className="mt-4 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
              Attach reference
            </button>
          </>
        ) : (
          <p className="text-sm text-slate-500">No cases available to attach to.</p>
        )}
      </div>
    </Modal>
  )
}

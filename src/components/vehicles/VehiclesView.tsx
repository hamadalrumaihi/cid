'use client'

/** Vehicle Registry + cross-reference engine — port of vanilla vehicles.js.
 *  Plates as first-class intel records (owner/gang links, notes,
 *  follow), plus the deconfliction scanner that flags phones, registered
 *  plates and linked persons appearing in two or more cases the viewer can
 *  see (all inputs RLS-scoped, so alerts never leak inaccessible cases). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { insert, list, update, withRetry } from '@/lib/db'
import { deleteRecord } from '@/lib/deleteRecord'
import { findDuplicates } from '@/lib/entity'
import { searchGangHits, searchPersonHits, type EntityHit } from '@/lib/entitySearch'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { GangIcon, PersonIcon, XMarkIcon } from '@/components/shell/icons'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { inputCls, labelCls } from '@/components/ui/Field'
import { WatchButton } from '@/components/cases/WatchButton'
import { CrossrefList } from '@/components/shared/CrossrefList'
import { DuplicateMatchNotice, duplicateMatches, type DuplicateMatch } from '@/components/shared/DuplicateMatches'
import { RecordSearchPicker } from '@/components/shared/RecordSearchPicker'
import { useToolNav } from '@/components/tools/useToolNav'
import { VehicleProfile } from './VehicleProfile'

type VehicleRow = Tables<'vehicles'>
interface PersonOption { id: string; name: string }
interface GangOption { id: string; name: string }

export function VehiclesView() {
  const { state, canEdit, canDelete } = useAuth()
  const router = useRouter()
  const nav = useToolNav()
  const sp = useSearchParams()
  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [persons, setPersons] = useState<PersonOption[]>([])
  const [gangs, setGangs] = useState<GangOption[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // `?q=` seeds the filter — how global-search results land here prefiltered.
  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  // `?vehicle=` drills into the profile view (mirrors cases' `?case=`).
  const vehicleId = sp.get('vehicle')
  const [editor, setEditor] = useState<{ record: VehicleRow | null } | null>(null)
  // Per-plate cross-reference (entity_crossref, P2-06) — opened from a row.
  const [xref, setXref] = useState<VehicleRow | null>(null)
  const vVehicles = useTableVersion('vehicles')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      const v = await withRetry(() => list('vehicles', { order: 'updated_at', ascending: false }))
      setVehicles(v)
      // Owner/gang names for the cards — bounded in:{id} lookups on just the
      // referenced ids (never a whole-registry load), degrading to id-less
      // chips on failure exactly like the old best-effort option fetches.
      const ownerIds = [...new Set(v.map((x) => x.owner_id).filter((x): x is string => !!x))]
      const gangIds = [...new Set(v.map((x) => x.gang_id).filter((x): x is string => !!x))]
      const [p, g] = await Promise.all([
        ownerIds.length ? list('persons', { select: 'id,name', in: { id: ownerIds } }).catch(() => []) : Promise.resolve([]),
        gangIds.length ? list('gangs', { select: 'id,name', in: { id: gangIds } }).catch(() => []) : Promise.resolve([]),
      ])
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
    if (!(await uiConfirm(`Delete vehicle ${v.plate}? It moves to the Trash and can be restored.`, { confirmText: 'Delete' }))) return
    await deleteRecord('vehicles', v, { label: `Vehicle ${v.plate}`, noConfirm: true, after: refresh })
  }

  if (state !== 'in') return <Notice text="Live vehicle records require sign-in." />

  // Standalone only — inside the workspace a profile is its own record tab
  // (openProfile below) and this list tab never swaps itself out.
  if (vehicleId && !nav.inWorkspace) return <VehicleProfile id={vehicleId} onBack={() => router.push('/vehicles')} />

  const openProfile = (v: VehicleRow) => {
    if (nav.inWorkspace) nav.openRecord('vehicles', v.id, v.plate)
    else router.push(`/vehicles?vehicle=${v.id}`)
  }

  const actionBtn = 'min-h-[44px] rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-200 transition hover:bg-white/10 sm:min-h-0'

  const actions = (v: VehicleRow) => (
    <span className="flex flex-shrink-0 items-center gap-2">
      <WatchButton type="vehicle" id={v.id} label={v.plate} compact />
      <button onClick={() => openProfile(v)} className={`-my-1 ${actionBtn}`}>Profile</button>
      <button onClick={() => setXref(v)} className={`-my-1 ${actionBtn}`} aria-label={`Cross-reference ${v.plate} across cases`}>Cross-ref</button>
      {canEdit && <button onClick={() => setEditor({ record: v })} className={`-my-1 ${actionBtn}`}>Edit</button>}
      {canDelete && <button onClick={() => void onDelete(v)} aria-label={`Delete vehicle ${v.plate}`} className="-my-1 min-h-[44px] min-w-[44px] rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-rose-300 transition hover:bg-rose-500/10 sm:min-h-0 sm:min-w-0"><XMarkIcon size={14} className="mx-auto" /></button>}
    </span>
  )

  // Narrow-viewport fallback for the table — the registry card, unchanged.
  const vehicleCard = (v: VehicleRow) => {
    const owner = ownerName(v.owner_id)
    const gang = gangName(v.gang_id)
    return (
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="inline-block rounded-md border border-white/15 bg-ink-800 px-2.5 py-1 font-mono text-sm font-semibold tracking-widest text-white">{v.plate}</p>
            <p className="mt-1.5 text-sm font-semibold text-slate-200">
              {v.model || 'Unknown model'}
              {v.color && <span className="text-slate-500"> · {v.color}</span>}
            </p>
          </div>
          {actions(v)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {owner ? <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-blue-300"><PersonIcon size={11} />{owner}</span> : <span className="rounded-md bg-white/5 px-2 py-1 text-slate-500">owner unknown</span>}
          {gang && <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-2 py-1 text-violet-300"><GangIcon size={11} />{gang}</span>}
        </div>
        {v.notes && <p className="mt-3 text-xs text-slate-400">{v.notes}</p>}
      </Card>
    )
  }

  // Table columns — the same fields the old card grid showed.
  const columns: DataColumn<VehicleRow>[] = [
    {
      key: 'plate', label: 'Plate',
      value: (v) => v.plate,
      render: (v) => <span className="inline-block rounded-md border border-white/15 bg-ink-800 px-2 py-0.5 font-mono text-xs font-semibold tracking-widest text-white">{v.plate}</span>,
    },
    {
      key: 'model', label: 'Model',
      value: (v) => [v.model || 'Unknown model', v.color].filter(Boolean).join(' · '),
      render: (v) => (
        <span className="text-sm text-slate-200">
          {v.model || 'Unknown model'}
          {v.color && <span className="text-slate-500"> · {v.color}</span>}
        </span>
      ),
    },
    {
      key: 'owner', label: 'Owner',
      value: (v) => ownerName(v.owner_id) ?? '—',
      render: (v) => {
        const owner = ownerName(v.owner_id)
        return owner
          ? <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-[11px] text-blue-300"><PersonIcon size={11} />{owner}</span>
          : <span className="text-xs text-slate-500">owner unknown</span>
      },
    },
    {
      key: 'gang', label: 'Gang',
      value: (v) => gangName(v.gang_id) ?? '—',
      render: (v) => {
        const gang = gangName(v.gang_id)
        return gang
          ? <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-2 py-1 text-[11px] text-violet-300"><GangIcon size={11} />{gang}</span>
          : <span className="text-slate-500">—</span>
      },
    },
    { key: 'notes', label: 'Notes', value: (v) => v.notes ?? '', render: (v) => <span className="line-clamp-2 max-w-[18rem] text-xs text-slate-400">{v.notes || '—'}</span> },
    { key: 'actions', label: 'Actions', value: () => '', render: (v) => actions(v) },
  ]

  return (
    <div>
      <PageHeader
        className="mb-6"
        title="Vehicle Registry"
        subtitle="Plates as first-class intel — owners, gang links & automatic cross-case matching"
        actions={
          <>
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
              <Button variant="primary" onClick={() => setEditor({ record: null })}>
                New Vehicle
              </Button>
            )}
          </>
        }
      />

      {loading ? (
        <CardGridSkeleton cols="sm:grid-cols-2 xl:grid-cols-3" />
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
        <Card>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(v) => v.id}
            pageSize={30}
            filterPlaceholder="Filter listed rows…"
            countLabel="vehicles"
            emptyText="No vehicles on file yet."
            mobileCard={vehicleCard}
          />
        </Card>
      )}

      {editor && (
        <VehicleModal
          record={editor.record}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void refresh() }}
        />
      )}
      {xref && (
        <Modal open onClose={() => setXref(null)}>
          <ModalHeader title={`Cross-reference · ${xref.plate}`} onClose={() => setXref(null)} />
          <p className="mb-3 text-sm text-slate-400">
            Every case this plate touches that you can read — intel links, surveillance sightings, report mentions and MDT bulletins. Bounded and answered server-side.
          </p>
          <CrossrefList
            kind="vehicle"
            id={xref.id}
            emptyTitle="No cross-case matches"
            emptyHint="Cases appear here when this plate is linked, sighted or mentioned in a report you can read."
          />
        </Modal>
      )}
    </div>
  )
}

/* ---- Create / edit modal ------------------------------------------------
   Exported so VehicleProfile's Edit action reuses this exact definition. */

export function VehicleModal({ record, onClose, onSaved }: {
  record: VehicleRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [plate, setPlate] = useState(record?.plate ?? '')
  const [model, setModel] = useState(record?.model ?? '')
  const [color, setColor] = useState(record?.color ?? '')
  // FK-preservation guard (vanilla vehicles.js, picker edition): while editing,
  // the current owner/gang ids are seeded as placeholder selections
  // IMMEDIATELY — the bounded lookup below only upgrades their labels. A
  // failed or slow lookup keeps the id in place, so an unrelated save can
  // never silently null an existing link.
  const [owner, setOwner] = useState<EntityHit | null>(
    record?.owner_id ? { id: record.owner_id, label: 'Current owner' } : null)
  const [gang, setGang] = useState<EntityHit | null>(
    record?.gang_id ? { id: record.gang_id, label: 'Current gang' } : null)
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [busy, setBusy] = useState(false)

  // Resolve the current owner/gang labels — one bounded in:{id} lookup per
  // table, best-effort; only touches a selection still pointing at that id.
  useEffect(() => {
    const pid = record?.owner_id
    const gid = record?.gang_id
    if (!pid && !gid) return
    let live = true
    void Promise.all([
      pid ? list('persons', { select: 'id,name', in: { id: [pid] } }).catch(() => []) : Promise.resolve([]),
      gid ? list('gangs', { select: 'id,name', in: { id: [gid] } }).catch(() => []) : Promise.resolve([]),
    ]).then(([p, g]) => {
      if (!live) return
      const pr = (p as unknown as PersonOption[])[0]
      const gr = (g as unknown as GangOption[])[0]
      if (pr) setOwner((cur) => (cur && cur.id === pr.id ? { ...cur, label: pr.name || 'Person' } : cur))
      if (gr) setGang((cur) => (cur && cur.id === gr.id ? { ...cur, label: gr.name } : cur))
    })
    return () => { live = false }
  }, [record])

  // Duplicate hint at create time — entity_duplicates on the typed plate
  // (P2-08): the server's norm_plate arm makes 'AB-123' hit a stored 'AB123'
  // (strong ⇒ "Use existing"), a trigram near-miss is a soft notice.
  // Advisory only (the UNIQUE plate key still guards).
  const nav = useToolNav()
  const [dupes, setDupes] = useState<DuplicateMatch[]>([])
  useEffect(() => {
    if (record) return
    const p = plate.trim()
    let live = true
    const t = window.setTimeout(async () => {
      if (p.length < 2) { if (live) setDupes([]); return }
      const rows = await findDuplicates('vehicle', { plate: p })
      if (!live) return
      setDupes(duplicateMatches('vehicle', rows))
    }, 400)
    return () => { live = false; window.clearTimeout(t) }
  }, [plate, record])
  const useExisting = (m: DuplicateMatch) => { nav.openHref(`/vehicles?vehicle=${encodeURIComponent(m.id)}`); onClose() }

  const dirty = () =>
    plate !== (record?.plate ?? '') || model !== (record?.model ?? '') || color !== (record?.color ?? '') ||
    (owner?.id ?? '') !== (record?.owner_id ?? '') || (gang?.id ?? '') !== (record?.gang_id ?? '') || notes !== (record?.notes ?? '')

  const save = async () => {
    const p = plate.trim().toUpperCase()
    if (!p) { toast('Plate is required.', 'warn'); return }
    setBusy(true)
    const payload = { plate: p, model: model.trim() || null, color: color.trim() || null, owner_id: owner?.id ?? null, gang_id: gang?.id ?? null, notes: notes.trim() || null }
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
        <div>
          <label htmlFor="vehicle-plate" className={labelCls}>Plate *</label>
          <input id="vehicle-plate" value={plate} onChange={(e) => setPlate(e.target.value)} className={`${inputCls} font-mono uppercase tracking-widest`} />
          {!record && <DuplicateMatchNotice matches={dupes} onUseExisting={useExisting} />}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="vehicle-model" className={labelCls}>Model</label>
            <input id="vehicle-model" value={model} onChange={(e) => setModel(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="vehicle-color" className={labelCls}>Color</label>
            <input id="vehicle-color" value={color} onChange={(e) => setColor(e.target.value)} className={inputCls} />
          </div>
        </div>
        <RecordSearchPicker<EntityHit>
          label="Registered Owner"
          value={owner}
          onChange={setOwner}
          search={searchPersonHits}
          placeholder="Search name, alias, phone… (blank = unknown)"
          getThumb={(h) => h.thumbUrl}
          peekType="person"
        />
        <RecordSearchPicker<EntityHit>
          label="Gang Association"
          value={gang}
          onChange={setGang}
          search={searchGangHits}
          placeholder="Search gang name or alias… (blank = none)"
          peekType="gang"
        />
        <div>
          <label htmlFor="vehicle-notes" className={labelCls}>Notes</label>
          <textarea id="vehicle-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
        </div>
      </div>
      <div className="mt-5">
        <Button variant="primary" className="w-full" disabled={busy} onClick={() => void save()}>
          {record ? 'Save changes' : 'Register vehicle'}
        </Button>
      </div>
    </Modal>
  )
}

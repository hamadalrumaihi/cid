'use client'

/** Persons of Interest registry — the intelligence-workspace rebuild of the
 *  old card grid. What changed and why:
 *   - Browse fetch is PROJECTED (PERSON_LIST_COLS) and search goes through the
 *     indexed `search_persons` RPC (name/alias/phone/identity/gang/plate/
 *     place/case number) instead of JSON.stringify over full rows.
 *   - Aggregate rollups (linked cases, vehicles, active warrants, duplicate
 *     clusters) come from a handful of projected fetches rolled up client-side
 *     — never a per-card query, never a full cases/reports fetch.
 *   - Filters + sort live in registryFilters (persisted via Store, like the
 *     cases area); metrics in the header click-through to their filter.
 *   - Grid and table layouts share the same chips; below `sm` the table view
 *     honestly falls back to cards (DataTable doesn't stack).
 *  Kept: paged grid (24/page + load-more), quick-add from an empty search,
 *  bulk multi-select delete (command), `?person=` profile drill-down,
 *  `?q=` seeding, attach-to-case (now a durable case_intel_links row). */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { deleteWithUndo, list, rpc, withRetry } from '@/lib/db'
import { fmtDate, timeAgo, todayISO } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { useRegistry } from '@/lib/useRegistry'
import { useNow } from '@/lib/useNow'
import { Store } from '@/lib/store'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { ConfidenceBadge, StaleIntelBadge } from '@/components/ui/IntelBadges'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { PersonProfile } from './PersonProfile'
import { PERSON_NULL_REFS, PersonModal, type PersonRow } from './PersonModal'
import { boloState, classificationLabel, PERSON_REVIEW_DAYS } from './personIntel'
import { BoloBadge, RegistryCard } from './RegistryCard'
import { RegistryAttachModal } from './RegistryAttachModal'
import { RegistryFilterBar } from './RegistryFilterBar'
import {
  applyRegistryFilters, buildRegistryStats, isStaleRecord, loadRegistryFilters,
  loadRegistrySort, persistRegistryFilters, sortRegistry,
  EMPTY_REGISTRY_FILTERS, LEGAL_LITE_COLS, PERSON_LIST_COLS,
  type RegistryFilters, type RegistryPerson, type RegistrySort, type WarrantLite,
} from './registryFilters'

const PAGE = 24
const TABLE_PAGE = 30
const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'

interface GangLite { id: string; name: string }
interface LinkLite { ref_id: string }
interface VehicleLite { id: string; owner_id: string | null }
interface PersonVehicleLite { person_id: string; vehicle_id: string }

type EditorState = { record: RegistryPerson | null; prefillName?: string } | null

/** live / syncing presence chip — stale rows stay visible while refreshing. */
function PresenceChip({ busy }: { busy: boolean }) {
  return busy ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
      <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-amber-400" />syncing
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
      <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />live
    </span>
  )
}

// Narrow-viewport signal for the table→cards fallback (see `narrow` below).
const NARROW_MQ = '(max-width: 639px)'
function subscribeNarrow(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW_MQ)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const narrowSnapshot = (): boolean => window.matchMedia(NARROW_MQ).matches

export function PersonsView() {
  const { state, canEdit, canDelete } = useAuth()
  const router = useRouter()
  const sp = useSearchParams()
  const now = useNow()
  const today = todayISO()

  // Aggregate source tables — projected, fetched with the registry load.
  const [gangs, setGangs] = useState<GangLite[]>([])
  const [intelLinks, setIntelLinks] = useState<LinkLite[]>([])
  const [vehicles, setVehicles] = useState<VehicleLite[]>([])
  const [personVehicles, setPersonVehicles] = useState<PersonVehicleLite[]>([])
  const [legal, setLegal] = useState<WarrantLite[]>([])

  // `?q=` seeds the search — how global-search results land here prefiltered.
  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const [view, setView] = useState<'grid' | 'table'>(() => (Store.get<string>('personsView', 'grid') === 'table' ? 'table' : 'grid'))
  // DataTable doesn't stack on narrow screens, so table view falls back to
  // cards below sm — via matchMedia, NOT CSS hiding: a css-hidden duplicate
  // list still loads every mugshot and doubles the DOM.
  const narrow = useSyncExternalStore(subscribeNarrow, narrowSnapshot, () => false)
  const [sort, setSort] = useState<RegistrySort>(() => loadRegistrySort())
  const [filters, setFilters] = useState<RegistryFilters>(() => loadRegistryFilters())
  const [pageState, setPageState] = useState({ sig: '', shown: PAGE })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [editor, setEditor] = useState<EditorState>(null)
  const [attach, setAttach] = useState<RegistryPerson | null>(null)

  // Server-side search (search_persons RPC): ranked ids, hydrated from the
  // loaded registry map, with misses fetched by id. null = browse mode.
  const [searchIds, setSearchIds] = useState<string[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [extraRows, setExtraRows] = useState<ReadonlyMap<string, RegistryPerson>>(new Map())
  const searchSeq = useRef(0)

  // `?person=` drills into the full profile page instead of the registry.
  const personId = sp.get('person')
  const vGangs = useTableVersion('gangs')
  const vLinks = useTableVersion('case_intel_links')
  const vPersonVehicles = useTableVersion('person_vehicles')
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  useEffect(() => { queueMicrotask(() => { void fetchProfiles() }) }, [fetchProfiles])

  const { rows, loading, refreshing, error: err, refresh } = useRegistry<RegistryPerson>({
    table: 'persons',
    watch: [vGangs, vLinks, vPersonVehicles],
    load: async () => {
      const [p, g, il, v, pv, lr] = await Promise.all([
        withRetry(() => list('persons', { select: PERSON_LIST_COLS, order: 'updated_at', ascending: false })),
        list('gangs', { select: 'id,name', order: 'name' })
          .then((r) => r as unknown as GangLite[]).catch(() => [] as GangLite[]),
        list('case_intel_links', { select: 'ref_id', eq: { kind: 'person' } })
          .then((r) => r as unknown as LinkLite[]).catch(() => [] as LinkLite[]),
        list('vehicles', { select: 'id,owner_id' })
          .then((r) => r as unknown as VehicleLite[]).catch(() => [] as VehicleLite[]),
        list('person_vehicles', { select: 'person_id,vehicle_id' })
          .then((r) => r as unknown as PersonVehicleLite[]).catch(() => [] as PersonVehicleLite[]),
        // "Active warrant per person" isn't expressible as a cheap count, so
        // one projected fetch (workflow columns only, never narrative) is
        // rolled up client-side (RLS-scoped; a denial zeroes the column).
        list('legal_requests', { select: LEGAL_LITE_COLS })
          .then((r) => r as unknown as WarrantLite[]).catch(() => [] as WarrantLite[]),
      ])
      setGangs(g); setIntelLinks(il); setVehicles(v); setPersonVehicles(pv); setLegal(lr)
      setSelected((sel) => new Set([...sel].filter((id) => p.some((x) => x.id === id))))
      return p
    },
  })

  const rowMap = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const rowMapRef = useRef(rowMap)
  useEffect(() => { rowMapRef.current = rowMap })

  // Debounced RPC search. Under 2 characters the RPC returns nothing, so the
  // registry stays in browse mode instead of flashing empty. All setState runs
  // inside the timers (never synchronously in the effect body).
  useEffect(() => {
    const q = query.trim()
    const seq = ++searchSeq.current
    if (q.length < 2) {
      const t = window.setTimeout(() => {
        if (seq !== searchSeq.current) return
        setSearchIds(null)
        setSearching(false)
      }, 0)
      return () => window.clearTimeout(t)
    }
    const t = window.setTimeout(() => {
      void (async () => {
        if (seq !== searchSeq.current) return
        setSearching(true)
        const res = await rpc('search_persons', { p_q: q, p_limit: 60, p_offset: 0 })
        if (seq !== searchSeq.current) return
        if (res.error) { setSearching(false); setSearchIds(null); toast(`Search failed: ${res.error.message}`, 'danger'); return }
        const ids = (res.data ?? []).map((r) => r.id)
        const misses = ids.filter((id) => !rowMapRef.current.has(id))
        if (misses.length) {
          const fetched = await list('persons', { select: PERSON_LIST_COLS, in: { id: misses } })
            .catch(() => [] as RegistryPerson[])
          if (seq !== searchSeq.current) return
          setExtraRows((m) => { const next = new Map(m); for (const r of fetched) next.set(r.id, r); return next })
        }
        setSearchIds(ids)
        setSearching(false)
      })()
    }, 300)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => { Store.set('personsView', view) }, [view])
  useEffect(() => { Store.set('personsSort', sort) }, [sort])
  useEffect(() => { persistRegistryFilters(filters) }, [filters])

  // Rollups over non-tombstone rows (merged records never count as BOLOs,
  // duplicates, or warrant carriers).
  const stats = useMemo(
    () => buildRegistryStats({ persons: rows.filter((p) => p.lifecycle !== 'merged'), intelLinks, vehicles, personVehicles, legal, todayISO: today }),
    [rows, intelLinks, vehicles, personVehicles, legal, today],
  )

  const searchActive = searchIds !== null
  const source = useMemo<RegistryPerson[]>(() => {
    if (searchIds === null) return rows
    return searchIds.map((id) => rowMap.get(id) ?? extraRows.get(id)).filter((x): x is RegistryPerson => !!x)
  }, [rows, rowMap, extraRows, searchIds])

  const items = useMemo(() => {
    const filtered = applyRegistryFilters(source, filters, { now, today, stats })
    // Search results keep the RPC's relevance order; browse gets the sort.
    return searchIds === null ? sortRegistry(filtered, sort, stats) : filtered
  }, [source, filters, now, today, stats, sort, searchIds])

  // Header metrics — computed over the lifecycle-visible registry (not the
  // current filter) so each number matches what its click-through shows.
  const metricsBase = useMemo(
    () => rows.filter((p) => filters.includeMerged || p.lifecycle !== 'merged'),
    [rows, filters.includeMerged],
  )
  const metricCounts = useMemo(() => {
    let bolos = 0, warrants = 0, stale = 0
    for (const p of metricsBase) {
      const b = boloState(p, today)
      if (b.active && !b.expired) bolos++
      if ((stats.warrantCounts.get(p.id) ?? 0) > 0) warrants++
      if (isStaleRecord(p, now)) stale++
    }
    return { bolos, warrants, stale }
  }, [metricsBase, stats, today, now])

  const metric = (patch: Partial<RegistryFilters>) => () => setFilters({ ...EMPTY_REGISTRY_FILTERS, ...patch })
  const metrics: Metric[] = [
    { label: 'Total visible', value: items.length, hint: 'Matching current filters', onClick: () => { setFilters(EMPTY_REGISTRY_FILTERS); setQuery('') } },
    { label: 'Active BOLOs', value: metricCounts.bolos, tint: metricCounts.bolos ? 'bg-rose-500/15 text-rose-300' : undefined, onClick: metric({ bolo: true }) },
    { label: 'Active warrants', value: metricCounts.warrants, tint: metricCounts.warrants ? 'bg-amber-500/15 text-amber-300' : undefined, onClick: metric({ warrant: true }) },
    { label: 'Stale records', value: metricCounts.stale, tint: metricCounts.stale ? 'bg-amber-500/15 text-amber-300' : undefined, hint: `No review in ${PERSON_REVIEW_DAYS}d`, onClick: metric({ stale: true }) },
    { label: 'Possible duplicates', value: stats.duplicateClusters, tint: stats.duplicateClusters ? 'bg-amber-500/15 text-amber-300' : undefined, hint: 'Clusters to review', onClick: metric({ duplicate: true }) },
  ]

  // Load-more resets whenever the query/filters/sort change the result set.
  const sig = JSON.stringify([query.trim(), filters, sort])
  const shown = pageState.sig === sig ? pageState.shown : PAGE
  const visible = items.slice(0, shown)
  const remaining = Math.max(0, items.length - visible.length)
  const gangName = (id: string | null) => (id && gangs.find((g) => g.id === id)?.name) || null

  const toggleSelect = (id: string, on: boolean) =>
    setSelected((sel) => { const next = new Set(sel); if (on) next.add(id); else next.delete(id); return next })

  // Deletes snapshot FULL rows first — the registry rows are projected, and
  // deleteWithUndo re-inserts its snapshot on undo.
  const fullRowsFor = async (ids: string[]): Promise<PersonRow[]> => {
    if (!ids.length) return []
    const full = await list('persons', { in: { id: ids } }).catch(() => [] as PersonRow[])
    return ids
      .map((id) => full.find((f) => f.id === id) ?? (rowMap.get(id) as PersonRow | undefined))
      .filter((x): x is PersonRow => !!x)
  }

  const deleteSelected = async () => {
    const ids = [...selected].filter((id) => rowMap.has(id))
    if (!ids.length) return
    const n = ids.length
    if (!(await uiConfirm(`Delete ${n} selected person${n > 1 ? 's' : ''}? This removes the registry records (not any linked officer accounts).`, { confirmText: `Delete ${n}` }))) return
    setSelected(new Set())
    await deleteWithUndo('persons', await fullRowsFor(ids), {
      label: `${n} person${n > 1 ? 's' : ''}`, noConfirm: true, after: () => void refresh(), setNullRefs: PERSON_NULL_REFS,
    })
  }

  const deleteOne = async (p: RegistryPerson) => {
    if (!(await uiConfirm(`Delete person "${p.name || 'record'}"? This removes the persons-registry record (not any linked officer account).`, { confirmText: 'Delete' }))) return
    await deleteWithUndo('persons', await fullRowsFor([p.id]), {
      label: `Person "${p.name || 'record'}"`, noConfirm: true, after: () => void refresh(), setNullRefs: PERSON_NULL_REFS,
    })
  }

  const openProfile = (id: string) => router.push(`/persons?person=${encodeURIComponent(id)}`)

  // Table columns — value() is the plain text (sort/filter/CSV), render() the
  // chips. Plain consts (closures over the rollups); cheap to rebuild and
  // DataTable re-derives from them anyway.
  const columns: DataColumn<RegistryPerson>[] = [
    {
      key: 'person', label: 'Person',
      value: (p) => (p.alias ? `${p.name} “${p.alias}”` : p.name),
      render: (p) => (
        <span className="flex flex-col">
          <span className="font-semibold text-white">{p.name}</span>
          {p.alias && <span className="text-xs text-slate-400">“{p.alias}”</span>}
        </span>
      ),
    },
    {
      key: 'status', label: 'Status',
      value: (p) => [p.classification ? classificationLabel(p.classification) : '', p.status ?? ''].filter(Boolean).join(' · ') || '—',
    },
    { key: 'gang', label: 'Gang', value: (p) => gangName(p.gang_id) ?? '—' },
    {
      key: 'bolo', label: 'BOLO',
      value: (p) => { const b = boloState(p, today); return b.expired ? 'Expired' : b.active ? `Active${b.risk ? ` · ${b.risk}` : ''}` : '—' },
      render: (p) => {
        const b = boloState(p, today)
        return b.active || b.expired ? <BoloBadge p={p} today={today} /> : <span className="text-slate-500">—</span>
      },
    },
    {
      key: 'warrants', label: 'Warrants',
      value: (p) => String(stats.warrantCounts.get(p.id) ?? 0),
      sortValue: (p) => stats.warrantCounts.get(p.id) ?? 0,
      render: (p) => {
        const n = stats.warrantCounts.get(p.id) ?? 0
        return n ? <span className="font-semibold text-rose-300">{n}</span> : <span className="text-slate-500">0</span>
      },
    },
    { key: 'cases', label: 'Cases', value: (p) => String(stats.caseCounts.get(p.id) ?? 0), sortValue: (p) => stats.caseCounts.get(p.id) ?? 0 },
    { key: 'vehicles', label: 'Vehicles', value: (p) => String(stats.vehicleCounts.get(p.id) ?? 0), sortValue: (p) => stats.vehicleCounts.get(p.id) ?? 0 },
    {
      key: 'confidence', label: 'Confidence',
      value: (p) => p.confidence ?? 'unverified',
      render: (p) => <ConfidenceBadge confidence={p.confidence} />,
    },
    {
      key: 'reviewed', label: 'Last reviewed',
      value: (p) => fmtDate(p.reviewed_at),
      sortValue: (p) => p.reviewed_at ?? '',
      render: (p) => (
        <span className="flex items-center gap-1.5">
          {fmtDate(p.reviewed_at)}
          <StaleIntelBadge reviewedAt={p.reviewed_at} thresholdDays={PERSON_REVIEW_DAYS} now={now} />
        </span>
      ),
    },
    { key: 'updated', label: 'Updated', value: (p) => timeAgo(p.updated_at), sortValue: (p) => p.updated_at },
    {
      key: 'actions', label: 'Actions',
      value: () => '',
      render: (p) => (
        <span className="flex gap-1.5">
          <Button size="sm" onClick={() => openProfile(p.id)}>Profile</Button>
          {canEdit && <Button size="sm" onClick={() => setEditor({ record: p })}>Edit</Button>}
        </span>
      ),
    },
  ]

  if (personId) {
    if (state !== 'in') return <Notice text="Live person records require sign-in." />
    return <PersonProfile id={personId} onBack={() => router.push('/persons')} />
  }

  const grid = () => (
    <div className={GRID}>
      {visible.map((p) => (
        <RegistryCard
          key={p.id}
          p={p}
          gang={gangName(p.gang_id)}
          caseCount={stats.caseCounts.get(p.id) ?? 0}
          vehicleCount={stats.vehicleCounts.get(p.id) ?? 0}
          warrantCount={stats.warrantCounts.get(p.id) ?? 0}
          duplicate={stats.duplicateIds.has(p.id)}
          now={now}
          today={today}
          canEdit={canEdit}
          canDelete={canDelete}
          selected={selected.has(p.id)}
          onSelect={(on) => toggleSelect(p.id, on)}
          onProfile={() => openProfile(p.id)}
          onEdit={() => setEditor({ record: p })}
          onDelete={() => void deleteOne(p)}
          onAttach={() => setAttach(p)}
        />
      ))}
      {remaining > 0 && (
        <div className="col-span-full pt-1 text-center">
          <Button size="sm" className="min-h-[44px] sm:min-h-0" onClick={() => setPageState({ sig, shown: shown + PAGE })}>
            Load {Math.min(remaining, PAGE)} more · {remaining} remaining
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <section className="view-in space-y-4">
      <Card pad="lg">
        <PageHeader
          title="Persons of Interest"
          subtitle="Identity, affiliations, legal status, relationships, and investigative history."
          actions={
            <>
              {state === 'in' && <PresenceChip busy={refreshing || searching} />}
              {canEdit && (
                <Button variant="primary" onClick={() => setEditor({ record: null })}>
                  New person
                </Button>
              )}
            </>
          }
        />
        {state === 'in' && !err && <MetricStrip metrics={metrics} className="mt-4 xl:grid-cols-5" />}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, alias, phone, gang, plate, place, case…"
          aria-label="Search persons"
          className="min-h-[40px] min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-badge-500"
        />
        <div role="tablist" aria-label="Layout" className="inline-flex rounded-lg border border-white/10 bg-ink-850 p-0.5">
          {(['grid', 'table'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`min-h-[36px] rounded-md px-2.5 py-1 text-xs font-semibold capitalize ${view === v ? 'bg-badge-500 text-ink-950' : 'text-slate-300 hover:bg-white/10'}`}>{v}</button>
          ))}
        </div>
        <Button onClick={() => void refresh()}>Refresh</Button>
      </div>

      <RegistryFilterBar
        filters={filters}
        onFilters={setFilters}
        gangs={gangs}
        sort={sort}
        onSort={setSort}
        searchActive={searchActive}
      />

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 backdrop-blur">
          <span className="text-sm font-semibold text-rose-200">{selected.size} selected</span>
          <span className="flex gap-2">
            <Button size="sm" variant="danger" onClick={() => void deleteSelected()}>Delete selected</Button>
            <Button size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </span>
        </div>
      )}

      {state !== 'in' ? (
        <Notice text="Live person records require sign-in." />
      ) : err ? (
        <ErrorNotice message={err} onRetry={refresh} />
      ) : loading && !rows.length ? (
        <CardGridSkeleton cols="sm:grid-cols-2 xl:grid-cols-3" />
      ) : !items.length ? (
        query.trim() && canEdit ? (
          <Card pad="none" className="p-8 text-center">
            <p className="text-sm text-slate-400">No persons match &ldquo;{query.trim()}&rdquo;.</p>
            <Button variant="primary" className="mt-3" onClick={() => setEditor({ record: null, prefillName: query.trim() })}>
              Add &ldquo;{query.trim()}&rdquo; to registry
            </Button>
          </Card>
        ) : rows.length ? (
          <Notice text="No persons match your search or filters." />
        ) : (
          <EmptyState
            title="No persons on file yet"
            hint={canEdit ? 'Add one with the New person button.' : undefined}
          />
        )
      ) : view === 'table' ? (
        narrow ? (
          /* DataTable doesn't stack on narrow screens — honest card fallback. */
          grid()
        ) : (
          <Card>
            <DataTable
              columns={columns}
              rows={items}
              rowKey={(p) => p.id}
              pageSize={TABLE_PAGE}
              initialSort={{ key: 'updated', dir: 'desc' }}
              filterPlaceholder="Filter listed rows…"
              csvName="persons"
              countLabel="persons"
              emptyText="No persons match this view."
            />
          </Card>
        )
      ) : (
        grid()
      )}

      {editor && (
        <PersonModal
          record={editor.record}
          prefillName={editor.prefillName}
          gangs={gangs}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void refresh() }}
        />
      )}
      {attach && <RegistryAttachModal person={attach} onClose={() => setAttach(null)} />}
    </section>
  )
}

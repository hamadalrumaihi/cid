'use client'

/** Narcotics Intelligence — the visual substance registry (spec §6-7, §30-31).
 *  Supersedes the old accordion: a quiet header with one prominent search
 *  (indexed search_narcotics RPC), category pills, a responsive grid of
 *  substance cards, a modest metric strip and a small filters popover. Merged
 *  tombstones are excluded everywhere. `?drug=<id>` drills into the dossier
 *  (owned by another agent, imported lazily). Registry model + card live in
 *  sibling files (narcoticsRegistry.ts / NarcoticsRegistryCard.tsx), matching
 *  the persons feature split. */
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { insert, list, rpc, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useRegistry } from '@/lib/useRegistry'
import { useTableVersion } from '@/lib/realtime'
import { useNow } from '@/lib/useNow'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionTabs, type SectionTab } from '@/components/ui/SectionTabs'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { NarcoticsRegistryCard } from './NarcoticsRegistryCard'
import {
  applyNarcoticFilters, buildAliasMap, buildNarcoticMetrics, categoryLabel, countByNarcotic,
  loadNarcoticFilters, loadNarcoticView, persistNarcoticFilters, persistNarcoticView,
  sortNarcotics, statusLabel, CATEGORY_PILLS, EMPTY_NARCOTIC_FILTERS, NARCOTIC_CATEGORIES,
  NARCOTIC_LIST_COLS, NARCOTIC_SORTS, NARCOTIC_STATUSES,
  type NarcoticFilters, type NarcoticStats, type RegistryNarcotic, type NarcoticSort,
} from './narcoticsRegistry'

// The dossier is built by another agent; import it lazily so the registry
// chunk never bundles it (and it can render client-only).
const NarcoticsDossier = dynamic(
  () => import('./NarcoticsDossier').then((m) => m.NarcoticsDossier),
  { ssr: false },
)

const PAGE = 24
const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'

interface AliasLite { narcotic_id: string; alias: string }
interface LinkLite { narcotic_id: string }
interface MediaLite { id: string; external_url: string | null; storage_path: string | null }

/** live / syncing presence chip. */
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

export function NarcoticsView() {
  const { state, canEdit } = useAuth()
  const router = useRouter()
  const sp = useSearchParams()
  const now = useNow()

  const drugId = sp.get('drug')

  const [aliases, setAliases] = useState<AliasLite[]>([])
  const [persons, setPersons] = useState<LinkLite[]>([])
  const [places, setPlaces] = useState<LinkLite[]>([])
  const [gangs, setGangs] = useState<LinkLite[]>([])
  const [seizures, setSeizures] = useState<LinkLite[]>([])
  const [media, setMedia] = useState<MediaLite[]>([])

  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const [view, setView] = useState(() => loadNarcoticView())
  const [filters, setFilters] = useState<NarcoticFilters>(() => loadNarcoticFilters())
  const [pageState, setPageState] = useState({ sig: '', shown: PAGE })
  const [creating, setCreating] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  // Server-side search (search_narcotics RPC): ranked ids hydrated from the
  // loaded rows, misses fetched by id. null = browse mode.
  const [searchIds, setSearchIds] = useState<string[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [extraRows, setExtraRows] = useState<ReadonlyMap<string, RegistryNarcotic>>(new Map())
  const searchSeq = useRef(0)

  const vAliases = useTableVersion('narcotic_aliases')
  const vSeizures = useTableVersion('narcotic_seizures')

  const { rows, loading, refreshing, error: err, refresh } = useRegistry<RegistryNarcotic>({
    table: 'narcotics',
    watch: [vAliases, vSeizures],
    load: async () => {
      const [narc, al, np, npl, ng, ns] = await Promise.all([
        withRetry(() => list('narcotics', { select: NARCOTIC_LIST_COLS, order: 'updated_at', ascending: false })),
        list('narcotic_aliases', { select: 'narcotic_id,alias', order: 'alias' })
          .then((r) => r as unknown as AliasLite[]).catch(() => [] as AliasLite[]),
        list('narcotic_persons', { select: 'narcotic_id' })
          .then((r) => r as unknown as LinkLite[]).catch(() => [] as LinkLite[]),
        list('narcotic_places', { select: 'narcotic_id' })
          .then((r) => r as unknown as LinkLite[]).catch(() => [] as LinkLite[]),
        list('narcotic_gangs', { select: 'narcotic_id' })
          .then((r) => r as unknown as LinkLite[]).catch(() => [] as LinkLite[]),
        list('narcotic_seizures', { select: 'narcotic_id' })
          .then((r) => r as unknown as LinkLite[]).catch(() => [] as LinkLite[]),
      ])
      setAliases(al); setPersons(np); setPlaces(npl); setGangs(ng); setSeizures(ns)
      // Resolve representative images in one projected fetch.
      const repIds = [...new Set(narc.map((n) => n.representative_media_id).filter((x): x is string => !!x))]
      if (repIds.length) {
        const m = await list('media', { select: 'id,external_url,storage_path', in: { id: repIds } })
          .then((r) => r as unknown as MediaLite[]).catch(() => [] as MediaLite[])
        setMedia(m)
      } else {
        setMedia([])
      }
      return narc
    },
  })

  const rowMap = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const rowMapRef = useRef(rowMap)
  useEffect(() => { rowMapRef.current = rowMap })

  // Debounced RPC search — under 2 chars stays in browse mode.
  useEffect(() => {
    const q = query.trim()
    const seq = ++searchSeq.current
    if (q.length < 2) {
      const t = window.setTimeout(() => {
        if (seq !== searchSeq.current) return
        setSearchIds(null); setSearching(false)
      }, 0)
      return () => window.clearTimeout(t)
    }
    const t = window.setTimeout(() => {
      void (async () => {
        if (seq !== searchSeq.current) return
        setSearching(true)
        const res = await rpc('search_narcotics', { p_query: q, p_limit: 60 })
        if (seq !== searchSeq.current) return
        if (res.error) { setSearching(false); setSearchIds(null); toast(`Search failed: ${res.error.message}`, 'danger'); return }
        const ids = (res.data ?? []).map((r) => r.id)
        const misses = ids.filter((id) => !rowMapRef.current.has(id))
        if (misses.length) {
          const fetched = await list('narcotics', { select: NARCOTIC_LIST_COLS, in: { id: misses } })
            .then((r) => r as unknown as RegistryNarcotic[]).catch(() => [] as RegistryNarcotic[])
          if (seq !== searchSeq.current) return
          setExtraRows((m) => { const next = new Map(m); for (const r of fetched) next.set(r.id, r); return next })
        }
        setSearchIds(ids)
        setSearching(false)
      })()
    }, 300)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => { persistNarcoticView(view) }, [view])
  useEffect(() => { persistNarcoticFilters(filters) }, [filters])

  const stats: NarcoticStats = useMemo(() => ({
    aliases: buildAliasMap(aliases),
    personCounts: countByNarcotic(persons),
    placeCounts: countByNarcotic(places),
    gangCounts: countByNarcotic(gangs),
    seizureCounts: countByNarcotic(seizures),
  }), [aliases, persons, places, gangs, seizures])

  const mediaMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of media) { const src = x.external_url || x.storage_path; if (src) m.set(x.id, src) }
    return m
  }, [media])

  // The lifecycle-visible registry (merged tombstones never counted or shown).
  const visibleRows = useMemo(() => rows.filter((n) => n.status !== 'merged'), [rows])
  const metrics = useMemo(() => buildNarcoticMetrics(visibleRows, now), [visibleRows, now])

  // Per-category counts for the pill row.
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of visibleRows) m.set(n.category, (m.get(n.category) ?? 0) + 1)
    return m
  }, [visibleRows])

  const source = useMemo<RegistryNarcotic[]>(() => {
    if (searchIds === null) return rows
    return searchIds.map((id) => rowMap.get(id) ?? extraRows.get(id)).filter((x): x is RegistryNarcotic => !!x)
  }, [rows, rowMap, extraRows, searchIds])

  const items = useMemo(() => {
    const filtered = applyNarcoticFilters(source, view.category, filters, now)
    // Search results keep the RPC's relevance order; browse gets the sort.
    return searchIds === null ? sortNarcotics(filtered, view.sort) : filtered
  }, [source, view.category, view.sort, filters, now, searchIds])

  const applyMetric = (patch: Partial<NarcoticFilters>) => () => {
    setQuery(''); setView((v) => ({ ...v, category: 'all' })); setFilters({ ...EMPTY_NARCOTIC_FILTERS, ...patch })
  }
  const metricStrip: Metric[] = [
    { label: 'Substances', value: metrics.total, hint: 'Excluding merged', onClick: () => { setQuery(''); setView((v) => ({ ...v, category: 'all' })); setFilters(EMPTY_NARCOTIC_FILTERS) } },
    { label: 'Confirmed', value: metrics.confirmed, tint: metrics.confirmed ? 'bg-emerald-500/15 text-emerald-300' : undefined, onClick: applyMetric({ status: 'confirmed' }) },
    { label: 'Provisional', value: metrics.provisional, tint: metrics.provisional ? 'bg-amber-500/15 text-amber-300' : undefined, hint: 'Reported / unidentified', onClick: applyMetric({ provisional: true }) },
    { label: 'Review due', value: metrics.reviewDue, tint: metrics.reviewDue ? 'bg-amber-500/15 text-amber-300' : undefined, hint: 'Overdue for review', onClick: applyMetric({ reviewDue: true }) },
  ]

  const categoryTabs: SectionTab[] = CATEGORY_PILLS.map((p) => ({
    id: p.value,
    label: p.label,
    count: p.value === 'all' ? visibleRows.length : (categoryCounts.get(p.value) ?? 0),
  }))

  const sig = JSON.stringify([query.trim(), view.category, view.sort, filters])
  const shown = pageState.sig === sig ? pageState.shown : PAGE
  const visible = items.slice(0, shown)
  const remaining = Math.max(0, items.length - visible.length)

  // `?drug=<id>` drills into the dossier (owned by the dossier agent).
  if (drugId) {
    if (state !== 'in') return <Notice text="Live narcotics records require sign-in." />
    return <NarcoticsDossier drugId={drugId} onClose={() => router.push('/narcotics')} />
  }

  const openDrug = (id: string) => router.push(`/narcotics?drug=${encodeURIComponent(id)}`)

  const grid = () => (
    <div className={GRID}>
      {visible.map((n) => (
        <NarcoticsRegistryCard
          key={n.id}
          n={n}
          aliases={stats.aliases.get(n.id) ?? []}
          imageUrl={n.representative_media_id ? (mediaMap.get(n.representative_media_id) ?? null) : null}
          personCount={stats.personCounts.get(n.id) ?? 0}
          placeCount={stats.placeCounts.get(n.id) ?? 0}
          gangCount={stats.gangCounts.get(n.id) ?? 0}
          seizureCount={stats.seizureCounts.get(n.id) ?? 0}
          now={now}
          onOpen={() => openDrug(n.id)}
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
      <Breadcrumbs items={[{ label: 'Intel' }, { label: 'Narcotics' }]} />

      <Card pad="lg">
        <PageHeader
          title="Narcotics Intelligence"
          subtitle="Controlled substances, packaging, investigative indicators, seizures, and linked criminal activity."
          actions={
            <>
              {state === 'in' && <PresenceChip busy={refreshing || searching} />}
              {state === 'in' && (
                <Button onClick={() => setSuggesting(true)}>Suggest correction</Button>
              )}
              {canEdit && (
                <Button variant="primary" onClick={() => setCreating(true)}>Add substance</Button>
              )}
            </>
          }
        />
        {state === 'in' && !err && <MetricStrip metrics={metricStrip} className="mt-4" />}
      </Card>

      {state !== 'in' ? (
        <Notice text="Live narcotics records require sign-in." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search substances, aliases, appearance, packaging…"
              aria-label="Search narcotics"
              className="min-h-[44px] min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-badge-500"
            />
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
              Sort
              <select
                value={view.sort}
                onChange={(e) => setView((v) => ({ ...v, sort: e.target.value as NarcoticSort }))}
                disabled={searchIds !== null}
                title={searchIds !== null ? 'Search results are ranked by relevance' : undefined}
                className="min-h-[44px] rounded-lg border border-white/10 bg-ink-850 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-badge-500 disabled:opacity-50"
              >
                {NARCOTIC_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <Button onClick={() => void refresh()}>Refresh</Button>
          </div>

          <SectionTabs
            tabs={categoryTabs}
            active={view.category}
            onChange={(id) => setView((v) => ({ ...v, category: id }))}
            idBase="narcotics-category"
            ariaLabel="Substance category"
          />

          <NarcoticsFilterBar filters={filters} onFilters={setFilters} />

          {err ? (
            <ErrorNotice message={err} onRetry={refresh} />
          ) : loading && !rows.length ? (
            <CardGridSkeleton cols="sm:grid-cols-2 lg:grid-cols-3" />
          ) : !items.length ? (
            query.trim() ? (
              <Notice text={`No substances match “${query.trim()}”.`} />
            ) : rows.length ? (
              <EmptyState
                title="No substances match this view"
                hint="Try a different category or clear the filters."
                action={{ label: 'Reset view', onClick: () => { setView((v) => ({ ...v, category: 'all' })); setFilters(EMPTY_NARCOTIC_FILTERS) } }}
              />
            ) : (
              <EmptyState
                title="No substances on file yet"
                hint={canEdit ? 'Add one with the Add substance button.' : undefined}
              />
            )
          ) : (
            grid()
          )}
        </>
      )}

      {creating && (
        <NarcoticCreateModal
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void refresh(); openDrug(id) }}
        />
      )}
      {suggesting && (
        <NarcoticSuggestionModal
          substances={visibleRows}
          onClose={() => setSuggesting(false)}
        />
      )}
    </section>
  )
}

/* ---- Filters popover -------------------------------------------------------
 * Category pills + search are the primary surface; this covers the long tail
 * (status, server-specific, restricted, review-due) without a dense toolbar. */
function NarcoticsFilterBar({ filters, onFilters }: { filters: NarcoticFilters; onFilters: (f: NarcoticFilters) => void }) {
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const patch = (p: Partial<NarcoticFilters>) => onFilters({ ...filters, ...p })

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const count = (filters.status ? 1 : 0) + (filters.provisional ? 1 : 0) + (filters.serverSpecific ? 1 : 0) + (filters.restricted ? 1 : 0) + (filters.reviewDue ? 1 : 0)
  const CHIP = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div ref={popRef} className="relative">
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((o) => !o)}
          className={`${CHIP} ${open || count ? 'border-badge-500/60 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
        >
          Filters{count ? ` (${count})` : ''}
        </button>
        {open && (
          <div role="dialog" aria-label="Filters" className="absolute left-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border border-white/10 bg-ink-850 p-3 shadow-glow">
            <Field label="Status">
              {(id) => (
                <Select id={id} value={filters.status} onChange={(e) => patch({ status: e.target.value })}>
                  <option value="">Any status</option>
                  {NARCOTIC_STATUSES.filter((s) => s !== 'merged').map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
              )}
            </Field>
            <div className="space-y-1.5 border-t border-white/5 pt-2">
              <PopCheck label="Provisional (reported / unidentified)" checked={filters.provisional} onChange={(v) => patch({ provisional: v })} />
              <PopCheck label="Server-specific only" checked={filters.serverSpecific} onChange={(v) => patch({ serverSpecific: v })} />
              <PopCheck label="Restricted only" checked={filters.restricted} onChange={(v) => patch({ restricted: v })} />
              <PopCheck label="Review due" checked={filters.reviewDue} onChange={(v) => patch({ reviewDue: v })} />
            </div>
          </div>
        )}
      </div>
      {count > 0 && (
        <button
          type="button"
          onClick={() => onFilters(EMPTY_NARCOTIC_FILTERS)}
          className="inline-flex min-h-[40px] items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

function PopCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[32px] cursor-pointer items-center gap-2 text-xs text-slate-200">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-badge-500" />
      {label}
    </label>
  )
}

/* ---- Add-substance modal (minimal create; the dossier owns rich editing) --- */
function NarcoticCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>('unknown')
  const [status, setStatus] = useState<string>('reported')
  const [classification, setClassification] = useState('')
  const [summary, setSummary] = useState('')
  const [restricted, setRestricted] = useState(false)
  const [serverSpecific, setServerSpecific] = useState(false)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) { toast('Name is required.', 'warn'); return }
    setBusy(true)
    const res = await insert('narcotics', {
      name: name.trim(),
      category,
      status,
      classification: classification.trim() || null,
      summary: summary.trim() || null,
      restricted,
      server_specific: serverSpecific,
    })
    if (res.error) { setBusy(false); toast(`Create failed: ${res.error.message}`, 'danger'); return }
    const id = res.data?.[0]?.id
    setBusy(false)
    if (!id) { toast('Created, but could not open the record.', 'warn'); onClose(); return }
    toast('Substance created', 'success')
    onCreated(id)
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader title="Add substance" onClose={onClose} />
      <div className="space-y-3">
        <Field label="Name" required>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blue Dream" />}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Category">
            {(id) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                {NARCOTIC_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
                {NARCOTIC_STATUSES.filter((s) => s !== 'merged').map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Classification" hint="Legacy free-text label (optional).">
          {(id) => <Input id={id} value={classification} onChange={(e) => setClassification(e.target.value)} />}
        </Field>
        <Field label="Summary">
          {(id) => <Textarea id={id} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} className="h-4 w-4 accent-badge-500" />
            Restricted
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={serverSpecific} onChange={(e) => setServerSpecific(e.target.checked)} className="h-4 w-4 accent-badge-500" />
            Server-specific
          </label>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => void save()}>Create substance</Button>
      </div>
    </Modal>
  )
}

/* ---- Suggestion modal (placeholder — the dossier agent may replace with a
 * richer form). Any active member can report a missing substance or suggest a
 * correction; writes go through the RPC. */
const SUGGESTION_TYPES: ReadonlyArray<{ value: string; label: string; needsNarcotic: boolean }> = [
  { value: 'new_substance', label: 'Missing / new substance', needsNarcotic: false },
  { value: 'incorrect_name', label: 'Incorrect name', needsNarcotic: true },
  { value: 'missing_alias', label: 'Missing alias / street name', needsNarcotic: true },
  { value: 'wrong_category', label: 'Wrong category', needsNarcotic: true },
  { value: 'incorrect_description', label: 'Incorrect description', needsNarcotic: true },
  { value: 'missing_packaging', label: 'Missing packaging detail', needsNarcotic: true },
  { value: 'duplicate', label: 'Duplicate record', needsNarcotic: true },
  { value: 'other', label: 'Other', needsNarcotic: false },
]

function NarcoticSuggestionModal({ substances, onClose }: { substances: RegistryNarcotic[]; onClose: () => void }) {
  const [type, setType] = useState('new_substance')
  const [narcoticId, setNarcoticId] = useState('')
  const [title, setTitle] = useState('')
  const [explanation, setExplanation] = useState('')
  const [proposed, setProposed] = useState('')
  const [busy, setBusy] = useState(false)

  const needsNarcotic = SUGGESTION_TYPES.find((t) => t.value === type)?.needsNarcotic ?? false

  const save = async () => {
    if (!title.trim()) { toast('A title is required.', 'warn'); return }
    if (!explanation.trim()) { toast('An explanation is required.', 'warn'); return }
    if (needsNarcotic && !narcoticId) { toast('Pick the substance this is about.', 'warn'); return }
    setBusy(true)
    // The RPC accepts a null narcotic for 'new_substance'; the generated Args
    // type narrows p_narcotic to string, so cast the single field.
    const res = await rpc('submit_narcotic_suggestion', {
      p_type: type,
      p_narcotic: (narcoticId || null) as string,
      p_title: title.trim(),
      p_explanation: explanation.trim(),
      p_proposed_value: proposed.trim() || undefined,
    })
    setBusy(false)
    if (res.error) { toast(`Submit failed: ${res.error.message}`, 'danger'); return }
    toast('Suggestion submitted for review', 'success')
    onClose()
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader title="Suggest a correction" onClose={onClose} />
      <p className="mb-3 text-xs text-slate-400">
        Report a missing substance or flag something to correct. A catalog manager reviews every suggestion.
      </p>
      <div className="space-y-3">
        <Field label="Type">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
              {SUGGESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label={needsNarcotic ? 'Substance' : 'Related substance (optional)'} required={needsNarcotic}>
          {(id) => (
            <Select id={id} value={narcoticId} onChange={(e) => setNarcoticId(e.target.value)}>
              <option value="">{needsNarcotic ? 'Select a substance…' : 'None (new / missing)'}</option>
              {substances.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Title" required>
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" />}
        </Field>
        <Field label="Explanation" required>
          {(id) => <Textarea id={id} rows={4} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="What should change, and why?" />}
        </Field>
        <Field label="Proposed value" hint="Optional — the corrected name, alias, category, etc.">
          {(id) => <Input id={id} value={proposed} onChange={(e) => setProposed(e.target.value)} />}
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => void save()}>Submit suggestion</Button>
      </div>
    </Modal>
  )
}

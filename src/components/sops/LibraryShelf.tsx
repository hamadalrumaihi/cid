'use client'

/** SOPs & Reference Library landing (shelf). Governance-aware rebuild of the
 *  old two-folder card grid:
 *   - Data via useLibrary (SHELF_COLS projection — never full bodies); every
 *     rule (views, filters, sort, metrics, ack state) comes from docModel.
 *   - Six library views (?view=) + metric tiles that click through to their
 *     filter, filter selects + toggle chips with removable active chips.
 *   - Browse groups by collection (docCategory → CATEGORY_ORDER sections);
 *     ?q= switches to the indexed search_documents RPC (ranked, with [[…]]
 *     match headlines rendered as <mark> — split manually, never
 *     dangerouslySetInnerHTML).
 *   - Grid/list layouts persisted via Store; below sm the list falls back to
 *     cards (matchMedia, PersonsView pattern).
 *  The parent (SopsView) owns the URL; this component reports view/query
 *  changes up and opens documents through onOpenDoc (?doc= deep links). */
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { rpc } from '@/lib/db'
import { fmtDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import type { Database } from '@/lib/database.types'
import { useNow } from '@/lib/useNow'
import { useProfilesStore } from '@/lib/profiles'
import { Store } from '@/lib/store'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Select } from '@/components/ui/Field'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { SectionTabs, panelDomId, tabDomId } from '@/components/ui/SectionTabs'
import { CardGridSkeleton, ListSkeleton } from '@/components/ui/Skeleton'
import {
  CATEGORY_HINT, CATEGORY_LABEL, CATEGORY_ORDER, SORT_LABEL, STATUS_LABEL,
  STATUS_TONE, TYPE_LABEL, VIEWS, VIEW_LABEL, applyDocFilters,
  buildLibraryMetrics, docCategory, docTitle, sortDocs,
  type DocFilters, type DocSort, type DocumentCategory, type DocumentStatus,
  type DocumentType, type LibraryView, type ShelfDoc,
} from './docModel'
import { DocCard, DocListRow } from './DocCard'
import { useLibrary } from './useLibrary'

// Lazy editor (RichEditor pattern) — the TipTap bundle stays out of the shelf
// chunk until command actually creates a document.
const DocEditorModal = dynamic(() => import('./DocEditor').then((m) => m.DocEditorModal), { ssr: false })

type SearchRow = Database['public']['Functions']['search_documents']['Returns'][number]

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'
const CHIP_ON = 'border-badge-500/50 bg-badge-500/15 text-white'
const CHIP_OFF = 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'

/** Boolean DocFilters keys exposed as toggle chips (all `boolean | undefined`,
 *  so a single indexed assignment stays type-safe). */
type BoolFilterKey = 'mandatory' | 'unacked' | 'reviewDue' | 'expired' | 'synced' | 'syncWarning'
const BOOL_FILTERS: ReadonlyArray<{ key: BoolFilterKey; label: string }> = [
  { key: 'mandatory', label: 'Mandatory' },
  { key: 'unacked', label: 'Unacknowledged' },
  { key: 'reviewDue', label: 'Review due' },
  { key: 'expired', label: 'Expired' },
  { key: 'synced', label: 'Drive-synced' },
  { key: 'syncWarning', label: 'Sync warning' },
]

// List layout doesn't stack on narrow screens — honest card fallback below sm
// (matchMedia, not CSS hiding; a hidden duplicate list would double the DOM).
const NARROW_MQ = '(max-width: 639px)'
function subscribeNarrow(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW_MQ)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const narrowSnapshot = (): boolean => window.matchMedia(NARROW_MQ).matches

/** Render a search_documents headline: [[…]] marks matched fragments — split
 *  on the markers (odd indices are matches) and style them; never innerHTML. */
function Headline({ text }: { text: string }) {
  const parts = text.split(/\[\[(.*?)\]\]/)
  return (
    <span className="mt-1 block text-xs leading-5 text-slate-400">
      {parts.map((p, i) =>
        i % 2 === 1
          ? <mark key={i} className="rounded bg-amber-500/20 px-0.5 text-amber-200">{p}</mark>
          : <span key={i}>{p}</span>,
      )}
    </span>
  )
}

function SearchHit({ r, onOpen }: { r: SearchRow; onOpen: () => void }) {
  const status = r.status as DocumentStatus
  const cat = r.category && (CATEGORY_ORDER as readonly string[]).includes(r.category)
    ? CATEGORY_LABEL[r.category as DocumentCategory]
    : null
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block min-h-[44px] w-full rounded-xl border border-white/5 bg-ink-900/60 px-4 py-3 text-left transition hover:border-white/10 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">{docTitle(r.name)}</span>
        <Badge tone="neutral">{TYPE_LABEL[r.document_type as DocumentType] ?? r.document_type}</Badge>
        <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? r.status}</Badge>
        {r.mandatory && <Badge tone="warn">Mandatory</Badge>}
        {cat && <span className="text-[11px] text-slate-400">{cat}</span>}
        <span className="ml-auto text-[11px] tabular-nums text-slate-400">{fmtDate(r.updated_at)}</span>
      </span>
      {r.headline && <Headline text={r.headline} />}
    </button>
  )
}

export function LibraryShelf({ view, q, onView, onQuery, onOpenDoc }: {
  view: LibraryView
  /** Initial ?q= — seeds the input; further changes flow UP via onQuery. */
  q: string
  onView: (v: LibraryView) => void
  onQuery: (q: string) => void
  onOpenDoc: (id: string) => void
}) {
  const { isCommand, isOwner } = useAuth()
  const lib = useLibrary()
  const now = useNow()
  const narrow = useSyncExternalStore(subscribeNarrow, narrowSnapshot, () => false)
  const canCreate = isCommand || isOwner

  const [query, setQuery] = useState(q)
  const [filters, setFilters] = useState<DocFilters>({})
  const [sort, setSort] = useState<DocSort>(() => {
    const s = Store.get<string>('sopsShelfSort', 'updated')
    return s in SORT_LABEL ? (s as DocSort) : 'updated'
  })
  const [layout, setLayout] = useState<'grid' | 'list'>(() =>
    Store.get<string>('sopsShelfLayout', 'grid') === 'list' ? 'list' : 'grid')
  const [editorOpen, setEditorOpen] = useState(false)

  // Owner names come from the shared roster cache; subscribing to `loaded`
  // re-renders the cards once it lands (officerName reads the cache directly).
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  useProfilesStore((s) => s.loaded)
  useEffect(() => { queueMicrotask(() => { void fetchProfiles() }) }, [fetchProfiles])

  useEffect(() => { Store.set('sopsShelfView', view) }, [view])
  useEffect(() => { Store.set('sopsShelfSort', sort) }, [sort])
  useEffect(() => { Store.set('sopsShelfLayout', layout) }, [layout])

  // ── Server search (?q=): debounced 300ms, sequenced against races. The URL
  // update rides the same debounce; onQuery lives in a ref so URL churn from
  // our own replace() doesn't re-trigger the effect. ────────────────────────
  const [search, setSearch] = useState<{ q: string; results: SearchRow[] } | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchTick, setSearchTick] = useState(0)
  const searchSeq = useRef(0)
  const onQueryRef = useRef(onQuery)
  useEffect(() => { onQueryRef.current = onQuery })

  useEffect(() => {
    const qt = query.trim()
    const seq = ++searchSeq.current
    const t = window.setTimeout(() => {
      if (seq !== searchSeq.current) return
      onQueryRef.current(qt)
      if (qt.length < 2) { setSearch(null); setSearchError(null); return }
      void (async () => {
        const res = await rpc('search_documents', { p_query: qt, p_limit: 30 })
        if (seq !== searchSeq.current) return
        if (res.error) { setSearchError(res.error.message); return }
        setSearchError(null)
        setSearch({ q: qt, results: res.data ?? [] })
      })()
    }, 300)
    return () => window.clearTimeout(t)
  }, [query, searchTick])

  const qTrim = query.trim()
  const searchMode = qTrim.length >= 2

  // ── Browse derivations (all rules live in docModel) ──────────────────────
  const rows = lib.rows
  const items = useMemo(
    () => (rows ? sortDocs(applyDocFilters(rows, filters, lib.myAcks, lib.bookmarks, view, now), sort) : []),
    [rows, filters, lib.myAcks, lib.bookmarks, view, now, sort],
  )
  const groups = useMemo(
    () => CATEGORY_ORDER
      .map((cat) => ({ cat, docs: items.filter((d) => docCategory(d) === cat) }))
      .filter((g) => g.docs.length > 0),
    [items],
  )
  const viewCounts = useMemo(() => {
    if (!rows) return null
    const out = {} as Record<LibraryView, number>
    for (const v of VIEWS) out[v] = applyDocFilters(rows, {}, lib.myAcks, lib.bookmarks, v, now).length
    return out
  }, [rows, lib.myAcks, lib.bookmarks, now])

  const m = useMemo(() => (rows ? buildLibraryMetrics(rows, lib.myAcks, now) : null), [rows, lib.myAcks, now])
  const metrics: Metric[] = m ? [
    { label: 'Published', value: m.published, onClick: () => { setFilters({}); onView('library') } },
    { label: 'Required reading', value: m.required, onClick: () => { setFilters({}); onView('required') } },
    { label: 'Awaiting acknowledgement', value: m.awaitingAck, tint: m.awaitingAck ? 'bg-amber-500/15 text-amber-300' : undefined, onClick: () => setFilters({ unacked: true }) },
    { label: 'Review due', value: m.reviewDue, tint: m.reviewDue ? 'bg-amber-500/15 text-amber-300' : undefined, onClick: () => setFilters({ reviewDue: true }) },
    { label: 'Recently updated', value: m.recent, hint: 'Last 7 days', onClick: () => setFilters({ recent: true }) },
    { label: 'Sync warnings', value: m.syncWarnings, tint: m.syncWarnings ? 'bg-rose-500/15 text-rose-300' : undefined, onClick: () => setFilters({ syncWarning: true }) },
  ] : []

  // Active filters as removable chips (selects + toggles share one row).
  const activeFilters: Array<{ key: string; label: string; clear: () => void }> = []
  if (filters.category) activeFilters.push({ key: 'category', label: CATEGORY_LABEL[filters.category], clear: () => setFilters((f) => ({ ...f, category: null })) })
  if (filters.type) activeFilters.push({ key: 'type', label: TYPE_LABEL[filters.type], clear: () => setFilters((f) => ({ ...f, type: null })) })
  if (filters.status) activeFilters.push({ key: 'status', label: STATUS_LABEL[filters.status], clear: () => setFilters((f) => ({ ...f, status: null })) })
  for (const t of BOOL_FILTERS) {
    if (filters[t.key]) activeFilters.push({
      key: t.key,
      label: t.label,
      clear: () => setFilters((f) => { const next: DocFilters = { ...f }; next[t.key] = undefined; return next }),
    })
  }

  const deadlineFor = (d: ShelfDoc): string | null | undefined =>
    view === 'required' ? (lib.campaignDeadlines.get(d.id) ?? d.acknowledgement_deadline) : undefined

  const renderDocs = (docs: ShelfDoc[]) => (
    layout === 'grid' || narrow ? (
      <div className={GRID}>
        {docs.map((d) => (
          <DocCard
            key={d.id}
            d={d} myAcks={lib.myAcks} nowMs={now}
            bookmarked={lib.bookmarks.has(d.id)}
            deadline={deadlineFor(d)}
            onOpen={() => onOpenDoc(d.id)}
            onToggleBookmark={() => void lib.toggleBookmark(d.id)}
          />
        ))}
      </div>
    ) : (
      <div className="space-y-2">
        {docs.map((d) => (
          <DocListRow
            key={d.id}
            d={d} myAcks={lib.myAcks} nowMs={now}
            bookmarked={lib.bookmarks.has(d.id)}
            deadline={deadlineFor(d)}
            onOpen={() => onOpenDoc(d.id)}
            onToggleBookmark={() => void lib.toggleBookmark(d.id)}
          />
        ))}
      </div>
    )
  )

  const hasFilters = activeFilters.length > 0
  const emptyForView: Record<LibraryView, { title: string; hint?: string }> = {
    library: {
      title: 'No documents in the library yet',
      hint: canCreate ? 'Create the first document with the New document button.' : 'Command staff haven’t published any documents yet.',
    },
    required: { title: 'No required reading', hint: 'Nothing needs your acknowledgement right now.' },
    recent: { title: 'Nothing updated in the last 7 days', hint: 'Recently edited or synced documents appear here.' },
    checklists: { title: 'No checklists yet', hint: 'Checklist-type documents appear here.' },
    templates: { title: 'No templates yet', hint: 'Template-type documents appear here.' },
    bookmarks: { title: 'No bookmarks yet', hint: 'Open a document and bookmark it to keep it here.' },
  }

  return (
    <section className="space-y-4">
      {/* ── Header: breadcrumbs, the view's one h1, search, metrics ───────── */}
      <Card pad="lg">
        <Breadcrumbs className="mb-2" items={[{ label: 'Reference' }, { label: 'SOPs & Library' }]} />
        <PageHeader
          title="SOPs & Reference Library"
          subtitle="Operational policy, legal guidance, checklists, and division reference material."
          actions={canCreate && (
            <Button variant="primary" onClick={() => setEditorOpen(true)}>New document</Button>
          )}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the library"
            placeholder="Search titles and document content…"
            className="min-h-[44px] min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-badge-500"
          />
          <div className="inline-flex rounded-lg border border-white/10 bg-ink-850 p-0.5" role="group" aria-label="Layout">
            {(['grid', 'list'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={layout === l}
                onClick={() => setLayout(l)}
                className={`min-h-[40px] rounded-md px-3 py-1 text-xs font-semibold capitalize ${layout === l ? 'bg-badge-500 text-ink-950' : 'text-slate-300 hover:bg-white/10'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <Button className="min-h-[44px] sm:min-h-0" onClick={() => void lib.refresh()} loading={lib.refreshing}>Refresh</Button>
        </div>
        {lib.loadedAt !== null && (
          <p className="mt-2 text-[11px] text-slate-400">
            Refreshed {new Date(lib.loadedAt).toLocaleTimeString('en-US')} — updates live as documents change.
          </p>
        )}
        {m && <MetricStrip metrics={metrics} className="mt-4 lg:grid-cols-6" />}
      </Card>

      {/* ── View tabs (?view=) ─────────────────────────────────────────────── */}
      <SectionTabs
        idBase="sops"
        ariaLabel="Library views"
        tabs={VIEWS.map((v) => ({ id: v, label: VIEW_LABEL[v], count: viewCounts?.[v] }))}
        active={view}
        onChange={onView}
      />

      {/* ── Filter bar (browse mode; search bypasses client filters) ───────── */}
      {!searchMode && (
        <Card pad="sm" className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Collection">
              {(id) => (
                <Select id={id} value={filters.category ?? ''} onChange={(e) => setFilters((f) => ({ ...f, category: (e.target.value || null) as DocumentCategory | null }))}>
                  <option value="">All collections</option>
                  {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Type">
              {(id) => (
                <Select id={id} value={filters.type ?? ''} onChange={(e) => setFilters((f) => ({ ...f, type: (e.target.value || null) as DocumentType | null }))}>
                  <option value="">All types</option>
                  {(Object.keys(TYPE_LABEL) as DocumentType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Status" hint="Default hides archived + superseded.">
              {(id) => (
                <Select id={id} value={filters.status ?? ''} onChange={(e) => setFilters((f) => ({ ...f, status: (e.target.value || null) as DocumentStatus | null }))}>
                  <option value="">Active statuses</option>
                  {(Object.keys(STATUS_LABEL) as DocumentStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Sort">
              {(id) => (
                <Select id={id} value={sort} onChange={(e) => setSort(e.target.value as DocSort)}>
                  {(Object.keys(SORT_LABEL) as DocSort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {BOOL_FILTERS.map((t) => {
              const on = !!filters[t.key]
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilters((f) => { const next: DocFilters = { ...f }; next[t.key] = on ? undefined : true; return next })}
                  className={`min-h-[40px] rounded-full border px-3 py-1 text-xs font-semibold transition ${on ? CHIP_ON : CHIP_OFF}`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
          {hasFilters && (
            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Active</span>
              {activeFilters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={f.clear}
                  aria-label={`Remove filter: ${f.label}`}
                  className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-badge-500/15 px-3 text-xs font-semibold text-badge-200 transition hover:bg-badge-500/25"
                >
                  {f.label} <span aria-hidden>×</span>
                </button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setFilters({})}>Clear all</Button>
            </div>
          )}
        </Card>
      )}

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      <div id={panelDomId('sops', view)} role="tabpanel" aria-labelledby={tabDomId('sops', view)}>
        {searchMode ? (
          searchError ? (
            <ErrorNotice message={searchError} onRetry={() => setSearchTick((t) => t + 1)} />
          ) : !search || search.q !== qTrim ? (
            <ListSkeleton />
          ) : search.results.length ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-400" aria-live="polite">
                {search.results.length} result{search.results.length === 1 ? '' : 's'} for “{search.q}”
              </p>
              {search.results.map((r) => <SearchHit key={r.id} r={r} onOpen={() => onOpenDoc(r.id)} />)}
            </div>
          ) : (
            <EmptyState
              title={`No matches for “${search.q}”`}
              hint="Try different keywords, or clear the search to browse the shelf."
              action={{ label: 'Clear search', onClick: () => setQuery('') }}
            />
          )
        ) : lib.error && rows === null ? (
          <ErrorNotice message={lib.error} onRetry={() => void lib.refresh()} />
        ) : rows === null ? (
          layout === 'grid' || narrow ? <CardGridSkeleton /> : <ListSkeleton />
        ) : (
          <div className="space-y-6">
            {/* A failed refresh keeps stale rows visible — say so, honestly. */}
            {lib.error && <ErrorNotice message={lib.error} onRetry={() => void lib.refresh()} />}
            {!items.length ? (
              rows.length && hasFilters ? (
                <EmptyState
                  title="No documents match your filters"
                  hint="Loosen a filter or clear them all to see the full shelf."
                  action={{ label: 'Clear filters', onClick: () => setFilters({}) }}
                />
              ) : (
                <EmptyState
                  title={emptyForView[view].title}
                  hint={emptyForView[view].hint}
                  action={view === 'library' && canCreate && !rows.length
                    ? { label: 'New document', onClick: () => setEditorOpen(true) }
                    : undefined}
                />
              )
            ) : (
              groups.map((g) => (
                <section key={g.cat}>
                  <SectionHeader title={CATEGORY_LABEL[g.cat]} subtitle={CATEGORY_HINT[g.cat]} className="mb-3" />
                  {renderDocs(g.docs)}
                </section>
              ))
            )}
          </div>
        )}
      </div>

      {editorOpen && (
        <DocEditorModal
          docId={null}
          onClose={() => setEditorOpen(false)}
          onSaved={(id: string) => { setEditorOpen(false); void lib.refresh(); onOpenDoc(id) }}
        />
      )}
    </section>
  )
}

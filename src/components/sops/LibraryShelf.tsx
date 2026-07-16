'use client'

/** SOPs & Reference Library landing — a quiet digital-library shelf.
 *   - Data via useLibrary (SHELF_COLS projection — never full bodies); every
 *     rule (views, filters, sort, ack state) comes from docModel.
 *   - A quiet header (breadcrumb, one h1, a single count line), ONE prominent
 *     search, category pills as the primary browse nav, and the remaining
 *     filters folded into a single focus-managed popover.
 *   - Browse groups by collection (docCategory → CATEGORY_ORDER sections),
 *     each a SectionHeader + a responsive card grid (1 → 2 → 3 → 4 columns).
 *   - ?q= switches to the indexed search_documents RPC (ranked, with [[…]]
 *     match headlines rendered as <mark> — split manually, never
 *     dangerouslySetInnerHTML) whose hits render as cards, not rows.
 *  The parent (SopsView) owns the URL; this component reports view/query
 *  changes up and opens documents through onOpenDoc (?doc= deep links). */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { SectionTabs, panelDomId, tabDomId } from '@/components/ui/SectionTabs'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import {
  CATEGORY_HINT, CATEGORY_LABEL, CATEGORY_ORDER, SORT_LABEL, STATUS_LABEL,
  STATUS_TONE, TYPE_LABEL, VIEWS, VIEW_LABEL, applyDocFilters,
  buildLibraryMetrics, docCategory, docTitle, isRecentlyUpdated, sortDocs,
  type DocFilters, type DocSort, type DocumentCategory, type DocumentStatus,
  type DocumentType, type LibraryView, type ShelfDoc,
} from './docModel'
import { DocCard } from './DocCard'
import { useLibrary } from './useLibrary'

// Lazy editor (RichEditor pattern) — the TipTap bundle stays out of the shelf
// chunk until command actually creates a document.
const DocEditorModal = dynamic(() => import('./DocEditor').then((m) => m.DocEditorModal), { ssr: false })

type SearchRow = Database['public']['Functions']['search_documents']['Returns'][number]

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

/** Short pill labels for the primary category nav (the long CATEGORY_LABEL
 *  reads as a shelf heading; pills need one or two words). */
const CATEGORY_PILL: Record<DocumentCategory, string> = {
  sops: 'SOPs', investigative: 'Investigative', command: 'Command',
  justice: 'Legal', technical: 'Technical',
}

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

const CHIP_ON = 'border-badge-500/50 bg-badge-500/15 text-white'
const CHIP_OFF = 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'

/** Render a search_documents headline: [[…]] marks matched fragments — split
 *  on the markers (odd indices are matches) and style them; never innerHTML. */
function Headline({ text }: { text: string }) {
  const parts = text.split(/\[\[(.*?)\]\]/)
  return (
    <span className="block text-xs leading-5 text-slate-400">
      {parts.map((p, i) =>
        i % 2 === 1
          ? <mark key={i} className="rounded bg-amber-500/20 px-0.5 text-amber-200">{p}</mark>
          : <span key={i}>{p}</span>,
      )}
    </span>
  )
}

/** Search hit rendered in the DocCard visual language (no bookmark — the RPC
 *  row carries no per-user reading state). */
function SearchHitCard({ r, onOpen }: { r: SearchRow; onOpen: () => void }) {
  const status = r.status as DocumentStatus
  const category = r.category && (CATEGORY_ORDER as readonly string[]).includes(r.category)
    ? CATEGORY_LABEL[r.category as DocumentCategory]
    : null
  return (
    <Card interactive className="flex flex-col gap-2">
      {category && (
        <span className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">{category}</span>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="min-h-[44px] min-w-0 rounded-lg text-left text-sm font-semibold leading-snug text-white transition hover:text-badge-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
      >
        {docTitle(r.name)}
      </button>
      <span className="flex flex-wrap items-center gap-1.5">
        {status !== 'published' && <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? r.status}</Badge>}
        {r.mandatory && <Badge tone="warn">Mandatory</Badge>}
        <Badge tone="neutral">{TYPE_LABEL[r.document_type as DocumentType] ?? r.document_type}</Badge>
      </span>
      {r.headline && <Headline text={r.headline} />}
      <p className="mt-auto pt-2 text-[11px] tabular-nums text-slate-400">Updated {fmtDate(r.updated_at)}</p>
    </Card>
  )
}

/** Category pill — the primary browse nav. `null` is the "All" pill. */
function CategoryPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[40px] rounded-full border px-4 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500 ${
        active ? CHIP_ON : CHIP_OFF
      }`}
    >
      {label}
    </button>
  )
}

/** The single filters popover — type / status / sort selects and the boolean
 *  toggles. Focus-managed (first control on open, Esc closes and restores the
 *  trigger, Tab wraps within the panel) and dismissed on outside click. */
function FilterPopover({ filters, sort, activeCount, onFilters, onSort, onClear }: {
  filters: DocFilters
  sort: DocSort
  activeCount: number
  onFilters: (next: DocFilters) => void
  onSort: (s: DocSort) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback((focusTrigger = false) => {
    setOpen(false)
    if (focusTrigger) btnRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(true) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close])

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('select,button,input')?.focus()
  }, [open])

  // Focus trap: Tab wraps within the panel so keyboard focus can't escape to
  // the page behind the open popover.
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const nodes = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('select,button,input,[tabindex]:not([tabindex="-1"])') ?? [],
    ).filter((n) => n.offsetParent !== null)
    if (!nodes.length) return
    const first = nodes[0], last = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const setBool = (key: BoolFilterKey, on: boolean) => {
    const next: DocFilters = { ...filters }
    next[key] = on ? true : undefined
    onFilters(next)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
      >
        <span aria-hidden>⚙</span> Filters
        {activeCount > 0 && (
          <span className="rounded-full bg-badge-500 px-1.5 text-[11px] font-bold tabular-nums text-ink-950">{activeCount}</span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Filter and sort documents"
          onKeyDown={onPanelKey}
          className="absolute right-0 z-30 mt-2 w-[min(20rem,90vw)] space-y-3 rounded-2xl border border-white/10 bg-ink-850 p-4 shadow-glow"
        >
          <Field label="Type">
            {(id) => (
              <Select id={id} value={filters.type ?? ''} onChange={(e) => onFilters({ ...filters, type: (e.target.value || null) as DocumentType | null })}>
                <option value="">All types</option>
                {(Object.keys(TYPE_LABEL) as DocumentType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Status" hint="Default hides archived + superseded.">
            {(id) => (
              <Select id={id} value={filters.status ?? ''} onChange={(e) => onFilters({ ...filters, status: (e.target.value || null) as DocumentStatus | null })}>
                <option value="">Active statuses</option>
                {(Object.keys(STATUS_LABEL) as DocumentStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Sort">
            {(id) => (
              <Select id={id} value={sort} onChange={(e) => onSort(e.target.value as DocSort)}>
                {(Object.keys(SORT_LABEL) as DocSort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
              </Select>
            )}
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-semibold text-slate-400">Show only</legend>
            <div className="flex flex-wrap gap-1.5">
              {BOOL_FILTERS.map((t) => {
                const on = !!filters[t.key]
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setBool(t.key, !on)}
                    className={`min-h-[36px] rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500 ${on ? CHIP_ON : CHIP_OFF}`}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
          </fieldset>
          {activeCount > 0 && (
            <div className="flex justify-end border-t border-white/5 pt-3">
              <Button size="sm" variant="ghost" onClick={onClear}>Clear all</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function LibraryShelf({
  view, q, onView, onQuery, onOpenDoc,
  canSuggest = false, canReviewSuggestions = false, onSuggest, onReviewSuggestions,
}: {
  view: LibraryView
  /** Initial ?q= — seeds the input; further changes flow UP via onQuery. */
  q: string
  onView: (v: LibraryView) => void
  onQuery: (q: string) => void
  onOpenDoc: (id: string) => void
  /** Active members may suggest an improvement; managers may open the review. */
  canSuggest?: boolean
  canReviewSuggestions?: boolean
  onSuggest?: () => void
  onReviewSuggestions?: () => void
}) {
  const { isCommand, isOwner } = useAuth()
  const lib = useLibrary()
  const now = useNow()
  const canCreate = isCommand || isOwner

  const [query, setQuery] = useState(q)
  const [filters, setFilters] = useState<DocFilters>({})
  const [sort, setSort] = useState<DocSort>(() => {
    const s = Store.get<string>('sopsShelfSort', 'updated')
    return s in SORT_LABEL ? (s as DocSort) : 'updated'
  })
  const [editorOpen, setEditorOpen] = useState(false)

  // Owner names come from the shared roster cache; subscribing to `loaded`
  // re-renders the cards once it lands (officerName reads the cache directly).
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  useProfilesStore((s) => s.loaded)
  useEffect(() => { queueMicrotask(() => { void fetchProfiles() }) }, [fetchProfiles])

  useEffect(() => { Store.set('sopsShelfView', view) }, [view])
  useEffect(() => { Store.set('sopsShelfSort', sort) }, [sort])

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

  // Featured "Recently updated" strip — top 4 active docs edited in the last
  // 7 days (the existing recent logic), shown only when browsing the whole
  // library with no filters applied.
  const recentDocs = useMemo(() => {
    if (!rows) return []
    return sortDocs(
      rows.filter((d) => isRecentlyUpdated(d, now) && d.status !== 'archived' && d.status !== 'superseded'),
      'updated',
    ).slice(0, 4)
  }, [rows, now])

  const metrics = useMemo(() => (rows ? buildLibraryMetrics(rows, lib.myAcks, now) : null), [rows, lib.myAcks, now])

  // Active-filter count for the popover badge (category is a pill, not counted).
  const filterCount =
    (filters.type ? 1 : 0) + (filters.status ? 1 : 0) +
    BOOL_FILTERS.reduce((n, t) => n + (filters[t.key] ? 1 : 0), 0)
  const hasAnyFilter = filterCount > 0 || !!filters.category

  const clearFilters = () => { setFilters({}); setSort('updated') }

  const deadlineFor = (d: ShelfDoc): string | null | undefined =>
    view === 'required' ? (lib.campaignDeadlines.get(d.id) ?? d.acknowledgement_deadline) : undefined

  const renderGrid = (docs: ShelfDoc[]) => (
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
  )

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

  // Featured strip only makes sense on the default Library view with a clean
  // slate; other views ARE their own curated list.
  const showFeatured = view === 'library' && !hasAnyFilter && recentDocs.length > 0

  return (
    <section className="space-y-5">
      {/* ── Quiet header: breadcrumb, one h1, subtitle, a single count line ── */}
      <header>
        <Breadcrumbs className="mb-2" items={[{ label: 'Reference' }, { label: 'SOPs & Library' }]} />
        <PageHeader
          title="SOPs & Reference Library"
          subtitle="Operational policy, legal guidance, checklists, and division reference material."
          actions={
            <>
              {canReviewSuggestions && onReviewSuggestions && (
                <Button onClick={onReviewSuggestions}>Review suggestions</Button>
              )}
              {canSuggest && onSuggest && (
                <Button onClick={onSuggest}>Suggest an improvement</Button>
              )}
              {canCreate && (
                <Button variant="primary" onClick={() => setEditorOpen(true)}>New document</Button>
              )}
            </>
          }
        />
        {metrics && rows && (
          <p className="mt-2 text-sm text-slate-400" aria-live="polite">
            {rows.length} document{rows.length === 1 ? '' : 's'}
            {metrics.awaitingAck > 0 && ` · ${metrics.awaitingAck} need${metrics.awaitingAck === 1 ? 's' : ''} your acknowledgement`}
          </p>
        )}
      </header>

      {/* ── One prominent search ────────────────────────────────────────────── */}
      <div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the library"
          placeholder="Search titles and document content…"
          className="min-h-[48px] w-full rounded-xl border border-white/10 bg-ink-850 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-badge-500"
        />
      </div>

      {searchMode ? (
        /* ── Search results (cards) ──────────────────────────────────────── */
        <div>
          {searchError ? (
            <ErrorNotice message={searchError} onRetry={() => setSearchTick((t) => t + 1)} />
          ) : !search || search.q !== qTrim ? (
            <CardGridSkeleton cols="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" />
          ) : search.results.length ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-400" aria-live="polite">
                {search.results.length} result{search.results.length === 1 ? '' : 's'} for “{search.q}”
              </p>
              <div className={GRID}>
                {search.results.map((r) => <SearchHitCard key={r.id} r={r} onOpen={() => onOpenDoc(r.id)} />)}
              </div>
            </div>
          ) : (
            <EmptyState
              title={`No matches for “${search.q}”`}
              hint="Try different keywords, or clear the search to browse the shelf."
              action={{ label: 'Clear search', onClick: () => setQuery('') }}
            />
          )}
        </div>
      ) : (
        <>
          {/* ── View tabs (?view=) ──────────────────────────────────────────── */}
          <SectionTabs
            idBase="sops"
            ariaLabel="Library views"
            tabs={VIEWS.map((v) => ({ id: v, label: VIEW_LABEL[v], count: viewCounts?.[v] }))}
            active={view}
            onChange={onView}
          />

          {/* ── Category pills (primary browse nav) + filters popover ───────── */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by collection">
              <CategoryPill label="All" active={!filters.category} onClick={() => setFilters((f) => ({ ...f, category: null }))} />
              {CATEGORY_ORDER.map((c) => (
                <CategoryPill
                  key={c}
                  label={CATEGORY_PILL[c]}
                  active={filters.category === c}
                  onClick={() => setFilters((f) => ({ ...f, category: f.category === c ? null : c }))}
                />
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <FilterPopover
                filters={filters}
                sort={sort}
                activeCount={filterCount}
                onFilters={setFilters}
                onSort={setSort}
                onClear={clearFilters}
              />
              <Button className="min-h-[40px]" onClick={() => void lib.refresh()} loading={lib.refreshing}>Refresh</Button>
            </div>
          </div>

          {/* ── Results ─────────────────────────────────────────────────────── */}
          <div id={panelDomId('sops', view)} role="tabpanel" aria-labelledby={tabDomId('sops', view)}>
            {lib.error && rows === null ? (
              <ErrorNotice message={lib.error} onRetry={() => void lib.refresh()} />
            ) : rows === null ? (
              <CardGridSkeleton cols="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" />
            ) : (
              <div className="space-y-8">
                {/* A failed refresh keeps stale rows visible — say so, honestly. */}
                {lib.error && <ErrorNotice message={lib.error} onRetry={() => void lib.refresh()} />}

                {showFeatured && (
                  <section>
                    <SectionHeader title="Recently updated" subtitle="Edited or synced in the last 7 days" className="mb-3" />
                    {renderGrid(recentDocs)}
                  </section>
                )}

                {!items.length ? (
                  rows.length && hasAnyFilter ? (
                    <EmptyState
                      title="No documents match your filters"
                      hint="Loosen a filter or clear them all to see the full shelf."
                      action={{ label: 'Clear filters', onClick: clearFilters }}
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
                      {renderGrid(g.docs)}
                    </section>
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}

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

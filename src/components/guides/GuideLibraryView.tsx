'use client'

/** The Guide Library (/guides) — the division's whole document shelf.
 *
 *  SOPs, policies, procedures, guides, forms, report templates, references and
 *  training material are all here, because they are all the same kind of
 *  object: something written down that somebody has to be able to find. What
 *  distinguishes them is metadata (type, category, access, status), not which
 *  page they live on.
 *
 *  ── The default screen ───────────────────────────────────────────────────
 *  Arriving with no question in mind, a reader sees: what they were part-way
 *  through, what the division pinned, what changed recently, then everything.
 *  A zone with nothing in it does not render — an empty "Continue Reading" is
 *  noise, not a promise.
 *
 *  The moment a reader narrows — a word in the box, a type chip, anything in
 *  the filter panel — the zones stand down and the screen answers the actual
 *  question. Recommendations are for people who have not asked yet.
 *
 *  ── Filters ──────────────────────────────────────────────────────────────
 *  There are 20 categories, 8 document types, 8 audiences and 4 statuses. As
 *  permanent rows of buttons that was 40 controls to read before the first
 *  document. So one quick row carries the four types people actually reach
 *  for, and everything else lives behind ONE Filters control (LibraryFilters).
 *  Nothing was removed: what is applied always shows as a removable chip above
 *  the results, so the view can never be narrowed invisibly.
 *
 *  Facet counts are computed with every filter EXCEPT the group's own applied,
 *  which is what makes a count honest: "Forms 3" means picking Forms returns
 *  three, given everything else already chosen.
 *
 *  There is deliberately no Bureau filter: `guides` carries no bureau column,
 *  and a filter that cannot narrow anything is worse than a missing one.
 *
 *  Search here is server-side and answers *which document and which section*,
 *  so a result opens at the match. It runs over the same policies as
 *  everything else, so a restricted document cannot appear in it — not as a
 *  title, not as a count, not as a snippet.
 *
 *  Authority: what comes back from the server IS the answer. Drafts and
 *  archived documents reach an editor because RLS lets them; the editor
 *  controls below are cosmetic and every one calls an RPC that re-checks. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fmtDate } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { useRegistry } from '@/lib/useRegistry'
import {
  EMPTY_GUIDE_LIBRARY, GUIDE_AUDIENCES, GUIDE_AUDIENCE_LABEL, GUIDE_SORTS, GUIDE_SORT_LABEL,
  GUIDE_DOC_TYPES, GUIDE_DOC_TYPE_LABEL, GUIDE_STATUSES, GUIDE_STATUS_LABEL,
  categoryLabelFrom, guideAudienceLabel, guideDocFamily, guideDocTypeLabel, guideStatusLabel,
  guideStatusOf, isArchived, isNewToReader, isPublished, isRestrictedAudience, isSuperseded,
  isUpdatedSinceSeen, loadGuideLibrary,
  matchGuides, searchGuides, setGuideArchived, setGuidePinned, setGuidePublished, sortGuides,
  toggleGuideBookmark,
  type GuideAudience, type GuideDocType, type GuideLibraryModel, type GuideRow, type GuideSearchHit,
  type GuideSort, type GuideStatusFilter,
} from '@/lib/guides'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { CardSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { useNav } from '@/components/shell/useNav'
import { GuideCard } from './GuideCard'
import { GuideAdminPanel } from './GuideAdminPanel'
import { GuideEditorDialog } from './GuideEditorDialog'
import { guideBody } from './guideRegistry'
import { ActiveFilterChips, LibraryFilters, type FilterGroup, type FilterOption } from './LibraryFilters'
import {
  CHIP, CHIP_DONE, CHIP_FORM, CHIP_LOCKED, CHIP_NEUTRAL, CHIP_TYPE, CHIP_WARN,
  GOLD_TEXT, GUIDE_CANVAS, PANEL, SLAB,
} from './guideSurfaces'

/** The types worth a permanent chip. The other four (policy, report template,
 *  reference, training) are one click further in, under Document Type. */
const QUICK_TYPES: readonly GuideDocType[] = ['sop', 'procedure', 'guide', 'form']

/** A quiet filter chip. The pressed state is carried by `aria-pressed` and by
 *  the word in the chip, never by colour alone. */
function FilterChip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`${CHIP} ${on ? CHIP_DONE : CHIP_NEUTRAL} min-h-[32px] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      {on && <span aria-hidden>✓</span>}
      {label}
    </button>
  )
}

/** One search result.
 *
 *  A hit is a SECTION, not a document, so it opens at the match — and it has
 *  to say enough for a reader to know whether the match is worth following:
 *  which document, what that document is, what it is about, who may read it,
 *  whether it is still in force, and the words around the match.
 *
 *  ── Snippets and access ──────────────────────────────────────────────────
 *  Nothing here decides what may be shown. Both halves of the search run
 *  under the reader's own policies — `guides_search` is SECURITY INVOKER and
 *  inner-joins `public.guides`, and the module half runs over the rows RLS
 *  already returned — so a restricted document produces no hit at all for a
 *  reader outside its audience: no title, no heading, no snippet, no count.
 *  The access chip below is therefore a reminder to somebody who may read it,
 *  never a disclosure to somebody who may not. */
function SearchHit({ hit, row, categoryLabel, onOpen }: {
  hit: GuideSearchHit
  /** The document row, when the library has loaded it. Absent only in the
   *  moment before the browse read settles; the result still opens. */
  row: GuideRow | undefined
  categoryLabel: string
  onOpen: () => void
}) {
  const restricted = row ? isRestrictedAudience(row.audience) : false
  const notCurrent = row ? guideStatusOf(row) !== 'published' : false
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${SLAB} w-full px-3 py-2.5 text-left transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={`mr-1 break-words text-sm font-semibold ${GOLD_TEXT}`}>{hit.title}</span>
        {row && (
          <span className={`${CHIP} ${guideDocFamily(row.doc_type) === 'form' ? CHIP_FORM : CHIP_TYPE}`}>
            {guideDocTypeLabel(row.doc_type)}
          </span>
        )}
        <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{categoryLabel}</span>
        {restricted && row && (
          <span className={`${CHIP} ${CHIP_LOCKED}`} title={guideAudienceLabel(row.audience)}>Restricted</span>
        )}
        {notCurrent && row && <span className={`${CHIP} ${CHIP_WARN}`}>{guideStatusLabel(row)}</span>}
      </span>
      {/* The section, then the words around the match. The heading is the
          more useful of the two — it is what the reader will land on. */}
      <span className="mt-1 block text-sm text-slate-200">{hit.heading}</span>
      {hit.snippet && <span className="mt-0.5 block line-clamp-2 text-xs text-slate-500">{hit.snippet.trim()}</span>}
    </button>
  )
}

function Zone({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const id = `gz-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div>
        <h2 id={id} className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

const toggleIn = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

export function GuideLibraryView() {
  const router = useRouter()
  const { navigate } = useNav()
  const { can, ready: permsReady } = usePermissions()
  const mayEdit = permsReady && can('edit', 'guide') === true

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<GuideSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [cats, setCats] = useState<ReadonlySet<string>>(new Set())
  const [audiences, setAudiences] = useState<ReadonlySet<string>>(new Set())
  const [types, setTypes] = useState<ReadonlySet<string>>(new Set())
  // Empty means the default view: what is CURRENTLY in force. A superseded
  // document is still readable and still searchable — it is simply not the
  // answer to "what are the rules", so it waits behind its own filter or
  // behind the link on the document that replaced it.
  const [statuses, setStatuses] = useState<ReadonlySet<string>>(new Set())
  const [onlyBookmarked, setOnlyBookmarked] = useState(false)
  const [sort, setSort] = useState<GuideSort>('updated')
  const [editing, setEditing] = useState<GuideRow | null | 'new'>(null)

  // One read for the whole screen: the guides, the category list, and this
  // reader's own bookmarks, progress and covers (lib/guides). The guides are
  // the hard part — a companion read that fails degrades to empty rather than
  // withholding the library. useRegistry carries the realtime refresh and the
  // stale-while-revalidate rule as it does for every registry; the model is
  // its single "row", so an optimistic edit is a patch to that model.
  const { rows: loaded, loading, error, refresh, setRows } = useRegistry<GuideLibraryModel>({
    table: 'guides',
    load: async () => [await loadGuideLibrary()],
  })
  const model = loaded[0] ?? EMPTY_GUIDE_LIBRARY
  const { guides: rows, categories, bookmarks, progress, covers } = model

  /** Patch the loaded model in place — for an edit that is instant and
   *  reversible, with refresh() settling the real answer a beat later. */
  const patchModel = useCallback((fn: (m: GuideLibraryModel) => GuideLibraryModel) => {
    setRows((prev) => (prev.length ? [fn(prev[0])] : prev))
  }, [setRows])

  // Server-side search, debounced. A blank box clears back to the browse view
  // rather than showing an empty result list.
  useEffect(() => {
    const q = query.trim()
    let live = true
    // Every setState below is in the timer callback, never in the effect body
    // itself: settling state synchronously with the render is the cascading
    // render the compiler lint rejects.
    const t = setTimeout(() => {
      if (!live) return
      if (!q) { setHits(null); setSearching(false); return }
      setSearching(true)
      void searchGuides(q).then((r) => { if (live) { setHits(r); setSearching(false) } })
    }, q ? 200 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [query])

  /** Sections of the documents whose prose is in the build, matched here
   *  rather than in the database. There is one copy of that text — the module
   *  — so the search can never drift from what the document says. This runs
   *  only over `rows`, which is what RLS already returned to this reader, so a
   *  document they may not see cannot surface through it. */
  const bodyHits = useMemo<GuideSearchHit[]>(() => {
    const q = query.trim()
    if (!q) return []
    const lower = q.toLowerCase()
    const out: GuideSearchHit[] = []
    for (const g of rows) {
      const body = guideBody(g.body_key)
      if (!body) continue
      for (const h of body.searchSections(q)) {
        out.push({
          guide_id: g.id, slug: g.slug, title: g.title, summary: g.summary, category: g.category,
          anchor: h.anchor, heading: h.heading, snippet: h.snippet,
          rank: (g.title.toLowerCase().includes(lower) ? 3 : 0)
            + (h.heading.toLowerCase().includes(lower) ? 2 : 0) + 1,
        })
      }
    }
    return out
  }, [rows, query])

  /** The two halves of the search, in one list: the server's sections
   *  (documents written in the editor) and the build's (written as modules). */
  const allHits = useMemo<GuideSearchHit[] | null>(() => {
    if (hits === null && !query.trim()) return null
    const seen = new Set<string>()
    return [...(hits ?? []), ...bodyHits]
      .filter((h) => {
        const key = `${h.guide_id}-${h.anchor}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title) || a.heading.localeCompare(b.heading))
  }, [hits, bodyHits, query])

  /** Every document this reader may see, by id — so a search result can show
   *  what the document IS without a second read. The row came back through
   *  the same policies as the hit itself, so nothing here can describe a
   *  document the reader could not already open. */
  const byId = useMemo(() => new Map(rows.map((g) => [g.id, g])), [rows])

  /* ---- the filter model ------------------------------------------------- */

  const statusOptionValues = useMemo<readonly GuideStatusFilter[]>(
    // Superseded is offered to every reader, not just editors: the history of
    // a policy is division reading, and hiding it would make "what did the
    // rules used to say" unanswerable. Drafts and archived stay with the
    // people who manage them.
    () => (mayEdit ? GUIDE_STATUSES : (['published', 'superseded'] as const)),
    [mayEdit],
  )

  const { shown, groups, chips } = useMemo(() => {
    const base = matchGuides(rows, query)
      .filter((g) => !onlyBookmarked || bookmarks.has(g.id))

    const pred = {
      type: (g: GuideRow) => !types.size || types.has(g.doc_type),
      category: (g: GuideRow) => !cats.size || cats.has(g.category),
      access: (g: GuideRow) => !audiences.size || audiences.has(g.audience),
      status: (g: GuideRow) => (statuses.size
        ? statuses.has(guideStatusOf(g))
        : !isArchived(g) && !isSuperseded(g)),
    }
    const keys = ['type', 'category', 'access', 'status'] as const

    /** The pool a group's own counts are measured against: everything else is
     *  applied, its own dimension is not. Counting against the fully-filtered
     *  list would print a 0 beside every option a reader has not picked. */
    const poolFor = (skip: (typeof keys)[number]) =>
      base.filter((g) => keys.every((k) => k === skip || pred[k](g)))

    const countBy = (pool: readonly GuideRow[], of: (g: GuideRow) => string) => {
      const m = new Map<string, number>()
      for (const g of pool) { const k = of(g); m.set(k, (m.get(k) ?? 0) + 1) }
      return m
    }
    const typeCounts = countBy(poolFor('type'), (g) => g.doc_type)
    const catCounts = countBy(poolFor('category'), (g) => g.category)
    const accessCounts = countBy(poolFor('access'), (g) => g.audience)
    const statusCounts = countBy(poolFor('status'), guideStatusOf)

    /** Offer an option only when the data carries it — plus anything already
     *  ticked, so a choice that has emptied the list can still be un-ticked.
     *  And offer a whole group only when there is something to choose
     *  BETWEEN: one option narrows nothing, it just costs a click to find
     *  that out. An empty group is dropped by LibraryFilters itself. */
    const optionsOf = (
      values: readonly string[], counts: Map<string, number>,
      label: (v: string) => string, selected: ReadonlySet<string>,
    ): FilterOption[] => {
      const out = values
        .filter((v) => (counts.get(v) ?? 0) > 0 || selected.has(v))
        .map((v) => ({ value: v, label: label(v), count: counts.get(v) ?? 0 }))
      return out.length > 1 ? out : []
    }

    const nextGroups: FilterGroup[] = [
      {
        id: 'type',
        label: 'Document type',
        options: optionsOf(GUIDE_DOC_TYPES, typeCounts, (v) => GUIDE_DOC_TYPE_LABEL[v as GuideDocType], types),
        selected: types,
        onToggle: (v) => setTypes((p) => toggleIn(p, v)),
      },
      {
        id: 'category',
        label: 'Category',
        options: optionsOf(
          categories.map((c) => c.slug), catCounts,
          (v) => categoryLabelFrom(categories, v), cats,
        ),
        selected: cats,
        onToggle: (v) => setCats((p) => toggleIn(p, v)),
      },
      {
        id: 'access',
        label: 'Access',
        options: optionsOf(GUIDE_AUDIENCES, accessCounts, (v) => GUIDE_AUDIENCE_LABEL[v as GuideAudience], audiences),
        selected: audiences,
        onToggle: (v) => setAudiences((p) => toggleIn(p, v)),
      },
      {
        id: 'status',
        label: 'Status',
        options: optionsOf(statusOptionValues, statusCounts, (v) => GUIDE_STATUS_LABEL[v as GuideStatusFilter], statuses),
        selected: statuses,
        onToggle: (v) => setStatuses((p) => toggleIn(p, v)),
      },
    ]

    /** What is applied, said in words, each one removable where it is shown. */
    const nextChips: { key: string; label: string; onRemove: () => void }[] = [
      ...[...types].map((v) => ({
        key: `type-${v}`,
        label: GUIDE_DOC_TYPE_LABEL[v as GuideDocType] ?? v,
        onRemove: () => setTypes((p) => toggleIn(p, v)),
      })),
      ...[...cats].map((v) => ({
        key: `cat-${v}`,
        label: categoryLabelFrom(categories, v),
        onRemove: () => setCats((p) => toggleIn(p, v)),
      })),
      ...[...audiences].map((v) => ({
        key: `acc-${v}`,
        label: GUIDE_AUDIENCE_LABEL[v as GuideAudience] ?? v,
        onRemove: () => setAudiences((p) => toggleIn(p, v)),
      })),
      ...[...statuses].map((v) => ({
        key: `st-${v}`,
        label: GUIDE_STATUS_LABEL[v as GuideStatusFilter] ?? v,
        onRemove: () => setStatuses((p) => toggleIn(p, v)),
      })),
    ]
    if (onlyBookmarked) {
      nextChips.push({ key: 'bookmarked', label: 'Bookmarked', onRemove: () => setOnlyBookmarked(false) })
    }

    return {
      shown: sortGuides(base.filter((g) => keys.every((k) => pred[k](g))), sort),
      groups: nextGroups,
      chips: nextChips,
    }
  }, [rows, query, cats, types, audiences, statuses, onlyBookmarked, bookmarks, sort,
      categories, statusOptionValues])

  const activeCount = types.size + cats.size + audiences.size + statuses.size + (onlyBookmarked ? 1 : 0)
  /** Whether the reader has asked a question yet. Until they have, the screen
   *  suggests; once they have, it answers. */
  const narrowed = activeCount > 0 || query.trim().length > 0

  const clearFilters = useCallback(() => {
    setQuery(''); setCats(new Set()); setTypes(new Set()); setAudiences(new Set())
    setStatuses(new Set()); setOnlyBookmarked(false)
  }, [])

  const readMinutesOf = useCallback(
    (g: GuideRow) => g.read_minutes ?? guideBody(g.body_key)?.readMinutes ?? 3,
    [],
  )

  const open = useCallback((g: GuideRow, anchor?: string | null) => {
    router.push(anchor ? `/guides/${g.slug}#${anchor}` : `/guides/${g.slug}`)
  }, [router])

  const onBookmark = async (g: GuideRow) => {
    const next = await toggleGuideBookmark(g.id)
    if (next === null) return
    patchModel((m) => {
      const s = new Set(m.bookmarks)
      if (next) s.add(g.id)
      else s.delete(g.id)
      return { ...m, bookmarks: s }
    })
  }

  const editorFor = (g: GuideRow) =>
    mayEdit
      ? {
          onEdit: () => setEditing(g),
          onTogglePublished: async () => {
            if (await setGuidePublished(g.id, !isPublished(g))) await refresh()
          },
          onTogglePinned: async () => {
            // Optimistic: a pin is instant and reversible, and refresh()
            // settles the real answer a beat later.
            patchModel((m) => ({
              ...m,
              guides: sortGuides(m.guides.map((r) => (r.id === g.id ? { ...r, pinned: !g.pinned } : r)), sort),
            }))
            if (!(await setGuidePinned(g.id, !g.pinned))) await refresh()
          },
        }
      : undefined

  const card = (g: GuideRow) => (
    <GuideCard
      key={g.id}
      guide={g}
      categoryLabel={categoryLabelFrom(categories, g.category)}
      readMinutes={readMinutesOf(g)}
      coverSrc={covers[g.id] ?? null}
      bookmarked={bookmarks.has(g.id)}
      progress={progress.get(g.id)}
      lastUpdatedText={fmtDate(g.updated_at)}
      isNew={isNewToReader(g, progress.get(g.id))}
      isUpdated={isUpdatedSinceSeen(g, progress.get(g.id))}
      onOpen={() => open(g)}
      onToggleBookmark={() => { void onBookmark(g) }}
      editor={editorFor(g)}
    />
  )

  const grid = (list: GuideRow[]) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{list.map(card)}</div>
  )

  /* ---- the browse zones (default screen only) --------------------------- */

  const continueReading = useMemo(
    () => shown
      .filter((g) => { const p = progress.get(g.id); return p?.last_anchor && !p.completed_at })
      .sort((a, b) => (progress.get(b.id)?.last_viewed_at ?? '').localeCompare(progress.get(a.id)?.last_viewed_at ?? ''))
      .slice(0, 3),
    [shown, progress],
  )
  const pinned = shown.filter((g) => g.pinned)
  const recent = useMemo(
    () => [...shown].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, 4),
    [shown],
  )

  return (
    <div className={`${GUIDE_CANVAS} -mx-3 -my-4 px-3 py-4 sm:-mx-6 sm:px-6`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <h1 className={`text-2xl font-black uppercase tracking-[0.18em] ${GOLD_TEXT}`}>Guide Library</h1>
            <p className="max-w-3xl text-sm text-slate-300">
              Every written document the division works from: standard operating procedures, policies, procedures,
              forms, report templates, references and training material. What a document <em>is</em> shows on its
              card and filters from here; the Penal Code keeps its own destination.
            </p>
          </div>
          {mayEdit && <Button size="sm" onClick={() => setEditing('new')}>New document</Button>}
        </header>

        {/* Search first — it is how most people arrive at a document they can
            already name. The narrowing controls sit under it, small. */}
        <div className="flex flex-col gap-3">
          <Field label="Search the library" hint="Searches titles, summaries, section headings, tags and keywords.">
            {(id) => (
              <Input
                id={id}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What are you trying to do?"
              />
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterChip on={!types.size} label="All" onClick={() => setTypes(new Set())} />
              {QUICK_TYPES.map((t) => (
                <FilterChip
                  key={t}
                  on={types.has(t)}
                  label={GUIDE_DOC_TYPE_LABEL[t]}
                  onClick={() => setTypes((p) => toggleIn(p, t))}
                />
              ))}
              <span aria-hidden className="mx-1 h-4 w-px bg-white/10" />
              <FilterChip on={onlyBookmarked} label="Bookmarked" onClick={() => setOnlyBookmarked((v) => !v)} />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <label htmlFor="guide-sort" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sort</label>
              <select
                id="guide-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as GuideSort)}
                className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-xs text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {GUIDE_SORTS.map((s) => <option key={s} value={s}>{GUIDE_SORT_LABEL[s]}</option>)}
              </select>
              <LibraryFilters groups={groups} activeCount={activeCount} onClearAll={clearFilters} />
            </div>
          </div>

          <ActiveFilterChips chips={chips} onClear={clearFilters} />
        </div>

        {loading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-32" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <CardSkeleton /><CardSkeleton /><CardSkeleton />
            </div>
          </div>
        )}

        {!loading && error && <ErrorNotice message={error} onRetry={() => { void refresh() }} />}

        {/* Search results replace the browse zones while a query is active. */}
        {!loading && !error && allHits !== null && (
          <Zone
            title="Search results"
            hint={searching ? 'Searching…' : `${allHits.length} matching section${allHits.length === 1 ? '' : 's'}.`}
          >
            {allHits.length === 0 && !searching ? (
              <EmptyState
                title="Nothing matches that"
                hint="Try fewer words, or clear the filters and browse the library."
                action={{ label: 'Clear search', onClick: clearFilters }}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {allHits.map((h) => (
                  <li key={`${h.guide_id}-${h.anchor}`}>
                    <SearchHit
                      hit={h}
                      row={byId.get(h.guide_id)}
                      categoryLabel={categoryLabelFrom(categories, h.category)}
                      onOpen={() => router.push(`/guides/${h.slug}#${h.anchor}`)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Zone>
        )}

        {!loading && !error && allHits === null && !rows.length && (
          <EmptyState
            title="No documents yet"
            hint="Published documents appear here. Command staff add them."
            action={{ label: 'Back to the Action Center', onClick: () => navigate('inbox') }}
          />
        )}

        {!loading && !error && allHits === null && rows.length > 0 && !shown.length && (
          <EmptyState
            title="Nothing matches those filters"
            hint="Try removing one of the chips above, or clear the filters."
            action={{ label: 'Clear filters', onClick: clearFilters }}
          />
        )}

        {!loading && !error && allHits === null && shown.length > 0 && (
          <>
            {/* The suggestion zones are for a reader who has not asked a
                question yet. Once anything is narrowed they stand down — a
                "Recently Updated" list that ignores the filter just applied
                is a second, contradictory answer on the same screen. */}
            {!narrowed && (
              <>
                {continueReading.length > 0 && (
                  <Zone title="Continue Reading" hint="You were part-way through these.">
                    {grid(continueReading)}
                  </Zone>
                )}

                {pinned.length > 0 && (
                  <Zone title="Pinned" hint="What the division wants everyone to have read.">
                    {grid(pinned)}
                  </Zone>
                )}

                {shown.length > 4 && (
                  <Zone title="Recently Updated">
                    <ul className={`${PANEL} flex flex-col gap-1 p-4`}>
                      {recent.map((g) => (
                        <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            onClick={() => open(g)}
                            className="rounded text-sm font-semibold text-badge-200 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          >
                            {g.title}
                          </button>
                          <span className="text-[11px] text-slate-500">
                            <time dateTime={g.updated_at}>{fmtDate(g.updated_at)}</time>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Zone>
                )}
              </>
            )}

            <Zone
              title={narrowed ? 'Results' : 'All Documents'}
              hint={`${shown.length} document${shown.length === 1 ? '' : 's'} you can read.`}
            >
              {grid(shown)}
            </Zone>
          </>
        )}

        {/* The back room: the feedback queue and the category vocabulary.
            Editors only — and that is presentation; both RPCs re-check. */}
        {!loading && !error && mayEdit && (
          <GuideAdminPanel guides={rows} onCategoriesChanged={() => { void refresh() }} />
        )}

        {mayEdit && editing !== null && (
          <GuideEditorDialog
            guide={editing === 'new' ? null : editing}
            categories={categories}
            onClose={() => setEditing(null)}
            onSaved={async (slug) => {
              setEditing(null)
              await refresh()
              if (slug) router.push(`/guides/${slug}`)
            }}
            onArchive={async (g, reason) => {
              const err = await setGuideArchived(g.id, !isArchived(g), reason)
              if (!err) { setEditing(null); await refresh() }
              return err
            }}
          />
        )}
      </div>
    </div>
  )
}

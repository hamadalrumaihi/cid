'use client'

/** The Guide Library (/guides).
 *
 *  Guides have their own permanent destination rather than a tab wedged into
 *  some other page: a guide is not a tool and not a record, and burying
 *  reference material inside a working screen is how it stops being read.
 *
 *  The page is arranged the way someone arrives at it: **Continue Reading**
 *  first (you were part-way through something), then **Pinned**, then
 *  **Recently Updated**, then **Browse by Category**, then **All Guides**. A
 *  zone with nothing in it does not render — an empty "Continue Reading" is
 *  noise, not a promise.
 *
 *  Search here is server-side and answers *which guide and which section*, so
 *  a result opens at the match. It runs over the same policies as everything
 *  else, so a restricted guide cannot appear in it — not as a title, not as a
 *  count, not as a suggestion.
 *
 *  Authority: what comes back from the server IS the answer. Drafts and
 *  archived guides reach an editor because RLS lets them; the editor controls
 *  below are cosmetic and every one calls an RPC that re-checks. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fmtDate } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { useRegistry } from '@/lib/useRegistry'
import {
  GUIDE_AUDIENCES, GUIDE_AUDIENCE_LABEL, GUIDE_SORTS, GUIDE_SORT_LABEL, categoryLabelFrom,
  guideImageUrl, isArchived, isNewToReader, isPublished, isUpdatedSinceSeen,
  listBookmarkedGuideIds, listGuideCategories, listGuideMedia, listGuideProgress, listGuides,
  matchGuides, searchGuides, setGuideArchived, setGuidePinned, setGuidePublished, sortGuides,
  toggleGuideBookmark,
  type GuideAudience, type GuideCategoryRow, type GuideProgressRow, type GuideRow, type GuideSearchHit,
  type GuideSort,
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
import { CHIP, CHIP_DONE, CHIP_NEUTRAL, GOLD_TEXT, GUIDE_CANVAS, PANEL, SLAB } from './guideSurfaces'

type StatusFilter = 'all' | 'published' | 'draft' | 'archived'

/** A quiet filter chip. The pressed state is carried by `aria-pressed` and by
 *  the word in the chip, never by colour alone. */
function FilterChip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`${CHIP} ${on ? CHIP_DONE : CHIP_NEUTRAL} transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300`}
    >
      {on && <span aria-hidden>✓</span>}
      {label}
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

export function GuideLibraryView() {
  const router = useRouter()
  const { navigate } = useNav()
  const { can, ready: permsReady } = usePermissions()
  const mayEdit = permsReady && can('edit', 'guide') === true

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<GuideSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [audiences, setAudiences] = useState<Set<GuideAudience>>(new Set())
  const [status, setStatus] = useState<StatusFilter>('all')
  const [onlyBookmarked, setOnlyBookmarked] = useState(false)
  const [sort, setSort] = useState<GuideSort>('updated')
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<Map<string, GuideProgressRow>>(new Map())
  const [categories, setCategories] = useState<GuideCategoryRow[]>([])
  /** guide id → signed cover URL. Absent means "no cover" — the normal case,
   *  and it renders nothing rather than a placeholder. */
  const [covers, setCovers] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<GuideRow | null | 'new'>(null)

  const { rows, loading, error, refresh, setRows } = useRegistry<GuideRow>({
    table: 'guides',
    load: listGuides,
  })

  // The reader's own bookmarks, progress and the category list load beside the
  // library; none of them failing is a reason to withhold the guides.
  useEffect(() => {
    let live = true
    void (async () => {
      const [marks, prog, catRows] = await Promise.all([
        listBookmarkedGuideIds().catch(() => new Set<string>()),
        listGuideProgress().catch(() => new Map<string, GuideProgressRow>()),
        listGuideCategories().catch((): GuideCategoryRow[] => []),
      ])
      if (!live) return
      setBookmarks(marks)
      setProgress(prog)
      setCategories(catRows)
    })()
    return () => { live = false }
  }, [rows.length])

  // Covers, resolved once per loaded set.
  useEffect(() => {
    let live = true
    void (async () => {
      const entries = await Promise.all(rows.map(async (g) => {
        const media = await listGuideMedia(g.id).catch(() => [])
        const cover = media.filter((m) => m.section === null).sort((a, b) => a.sort_order - b.sort_order)[0]
        if (!cover) return null
        const src = await guideImageUrl(cover.storage_path)
        return src ? ([g.id, src] as const) : null
      }))
      if (live) setCovers(Object.fromEntries(entries.filter((e): e is readonly [string, string] => e !== null)))
    })()
    return () => { live = false }
  }, [rows])

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

  /** Sections of the guides whose prose is in the build, matched here rather
   *  than in the database. There is one copy of that text — the module — so
   *  the search can never drift from what the guide says. This runs only over
   *  `rows`, which is what RLS already returned to this reader, so a guide
   *  they may not see cannot surface through it. */
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

  /** The two halves of the search, in one list: the server's sections (guides
   *  written in the editor) and the build's (guides written as modules). */
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

  const toggleIn = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }

  const shown = useMemo(() => {
    let out = matchGuides(rows, query)
    if (cats.size) out = out.filter((g) => cats.has(g.category))
    if (audiences.size) out = out.filter((g) => audiences.has(g.audience as GuideAudience))
    if (status === 'published') out = out.filter((g) => isPublished(g) && !isArchived(g))
    if (status === 'draft') out = out.filter((g) => !isPublished(g))
    if (status === 'archived') out = out.filter((g) => isArchived(g))
    if (status === 'all' && mayEdit) out = out.filter((g) => !isArchived(g))
    if (onlyBookmarked) out = out.filter((g) => bookmarks.has(g.id))
    return sortGuides(out, sort)
  }, [rows, query, cats, audiences, status, onlyBookmarked, bookmarks, sort, mayEdit])

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
    setBookmarks((prev) => {
      const s = new Set(prev)
      if (next) s.add(g.id)
      else s.delete(g.id)
      return s
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
            setRows((prev) => sortGuides(prev.map((r) => (r.id === g.id ? { ...r, pinned: !g.pinned } : r)), sort))
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

  /* ---- the five zones --------------------------------------------------- */

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
  const byCategory = useMemo(() => {
    const map = new Map<string, GuideRow[]>()
    for (const g of shown) map.set(g.category, [...(map.get(g.category) ?? []), g])
    return categories
      .filter((c) => map.has(c.slug))
      .map((c) => ({ category: c, guides: map.get(c.slug)! }))
  }, [shown, categories])

  const clearFilters = () => {
    setQuery(''); setCats(new Set()); setAudiences(new Set()); setStatus('all'); setOnlyBookmarked(false)
  }

  return (
    <div className={`${GUIDE_CANVAS} -mx-3 -my-4 px-3 py-4 sm:-mx-6 sm:px-6`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <h1 className={`text-2xl font-black uppercase tracking-[0.18em] ${GOLD_TEXT}`}>Guide Library</h1>
            <p className="max-w-3xl text-sm text-slate-300">
              Reference documents for the division. A guide explains how to use a portal feature — it reads no
              portal record and changes none. Policy and authority live in the SOP library.
            </p>
          </div>
          {mayEdit && <Button size="sm" onClick={() => setEditing('new')}>New guide</Button>}
        </header>

        {/* Search and filters. */}
        <div className={`${PANEL} flex flex-col gap-3 p-4`}>
          <Field label="Search guides" hint="Searches titles, summaries, section headings, tags and keywords.">
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

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Category</span>
            {categories.filter((c) => c.active).map((c) => (
              <FilterChip key={c.slug} on={cats.has(c.slug)} label={c.label} onClick={() => setCats((p) => toggleIn(p, c.slug))} />
            ))}
            {cats.size > 0 && <Button variant="ghost" size="sm" onClick={() => setCats(new Set())}>Clear</Button>}
          </div>

          {/* The audience filter only means anything to somebody who can see
              more than one audience — which is exactly the people who may edit. */}
          {mayEdit && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Audience</span>
              {GUIDE_AUDIENCES.map((a) => (
                <FilterChip
                  key={a}
                  on={audiences.has(a)}
                  label={GUIDE_AUDIENCE_LABEL[a]}
                  onClick={() => setAudiences((p) => toggleIn(p, a))}
                />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Show</span>
            <FilterChip on={onlyBookmarked} label="My bookmarks" onClick={() => setOnlyBookmarked((v) => !v)} />
            {mayEdit && (['all', 'published', 'draft', 'archived'] as const).map((s) => (
              <FilterChip
                key={s}
                on={status === s}
                label={s === 'all' ? 'Live' : s === 'published' ? 'Published' : s === 'draft' ? 'Drafts' : 'Archived'}
                onClick={() => setStatus(s)}
              />
            ))}
            <span className="ml-auto flex items-center gap-1.5">
              <label htmlFor="guide-sort" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sort</label>
              <select
                id="guide-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as GuideSort)}
                className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-xs text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
              >
                {GUIDE_SORTS.map((s) => <option key={s} value={s}>{GUIDE_SORT_LABEL[s]}</option>)}
              </select>
            </span>
          </div>
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
                hint="Try fewer words, or clear the filters and browse by category."
                action={{ label: 'Clear search', onClick: clearFilters }}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {allHits.map((h) => (
                  <li key={`${h.guide_id}-${h.anchor}`}>
                    <button
                      type="button"
                      onClick={() => router.push(`/guides/${h.slug}#${h.anchor}`)}
                      className={`${SLAB} w-full px-3 py-2 text-left transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300`}
                    >
                      <p className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-semibold ${GOLD_TEXT}`}>{h.title}</span>
                        <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{categoryLabelFrom(categories, h.category)}</span>
                      </p>
                      <p className="mt-0.5 text-sm text-slate-200">{h.heading}</p>
                      {h.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{h.snippet.trim()}</p>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Zone>
        )}

        {!loading && !error && allHits === null && !rows.length && (
          <EmptyState
            title="No guides yet"
            hint="Published guides appear here. Command staff add them."
            action={{ label: 'Back to the Action Center', onClick: () => navigate('inbox') }}
          />
        )}

        {!loading && !error && allHits === null && rows.length > 0 && !shown.length && (
          <EmptyState
            title="Nothing matches those filters"
            hint="Try a different category, or clear the filters."
            action={{ label: 'Clear filters', onClick: clearFilters }}
          />
        )}

        {/* The five zones. Each renders only when it has something in it. */}
        {!loading && !error && allHits === null && shown.length > 0 && (
          <>
            {continueReading.length > 0 && (
              <Zone title="Continue Reading" hint="You were part-way through these.">
                {grid(continueReading)}
              </Zone>
            )}

            {pinned.length > 0 && (
              <Zone title="Pinned Guides" hint="What the division wants everyone to have read.">
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
                        className="rounded text-sm font-semibold text-badge-200 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
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

            {byCategory.length > 1 && (
              <Zone title="Browse by Category">
                <div className="flex flex-wrap gap-2">
                  {byCategory.map(({ category, guides }) => (
                    <button
                      key={category.slug}
                      type="button"
                      onClick={() => setCats(new Set([category.slug]))}
                      className={`${SLAB} px-3 py-2 text-left transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300`}
                    >
                      <span className="text-sm font-semibold text-slate-100">{category.label}</span>
                      <span className="ml-2 text-xs text-slate-500">{guides.length}</span>
                      {category.description && (
                        <span className="mt-0.5 block max-w-xs text-xs text-slate-500">{category.description}</span>
                      )}
                    </button>
                  ))}
                </div>
              </Zone>
            )}

            <Zone title="All Guides" hint={`${shown.length} guide${shown.length === 1 ? '' : 's'} you can read.`}>
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

'use client'

/** The Guide Library (/guides).
 *
 *  Guides have their own permanent destination rather than a tab wedged into
 *  some other page: a guide is not a tool and not a record, and burying
 *  reference material inside a working screen is how it stops being read.
 *
 *  What the library offers: search, category filters, the reader's own
 *  bookmarks, the pinned guides first, and — for the people who may edit them
 *  — the drafts alongside the published ones. Every card opens a guide at its
 *  own URL, which is what makes a guide something a member can send to
 *  another member.
 *
 *  Authority: what comes back from the server IS the answer. Drafts reach an
 *  editor because RLS lets them; the editor controls below are cosmetic and
 *  every one of them calls an RPC that re-checks. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtDate } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { useRegistry } from '@/lib/useRegistry'
import {
  GUIDE_CATEGORIES, GUIDE_CATEGORY_LABEL, guideImageUrl, listBookmarkedGuideIds, listGuideMedia,
  isPublished, listGuides, matchGuides, setGuidePinned, setGuidePublished, sortGuides, toggleGuideBookmark,
  type GuideCategory, type GuideRow,
} from '@/lib/guides'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { useNav } from '@/components/shell/useNav'
import { useRouter } from 'next/navigation'
import { GuideCard } from './GuideCard'
import { CHIP, CHIP_DONE, CHIP_NEUTRAL, GOLD_TEXT, GUIDE_CANVAS, PANEL } from './guideSurfaces'

type StatusFilter = 'all' | 'published' | 'draft'

/** A quiet filter chip. Pressed state is carried by aria-pressed, not by
 *  colour alone. */
function FilterChip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`${CHIP} ${on ? CHIP_DONE : CHIP_NEUTRAL} transition hover:text-white`}
    >
      {label}
    </button>
  )
}

export function GuideLibraryView() {
  const router = useRouter()
  const { navigate } = useNav()
  const { can, ready: permsReady } = usePermissions()
  const mayEdit = permsReady && can('edit', 'guide') === true

  const [query, setQuery] = useState('')
  const [cats, setCats] = useState<Set<GuideCategory>>(new Set())
  const [status, setStatus] = useState<StatusFilter>('all')
  const [onlyBookmarked, setOnlyBookmarked] = useState(false)
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set())
  /** guide id → signed cover URL. Absent means "no cover" — which is the
   *  normal case, and renders nothing rather than a placeholder. */
  const [covers, setCovers] = useState<Record<string, string>>({})

  const { rows, loading, error, refresh, setRows } = useRegistry<GuideRow>({
    table: 'guides',
    load: listGuides,
  })

  // Bookmarks are the reader's own list and load beside the library; failing
  // to read them is not a reason to withhold the guides.
  useEffect(() => {
    let live = true
    void listBookmarkedGuideIds()
      .then((s) => { if (live) setBookmarks(s) })
      .catch(() => undefined)
    return () => { live = false }
  }, [rows.length])

  // Covers, resolved once per loaded set. A guide with no cover simply never
  // appears in the map.
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

  const toggleCat = (c: GuideCategory) =>
    setCats((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })

  const shown = useMemo(() => {
    let out = matchGuides(rows, query)
    if (cats.size) out = out.filter((g) => cats.has(g.category as GuideCategory))
    if (status !== 'all') out = out.filter((g) => g.status === status)
    if (onlyBookmarked) out = out.filter((g) => bookmarks.has(g.id))
    return sortGuides(out)
  }, [rows, query, cats, status, onlyBookmarked, bookmarks])

  const pinned = shown.filter((g) => g.pinned)
  const rest = shown.filter((g) => !g.pinned)
  /** "Recently updated" is the three most recent of what is showing — a
   *  shortcut into the same list, not a second copy of it. */
  const recent = useMemo(
    () => [...shown].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, 3),
    [shown],
  )

  const open = useCallback((g: GuideRow) => { router.push(`/guides/${g.slug}`) }, [router])

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
          onTogglePublished: async () => {
            if (await setGuidePublished(g.id, !isPublished(g))) await refresh()
          },
          onTogglePinned: async () => {
            // Optimistic: a pin is instant and reversible, and refresh()
            // settles the real answer a beat later.
            setRows((prev) => sortGuides(prev.map((r) => (r.id === g.id ? { ...r, pinned: !g.pinned } : r))))
            if (!(await setGuidePinned(g.id, !g.pinned))) await refresh()
          },
        }
      : undefined

  const card = (g: GuideRow) => (
    <GuideCard
      key={g.id}
      guide={g}
      coverSrc={covers[g.id] ?? null}
      bookmarked={bookmarks.has(g.id)}
      lastUpdatedText={fmtDate(g.updated_at)}
      onOpen={() => open(g)}
      onToggleBookmark={() => { void onBookmark(g) }}
      editor={editorFor(g)}
    />
  )

  return (
    <div className={`${GUIDE_CANVAS} -mx-3 -my-4 px-3 py-4 sm:-mx-6 sm:px-6`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-2">
          <h1 className={`text-2xl font-black uppercase tracking-[0.18em] ${GOLD_TEXT}`}>Guide Library</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            Reference documents for the division. A guide describes how something works — it reads no
            portal record and changes none.
          </p>
        </header>

        {/* Search and filters. */}
        <div className={`${PANEL} flex flex-col gap-3 p-4`}>
          <Field label="Search guides">
            {(id) => (
              <Input
                id={id}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Title, summary or category…"
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Category</span>
            {GUIDE_CATEGORIES.map((c) => (
              <FilterChip key={c} on={cats.has(c)} label={GUIDE_CATEGORY_LABEL[c]} onClick={() => toggleCat(c)} />
            ))}
            {cats.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setCats(new Set())}>Clear</Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Show</span>
            <FilterChip
              on={onlyBookmarked}
              label="My bookmarks"
              onClick={() => setOnlyBookmarked((v) => !v)}
            />
            {/* Draft / published is only a distinction for the people who can
                see both. Everyone else is shown published guides only, by RLS. */}
            {mayEdit && (['all', 'published', 'draft'] as const).map((s) => (
              <FilterChip
                key={s}
                on={status === s}
                label={s === 'all' ? 'All states' : s === 'published' ? 'Published' : 'Drafts'}
                onClick={() => setStatus(s)}
              />
            ))}
          </div>
        </div>

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        )}

        {!loading && error && <ErrorNotice message={error} onRetry={() => { void refresh() }} />}

        {!loading && !error && !rows.length && (
          <EmptyState
            title="No guides yet"
            hint="Published guides appear here. Command staff add them."
            action={{ label: 'Back to the Action Center', onClick: () => navigate('inbox') }}
          />
        )}

        {!loading && !error && rows.length > 0 && !shown.length && (
          <EmptyState
            title="Nothing matches those filters"
            hint="Try a different search or clear the category filters."
            action={{
              label: 'Clear filters',
              onClick: () => { setQuery(''); setCats(new Set()); setStatus('all'); setOnlyBookmarked(false) },
            }}
          />
        )}

        {!loading && !error && shown.length > 0 && (
          <>
            {pinned.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Pinned</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{pinned.map(card)}</div>
              </section>
            )}

            {/* A quiet index of what changed most recently — the same guides,
                reachable in one line rather than by scanning the grid. */}
            {shown.length > 3 && (
              <section className={`${PANEL} flex flex-col gap-2 p-4`}>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Recently updated</h2>
                <ul className="flex flex-col gap-1">
                  {recent.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        onClick={() => open(g)}
                        className="rounded text-sm font-semibold text-badge-200 transition hover:text-white"
                      >
                        {g.title}
                      </button>
                      <span className="text-[11px] text-slate-500">
                        <time dateTime={g.updated_at}>{fmtDate(g.updated_at)}</time>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {rest.length > 0 && (
              <section className="flex flex-col gap-3">
                {pinned.length > 0 && (
                  <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">All guides</h2>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{rest.map(card)}</div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

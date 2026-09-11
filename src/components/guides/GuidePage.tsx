'use client'

/** One guide, at its own address (/guides/<slug>).
 *
 *  This is the frame every guide shares: breadcrumbs back to the library, the
 *  masthead, the in-guide search, the contents rail (a sticky list on a wide
 *  screen, a sheet on a narrow one), the bookmark control, and the optional
 *  imagery. The written content comes from the body module named by the
 *  library row's body_key — see guideRegistry.
 *
 *  The sections inside a guide are ANCHORS, not portal tabs: the document is
 *  continuous and the contents rail scrolls to a heading. Tabs would hide most
 *  of a reference document behind a click and break Ctrl-F.
 *
 *  Imagery is optional at every slot. When a guide carries none — which is the
 *  normal case — nothing renders for it: no placeholder, no empty frame, no
 *  "View image" action. Written content and imagery are independent, so
 *  removing every image changes nothing else on the page. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { usePermissions } from '@/lib/permissions'
import { fmtDate } from '@/lib/format'
import {
  getGuideBySlug, guideCategoryLabel, guideImageUrl, isPublished, listGuideMedia, toggleGuideBookmark,
  type GuideMediaRow, type GuideRow,
} from '@/lib/guides'
import { list } from '@/lib/db'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { DocToc, scrollToHeading, useActiveHeading } from '@/components/sops/DocToc'
import { useNav } from '@/components/shell/useNav'
import { GuideHeader, type GuideImageRef } from './GuideParts'
import { GuideMediaManager, type GuideMediaSlot } from './GuideMediaManager'
import { CHIP, CHIP_DONE, CHIP_NEUTRAL, GUIDE_CANVAS, SLAB } from './guideSurfaces'
import { guideBody } from './guideRegistry'

/** A media row, with a signed URL, ready for GuideParts. Rows whose object
 *  could not be signed are dropped rather than rendered broken. */
type ResolvedImage = GuideImageRef

async function resolveImages(rows: readonly GuideMediaRow[]): Promise<ResolvedImage[]> {
  const out = await Promise.all(rows.map(async (m): Promise<ResolvedImage | null> => {
    const src = await guideImageUrl(m.storage_path)
    return src
      ? { id: m.id, section: m.section, order: m.sort_order, src, alt: m.alt, caption: m.caption ?? undefined }
      : null
  }))
  return out.filter((i): i is ResolvedImage => i !== null)
}

export function GuidePage({ slug }: { slug: string }) {
  const { state } = useAuth()
  const { navigate } = useNav()
  const { can, ready: permsReady } = usePermissions()
  const mayEdit = permsReady && can('edit', 'guide') === true
  const [row, setRow] = useState<GuideRow | null>(null)
  const [media, setMedia] = useState<GuideMediaRow[]>([])
  const [images, setImages] = useState<ResolvedImage[]>([])
  const [bookmarked, setBookmarked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tocOpen, setTocOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const g = await getGuideBySlug(slug)
      setRow(g)
      if (g) {
        // Imagery and the bookmark are decoration on top of the document —
        // neither failing is a reason to withhold the guide, so both are
        // settled separately and swallowed.
        const [media, marks] = await Promise.all([
          listGuideMedia(g.id).catch((): GuideMediaRow[] => []),
          list('guide_bookmarks', { eq: { guide_id: g.id } }).catch(() => []),
        ])
        setMedia(media)
        setImages(await resolveImages(media))
        setBookmarked(marks.length > 0)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [slug])

  // Deferred past the effect body so the first setState is not synchronous
  // with the render (the React Compiler lint rejects that, rightly — it is a
  // cascading render). The same idiom as usePermissions.
  useEffect(() => {
    if (state !== 'in') return
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [state, load])

  const body = guideBody(row?.body_key)
  const sections = useMemo(() => body?.sections ?? [], [body])

  const shown = useMemo(
    () => (body ? body.matchSections(query) : new Set<string>()),
    [body, query],
  )
  const active = useActiveHeading(slug, sections)
  const visible = sections.filter((s) => shown.has(s.id))

  const cover = useMemo(
    () => images.filter((i) => i.section === null).sort((a, b) => a.order - b.order)[0] ?? null,
    [images],
  )
  const imagesFor = useCallback(
    (section: string) => images.filter((i) => i.section === section).sort((a, b) => a.order - b.order),
    [images],
  )

  const jump = (id: string) => { setTocOpen(false); scrollToHeading(id) }

  /** Re-read just the imagery after an editor changes it — the document itself
   *  has not moved, so there is no reason to reload it. */
  const reloadMedia = useCallback(async () => {
    if (!row) return
    const next = await listGuideMedia(row.id).catch((): GuideMediaRow[] => [])
    setMedia(next)
    setImages(await resolveImages(next))
  }, [row])

  /** One slot per anchor section, plus the cover. An editor picks where an
   *  image goes by the section it illustrates. */
  const slots: GuideMediaSlot[] = [
    { section: null, label: 'Cover' },
    ...sections.map((s) => ({ section: s.id, label: s.text })),
  ]

  const onBookmark = async () => {
    if (!row) return
    const next = await toggleGuideBookmark(row.id)
    if (next !== null) setBookmarked(next)
  }

  const backToLibrary = () => navigate('guides')

  const crumbs = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Breadcrumbs items={[{ label: 'Guides', onClick: backToLibrary }, { label: row?.title ?? 'Guide' }]} />
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={backToLibrary}>Back to Guides</Button>
        {row && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { void onBookmark() }}
            aria-pressed={bookmarked}
            title={bookmarked ? 'Remove this guide from your bookmarks' : 'Keep this guide in your bookmarks'}
          >
            {bookmarked ? 'Bookmarked' : 'Bookmark'}
          </Button>
        )}
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className={`${GUIDE_CANVAS} -mx-3 -my-4 px-3 py-4 sm:-mx-6 sm:px-6`}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`${GUIDE_CANVAS} -mx-3 -my-4 px-3 py-4 sm:-mx-6 sm:px-6`}>
        <div className="mx-auto w-full max-w-3xl">
          <ErrorNotice message={error} onRetry={() => { void load() }} />
        </div>
      </div>
    )
  }

  // A draft, a deleted guide and a slug that never existed are deliberately
  // one outcome. Saying "this is a draft you may not read" would disclose it.
  if (!row) {
    return (
      <div className={`${GUIDE_CANVAS} -mx-3 -my-4 px-3 py-4 sm:-mx-6 sm:px-6`}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {crumbs}
          <EmptyState
            title="This guide is not available"
            hint="It may have been unpublished or removed. The library lists everything you can read."
            action={{ label: 'Back to Guides', onClick: backToLibrary }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={`${GUIDE_CANVAS} -mx-3 -my-4 px-3 py-4 sm:-mx-6 sm:px-6`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
        {/* Contents rail — desktop only; the sheet below serves small screens. */}
        {sections.length > 0 && (
          <aside className="hidden w-56 flex-shrink-0 lg:block">
            <div className="sticky top-20">
              <DocToc headings={sections} activeId={active} onSelect={jump} size="rail" />
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <GuideHeader
            title={row.title}
            summary={row.summary ?? undefined}
            lastUpdated={body?.lastUpdated ?? row.updated_at}
            lastUpdatedText={fmtDate(body?.lastUpdated ?? row.updated_at)}
            actions={crumbs}
            note={body?.note}
            cover={cover}
          />

          <div className="flex flex-wrap items-center gap-2">
            <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{guideCategoryLabel(row.category)}</span>
            {!isPublished(row) && <span className={`${CHIP} ${CHIP_NEUTRAL}`}>Draft</span>}
            {row.pinned && <span className={`${CHIP} ${CHIP_DONE}`}>Pinned</span>}
          </div>

          {/* Search + the mobile section menu. */}
          {sections.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <Field label="Search this guide">
                  {(id) => (
                    <Input
                      id={id}
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search this guide…"
                    />
                  )}
                </Field>
              </div>
              <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setTocOpen(true)}>
                Sections
              </Button>
            </div>
          )}

          {query.trim() && (
            <p className="text-xs text-slate-500" role="status">
              {visible.length} of {sections.length} sections match “{query.trim()}”.
            </p>
          )}

          {body
            ? <body.Body shown={shown} imagesFor={imagesFor} />
            : (
              <p className={`${SLAB} px-4 py-6 text-center text-sm text-slate-400`}>
                This guide’s content is not part of this build.
              </p>
            )}

          {body && !visible.length && (
            <p className={`${SLAB} px-4 py-6 text-center text-sm text-slate-400`}>
              Nothing in this guide matches “{query.trim()}”.
            </p>
          )}

          {mayEdit && (
            <GuideMediaManager guideId={row.id} media={media} slots={slots} onChanged={reloadMedia} />
          )}

          {sections.length > 0 && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => jump(sections[0].id)}>
                Back to top
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile section menu. */}
      <Modal open={tocOpen} onClose={() => setTocOpen(false)} slide>
        <ModalHeader title="Sections" onClose={() => setTocOpen(false)} />
        <div className="p-3">
          <DocToc headings={sections} activeId={active} onSelect={jump} size="sheet" />
        </div>
      </Modal>
    </div>
  )
}

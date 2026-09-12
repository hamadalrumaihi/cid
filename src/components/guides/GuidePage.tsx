'use client'

/** One guide, at its own address (/guides/<slug>).
 *
 *  This is the frame every guide shares: breadcrumbs back to the library, the
 *  masthead, the in-guide search, the contents rail (a sticky list on a wide
 *  screen, a sheet on a narrow one), the bookmark and progress controls, the
 *  feedback block and the optional imagery.
 *
 *  The prose reaches the page from one of three places and renders the same
 *  either way — a reader cannot tell which, nor should they have to:
 *    - a data-driven document module (body.doc), rendered by GuideDocView;
 *    - a guide that renders itself (body.Body — UNDERGRND's tables);
 *    - public.guide_sections, for a guide written in the editor.
 *
 *  The sections inside a guide are ANCHORS, not portal tabs: the document is
 *  continuous and the contents rail scrolls to a heading. Tabs would hide most
 *  of a reference document behind a click and break Ctrl-F. The anchors are
 *  permanent, so a link to a section keeps working.
 *
 *  Imagery is optional at every slot. When a guide carries none — which is the
 *  normal case — nothing renders for it: no placeholder, no empty frame, no
 *  "View image" action. Written content and imagery are independent, so
 *  removing every image changes nothing else on the page.
 *
 *  Reading progress is the reader's own: where they left off, whether they
 *  marked it read. It is private to them (the guide_progress policy admits no
 *  other row) and is not a performance record. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { usePermissions } from '@/lib/permissions'
import { fmtDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { renderMarkdown, type DocHeading } from '@/lib/markdown'
import {
  categoryLabelFrom, getGuideBySlug, guideAudienceLabel, guideImageUrl, isArchived, isPublished,
  isRestrictedAudience, isUpdatedSinceSeen, listGuideCategories, listGuideMedia, listGuideProgress,
  listGuideSections, listGuides, markGuideComplete, markGuideOutdated, recordGuideView,
  submitGuideFeedback, toggleGuideBookmark,
  type GuideCategoryRow, type GuideFeedbackKind, type GuideMediaRow, type GuideProgressRow,
  type GuideRow, type GuideSectionRow,
} from '@/lib/guides'
import { list } from '@/lib/db'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { DocToc, scrollToHeading, useActiveHeading } from '@/components/sops/DocToc'
import { useNav } from '@/components/shell/useNav'
import { GuideHeader, GuideSection, type GuideImageRef } from './GuideParts'
import { GuideDocView } from './GuideDocView'
import { GuideMediaManager, type GuideMediaSlot } from './GuideMediaManager'
import { CHIP, CHIP_DONE, CHIP_LOCKED, CHIP_NEUTRAL, GOLD_TEXT, GUIDE_CANVAS, PANEL, SLAB, WARN } from './guideSurfaces'
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

/** Reading estimate for a guide whose prose lives in the database. Same rule
 *  as the document modules: 200 words a minute, never less than a minute. */
function dbReadMinutes(sections: readonly GuideSectionRow[]): number {
  const words = sections.reduce((n, s) => n + `${s.heading} ${s.body}`.trim().split(/\s+/).length, 0)
  return Math.max(1, Math.round(words / 200))
}

/* ---- reader feedback ------------------------------------------------------ */

const REPORT_KINDS: { kind: GuideFeedbackKind; label: string; prompt: string }[] = [
  { kind: 'broken_link', label: 'Report a broken link', prompt: 'Which link, and where in the guide?' },
  { kind: 'outdated', label: 'Report as out of date', prompt: 'What no longer matches the portal?' },
  { kind: 'suggestion', label: 'Suggest an improvement', prompt: 'What would make this guide clearer?' },
]

/** "Was this guide helpful?" plus the three report actions.
 *
 *  All four go to the same review queue rather than to anyone's notifications:
 *  a guide's owner reads them as a list of work, not as chat. */
function GuideFeedbackBlock({ guideId, anchor }: { guideId: string; anchor: string | null }) {
  const [rating, setRating] = useState<'yes' | 'partly' | 'no' | null>(null)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)
  const [report, setReport] = useState<GuideFeedbackKind | null>(null)
  const [reportText, setReportText] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (r: 'yes' | 'partly' | 'no') => {
    setRating(r)
    const err = await submitGuideFeedback({ guideId, kind: 'helpful', rating: r, comment: comment.trim() || undefined, anchor })
    if (err) { toast(`Feedback not sent — ${err}`, 'danger'); return }
    setSent(true)
  }

  const sendReport = async () => {
    if (!report) return
    setBusy(true)
    const err = await submitGuideFeedback({ guideId, kind: report, comment: reportText.trim() || undefined, anchor })
    setBusy(false)
    if (err) { toast(`That could not be sent — ${err}`, 'danger'); return }
    setReport(null)
    setReportText('')
    toast('Thank you — that has gone to the guide’s review queue.', 'success')
  }

  const active = REPORT_KINDS.find((k) => k.kind === report) ?? null

  return (
    <section className={`${PANEL} flex flex-col gap-3 p-4 sm:p-6`}>
      <h2 className={`text-sm font-black uppercase tracking-[0.2em] ${GOLD_TEXT}`}>Was this guide helpful?</h2>
      {sent ? (
        <p className="text-sm text-slate-300" role="status">
          Thank you — your answer has gone to the guide’s review queue.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Was this guide helpful?">
            {(['yes', 'partly', 'no'] as const).map((r) => (
              <Button
                key={r}
                variant={rating === r ? 'primary' : 'ghost'}
                size="sm"
                aria-pressed={rating === r}
                onAction={() => send(r)}
              >
                {r === 'yes' ? 'Yes' : r === 'partly' ? 'Partly' : 'No'}
              </Button>
            ))}
          </div>
          <Field label="Anything to add (optional)">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What was missing, or what helped?"
              />
            )}
          </Field>
        </>
      )}

      <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
        {REPORT_KINDS.map((k) => (
          <Button key={k.kind} variant="ghost" size="sm" onClick={() => { setReport(k.kind); setReportText('') }}>
            {k.label}
          </Button>
        ))}
      </div>

      <Modal open={!!active} onClose={() => setReport(null)}>
        <ModalHeader title={active?.label ?? ''} onClose={() => setReport(null)} />
        <div className="flex flex-col gap-3 p-4">
          <Field label={active?.prompt ?? ''}>
            {(id) => (
              <Textarea id={id} rows={4} value={reportText} onChange={(e) => setReportText(e.target.value)} />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReport(null)}>Cancel</Button>
            <Button size="sm" loading={busy} onAction={sendReport}>Send</Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}

/* ---- the page ------------------------------------------------------------- */

export function GuidePage({ slug }: { slug: string }) {
  const { state } = useAuth()
  const { navigate } = useNav()
  const router = useRouter()
  const { can, ready: permsReady } = usePermissions()
  const mayEdit = permsReady && can('edit', 'guide') === true

  const [row, setRow] = useState<GuideRow | null>(null)
  const [dbSections, setDbSections] = useState<GuideSectionRow[]>([])
  const [cats, setCats] = useState<GuideCategoryRow[]>([])
  const [related, setRelated] = useState<GuideRow[]>([])
  const [progress, setProgress] = useState<GuideProgressRow | null>(null)
  const [media, setMedia] = useState<GuideMediaRow[]>([])
  const [images, setImages] = useState<ResolvedImage[]>([])
  const [bookmarked, setBookmarked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tocOpen, setTocOpen] = useState(false)
  // Set once the reader marks the guide read or unread in this visit, so
  // the chip answers immediately without re-reading the progress row.
  const [doneOverride, setDoneOverride] = useState<boolean | null>(null)
  const [outdatedOpen, setOutdatedOpen] = useState(false)
  const [outdatedReason, setOutdatedReason] = useState('')
  const landed = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const g = await getGuideBySlug(slug)
      setRow(g)
      if (g) {
        // Everything past the document itself is decoration: none of it
        // failing is a reason to withhold the guide, so each is settled
        // separately and swallowed.
        const [secs, mediaRows, marks, categories, prog, all] = await Promise.all([
          listGuideSections(g.id).catch((): GuideSectionRow[] => []),
          listGuideMedia(g.id).catch((): GuideMediaRow[] => []),
          list('guide_bookmarks', { eq: { guide_id: g.id } }).catch(() => []),
          listGuideCategories().catch((): GuideCategoryRow[] => []),
          listGuideProgress().catch(() => new Map<string, GuideProgressRow>()),
          listGuides().catch((): GuideRow[] => []),
        ])
        setDbSections(secs)
        setMedia(mediaRows)
        setImages(await resolveImages(mediaRows))
        setBookmarked(marks.length > 0)
        setCats(categories)
        // The progress row as it stood BEFORE this visit, so the
        // "updated since you last read it" banner still has something to
        // compare against after the view below records the visit.
        setProgress(prog.get(g.id) ?? null)
        // Related guides come from the same already-RLS-filtered list the
        // library shows, so nothing surfaces here that the reader could not
        // already see there.
        setRelated(all.filter((o) =>
          o.id !== g.id && o.category === g.category && isPublished(o) && !isArchived(o)).slice(0, 4))
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

  /** The contents, from whichever of the three prose sources this guide uses. */
  const sections = useMemo<DocHeading[]>(() => {
    if (body) return body.sections
    return dbSections.map((s) => ({ id: s.anchor, text: s.heading, level: 2 as const }))
  }, [body, dbSections])

  const shown = useMemo(() => {
    if (body) return body.matchSections(query)
    const q = query.trim().toLowerCase()
    const hit = dbSections.filter((s) => !q || `${s.heading} ${s.body}`.toLowerCase().includes(q))
    return new Set(hit.map((s) => s.anchor))
  }, [body, dbSections, query])

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

  const jump = useCallback((id: string) => {
    setTocOpen(false)
    scrollToHeading(id)
    if (row) void recordGuideView(row.id, id)
  }, [row])

  /** Land where the link asked, or where the reader left off. Once only: a
   *  reader who has scrolled away should not be yanked back by a re-render. */
  useEffect(() => {
    if (landed.current || loading || !row || !sections.length) return
    landed.current = true
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
    const target = sections.find((s) => s.id === hash)?.id
      ?? (progress?.last_anchor && sections.find((s) => s.id === progress.last_anchor)?.id)
      ?? null
    void recordGuideView(row.id, target)
    if (target) {
      // After paint, so the heading exists to scroll to.
      const t = window.setTimeout(() => scrollToHeading(target), 60)
      return () => window.clearTimeout(t)
    }
  }, [loading, row, sections, progress])

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

  const onToggleComplete = async () => {
    if (!row) return
    const want = !progress?.completed_at
    const ok = await markGuideComplete(row.id, want)
    if (!ok) { toast('That could not be saved.', 'danger'); return }
    setDoneOverride(want)
  }

  const copySectionLink = async (anchor: string) => {
    const url = `${window.location.origin}/guides/${slug}#${anchor}`
    try {
      await navigator.clipboard.writeText(url)
      toast('Section link copied.', 'success')
    } catch {
      toast('Could not copy — the address is in the browser bar.', 'danger')
    }
  }

  const flagOutdated = async () => {
    if (!row || !outdatedReason.trim()) return
    const err = await markGuideOutdated(row.id, outdatedReason.trim())
    if (err) { toast(`That could not be recorded — ${err}`, 'danger'); return }
    setOutdatedOpen(false)
    setOutdatedReason('')
    await load()
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

  // A draft, an archived guide, a guide outside the reader's audience, a
  // deleted guide and a slug that never existed are deliberately one outcome.
  // Saying "this is a draft you may not read" would disclose it.
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

  const readMinutes = body?.readMinutes ?? row.read_minutes ?? dbReadMinutes(dbSections)
  const done = doneOverride ?? !!progress?.completed_at
  const changed = isUpdatedSinceSeen(row, progress ?? undefined)
  const idx = active ? sections.findIndex((s) => s.id === active) : -1
  const prev = idx > 0 ? sections[idx - 1] : null
  const next = idx >= 0 && idx < sections.length - 1 ? sections[idx + 1] : null

  const sectionMeta = (s: { anchor: string }) => (
    <Button variant="ghost" size="sm" onClick={() => { void copySectionLink(s.anchor) }}>
      Copy link
    </Button>
  )

  return (
    <div className={`${GUIDE_CANVAS} -mx-3 -my-4 px-3 py-4 sm:-mx-6 sm:px-6`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
        {/* Contents rail — desktop only; the sheet below serves small screens. */}
        {sections.length > 0 && (
          <aside className="hidden w-56 flex-shrink-0 lg:block">
            <div className="sticky top-20 flex flex-col gap-3">
              <DocToc headings={sections} activeId={active} onSelect={jump} size="rail" />
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={done}
                onAction={onToggleComplete}
              >
                {done ? 'Marked as read' : 'Mark as read'}
              </Button>
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
            <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{categoryLabelFrom(cats, row.category)}</span>
            <span className={`${CHIP} ${CHIP_NEUTRAL}`}>~{readMinutes} min read</span>
            {!isPublished(row) && <span className={`${CHIP} ${CHIP_NEUTRAL}`}>Draft</span>}
            {isArchived(row) && <span className={`${CHIP} ${CHIP_NEUTRAL}`}>Archived</span>}
            {row.pinned && <span className={`${CHIP} ${CHIP_DONE}`}>Pinned</span>}
            {isRestrictedAudience(row.audience) && (
              <span className={`${CHIP} ${CHIP_LOCKED}`} title={guideAudienceLabel(row.audience)}>Restricted</span>
            )}
            {done && <span className={`${CHIP} ${CHIP_DONE}`}>Read</span>}
          </div>

          {changed && (
            <p className={`${SLAB} px-4 py-3 text-sm text-slate-300`} role="status">
              This guide has changed since you last read it.
              {row.publication_note ? ` ${row.publication_note}` : ''}
            </p>
          )}

          {row.outdated_at && (
            <p className={`${WARN} px-4 py-3 text-sm`} role="status">
              Flagged as out of date{row.outdated_reason ? ` — ${row.outdated_reason}` : ''}. Parts of
              this guide may no longer match the portal.
            </p>
          )}

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

          {body?.doc && (
            <GuideDocView
              doc={body.doc}
              shown={shown}
              imagesFor={imagesFor}
              onOpen={(to) => { if (to.startsWith('/guides/')) router.push(to); else navigate(to.replace(/^\//, '')) }}
              sectionMeta={sectionMeta}
            />
          )}

          {body?.Body && !body.doc && <body.Body shown={shown} imagesFor={imagesFor} />}

          {!body && dbSections.filter((s) => shown.has(s.anchor)).map((s) => (
            <GuideSection
              key={s.id}
              id={s.anchor}
              title={s.heading}
              meta={sectionMeta({ anchor: s.anchor })}
              images={imagesFor(s.anchor)}
            >
              <div className="prose-guide text-sm leading-relaxed text-slate-300">
                {renderMarkdown(s.body)}
              </div>
            </GuideSection>
          ))}

          {!sections.length && (
            <p className={`${SLAB} px-4 py-6 text-center text-sm text-slate-400`}>
              This guide has no sections yet.
            </p>
          )}

          {sections.length > 0 && !visible.length && (
            <p className={`${SLAB} px-4 py-6 text-center text-sm text-slate-400`}>
              Nothing in this guide matches “{query.trim()}”.
            </p>
          )}

          {/* Previous / next section, and a link to whichever section the
              reader is in — the one control set that works for all three
              prose sources. */}
          {sections.length > 1 && (
            <nav className={`${SLAB} flex flex-wrap items-center justify-between gap-2 px-3 py-2`} aria-label="Sections">
              <Button variant="ghost" size="sm" disabled={!prev} onClick={() => prev && jump(prev.id)}>
                {prev ? `← ${prev.text}` : '← Previous section'}
              </Button>
              {active && (
                <Button variant="ghost" size="sm" onClick={() => { void copySectionLink(active) }}>
                  Copy link to this section
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={!next} onClick={() => next && jump(next.id)}>
                {next ? `${next.text} →` : 'Next section →'}
              </Button>
            </nav>
          )}

          <div className="flex flex-wrap items-center gap-2 lg:hidden">
            <Button variant="ghost" size="sm" aria-pressed={done} onAction={onToggleComplete}>
              {done ? 'Marked as read' : 'Mark as read'}
            </Button>
          </div>

          <GuideFeedbackBlock guideId={row.id} anchor={active ?? null} />

          {mayEdit && (
            <>
              <GuideMediaManager guideId={row.id} media={media} slots={slots} onChanged={reloadMedia} />
              <div className={`${SLAB} flex flex-wrap items-center gap-2 px-3 py-2`}>
                <Button variant="ghost" size="sm" onClick={() => setOutdatedOpen(true)}>
                  {row.outdated_at ? 'Update the out-of-date flag' : 'Flag this guide as out of date'}
                </Button>
                {row.next_review_at && (
                  <span className="text-[11px] text-slate-500">
                    Next review {fmtDate(row.next_review_at)}
                  </span>
                )}
              </div>
            </>
          )}

          {related.length > 0 && (
            <section className={`${PANEL} flex flex-col gap-3 p-4 sm:p-6`}>
              <h2 className={`text-sm font-black uppercase tracking-[0.2em] ${GOLD_TEXT}`}>Related guides</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {related.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/guides/${g.slug}`)}
                      className={`${SLAB} w-full px-3 py-2 text-left hover:border-amber-400/30`}
                    >
                      <span className={`block text-sm font-semibold ${GOLD_TEXT}`}>{g.title}</span>
                      {g.summary && <span className="mt-0.5 block text-xs text-slate-400">{g.summary}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
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

      <Modal open={outdatedOpen} onClose={() => setOutdatedOpen(false)}>
        <ModalHeader title="Flag as out of date" onClose={() => setOutdatedOpen(false)} />
        <div className="flex flex-col gap-3 p-4">
          <Field label="What no longer matches the portal?" required>
            {(id) => (
              <Textarea id={id} rows={4} value={outdatedReason} onChange={(e) => setOutdatedReason(e.target.value)} />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOutdatedOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!outdatedReason.trim()} onAction={flagOutdated}>Flag</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

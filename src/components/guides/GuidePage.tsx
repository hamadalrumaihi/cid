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
import { renderDocumentMarkdown, renderMarkdown, stripDocumentPreamble, type DocHeading } from '@/lib/markdown'
import {
  categoryLabelFrom, guideDocTypeLabel, isSuperseded,
  isUpdatedSinceSeen, listGuideMedia, loadGuidePage, markGuideComplete,
  markGuideOutdated, recordGuideView, resolveGuideImages, submitGuideFeedback, toggleGuideBookmark,
  type GuideCategoryRow, type GuideFeedbackKind, type GuideImage, type GuideMediaRow,
  type GuideProgressRow, type GuideRow, type GuideSectionRow,
} from '@/lib/guides'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { DocToc, scrollToHeading, useActiveHeading } from '@/components/shared/DocToc'
import { Collapsible } from '@/components/ui/Collapsible'
import { useNav } from '@/components/shell/useNav'
import { GuideCover, GuideSection } from './GuideParts'
import { DocumentHeader } from './DocumentHeader'
import { DocCallout } from './DocCallout'
import { GuideDocView } from './GuideDocView'
import { GuideMediaManager, type GuideMediaSlot } from './GuideMediaManager'
import { GuideAcknowledgement, guideOffersAcknowledgement } from './GuideAcknowledgement'
import { GOLD_TEXT, GUIDE_CANVAS, PANEL, SLAB, WARN } from './guideSurfaces'
import { guideBody } from './guideRegistry'
import { RelatedDocuments } from './RelatedDocuments'

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
  const [replacement, setReplacement] = useState<GuideRow | null>(null)
  const [policy, setPolicy] = useState<GuideRow | null>(null)
  const [governs, setGoverns] = useState<GuideRow[]>([])
  const [supersedes, setSupersedes] = useState<GuideRow[]>([])
  const [progress, setProgress] = useState<GuideProgressRow | null>(null)
  const [media, setMedia] = useState<GuideMediaRow[]>([])
  const [images, setImages] = useState<GuideImage[]>([])
  const [bookmarked, setBookmarked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Set once the reader marks the guide read or unread in this visit, so
  // the chip answers immediately without re-reading the progress row.
  const [doneOverride, setDoneOverride] = useState<boolean | null>(null)
  const [outdatedOpen, setOutdatedOpen] = useState(false)
  const [outdatedReason, setOutdatedReason] = useState('')
  const landed = useRef(false)

  // One read for the whole page (lib/guides): the guide, its prose, its
  // imagery signed, this reader's bookmark and progress as they stood BEFORE
  // this visit, and the related guides. Everything past the guide itself is
  // decoration — a part that fails degrades to empty rather than withholding
  // the document — and a slug that names nothing this reader may see answers
  // `guide: null`, the same as a slug that never existed.
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const page = await loadGuidePage(slug)
      setRow(page.guide)
      setDbSections(page.sections)
      setMedia(page.media)
      setImages(page.images)
      setBookmarked(page.bookmarked)
      setCats(page.categories)
      setProgress(page.progress)
      setRelated(page.related)
      setReplacement(page.replacement)
      setPolicy(page.policy)
      setGoverns(page.governs)
      setSupersedes(page.supersedes)
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

  /** A migrated document is ONE section holding the whole body, so its
   *  structure lives in the text rather than in rows. `renderDocumentMarkdown`
   *  returns the nodes and the heading list from a single pass, which is how
   *  the old SOP reader built its rail — and the better arrangement: a table
   *  of contents derived from the text cannot disagree with the text. */
  //  ...minus an opening line that only restates the title, which every
  //  document carried out of the word processor it was written in. The <h1>
  //  above already says it; saying it twice more (once as the section row's
  //  heading, once as the first line of the text) is the "duplicated document
  //  title" every migrated SOP opened with.
  const singleBody = !body && dbSections.length === 1
    ? stripDocumentPreamble(dbSections[0].body, row?.title)
    : null
  const rendered = useMemo(
    () => (singleBody === null ? null : renderDocumentMarkdown(singleBody)),
    [singleBody],
  )

  /** The contents, from whichever prose source this guide uses. */
  const sections = useMemo<DocHeading[]>(() => {
    if (body) return body.sections
    if (rendered) return rendered.headings
    return dbSections.map((s) => ({ id: s.anchor, text: s.heading, level: 2 as const }))
  }, [body, rendered, dbSections])

  const shown = useMemo(() => {
    if (body) return body.matchSections(query)
    // A single-body document has nothing to filter: its structure is in the
    // text. The rail below narrows to matching headings instead.
    if (rendered) return new Set(rendered.headings.map((h) => h.id))
    const q = query.trim().toLowerCase()
    const hit = dbSections.filter((s) => !q || `${s.heading} ${s.body}`.toLowerCase().includes(q))
    return new Set(hit.map((s) => s.anchor))
  }, [body, rendered, dbSections, query])

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
    setImages(await resolveGuideImages(next).catch((): GuideImage[] => []))
  }, [row])

  /** One slot per anchor section, plus the cover. An editor picks where an
   *  image goes by the section it illustrates. */
  const slots: GuideMediaSlot[] = [
    { section: null, label: 'Cover' },
    // Sections and sub-sections; a clause is too fine a place to hang an image.
    ...sections.filter((s) => s.level < 4).map((s) => ({ section: s.id, label: s.text })),
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
            {/* The rail scrolls inside the viewport rather than past it: the
                CID SOP lists 48 Titles and sub-titles, which is taller than
                most screens, and a sticky column with no bound simply hides
                its last entries. */}
            <div className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
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
          {/* The cover, when a guide has one. Above the header rather than
              inside it: a header is a contract every document keeps, and most
              documents have no cover. */}
          <GuideCover image={cover} />

          <DocumentHeader
            row={row}
            categoryLabel={categoryLabelFrom(cats, row.category)}
            actions={crumbs}
            readMinutes={readMinutes}
          />

          {/* The document's own standing note, where its module supplies one. */}
          {body?.note && <DocCallout kind="info">{body.note}</DocCallout>}

          {/* Superseded: say it before the prose, and name the replacement. A
              reader who lands here from an old link must not read a retired
              policy believing it is in force. */}
          {isSuperseded(row) && (
            <DocCallout kind="warning" title="This document has been superseded">
              <p>
                It is kept as the record of what the rules were. For the rules in force now,{' '}
                {replacement
                  ? <a href={`/guides/${replacement.slug}`}>read {replacement.title}</a>
                  : 'see the current document in the library'}.
                {row.change_summary ? ` ${row.change_summary}` : ''}
              </p>
            </DocCallout>
          )}

          {/* A form filled in without its rules is a form filled in wrongly. */}
          {policy && (
            <DocCallout kind="info" title="Governing policy">
              <p>
                This {guideDocTypeLabel(row.doc_type).toLowerCase()} is governed by{' '}
                <a href={`/guides/${policy.slug}`}>{policy.title}</a>
                {policy.doc_type ? ` (${guideDocTypeLabel(policy.doc_type)})` : ''}.
              </p>
            </DocCallout>
          )}


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
            </div>
          )}

          {/* Contents on a narrow screen. The desktop rail cannot follow you
              down a phone, and a bare "Sections" button hides both where you
              are and how much is left. This names the section you are in and
              opens the whole list in place. */}
          {sections.length > 1 && (
            <Collapsible
              className="lg:hidden"
              title="Contents"
              hint={active ? sections.find((h) => h.id === active)?.text : `${sections.length} sections`}
            >
              <DocToc headings={sections} activeId={active} onSelect={jump} size="sheet" />
            </Collapsible>
          )}

          {query.trim() && (
            <p className="text-xs text-slate-500" role="status">
              {rendered
                ? `${sections.filter((h) => h.text.toLowerCase().includes(query.trim().toLowerCase())).length} of ${sections.length} headings match “${query.trim()}” — the document is shown in full.`
                : `${visible.length} of ${sections.length} sections match “${query.trim()}”.`}
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

          {/* A migrated document renders as the document it is: one continuous
              body with its own headings, not a section card wrapping the lot. */}
          {rendered && (
            <div className="prose-guide text-sm leading-relaxed text-slate-300">
              {rendered.nodes}
            </div>
          )}

          {!body && !rendered && dbSections.filter((s) => shown.has(s.anchor)).map((s) => (
            <GuideSection
              key={s.id}
              id={s.anchor}
              title={s.heading}
              meta={sectionMeta({ anchor: s.anchor })}
              images={imagesFor(s.anchor)}
            >
              <div className="prose-guide text-sm leading-relaxed text-slate-300">
                {/* Same rule one level down: a section whose first line
                    repeats its own heading says it once, in the heading. */}
                {renderMarkdown(stripDocumentPreamble(s.body, s.heading))}
              </div>
            </GuideSection>
          ))}

          {!sections.length && (
            <p className={`${SLAB} px-4 py-6 text-center text-sm text-slate-400`}>
              This guide has no sections yet.
            </p>
          )}

          {!rendered && sections.length > 0 && !visible.length && (
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

          {/* Opt-in only — see GuideAcknowledgement. Every other guide renders
              nothing here, and no guide is gated on it. */}
          {guideOffersAcknowledgement(row.slug) && (
            <GuideAcknowledgement guideId={row.id} guideTitle={row.title} />
          )}

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

          <RelatedDocuments governs={governs} supersedes={supersedes} sameCategory={related} />

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

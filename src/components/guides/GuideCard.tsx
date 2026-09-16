'use client'

/** One document in the library — SOP, policy, procedure, form, guide alike.
 *
 *  A card exists to answer one question: is this the document I want? So it
 *  carries only what that decision needs — what it IS, what it is ABOUT, who
 *  may read it, whether it is still in force, whether it changed since I last
 *  looked, how long it takes — and stops. Everything else belongs on the
 *  document.
 *
 *  ── Forms do not look like policies ──────────────────────────────────────
 *  The type badge is outlined for the form family and filled for governing
 *  documents (guideDocFamily). Same hue, different weight: a reader scanning
 *  twenty cards for "the activity report" can pick the forms out without
 *  reading twenty titles, and nothing about the card is themed by type.
 *
 *  ── Colour reinforces the word, never replaces it ────────────────────────
 *  Blue informs, amber says read this before you act on it (draft,
 *  superseded, flagged out of date), red restricts, green confirms. Every
 *  coloured chip also says its state in a word, so none of it depends on a
 *  reader distinguishing amber from rose.
 *
 *  Restricted documents reach only their audience at all (the wall is in the
 *  SELECT policy, not here), so the restricted badge is a reminder to the
 *  people who can see it, never a hint to anyone who cannot. */
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import {
  guideAudienceLabel, guideDocFamily, guideDocTypeLabel, guideStatusLabel, isArchived,
  isRestrictedAudience, isSuperseded,
  type GuideProgressRow, type GuideRow,
} from '@/lib/guides'
import {
  CHIP, CHIP_DONE, CHIP_FORM, CHIP_LOCKED, CHIP_NEUTRAL, CHIP_TYPE, CHIP_WARN, GOLD_TEXT, PANEL, SLAB,
} from './guideSurfaces'

export interface GuideCardProps {
  guide: GuideRow
  categoryLabel: string
  /** Reading estimate in minutes — the guide's own override, or worked out
   *  from its text. */
  readMinutes: number
  /** Signed URL for the guide's cover, when it has one. */
  coverSrc?: string | null
  bookmarked?: boolean
  progress?: GuideProgressRow
  lastUpdatedText: string
  /** Published recently and not yet opened by this reader. */
  isNew?: boolean
  /** Changed since this reader last opened it. */
  isUpdated?: boolean
  onOpen: () => void
  onToggleBookmark?: () => void
  /** Editor controls — omitted entirely for everyone else. */
  editor?: { onTogglePublished: () => void; onTogglePinned: () => void; onEdit: () => void }
}

export function GuideCard({
  guide, categoryLabel, readMinutes, coverSrc = null, bookmarked = false, progress,
  lastUpdatedText, isNew = false, isUpdated = false, onOpen, onToggleBookmark, editor,
}: GuideCardProps) {
  const draft = guide.status === 'draft'
  const archived = isArchived(guide)
  const superseded = isSuperseded(guide)
  const restricted = isRestrictedAudience(guide.audience)
  const done = !!progress?.completed_at
  const started = !done && !!progress?.last_anchor
  const isForm = guideDocFamily(guide.doc_type) === 'form'

  return (
    <article className={`${PANEL} flex flex-col overflow-hidden`}>
      {coverSrc && (
        /* eslint-disable-next-line @next/next/no-img-element -- intrinsic size varies per guide; next/image needs fixed dimensions and would letterbox or crop. */
        <img src={coverSrc} alt="" loading="lazy" className="h-32 w-full object-cover" />
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Type first, then category. They are different questions — what
              this IS, and what it is ABOUT — and the type is the one a reader
              scanning for "the form" is matching on. */}
          <span className={`${CHIP} ${isForm ? CHIP_FORM : CHIP_TYPE}`}>{guideDocTypeLabel(guide.doc_type)}</span>
          <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{categoryLabel}</span>
          {/* One status chip from one rule — archiving outranks the status
              column when both apply, which `guideStatusOf` settles. Active is
              the norm and says nothing; the other three are amber, because
              each of them means "do not treat this as the rule". */}
          {(draft || archived || superseded) && (
            <span
              className={`${CHIP} ${CHIP_WARN}`}
              title={superseded ? 'Replaced by a later document' : undefined}
            >
              {guideStatusLabel(guide)}
            </span>
          )}
          {restricted && (
            <span className={`${CHIP} ${CHIP_LOCKED}`} title={guideAudienceLabel(guide.audience)}>
              Restricted
            </span>
          )}
          {/* Out of date is a caution, not a classification: somebody flagged
              the contents, nobody restricted them. */}
          {guide.outdated_at && <span className={`${CHIP} ${CHIP_WARN}`}>Flagged out of date</span>}
          {isNew && <span className={`${CHIP} ${CHIP_DONE}`}>New</span>}
          {!isNew && isUpdated && <span className={`${CHIP} ${CHIP_DONE}`}>Updated</span>}
          {/* Pinned is neither a state of the document nor a warning — it is
              the division saying "read this". Quiet, and last. */}
          {guide.pinned && <span className={`${CHIP} ${CHIP_NEUTRAL}`}>Pinned</span>}
        </div>

        <div className="min-w-0">
          {/* A document title is a proper name — "CID Undercover Operations
              Procedure", not an all-caps banner. Uppercase forced onto a
              40-character SOP title costs a line and reads as shouting; the
              weight and the colour carry the emphasis instead. */}
          <h3 className={`break-words text-sm font-bold leading-snug ${GOLD_TEXT}`}>{guide.title}</h3>
          {guide.summary && <p className="mt-1 text-sm text-slate-300">{guide.summary}</p>}
        </div>

        {done && (
          <p className={`${CHIP} ${CHIP_DONE} self-start`}>Read</p>
        )}
        {started && (
          <Progress
            value={1}
            max={2}
            label="Reading progress"
            valueText="In progress"
            showValue
            tone="accent"
          />
        )}

        <p className="mt-auto flex flex-wrap gap-x-3 text-[11px] text-slate-500">
          <span>Last updated <time dateTime={guide.updated_at}>{lastUpdatedText}</time></span>
          <span>~{readMinutes} min read</span>
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onOpen}>
            {started ? 'Continue reading' : isForm ? 'Open form' : 'Open document'}
          </Button>
          {onToggleBookmark && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleBookmark}
              aria-pressed={bookmarked}
              title={bookmarked ? 'Remove from your bookmarks' : 'Keep in your bookmarks'}
            >
              {bookmarked ? 'Bookmarked' : 'Bookmark'}
            </Button>
          )}
        </div>

        {editor && (
          <div className={`${SLAB} flex flex-wrap items-center gap-2 px-3 py-2`}>
            <Button variant="ghost" size="sm" onClick={editor.onEdit}>Edit</Button>
            <Button variant="ghost" size="sm" onAction={editor.onTogglePublished}>
              {draft ? 'Publish' : 'Unpublish'}
            </Button>
            <Button variant="ghost" size="sm" onAction={editor.onTogglePinned}>
              {guide.pinned ? 'Unpin' : 'Pin'}
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}

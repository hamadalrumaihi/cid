'use client'

/** One guide in the library.
 *
 *  A card says what the guide is and lets the reader open it. It carries the
 *  few pieces of metadata a reader actually chooses by — category, how long it
 *  takes, when it changed, how far they got — and stops there. Everything else
 *  belongs on the guide.
 *
 *  Restricted guides reach only their audience at all (the wall is in the
 *  SELECT policy, not here), so the restricted badge is a reminder to the
 *  people who can see it, never a hint to anyone who cannot.
 *
 *  Status is never carried by colour alone: every badge has a word in it. */
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import {
  guideAudienceLabel, isArchived, isPublished, isRestrictedAudience, type GuideProgressRow, type GuideRow,
} from '@/lib/guides'
import { CHIP, CHIP_DONE, CHIP_LOCKED, CHIP_NEUTRAL, GOLD_TEXT, PANEL, SLAB } from './guideSurfaces'

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
  const draft = !isPublished(guide)
  const archived = isArchived(guide)
  const restricted = isRestrictedAudience(guide.audience)
  const done = !!progress?.completed_at
  const started = !done && !!progress?.last_anchor

  return (
    <article className={`${PANEL} flex flex-col overflow-hidden`}>
      {coverSrc && (
        /* eslint-disable-next-line @next/next/no-img-element -- intrinsic size varies per guide; next/image needs fixed dimensions and would letterbox or crop. */
        <img src={coverSrc} alt="" className="h-32 w-full object-cover" />
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{categoryLabel}</span>
          {guide.pinned && <span className={`${CHIP} ${CHIP_DONE}`}>Pinned</span>}
          {draft && <span className={`${CHIP} ${CHIP_NEUTRAL}`}>Draft</span>}
          {archived && <span className={`${CHIP} ${CHIP_NEUTRAL}`}>Archived</span>}
          {restricted && (
            <span className={`${CHIP} ${CHIP_LOCKED}`} title={guideAudienceLabel(guide.audience)}>
              Restricted
            </span>
          )}
          {isNew && <span className={`${CHIP} ${CHIP_DONE}`}>New</span>}
          {!isNew && isUpdated && <span className={`${CHIP} ${CHIP_DONE}`}>Updated</span>}
          {guide.outdated_at && <span className={`${CHIP} ${CHIP_LOCKED}`}>Flagged out of date</span>}
        </div>

        <div className="min-w-0">
          <h3 className={`text-sm font-black uppercase tracking-[0.14em] ${GOLD_TEXT}`}>{guide.title}</h3>
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
            {started ? 'Continue' : 'Open Guide'}
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

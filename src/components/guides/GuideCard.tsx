'use client'

/** One guide in the library.
 *
 *  A card says what the guide is and lets the reader open it. Editors also see
 *  its state — draft or published, pinned or not — because those are the two
 *  facts an editor needs at a glance; everyone else only ever sees published
 *  guides, so a status chip would be noise for them.
 *
 *  The cover image is optional, like every other image in the library: when a
 *  guide has none the card renders without one. No placeholder, no grey box. */
import { Button } from '@/components/ui/Button'
import { guideCategoryLabel, isPublished, type GuideRow } from '@/lib/guides'
import { CHIP, CHIP_DONE, CHIP_NEUTRAL, GOLD_TEXT, PANEL, SLAB } from './guideSurfaces'

export interface GuideCardProps {
  guide: GuideRow
  /** Signed URL for the guide's cover, when it has one. */
  coverSrc?: string | null
  bookmarked?: boolean
  lastUpdatedText: string
  onOpen: () => void
  onToggleBookmark?: () => void
  /** Editor controls — omitted entirely for everyone else. */
  editor?: { onTogglePublished: () => void; onTogglePinned: () => void }
}

export function GuideCard({
  guide, coverSrc = null, bookmarked = false, lastUpdatedText, onOpen, onToggleBookmark, editor,
}: GuideCardProps) {
  const draft = !isPublished(guide)
  return (
    <article className={`${PANEL} flex flex-col overflow-hidden`}>
      {coverSrc && (
        /* eslint-disable-next-line @next/next/no-img-element -- intrinsic size varies per guide; next/image needs fixed dimensions and would letterbox or crop. */
        <img src={coverSrc} alt="" className="h-32 w-full object-cover" />
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{guideCategoryLabel(guide.category)}</span>
          {guide.pinned && <span className={`${CHIP} ${CHIP_DONE}`}>Pinned</span>}
          {draft && <span className={`${CHIP} ${CHIP_NEUTRAL}`}>Draft</span>}
        </div>

        <div className="min-w-0">
          <h3 className={`text-sm font-black uppercase tracking-[0.14em] ${GOLD_TEXT}`}>{guide.title}</h3>
          {guide.summary && <p className="mt-1 text-sm text-slate-300">{guide.summary}</p>}
        </div>

        <p className="mt-auto text-[11px] text-slate-500">
          Last updated <time dateTime={guide.updated_at}>{lastUpdatedText}</time>
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onOpen}>Open Guide</Button>
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

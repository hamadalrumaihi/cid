'use client'

/** Presentational shelf card — one document "cover" in the library grid. All
 *  derivations come from docModel (status/ack are text-labelled, never
 *  colour-alone). The PRIMARY action is a real <button> around the title; the
 *  bookmark toggle is its own small button OUTSIDE it (no nested buttons,
 *  ≥40px hit areas). The cover shows at most THREE badges — fuller governance
 *  state (review, expiry, sync, classification) lives in the reader rail. */
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { fmtDate } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import {
  ACK_LABEL, CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE, TYPE_LABEL,
  ackState, docCategory, docTitle,
  type DocumentStatus, type DocumentType, type MyAckVersions, type ShelfDoc,
} from './docModel'

export interface DocItemProps {
  d: ShelfDoc
  myAcks: MyAckVersions
  bookmarked: boolean
  nowMs: number
  /** Active campaign deadline (Required view) — pre-resolved by the shelf. */
  deadline?: string | null
  onOpen: () => void
  onToggleBookmark: () => void
}

/** Cover badges — at most three, in priority order: an unpublished status, the
 *  mandatory / needs-acknowledgement flag, then the document type. */
function DocCoverBadges({ d, myAcks }: Pick<DocItemProps, 'd' | 'myAcks'>) {
  const status = (d.status ?? 'draft') as DocumentStatus
  const type = d.document_type as DocumentType
  const ack = ackState(d, myAcks)
  const ackPending = ack === 'pending' || ack === 'reack_needed'

  const badges: React.ReactNode[] = []
  if (status !== 'published') {
    badges.push(<Badge key="status" tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? d.status}</Badge>)
  }
  if (ackPending) badges.push(<Badge key="ack" tone="warn">{ACK_LABEL[ack]}</Badge>)
  else if (d.mandatory) badges.push(<Badge key="mand" tone="warn">Mandatory</Badge>)
  badges.push(<Badge key="type" tone="neutral">{TYPE_LABEL[type] ?? d.document_type}</Badge>)

  return <span className="flex flex-wrap items-center gap-1.5">{badges.slice(0, 3)}</span>
}

function BookmarkToggle({ title, bookmarked, onToggle }: { title: string; bookmarked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? `Remove bookmark: ${title}` : `Bookmark: ${title}`}
      title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-base transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500 ${
        bookmarked ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <span aria-hidden>{bookmarked ? '★' : '☆'}</span>
    </button>
  )
}

export function DocCard({ d, myAcks, bookmarked, deadline, onOpen, onToggleBookmark }: DocItemProps) {
  const title = docTitle(d.name)
  const owner = d.owner_user_id ? officerName(d.owner_user_id) : null
  const category = CATEGORY_LABEL[docCategory(d)]
  return (
    <Card interactive className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {category}
        </span>
        <BookmarkToggle title={title} bookmarked={bookmarked} onToggle={onToggleBookmark} />
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="min-h-[44px] min-w-0 rounded-lg text-left text-sm font-semibold leading-snug text-white transition hover:text-badge-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
      >
        {title}
      </button>
      <DocCoverBadges d={d} myAcks={myAcks} />
      {d.excerpt && <p className="line-clamp-3 text-xs leading-5 text-slate-400">{d.excerpt}</p>}
      <p className="mt-auto pt-2 text-[11px] text-slate-400">
        Updated {fmtDate(d.updated_at)}
        {owner ? ` · ${owner}` : ''}
        {deadline ? <span className="text-amber-300"> · Due {fmtDate(deadline)}</span> : null}
      </p>
    </Card>
  )
}

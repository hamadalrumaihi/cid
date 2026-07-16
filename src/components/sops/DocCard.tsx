'use client'

/** Presentational shelf items — one card (grid) and one row (list) sharing a
 *  single chip strip so governance state never reads differently between
 *  layouts. All derivations come from docModel (status/ack/review/sync are
 *  text-labelled, never color-alone). The PRIMARY action is a real <button>
 *  around the title area; the bookmark toggle is its own small button OUTSIDE
 *  it (no nested buttons, ≥40px hit areas). */
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { fmtDate } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import {
  ACK_LABEL, CLASS_LABEL, STATUS_LABEL, STATUS_TONE, SYNC_LABEL, SYNC_TONE,
  TYPE_LABEL, ackState, docTitle, isExpired, reviewState,
  type DocumentClassification, type DocumentStatus, type DocumentType,
  type MyAckVersions, type ShelfDoc, type SyncStatus,
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

/** Governance chip strip — identical between card and row. */
function DocChips({ d, myAcks, nowMs, deadline }: Pick<DocItemProps, 'd' | 'myAcks' | 'nowMs' | 'deadline'>) {
  const status = (d.status ?? 'draft') as DocumentStatus
  const cls = (d.classification ?? 'internal') as DocumentClassification
  const type = d.document_type as DocumentType
  const ack = ackState(d, myAcks)
  const review = reviewState(d, nowMs)
  const sync = d.source_system === 'google_drive' ? ((d.sync_status ?? 'synced') as SyncStatus) : null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone="neutral">{TYPE_LABEL[type] ?? d.document_type}</Badge>
      <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? d.status}</Badge>
      {cls !== 'internal' && <Badge tone="accent">{CLASS_LABEL[cls] ?? d.classification}</Badge>}
      {d.mandatory && <Badge tone="warn">Mandatory</Badge>}
      {ack !== 'not_required' && (
        <Badge tone={ack === 'acknowledged' ? 'good' : 'warn'}>{ACK_LABEL[ack]}</Badge>
      )}
      {review && <Badge tone="warn">{review === 'overdue' ? 'Review overdue' : 'Review due soon'}</Badge>}
      {isExpired(d, nowMs) && <Badge tone="danger">Expired</Badge>}
      {sync && (
        <Badge tone={SYNC_TONE[sync] ?? 'neutral'} title={SYNC_LABEL[sync] ?? undefined}>
          {`Drive · ${sync.replace(/_/g, ' ')}`}
        </Badge>
      )}
      {deadline && <Badge tone="warn">Due {fmtDate(deadline)}</Badge>}
    </span>
  )
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

export function DocCard({ d, myAcks, bookmarked, nowMs, deadline, onOpen, onToggleBookmark }: DocItemProps) {
  const title = docTitle(d.name)
  const owner = d.owner_user_id ? officerName(d.owner_user_id) : null
  return (
    <Card interactive className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-h-[44px] min-w-0 flex-1 rounded-lg text-left text-sm font-semibold text-white transition hover:text-badge-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
        >
          {title}
        </button>
        <BookmarkToggle title={title} bookmarked={bookmarked} onToggle={onToggleBookmark} />
      </div>
      <div className="mt-1.5">
        <DocChips d={d} myAcks={myAcks} nowMs={nowMs} deadline={deadline} />
      </div>
      {d.excerpt && <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">{d.excerpt}</p>}
      <p className="mt-auto pt-3 text-[11px] text-slate-400">
        Updated {fmtDate(d.updated_at)}
        {owner ? ` · ${owner}` : ''}
      </p>
    </Card>
  )
}

/** List-layout row (≥sm only — the shelf falls back to cards below sm). */
export function DocListRow({ d, myAcks, bookmarked, nowMs, deadline, onOpen, onToggleBookmark }: DocItemProps) {
  const title = docTitle(d.name)
  const owner = d.owner_user_id ? officerName(d.owner_user_id) : null
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-ink-900/60 py-1.5 pl-4 pr-2 transition hover:border-white/10">
      <button
        type="button"
        onClick={onOpen}
        className="min-h-[44px] min-w-0 flex-1 rounded-lg py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
      >
        <span className="block truncate text-sm font-semibold text-white">{title}</span>
        <span className="block truncate text-xs text-slate-400">
          Updated {fmtDate(d.updated_at)}
          {owner ? ` · ${owner}` : ''}
          {d.excerpt ? ` — ${d.excerpt}` : ''}
        </span>
      </button>
      <div className="hidden max-w-[50%] flex-shrink-0 justify-end md:flex">
        <DocChips d={d} myAcks={myAcks} nowMs={nowMs} deadline={deadline} />
      </div>
      <BookmarkToggle title={title} bookmarked={bookmarked} onToggle={onToggleBookmark} />
    </div>
  )
}

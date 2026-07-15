'use client'

/** One row in the Action Center queue — priority accent, title (deep link),
 *  the "why this needs you" line, context badges, and the inline action when
 *  the canonical write can happen right here (task complete, blocker resolve,
 *  access decision, mark-read). Everything else navigates to the owning
 *  surface via the deep link. */
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { priorityTint } from '@/lib/tint'
import { timeAgo } from '@/lib/format'
import type { ActionItem } from '@/lib/actionItems'

const STALE_MS = 14 * 24 * 60 * 60 * 1000

/** Left-border severity accent per priority (priorityTint temperatures). */
const ACCENT: Record<string, string> = {
  critical: 'border-l-rose-400/80',
  high: 'border-l-amber-400/70',
  normal: 'border-l-blue-400/40',
  low: 'border-l-white/15',
}

export type InlineActionKind = 'complete_task' | 'resolve_blocker' | 'decide_access' | 'mark_read'

/** Unread notifications absorbed by an item (marked read on act/open). */
export function notificationIdsOf(it: ActionItem): string[] {
  const ids = (it.sourceMetadata as { notificationIds?: unknown } | null | undefined)?.notificationIds
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
}

/** Which canonical inline write (if any) a row offers. Sign-offs, transfers,
 *  membership and legal are navigation-only — their writes live behind
 *  server-authoritative flows on the owning pages. */
export function inlineActionOf(it: ActionItem): InlineActionKind | null {
  if (!it.canAct) return null
  switch (it.sourceType) {
    case 'task':
      return 'complete_task'
    case 'blocker':
      return 'resolve_blocker'
    case 'access_request':
      return 'decide_access'
    case 'mention':
    case 'handover':
    case 'other':
      return 'mark_read'
    default:
      return null
  }
}

const ACTION_FALLBACK: Record<InlineActionKind, string> = {
  complete_task: 'Complete',
  resolve_blocker: 'Resolve',
  decide_access: 'Decide',
  mark_read: 'Mark read',
}

export function ActionItemRow({ item, now, muted, onOpen, onAction }: {
  item: ActionItem
  /** Render-stable timestamp from the parent (useNow) — keeps render pure. */
  now: number
  /** Waiting-on-others rows read visually quieter. */
  muted?: boolean
  /** Deep link followed — the parent absorbs the item's notifications. */
  onOpen: (item: ActionItem) => void
  /** Runs the inline action (modal kinds open in the parent). */
  onAction: (item: ActionItem, kind: InlineActionKind) => Promise<unknown> | void
}) {
  const kind = inlineActionOf(item)
  const waiting = item.status === 'waiting'
  const stale = !item.dueAt && now - new Date(item.createdAt).getTime() > STALE_MS
  return (
    <li className="list-none">
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-white/10 border-l-2 bg-ink-900/55 p-3 transition hover:border-white/20 ${ACCENT[item.priority] ?? ACCENT.normal} ${muted ? 'opacity-80' : ''}`}>
        <div className="min-w-0 flex-1 basis-60">
          <Link
            href={item.deepLink}
            onClick={() => onOpen(item)}
            className={`block truncate rounded text-sm font-semibold transition ${muted ? 'text-slate-300' : 'text-white'} hover:text-amber-100`}
          >
            {item.title}
          </Link>
          {item.summary && <p className="mt-0.5 truncate text-xs text-slate-300">{item.summary}</p>}
          {item.reason && <p className="mt-0.5 truncate text-[11px] text-slate-400">{item.reason}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {item.caseNumber && (
              <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-300">{item.caseNumber}</span>
            )}
            {item.bureau && <Badge>{item.bureau}</Badge>}
            {item.dueAt && <DeadlineChip at={item.dueAt} now={now} />}
            {(item.priority === 'critical' || item.priority === 'high') && (
              <Badge tint={priorityTint(item.priority)}>{item.priority === 'critical' ? 'Critical' : 'High'}</Badge>
            )}
            {stale && <Badge>Stale</Badge>}
            {waiting
              ? <span className="text-[11px] text-slate-400">waiting {timeAgo(item.waitingSince ?? item.updatedAt)}</span>
              : <span className="text-[11px] text-slate-400">{timeAgo(item.createdAt)}</span>}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
          {kind && (
            <Button size="sm" className="min-h-[40px] sm:min-h-0" onAction={() => onAction(item, kind)}>
              {/* Access rows carry 'Grant'/'Deny' labels for the modal — the
                  row button only opens that decision. */}
              {kind === 'decide_access' ? 'Decide' : item.actionLabel || ACTION_FALLBACK[kind]}
            </Button>
          )}
          <Link
            href={item.deepLink}
            onClick={() => onOpen(item)}
            aria-label={`Open ${item.title}`}
            className="inline-flex min-h-[40px] items-center rounded-lg px-2 text-[11px] font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white sm:min-h-0"
          >
            Open →
          </Link>
        </div>
      </div>
    </li>
  )
}

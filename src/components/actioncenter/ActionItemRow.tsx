'use client'

/** One row in the Action Center queue — selection checkbox, priority accent,
 *  title (deep link), the "why this needs you" line, context badges (incl.
 *  the Phase-7 Escalated badge), the inline actions `inlineActionsFor`
 *  offers, and the Snooze / Dismiss menu. Everything not offered inline
 *  navigates to the owning surface via the deep link.
 *
 *  The badge / action / checkbox pieces are exported for ActionCard (the
 *  < 640 px layout) so both shapes render the same facts. */
import Link from 'next/link'
import { bureauShort } from '@/lib/roles'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { priorityTint } from '@/lib/tint'
import { timeAgo } from '@/lib/format'
import type { ActionItem } from '@/lib/actionItems'
import { isDismissable, type ActionStateOp } from '@/lib/actionState'
import type { InlineAction } from './inlineActions'
import { SnoozeMenu } from './SnoozeMenu'

const STALE_MS = 14 * 24 * 60 * 60 * 1000

/** Left-border severity accent per priority (priorityTint temperatures). */
export const ACCENT: Record<string, string> = {
  critical: 'border-l-rose-400/80',
  high: 'border-l-amber-400/70',
  normal: 'border-l-blue-400/40',
  low: 'border-l-white/15',
}

/** Which hidden lane a row is rendered in, if any. */
export type RowLane = 'snoozed' | 'dismissed' | null

export interface RowProps {
  item: ActionItem
  /** Render-stable timestamp from the parent (useNow) — keeps render pure. */
  now: number
  /** Waiting-on-others rows read visually quieter. */
  muted?: boolean
  /** The inline actions this viewer is offered (parent computes per item). */
  actions: InlineAction[]
  lane?: RowLane
  selected: boolean
  /** Checkbox toggled; `range` = Shift held (select from the last click). */
  onSelect: (item: ActionItem, range: boolean) => void
  /** Deep link followed — the parent marks the item seen + absorbs notifications. */
  onOpen: (item: ActionItem) => void
  /** Runs (or opens the modal for) one inline action. */
  onAction: (item: ActionItem, action: InlineAction) => Promise<unknown> | void
  /** Per-viewer state write (snooze / dismiss / unsnooze / undismiss). */
  onState: (item: ActionItem, op: ActionStateOp, until?: string) => Promise<unknown> | void
}

const TONE_CLASS: Record<NonNullable<InlineAction['tone']>, string> = {
  primary: '',
  neutral: '',
  danger: 'text-rose-300 hover:text-rose-200',
}

export function RowCheckbox({ item, selected, onSelect }: Pick<RowProps, 'item' | 'selected' | 'onSelect'>) {
  return (
    // 44 px hit area around a native checkbox: the label IS the target.
    <label className="flex h-11 w-11 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg transition hover:bg-white/5">
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Select ${item.title}`}
        onChange={() => { /* handled on click for the shift modifier */ }}
        onClick={(e) => onSelect(item, e.shiftKey)}
        className="h-4 w-4 cursor-pointer rounded border-white/20 bg-ink-950 accent-badge-500"
      />
    </label>
  )
}

export function RowBadges({ item, now, lane }: { item: ActionItem; now: number; lane?: RowLane }) {
  const waiting = item.status === 'waiting'
  const stale = !item.dueAt && now - new Date(item.createdAt).getTime() > STALE_MS
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {item.escalatedAt && (
        <Badge tone="danger" title={`Escalated ${timeAgo(item.escalatedAt)}`}>Escalated</Badge>
      )}
      {item.caseNumber && (
        <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-300">{item.caseNumber}</span>
      )}
      {item.bureau && <Badge>{bureauShort(item.bureau)}</Badge>}
      {item.dueAt && <DeadlineChip at={item.dueAt} now={now} />}
      {(item.priority === 'critical' || item.priority === 'high') && (
        <Badge tint={priorityTint(item.priority)}>{item.priority === 'critical' ? 'Critical' : 'High'}</Badge>
      )}
      {stale && <Badge>Stale</Badge>}
      {lane === 'snoozed' && item.state?.snoozedUntil && (
        <span className="text-[11px] text-slate-400">snoozed until {new Date(item.state.snoozedUntil).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      )}
      {lane === 'dismissed' && item.state?.dismissedAt && (
        <span className="text-[11px] text-slate-400">dismissed {timeAgo(item.state.dismissedAt)}</span>
      )}
      {!lane && (waiting
        ? <span className="text-[11px] text-slate-400">waiting {timeAgo(item.waitingSince ?? item.updatedAt)}</span>
        : <span className="text-[11px] text-slate-400">{timeAgo(item.createdAt)}</span>)}
    </div>
  )
}

/** Inline action buttons + the state menu (or Unsnooze / Undismiss in a
 *  hidden lane) + the Open link. `stack` lays them out for the card. */
export function RowActions({ item, actions, lane, onOpen, onAction, onState, stack }: Pick<RowProps, 'item' | 'actions' | 'lane' | 'onOpen' | 'onAction' | 'onState'> & { stack?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${stack ? 'flex-wrap' : 'flex-shrink-0 flex-wrap'}`}>
      {!lane && actions.map((a) => (
        <Button
          key={a.kind}
          size="sm"
          variant={a.tone === 'danger' ? 'ghost' : 'secondary'}
          className={`min-h-[40px] lg:min-h-0 ${TONE_CLASS[a.tone ?? 'neutral']}`}
          onAction={() => onAction(item, a)}
        >
          {a.label}
        </Button>
      ))}
      {lane === 'snoozed' && (
        <Button size="sm" className="min-h-[40px] lg:min-h-0" onAction={() => onState(item, 'unsnooze')}>Unsnooze</Button>
      )}
      {lane === 'dismissed' && (
        <Button size="sm" className="min-h-[40px] lg:min-h-0" onAction={() => onState(item, 'undismiss')}>Restore</Button>
      )}
      {!lane && (
        <SnoozeMenu
          ariaLabel={`Snooze or dismiss ${item.title}`}
          onSnooze={(until) => onState(item, 'snooze', until)}
          dismiss={{ allowed: isDismissable(item.dedupeKey), onDismiss: () => onState(item, 'dismiss') }}
        />
      )}
      <Link
        href={item.deepLink}
        onClick={() => onOpen(item)}
        aria-label={`Open ${item.title}`}
        className="inline-flex min-h-[40px] items-center rounded-lg px-2 text-[11px] font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white lg:min-h-0"
      >
        Open →
      </Link>
    </div>
  )
}

export function ActionItemRow(props: RowProps) {
  const { item, now, muted, lane, selected, onSelect, onOpen } = props
  const quiet = muted || !!lane
  return (
    <li className="list-none">
      <div
        className={`flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-l-2 bg-ink-900/55 p-2 pr-3 transition focus-within:ring-2 focus-within:ring-amber-400/40 hover:border-white/20 ${
          selected ? 'border-amber-400/30 bg-amber-500/[0.06]' : 'border-white/10'
        } ${ACCENT[item.priority] ?? ACCENT.normal} ${quiet ? 'opacity-80' : ''}`}
      >
        <RowCheckbox item={item} selected={selected} onSelect={onSelect} />
        <div className="min-w-0 flex-1 basis-60">
          <Link
            href={item.deepLink}
            onClick={() => onOpen(item)}
            className={`block truncate rounded text-sm font-semibold transition ${quiet ? 'text-slate-300' : 'text-white'} hover:text-amber-100`}
          >
            {item.title}
          </Link>
          {item.summary && <p className="mt-0.5 truncate text-xs text-slate-300">{item.summary}</p>}
          {item.reason && <p className="mt-0.5 truncate text-[11px] text-slate-400">{item.reason}</p>}
          <RowBadges item={item} now={now} lane={lane} />
        </div>
        <RowActions {...props} />
      </div>
    </li>
  )
}

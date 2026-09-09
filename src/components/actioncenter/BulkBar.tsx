'use client'

/** Bulk bar for the Action Center selection (Phase 7, P7-04 / AC5). Three
 *  actions only — Mark read, Snooze, Dismiss — never a decision: approvals,
 *  sign-offs and reassignments stay one row at a time on purpose. Dismiss
 *  reads "n of m can be dismissed" from the client mirror of the server's
 *  key class; the RPC skips (never raises on) the rest and the parent toasts
 *  the skipped titles.
 *
 *  Sticky at the bottom (above BottomNav on phones), `role="toolbar"`, and a
 *  polite live region that announces the selection count. The live region
 *  stays mounted while the selection is empty so the transition announces. */
import type { ActionItem } from '@/lib/actionItems'
import { isDismissable } from '@/lib/actionState'
import { Button } from '@/components/ui/Button'
import { notificationIdsOf } from './inlineActions'
import { SnoozeMenu } from './SnoozeMenu'

/** Rows Mark read can touch: notification-backed items. */
export const isReadable = (it: ActionItem): boolean =>
  it.dedupeKey.startsWith('notif:') || notificationIdsOf(it).length > 0

export function BulkBar({ selected, visibleCount, onClear, onSelectAll, onMarkRead, onSnooze, onDismiss }: {
  selected: ActionItem[]
  /** Rows currently on screen (the Ctrl/⌘+A set). */
  visibleCount: number
  onClear: () => void
  onSelectAll: () => void
  onMarkRead: (items: ActionItem[]) => Promise<unknown>
  onSnooze: (items: ActionItem[], until: string) => Promise<unknown>
  onDismiss: (items: ActionItem[]) => Promise<unknown>
}) {
  const n = selected.length
  const readable = selected.filter(isReadable)
  const dismissable = selected.filter((it) => isDismissable(it.dedupeKey))
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {n === 0 ? 'No queue items selected.' : `${n} of ${visibleCount} queue item${n === 1 ? '' : 's'} selected.`}
      </p>
      {n > 0 && (
        <div
          role="toolbar"
          aria-label="Selected items"
          className="sticky bottom-[calc(var(--bottom-nav-h,0rem)+0.75rem+env(safe-area-inset-bottom,0px))] z-20 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/25 bg-ink-850/95 p-2 shadow-xl shadow-black/40 backdrop-blur"
        >
          <span className="px-1 text-xs font-semibold text-amber-200" aria-hidden>
            {n} selected
          </span>
          {n < visibleCount && (
            <Button size="sm" variant="ghost" className="min-h-[44px] lg:min-h-0" onClick={onSelectAll}>Select all {visibleCount}</Button>
          )}
          <span className="mx-1 hidden h-5 w-px bg-white/10 sm:inline-block" aria-hidden />
          <Button
            size="sm"
            className="min-h-[44px] lg:min-h-0"
            disabled={!readable.length}
            title={readable.length ? undefined : 'None of the selected items is a notification'}
            onAction={() => onMarkRead(readable)}
          >
            Mark read{readable.length && readable.length < n ? ` (${readable.length})` : ''}
          </Button>
          <SnoozeMenu
            label="Snooze"
            ariaLabel={`Snooze ${n} selected item${n === 1 ? '' : 's'}`}
            align="left"
            onSnooze={(until) => onSnooze(selected, until)}
          />
          <Button
            size="sm"
            variant="ghost"
            className="min-h-[44px] text-rose-300 hover:text-rose-200 lg:min-h-0"
            disabled={!dismissable.length}
            title={dismissable.length ? undefined : 'Decisions and assigned work can’t be dismissed — snooze instead'}
            onAction={() => onDismiss(dismissable)}
          >
            Dismiss
          </Button>
          <span className="text-[11px] text-slate-400">
            {dismissable.length} of {n} can be dismissed
          </span>
          <Button size="sm" variant="ghost" className="ml-auto min-h-[44px] lg:min-h-0" onClick={onClear} aria-label="Clear selection">
            Clear
          </Button>
        </div>
      )}
    </>
  )
}

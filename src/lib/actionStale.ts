/** Items that have stopped moving — and what actually clears them.
 *
 *  A queue row with no deadline never becomes urgent: `urgency()` nudges it a
 *  little as it ages and then stops, so it sits at the same height forever
 *  while dated work overtakes it. The Action Center already NAMED that with a
 *  "Stale" badge, and named it only: there was no way to see the stale rows
 *  together, and the badge said nothing about how to get rid of one. A label
 *  a reader cannot act on is just a second kind of clutter.
 *
 *  So staleness is a shared predicate — the badge, the chip and the count
 *  agree because they ask the same function — and every stale row carries the
 *  ONE sentence that clears it. The advice is honest about its own limits:
 *  most stale work is cleared by doing it, and this module never pretends a
 *  queue row can be resolved from the queue when its decision lives elsewhere.
 *
 *  Pure, and unaware of the viewer: staleness is a fact about the row's age,
 *  not about anyone's permissions. */
import { isDismissable } from './actionState'
import type { ActionItem } from './actionItems'

/** Undated work that has sat this long has stopped moving. Two weeks is the
 *  point at which "I'll get to it" has stopped being true. */
export const STALE_DAYS = 14

const DAY_MS = 86_400_000

/** Whole days since the row appeared (or since it started waiting, which is
 *  the more honest clock for a row parked in someone else's queue). */
export function ageInDays(item: Pick<ActionItem, 'createdAt' | 'waitingSince'>, now: number): number {
  const since = Date.parse(item.waitingSince ?? item.createdAt)
  if (Number.isNaN(since)) return 0
  return Math.max(0, Math.floor((now - since) / DAY_MS))
}

/** A row is stale when it carries no deadline and has aged past the window.
 *  A DATED row is never stale however old it is — it is overdue, which the
 *  queue already says loudly and which is a different problem. */
export function isStale(item: Pick<ActionItem, 'createdAt' | 'waitingSince' | 'dueAt'>, now: number): boolean {
  return !item.dueAt && ageInDays(item, now) >= STALE_DAYS
}

/** The one sentence that gets rid of this row, given what it is. */
export function staleAdvice(item: Pick<ActionItem, 'status' | 'dedupeKey'>, days: number): string {
  const sat = `No deadline, and nothing has moved in ${days} days.`
  if (item.status === 'waiting') {
    return `${sat} It is in someone else's queue — chase the holder, or reassign it if they are not going to get to it.`
  }
  if (item.status === 'informational') {
    return `${sat} Nothing is being asked of you — dismiss it if you have read it.`
  }
  if (isDismissable(item.dedupeKey)) {
    return `${sat} Act on it, or dismiss it if it no longer matters.`
  }
  // A decision or assigned work: it cannot be dismissed, and saying "dismiss
  // it" would be a lie. The only honest exits are doing it or giving it a date.
  return `${sat} Open it and act, or give it a due date so it stops drifting.`
}

/** Badge text + the tooltip that explains the way out. */
export function staleLabel(item: ActionItem, now: number): { days: number; advice: string } | null {
  if (!isStale(item, now)) return null
  const days = ageInDays(item, now)
  return { days, advice: staleAdvice(item, days) }
}

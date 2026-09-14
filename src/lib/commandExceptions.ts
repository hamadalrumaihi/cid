/** Exceptions first.
 *
 *  A command dashboard that renders every queue the same way, zero or not,
 *  makes the reader do the triage: eight tiles, six of them zero, and the two
 *  that matter have to be found by eye every time. The numbers that are zero
 *  are not news — they are the absence of news — and the surface should say
 *  so once rather than spending a tile on each.
 *
 *  So a count is one of three things, and the distinction the portal cares
 *  about most is the third: a queue that has not loaded is NOT an empty queue.
 *  "0 pending" on a failed read is a lie a commander will act on, so an
 *  unknown count stays visible and stays labelled unknown — it never joins the
 *  all-clear line, and it never joins the exceptions either.
 *
 *  Pure, and about presentation only: nothing here decides what a viewer may
 *  see, and every count handed in was already trimmed by RLS. */

export type CountState =
  /** A number greater than zero — something is waiting. */
  | 'attention'
  /** A loaded zero — genuinely nothing. */
  | 'clear'
  /** Not loaded, or not readable. Never reported as zero. */
  | 'unknown'

export function countState(value: number | null | undefined): CountState {
  if (value == null || !Number.isFinite(value)) return 'unknown'
  return value > 0 ? 'attention' : 'clear'
}

export interface ExceptionSplit<T> {
  /** Non-zero counts, in the order given. */
  attention: T[]
  /** Loaded zeros — summarized, not enumerated. */
  clear: T[]
  /** Counts that could not be read. Shown, never summarized away. */
  unknown: T[]
}

/** Partition counted things into what needs attention, what is clear, and
 *  what could not be read. Order within each bucket is the order given, so a
 *  caller's deliberate ranking survives. */
export function splitExceptions<T>(rows: readonly T[], value: (row: T) => number | null | undefined): ExceptionSplit<T> {
  const out: ExceptionSplit<T> = { attention: [], clear: [], unknown: [] }
  for (const row of rows) out[countState(value(row))].push(row)
  return out
}

/** The one line that stands in for the tiles nobody needs to read.
 *  Returns null when there is nothing to summarize. */
export function allClearText(clearLabels: readonly string[]): string | null {
  if (!clearLabels.length) return null
  if (clearLabels.length === 1) return `${clearLabels[0]}: nothing waiting.`
  const list = clearLabels.length <= 4
    ? `${clearLabels.slice(0, -1).join(', ')} and ${clearLabels[clearLabels.length - 1]}`
    : `${clearLabels.slice(0, 3).join(', ')} and ${clearLabels.length - 3} more`
  return `Nothing waiting on ${list}.`
}

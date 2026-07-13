/** Shared deadline engine (v1.14) — the generalized form of the legal
 *  deadline helper (DOJ adoption register: "deadline/expiry concepts").
 *  Server-authoritative timestamps in, human warning out; every surface that
 *  shows a due date (tasks, joint access, follow-ups, warrants, subpoenas)
 *  renders the SAME vocabulary through ui/DeadlineChip. */

export type DeadlineKind = 'due' | 'expires' | 'deadline'

export interface DeadlineInfo {
  text: string
  /** Inside the warning window (default 24h) or already past. */
  urgent: boolean
  /** Strictly past the timestamp. */
  overdue: boolean
}

const LABEL: Record<DeadlineKind, { future: string; past: string }> = {
  due: { future: 'Due', past: 'Overdue' },
  expires: { future: 'Expires', past: 'Expired' },
  deadline: { future: 'Response due', past: 'Response overdue' },
}

/** Null when there is no parseable timestamp — callers render nothing. */
export function deadlineInfo(
  iso: string | null | undefined,
  kind: DeadlineKind = 'due',
  opts: { soonHours?: number; urgentHours?: number; now?: number } = {},
): DeadlineInfo | null {
  if (!iso) return null
  // Date-only values (tasks.due, follow_up_at) count as due at end of day.
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T23:59:59` : iso
  const at = new Date(raw).getTime()
  if (Number.isNaN(at)) return null
  const { soonHours = 48, urgentHours = 24, now = Date.now() } = opts
  const ms = at - now
  const { future, past } = LABEL[kind]
  if (ms <= 0) {
    const hours = Math.round(-ms / 3_600_000)
    const ago = hours < 1 ? '' : hours < 48 ? ` by ${hours}h` : ` by ${Math.round(hours / 24)}d`
    return { text: `${past}${ago}`, urgent: true, overdue: true }
  }
  const hours = Math.round(ms / 3_600_000)
  if (hours <= soonHours) {
    return { text: `${future} in ${hours}h`, urgent: hours <= urgentHours, overdue: false }
  }
  return { text: `${future} ${new Date(raw).toLocaleDateString()}`, urgent: false, overdue: false }
}

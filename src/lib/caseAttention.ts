/** "Needs attention" — what is waiting on THIS case, and whether it is waiting
 *  on the viewer.
 *
 *  The case Brief already had a guided next action and a closure checklist
 *  (lib/caseWorkflow). What it did not have was the handful of states that
 *  stall a real case without ever announcing themselves: a report a reviewer
 *  sent back, a legal request returned for revision, a finalized report nobody
 *  signed. Each of those sits quietly inside a tab until somebody asks why the
 *  case has not moved in a fortnight.
 *
 *  TWO RULES.
 *
 *  · MINE FIRST. An item the viewer can act on outranks one that is waiting on
 *    somebody else, whatever its severity. "Waiting on the judge" is not work,
 *    it is weather; putting it above the viewer's own overdue task is how a
 *    queue teaches people to ignore it.
 *  · NOTHING FROM ANOTHER CASE. Every item is derived from rows of this case
 *    alone. The Action Center remains the one personal queue across cases;
 *    this is the same question asked inside one jacket, and it must never grow
 *    into a second copy of it.
 *
 *  Pure, like the evaluator beside it: rows in, list out, no React, no I/O.
 *  Authority is unchanged — this decides what to SHOW, never who may act. */
import type { Severity, WfCase } from './caseWorkflow'

export interface AttentionItem {
  key: string
  label: string
  detail?: string
  severity: Severity
  /** The case tab this points at. */
  tab?: string
  /** The case is waiting on the VIEWER — their move, not someone else's. */
  mine: boolean
}

/** Minimal row shapes, Pick-style: the evaluator stays decoupled from the
 *  full table types and callers pass projections. */
export interface AttTask { done: boolean; due: string | null; assignee_id?: string | null }
export interface AttReport {
  review_status: string
  finalized: boolean
  author_id?: string | null
  signature?: unknown
}
export interface AttLegal {
  review_status: string
  expires_at?: string | null
  created_by?: string | null
}

export interface AttentionInputs {
  c: WfCase
  meId?: string | null
  tasks?: AttTask[]
  reports?: AttReport[]
  legal?: AttLegal[]
  /** Non-archived case media/evidence count. Advisory: zero is a nudge, never
   *  a blocker, and never stops a case closing. */
  mediaCount?: number
  /** Display name of the current sign-off assignee, for "waiting on X". */
  assigneeName?: string | null
  /** Injected clock (ISO) so the evaluator stays pure and testable. */
  todayISO?: string
}

const AWAITING_SIGNOFF = new Set(['awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director'])
const RETURNED_SIGNOFF = new Set(['changes_requested', 'denied'])

/** Legal states that are finished — nothing is waiting on anybody. */
const LEGAL_DONE = new Set(['denied', 'withdrawn', 'cancelled', 'superseded', 'closed'])
/** Legal states that mean "sent back to the requester" (lib/justice
 *  REVIEW_STATUS_LABEL — bureau, SIB command and judge each return their own). */
const LEGAL_RETURNED = new Set(['returned_by_cid', 'returned_by_siu_command', 'returned_by_judge'])
/** Legal states that are decided in the requester's favour — nothing to chase
 *  except an expiry. */
const LEGAL_APPROVED = new Set(['approved', 'partially_approved'])

const EXPIRY_WINDOW_DAYS = 3

const isDue = (date: string | null | undefined, today: string): boolean => !!date && date <= today

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime()
  const b = new Date(`${toISO.slice(0, 10)}T00:00:00`).getTime()
  return Math.round((b - a) / 86_400_000)
}

const SEVERITY_RANK: Record<Severity, number> = { urgent: 0, warn: 1, info: 2 }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** Everything this case is waiting on, the viewer's own moves first. */
export function caseAttention(input: AttentionInputs): AttentionItem[] {
  const { c, meId = null, assigneeName = null } = input
  // A closed case is not a queue. Whatever is still open on it belongs to the
  // reopening decision, not to a list of work.
  if (c.status === 'closed') return []

  const today = (input.todayISO || new Date().toISOString()).slice(0, 10)
  const tasks = input.tasks ?? []
  const reports = input.reports ?? []
  const legal = input.legal ?? []
  const items: AttentionItem[] = []

  /* ── Sign-off ─────────────────────────────────────────────────────────── */
  const s = c.signoff_status || 'none'
  if (RETURNED_SIGNOFF.has(s)) {
    const mine = !!meId && (c.signoff_submitted_by === meId || c.lead_detective_id === meId)
    items.push({
      key: 'signoff_returned',
      label: 'Sign-off was returned — revise and resubmit',
      detail: 'A reviewer sent this back. Address the notes, then resubmit.',
      severity: 'urgent', tab: 'signoff', mine,
    })
  } else if (AWAITING_SIGNOFF.has(s)) {
    const mine = !!meId && c.signoff_assignee_id === meId
    items.push(mine
      ? { key: 'signoff_decide', label: 'Sign-off is awaiting your decision', severity: 'urgent', tab: 'signoff', mine: true }
      : { key: 'signoff_waiting', label: `Sign-off is with ${assigneeName || 'the reviewer'}`, severity: 'info', tab: 'signoff', mine: false })
  }

  /* ── Reports ──────────────────────────────────────────────────────────── */
  const returned = reports.filter((r) => r.review_status === 'returned')
  if (returned.length) {
    items.push({
      key: 'report_returned',
      label: `${returned.length} ${plural(returned.length, 'report was', 'reports were')} returned for revision`,
      detail: 'A reviewer sent it back — the case does not move until it is revised and resubmitted.',
      severity: 'urgent', tab: 'reports',
      mine: !!meId && returned.some((r) => r.author_id === meId),
    })
  }
  const submitted = reports.filter((r) => r.review_status === 'submitted')
  if (submitted.length) {
    items.push({
      key: 'report_review',
      label: `${submitted.length} ${plural(submitted.length, 'report is', 'reports are')} waiting on a reviewer`,
      severity: 'info', tab: 'reports', mine: false,
    })
  }
  // A finalized report with no author signature is a document that looks
  // complete and is not.
  const unsigned = reports.filter((r) => r.finalized && !r.signature)
  if (unsigned.length) {
    items.push({
      key: 'report_unsigned',
      label: `${unsigned.length} finalized ${plural(unsigned.length, 'report is', 'reports are')} unsigned`,
      detail: 'A finalized report without a signature is not a finished record.',
      severity: 'warn', tab: 'reports',
      mine: !!meId && unsigned.some((r) => r.author_id === meId),
    })
  }

  /* ── Legal requests ───────────────────────────────────────────────────── */
  const live = legal.filter((l) => !LEGAL_DONE.has(l.review_status))
  const legalReturned = live.filter((l) => LEGAL_RETURNED.has(l.review_status))
  if (legalReturned.length) {
    items.push({
      key: 'legal_returned',
      label: `${legalReturned.length} legal ${plural(legalReturned.length, 'request was', 'requests were')} returned for revision`,
      severity: 'urgent', tab: 'legal',
      mine: !!meId && legalReturned.some((l) => l.created_by === meId),
    })
  }
  const legalPending = live.filter((l) => !LEGAL_RETURNED.has(l.review_status) && !LEGAL_APPROVED.has(l.review_status))
  if (legalPending.length) {
    items.push({
      key: 'legal_pending',
      label: `${legalPending.length} legal ${plural(legalPending.length, 'request is', 'requests are')} awaiting a decision`,
      severity: 'info', tab: 'legal', mine: false,
    })
  }
  const expiring = live.filter((l) => {
    if (!LEGAL_APPROVED.has(l.review_status) || !l.expires_at) return false
    const d = daysBetween(today, l.expires_at)
    return d >= 0 && d <= EXPIRY_WINDOW_DAYS
  })
  if (expiring.length) {
    items.push({
      key: 'legal_expiring',
      label: expiring.length === 1
        ? 'An approved legal request expires within 3 days'
        : `${expiring.length} approved legal requests expire within 3 days`,
      severity: 'urgent', tab: 'legal',
      mine: !!meId && expiring.some((l) => l.created_by === meId),
    })
  }

  /* ── Tasks ────────────────────────────────────────────────────────────── */
  const overdue = tasks.filter((t) => !t.done && isDue(t.due, today))
  const mineOverdue = meId ? overdue.filter((t) => t.assignee_id === meId) : []
  const othersOverdue = overdue.length - mineOverdue.length
  if (mineOverdue.length) {
    items.push({
      key: 'tasks_overdue_mine',
      label: `${mineOverdue.length} of your ${plural(mineOverdue.length, 'tasks is', 'tasks are')} overdue`,
      severity: 'urgent', tab: 'tasks', mine: true,
    })
  }
  if (othersOverdue > 0) {
    items.push({
      key: 'tasks_overdue',
      label: `${othersOverdue} ${plural(othersOverdue, 'task is', 'tasks are')} overdue`,
      severity: 'warn', tab: 'tasks', mine: false,
    })
  }

  /* ── Evidence ─────────────────────────────────────────────────────────── */
  if (input.mediaCount === 0) {
    items.push({
      key: 'evidence_missing',
      label: 'No evidence or media is attached yet',
      detail: 'Advisory — a case with no attachments can still be worked and closed.',
      severity: 'info', tab: 'media', mine: false,
    })
  }

  // Mine first, then urgency, then the order the rules above produced.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) =>
      (Number(b.item.mine) - Number(a.item.mine))
      || (SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity])
      || (a.i - b.i))
    .map((x) => x.item)
}

/** How many of these are the viewer's own move — the count a header badge
 *  shows, and the reason a Brief opens on this block rather than below it. */
export const attentionMineCount = (items: readonly AttentionItem[]): number =>
  items.filter((i) => i.mine).length

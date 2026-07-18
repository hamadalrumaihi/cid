/** Shared case-state evaluator — the single rules engine behind "Guided next
 *  action" (the case Overview banner), the pre-close checklist, and My Desk's
 *  per-case hints. It is intentionally PURE: it takes plain rows in and returns
 *  a plain assessment out, with no React, no db, and no I/O, so it can be unit
 *  tested exhaustively and reused by every surface without drift.
 *
 *  The workflow itself stays server-authoritative (the signoff_* / legal RPCs
 *  are the authority). This module only *reads* already-fetched state to decide
 *  what to surface to the operator — it never decides who may act. */
import type { Tables } from './database.types'

export type CaseStage =
  | 'investigation'      // open/active, nothing in review
  | 'awaiting_signoff'   // submitted, sitting with a reviewer
  | 'returned_signoff'   // bounced back for changes / denied
  | 'doj_review'         // ready for DOJ or has live legal requests
  | 'dormant'            // status = cold
  | 'closed'

export type Severity = 'info' | 'warn' | 'urgent'

export interface NextAction {
  key: string
  label: string
  detail?: string
  severity: Severity
  /** Case sub-tab this action points at, when applicable. */
  tab?: string
}

export interface Blocker {
  key: string
  label: string
  count?: number
  severity: Severity
}

/** Officer-authored durable blocker (an open case_blockers row projection). */
export interface PersistedBlocker {
  title: string
  type: string
  review_at: string | null
  status: string
}

/** One line of the itemized closure-readiness checklist. Invariant:
 *  closureReady === closureChecklist.every((i) => i.ok). */
export interface ClosureChecklistItem {
  key: string
  label: string
  ok: boolean
}

export interface CaseCounts {
  openTasks: number
  overdueTasks: number
  draftReports: number
  activeLegal: number
  expiringLegal: number
  /** Non-archived case media (Photos & Media tab). */
  media: number
  supportOfficers: number
}

export interface CaseAssessment {
  stage: CaseStage
  stageLabel: string
  /** Ordered most-important-first; the Overview banner shows the first. */
  nextActions: NextAction[]
  /** Unresolved work that should be cleared before the case is closed. */
  blockers: Blocker[]
  closureReady: boolean
  /** Itemized closure gates — every `ok` ⇔ closureReady (see invariant). */
  closureChecklist: ClosureChecklistItem[]
  counts: CaseCounts
}

/** Minimal row shapes — Pick so the evaluator stays decoupled from the full
 *  table types and callers can pass projections. */
export type WfCase = Pick<Tables<'cases'>,
  'id' | 'status' | 'signoff_status' | 'signoff_stage' | 'signoff_assignee_id'
  | 'signoff_submitted_by' | 'lead_detective_id' | 'follow_up_at'>
export type WfTask = Pick<Tables<'case_tasks'>, 'done' | 'due'>
export type WfReport = Pick<Tables<'reports'>, 'finalized'>
export type WfLegal = Pick<Tables<'legal_requests'>, 'review_status' | 'expires_at'>

export interface CaseInputs {
  c: WfCase
  tasks?: WfTask[]
  reports?: WfReport[]
  legal?: WfLegal[]
  /** Non-archived case media count (photos & media). Advisory only — a case
   *  with zero photos gets a nudge, never a blocker, and stays closable. */
  mediaCount?: number
  supportCount?: number
  meId?: string | null
  /** Display name of the current sign-off assignee, for "waiting on X" copy. */
  assigneeName?: string | null
  /** Durable officer-authored blockers (case_blockers rows). Only rows with
   *  status 'open' count — pass all rows, the evaluator filters. */
  persistedBlockers?: PersistedBlocker[]
  /** Injected clock (ISO) so the evaluator stays pure/testable. Defaults to now. */
  todayISO?: string
}

const AWAITING = new Set(['awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director'])
const RETURNED = new Set(['changes_requested', 'denied'])
/** Sign-off states that mean "nothing is in the review pipeline right now". */
const SIGNOFF_IDLE = new Set(['none', 'approved_complete', 'ready_doj', '', null as unknown as string])
/** Legal review_status values that are finished — they do not block a close. */
const LEGAL_TERMINAL = new Set(['denied', 'withdrawn', 'closed'])

const STAGE_LABEL: Record<CaseStage, string> = {
  investigation: 'Investigation',
  awaiting_signoff: 'Awaiting sign-off',
  returned_signoff: 'Returned for changes',
  doj_review: 'DOJ / legal review',
  dormant: 'Dormant (cold)',
  closed: 'Closed',
}

function isDue(date: string | null | undefined, today: string): boolean {
  return !!date && date <= today
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00').getTime()
  const b = new Date(toISO.slice(0, 10) + 'T00:00:00').getTime()
  return Math.round((b - a) / 86_400_000)
}

function deriveStage(c: WfCase, activeLegal: number): CaseStage {
  if (c.status === 'closed') return 'closed'
  const s = c.signoff_status || 'none'
  if (RETURNED.has(s)) return 'returned_signoff'
  if (AWAITING.has(s)) return 'awaiting_signoff'
  if (s === 'ready_doj' || activeLegal > 0) return 'doj_review'
  if (c.status === 'cold') return 'dormant'
  return 'investigation'
}

/** Whether the RICO tab renders in the case tab strip. RICO is rare (few
 *  cases ever grow a tracker), so the tab stays hidden until: the case HAS
 *  rico data, OR the viewer explicitly enabled tracking this session, OR a
 *  deep link (`?tab=rico`) is already pointing at it — saved links must never
 *  break. Pure so the rule stays unit-testable. */
export function ricoTabVisible(i: { hasData: boolean; sessionEnabled: boolean; activeTab: string }): boolean {
  return i.hasData || i.sessionEnabled || i.activeTab === 'rico'
}

/** Evaluate a case's workflow position and surface what to do next / what
 *  blocks closure. Pure — same inputs always yield the same assessment. */
export function assessCase(input: CaseInputs): CaseAssessment {
  const { c, meId = null, assigneeName = null } = input
  const today = (input.todayISO || new Date().toISOString()).slice(0, 10)
  const tasks = input.tasks ?? []
  const reports = input.reports ?? []
  const legal = input.legal ?? []

  const openTaskRows = tasks.filter((t) => !t.done)
  const openTasks = openTaskRows.length
  const overdueTasks = openTaskRows.filter((t) => isDue(t.due, today)).length
  const draftReports = reports.filter((r) => !r.finalized).length
  const activeLegalRows = legal.filter((l) => !LEGAL_TERMINAL.has(l.review_status || ''))
  const activeLegal = activeLegalRows.length
  const expiringLegal = activeLegalRows.filter((l) => {
    if (!l.expires_at) return false
    const d = daysBetween(today, l.expires_at)
    return d >= 0 && d <= 3
  }).length
  const media = input.mediaCount ?? 0
  const supportOfficers = input.supportCount ?? 0
  const openPersisted = (input.persistedBlockers ?? []).filter((b) => b.status === 'open')
  const openBlockers = openPersisted.length
  const dueBlockers = openPersisted.filter((b) => isDue(b.review_at, today)).length

  const counts: CaseCounts = { openTasks, overdueTasks, draftReports, activeLegal, expiringLegal, media, supportOfficers }
  const stage = deriveStage(c, activeLegal)

  const s = c.signoff_status || 'none'
  const iAmOwner = !!meId && (c.signoff_submitted_by === meId || c.lead_detective_id === meId)
  const iAmAssignee = !!meId && c.signoff_assignee_id === meId

  const nextActions: NextAction[] = []
  const push = (a: NextAction) => nextActions.push(a)

  if (stage === 'closed') {
    push({ key: 'closed', label: 'Case is closed', detail: 'Reopen it if new work is needed.', severity: 'info' })
  } else {
    // Sign-off first — it is the most time-sensitive, actor-specific state.
    if (RETURNED.has(s) && iAmOwner) {
      push({ key: 'signoff_returned', label: 'Revise and resubmit for sign-off', detail: 'A reviewer sent this back — address the notes and resubmit.', severity: 'urgent', tab: 'signoff' })
    } else if (AWAITING.has(s) && iAmAssignee) {
      push({ key: 'signoff_decide', label: 'Decide sign-off — it is awaiting your review', severity: 'urgent', tab: 'signoff' })
    } else if (AWAITING.has(s)) {
      push({ key: 'signoff_waiting', label: `Waiting on ${assigneeName || 'the reviewer'} for sign-off`, severity: 'info', tab: 'signoff' })
    }

    if (expiringLegal > 0) push({ key: 'legal_expiring', label: expiringLegal === 1 ? 'A warrant/subpoena expires within 3 days' : `${expiringLegal} legal requests expire within 3 days`, severity: 'urgent', tab: 'legal' })
    if (overdueTasks > 0) push({ key: 'tasks_overdue', label: `${overdueTasks} ${overdueTasks === 1 ? 'task is' : 'tasks are'} overdue`, severity: 'urgent', tab: 'tasks' })
    if (isDue(c.follow_up_at, today)) push({ key: 'followup_due', label: 'Follow-up is due', detail: c.follow_up_at ?? undefined, severity: 'warn' })
    if (openTasks - overdueTasks > 0) push({ key: 'tasks_open', label: `${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'}`, severity: 'info', tab: 'tasks' })

    // Durable blockers: a passed review date means "re-check whether the case
    // is still waiting on this"; otherwise open blockers are informational.
    if (dueBlockers > 0) {
      push({ key: 'blockers_review_due', label: `${dueBlockers} ${dueBlockers === 1 ? 'blocker is' : 'blockers are'} due for review`, detail: 'Check whether the case is still waiting on it, then resolve or re-date it.', severity: 'warn' })
    } else if (openBlockers > 0) {
      push({ key: 'blockers_open', label: `${openBlockers} open ${openBlockers === 1 ? 'blocker' : 'blockers'}`, severity: 'info' })
    }

    // Investigation-stage nudges toward being sign-off-ready. Photos are
    // advisory only — zero photos never blocks sign-off or closure.
    if (stage === 'investigation') {
      if (media === 0) push({ key: 'add_photos', label: 'Add case photos before requesting sign-off', severity: 'info', tab: 'media' })
      if (draftReports > 0) push({ key: 'finalize_reports', label: `Finalize ${draftReports} draft ${draftReports === 1 ? 'report' : 'reports'}`, severity: 'info', tab: 'reports' })
      if (SIGNOFF_IDLE.has(s) && media > 0 && draftReports === 0 && openTasks === 0 && openBlockers === 0) {
        push({ key: 'request_signoff', label: 'Ready — request sign-off when you are', severity: 'info', tab: 'signoff' })
      }
    }
  }

  // Closure blockers — the pre-close checklist reads these directly.
  const blockers: Blocker[] = []
  if (stage !== 'closed') {
    if (AWAITING.has(s) || RETURNED.has(s)) blockers.push({ key: 'signoff_open', label: 'Sign-off is still in progress', severity: 'warn' })
    if (openTasks > 0) blockers.push({ key: 'open_tasks', label: `${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'}`, count: openTasks, severity: overdueTasks > 0 ? 'urgent' : 'warn' })
    if (activeLegal > 0) blockers.push({ key: 'active_legal', label: `${activeLegal} unresolved legal ${activeLegal === 1 ? 'request' : 'requests'}`, count: activeLegal, severity: 'warn' })
    if (draftReports > 0) blockers.push({ key: 'draft_reports', label: `${draftReports} unfinalized ${draftReports === 1 ? 'report' : 'reports'}`, count: draftReports, severity: 'info' })
    if (openBlockers > 0) blockers.push({ key: 'open_blockers', label: `${openBlockers} open ${openBlockers === 1 ? 'blocker' : 'blockers'}`, count: openBlockers, severity: dueBlockers > 0 ? 'urgent' : 'warn' })
  }

  // Itemized closure gates — each item mirrors exactly one possible blocker
  // (plus the not-already-closed gate), so every-ok ⇔ closureReady holds.
  const closureChecklist: ClosureChecklistItem[] = [
    { key: 'case_open', label: 'Case is open (not already closed)', ok: stage !== 'closed' },
    { key: 'signoff_clear', label: AWAITING.has(s) || RETURNED.has(s) ? 'Sign-off is still in progress' : 'Sign-off pipeline is clear', ok: !(AWAITING.has(s) || RETURNED.has(s)) },
    { key: 'tasks_done', label: openTasks > 0 ? `${openTasks} open ${openTasks === 1 ? 'task remains' : 'tasks remain'}` : 'All tasks completed', ok: openTasks === 0 },
    { key: 'legal_resolved', label: activeLegal > 0 ? `${activeLegal} unresolved legal ${activeLegal === 1 ? 'request' : 'requests'}` : 'No unresolved legal requests', ok: activeLegal === 0 },
    { key: 'reports_final', label: draftReports > 0 ? `${draftReports} ${draftReports === 1 ? 'report is' : 'reports are'} still in draft` : 'All reports finalized', ok: draftReports === 0 },
    { key: 'blockers_clear', label: openBlockers > 0 ? `${openBlockers} open ${openBlockers === 1 ? 'blocker' : 'blockers'}` : 'No open blockers', ok: openBlockers === 0 },
  ]

  return {
    stage,
    stageLabel: STAGE_LABEL[stage],
    nextActions,
    blockers,
    closureReady: stage !== 'closed' && blockers.length === 0,
    closureChecklist,
    counts,
  }
}

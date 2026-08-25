/** Advisory case-health flags — a PURE, clock-injected companion to
 *  lib/caseWorkflow's assessCase. Where assessCase answers "what should the
 *  operator do next", caseHealth answers "what looks neglected on this case":
 *  hygiene signals (no lead, no summary, quiet 14d+, undescribed media) plus
 *  the due/returned work the viewer already fetched. Every flag is ADVISORY —
 *  nothing here blocks closure, sign-off or any workflow.
 *
 *  Contract: computed ONLY from viewer-visible inputs the caller already has
 *  in hand — this module never fetches. When an optional input is undefined
 *  (e.g. the list view has no task rows and no intel-link count), the flags
 *  that need it are SKIPPED rather than guessed. BOLO expiry is deliberately
 *  out of scope: persons.bolo_expires_at is person-scoped, not case-scoped. */
import type { Tables } from './database.types'

export type HealthSeverity = 'info' | 'warn'

export interface HealthFlag {
  key: string
  /** Short chip text. */
  label: string
  /** Why the flag raised + how to clear it — the chip tooltip. */
  why: string
  /** Case sub-tab (caseTabs vocabulary) the chip deep-links to. */
  tab: string
  severity: HealthSeverity
}

/** Minimal row shapes — structural Picks so callers can pass projections
 *  (the caseWorkflow idiom). */
export type HealthCase = Pick<Tables<'cases'>,
  'status' | 'signoff_status' | 'lead_detective_id' | 'summary' | 'updated_at' | 'follow_up_at'>
export interface HealthTask { done: boolean | null; due: string | null }
export interface HealthReport { finalized: boolean | null }
export interface HealthLegal { review_status: string }
export interface HealthBlocker { status: string; review_at: string | null }
export interface HealthMedia { title: string | null; category: string | null; archived_at: string | null }

export interface HealthInputs {
  c: HealthCase
  /** Case tasks — undefined (list view) skips the overdue_tasks flag. */
  tasks?: HealthTask[]
  /** Case reports — undefined skips draft_reports. */
  reports?: HealthReport[]
  /** Legal rows — undefined skips returned_legal. */
  legal?: HealthLegal[]
  /** case_blockers rows (all; open filtered here) — undefined skips the flag. */
  blockers?: HealthBlocker[]
  /** Media rows — undefined skips evidence_without_description. */
  media?: HealthMedia[]
  /** case_intel_links count. undefined (not fetched) SKIPS no_linked_subjects
   *  — an unknown count is a different claim from a known zero. */
  intelLinks?: number
  /** Injected clock (ISO) so the evaluator stays pure/testable. */
  nowISO?: string
}

/** Same quiet threshold as caseUtils.isStaleCase / StaleBadge. */
export const CASE_STALE_DAYS = 14

/** Mirror of lib/legalWorkflow's RETURNED set — every member of that set is a
 *  `returned_by_*` status and nothing else is, so the prefix IS the rule
 *  (responsibleRole() sends exactly these back to the investigator). */
const isReturnedLegal = (s: string | null | undefined): boolean =>
  (s ?? '').startsWith('returned_by_')

const isDue = (date: string | null | undefined, today: string): boolean =>
  !!date && date.slice(0, 10) <= today

const daysSince = (fromISO: string, nowISO: string): number =>
  Math.floor((new Date(nowISO).getTime() - new Date(fromISO).getTime()) / 86_400_000)

const n = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

/** Evaluate a case's advisory health flags. Pure — same inputs, same flags.
 *  Closed cases return no flags at all (a closed case needs no attention
 *  chips); cold cases keep only the pending-work flags (overdue tasks,
 *  returned legal, due blockers, follow-up, drafts) and drop the
 *  active-investigation hygiene nudges. */
export function caseHealth(input: HealthInputs): HealthFlag[] {
  const { c } = input
  if (c.status === 'closed') return []
  const now = input.nowISO || new Date().toISOString()
  const today = now.slice(0, 10)
  // "Active" = being worked (not closed, not deliberately parked cold) — the
  // same set isStaleCase watches. Hygiene nudges apply to active cases only.
  const active = c.status !== 'cold'
  const flags: HealthFlag[] = []

  // ── Due / returned work (warn) — real pending items, cold included. ──
  if (input.legal) {
    const returned = input.legal.filter((l) => isReturnedLegal(l.review_status)).length
    if (returned > 0) {
      flags.push({
        key: 'returned_legal',
        label: returned === 1 ? 'Legal request returned' : `${returned} legal requests returned`,
        why: 'A reviewer sent it back to the investigator — revise and resubmit from the Legal tab.',
        tab: 'legal', severity: 'warn',
      })
    }
  }
  if (input.tasks) {
    const overdue = input.tasks.filter((t) => !t.done && isDue(t.due, today)).length
    if (overdue > 0) {
      flags.push({
        key: 'overdue_tasks',
        label: n(overdue, 'overdue task', 'overdue tasks'),
        why: 'Open tasks are past their due date — complete or re-date them on the Tasks tab.',
        tab: 'tasks', severity: 'warn',
      })
    }
  }
  if (isDue(c.follow_up_at, today)) {
    flags.push({
      key: 'follow_up_due',
      label: 'Follow-up due',
      why: `The follow-up date (${(c.follow_up_at ?? '').slice(0, 10)}) has passed — act on it or move it from the case header.`,
      tab: 'overview', severity: 'warn',
    })
  }
  if (input.blockers) {
    const due = input.blockers.filter((b) => b.status === 'open' && isDue(b.review_at, today)).length
    if (due > 0) {
      flags.push({
        key: 'open_blockers_review_due',
        label: n(due, 'blocker due for review', 'blockers due for review'),
        why: 'A blocker’s review date has passed — check whether the case still waits on it, then resolve or re-date it.',
        tab: 'overview', severity: 'warn',
      })
    }
  }

  // ── Hygiene (active cases only). ──
  if (active && !c.lead_detective_id) {
    flags.push({
      key: 'no_lead',
      label: 'No lead detective',
      why: 'Nobody owns this case — assign a lead via Edit case or Hand over case.',
      tab: 'overview', severity: 'warn',
    })
  }
  const quiet = daysSince(c.updated_at, now)
  if (active && quiet >= CASE_STALE_DAYS) {
    flags.push({
      key: 'no_recent_activity',
      label: `Quiet ${quiet}d`,
      why: `No updates in ${quiet} days — record progress, or mark the case cold if it is parked.`,
      tab: 'timeline', severity: 'warn',
    })
  }
  // Viewer-agnostic and informational — the actor-specific urgency lives in
  // assessCase; this only notes that the case is sitting with a reviewer.
  if ((c.signoff_status ?? '').startsWith('awaiting_')) {
    flags.push({
      key: 'awaiting_signoff',
      label: 'Awaiting sign-off',
      why: 'Submitted for command review — the assigned reviewer decides next.',
      tab: 'signoff', severity: 'info',
    })
  }
  if (active && !(c.summary ?? '').trim()) {
    flags.push({
      key: 'missing_summary',
      label: 'No summary',
      why: 'A one-line summary is what every list and packet shows — add one via Edit case.',
      tab: 'overview', severity: 'info',
    })
  }
  if (active && input.intelLinks === 0) {
    flags.push({
      key: 'no_linked_subjects',
      label: 'No linked subjects',
      why: 'Nothing connects this case to people, gangs, vehicles or places — link subjects on Intel & Notes.',
      tab: 'intel', severity: 'info',
    })
  }
  if (input.reports) {
    const drafts = input.reports.filter((r) => !r.finalized).length
    if (drafts > 0) {
      flags.push({
        key: 'draft_reports',
        label: n(drafts, 'draft report', 'draft reports'),
        why: 'Reports still in draft — finalize them before requesting sign-off.',
        tab: 'reports', severity: 'info',
      })
    }
  }
  if (input.media) {
    const bare = input.media.filter((m) => !m.archived_at && !(m.title ?? '').trim() && !(m.category ?? '').trim()).length
    if (bare > 0) {
      flags.push({
        key: 'evidence_without_description',
        label: n(bare, 'undescribed media item', 'undescribed media items'),
        why: 'Media without a title or category is hard to find and cite later — describe it on Photos & Media.',
        tab: 'media', severity: 'info',
      })
    }
  }

  return flags
}

/** The flags a LIST row can honestly compute from the cases row alone —
 *  what CasesView's table chip and the "Needs attention" filter use. Never
 *  guesses at per-case child rows it did not fetch. */
const LIST_SAFE_KEYS = new Set(['no_lead', 'missing_summary', 'no_recent_activity', 'follow_up_due'])

export function listCaseHealth(c: HealthCase, nowISO?: string): HealthFlag[] {
  return caseHealth({ c, nowISO }).filter((f) => LIST_SAFE_KEYS.has(f.key))
}

/** Owner Console — pure derivations for the Owner Dashboard.
 *
 *  Hook-free on purpose: the pending-action queue, the curated admin audit
 *  set and the ledger reference counter are plain functions with a unit test
 *  beside them (ownerQueue.test.ts), so the dashboard's judgement calls are
 *  verifiable without a fetch layer. */

export interface OwnerQueueInput {
  /** Each signal: a count, or null = not checked / the fetch failed. A null
   *  never produces a queue row — "unknown" is not "pending". */
  clientErrors: number | null
  securityFailures: number | null
  fixtureIssues: number | null
  openFeedback: number | null
}

export interface OwnerQueueItem {
  id: 'client_errors' | 'security_failures' | 'fixture_issues' | 'open_feedback'
  label: string
  /** Why this row needs the owner — the DashRow `why` line. */
  why: string
  count: number
  /** Owner Console section (?s=) the row deep-links to. */
  section: 'security' | 'feedback'
}

/** The owner's pending-action queue, derived from the real health signals
 *  only (client errors, RLS-suite failures, fixture drift, open feedback).
 *  Nothing here is invented — no uptime/backup/upload monitors exist. */
export function ownerQueue(input: OwnerQueueInput): OwnerQueueItem[] {
  const out: OwnerQueueItem[] = []
  if (input.clientErrors) {
    out.push({
      id: 'client_errors', count: input.clientErrors, section: 'security',
      label: 'Client errors reported',
      why: 'Uncaught exceptions from members’ browsers — triage, then clear',
    })
  }
  if (input.securityFailures) {
    out.push({
      id: 'security_failures', count: input.securityFailures, section: 'security',
      label: 'Security suite failures',
      why: 'The live RLS suites reported failing assertions on their latest runs',
    })
  }
  if (input.fixtureIssues) {
    out.push({
      id: 'fixture_issues', count: input.fixtureIssues, section: 'security',
      label: 'Fixture health issues',
      why: 'rls-test fixtures missing or drifted from their expected identity',
    })
  }
  if (input.openFeedback) {
    out.push({
      id: 'open_feedback', count: input.openFeedback, section: 'feedback',
      label: 'Open feedback',
      why: 'Submissions not yet resolved, archived, rejected or marked duplicate',
    })
  }
  return out
}

/** Curated audit_log actions that count as ADMINISTRATIVE changes for the
 *  dashboard's "Recent administrative changes" panel. These are the named
 *  actions the admin RPCs write (schema: upper-case literals); the generic
 *  row triggers write INSERT/UPDATE/DELETE and are deliberately excluded —
 *  ordinary bureau workload does not belong on the owner's dashboard. */
export const ADMIN_AUDIT_ACTIONS: readonly string[] = [
  // Membership lifecycle
  'APPROVED', 'REJECTED', 'CORRECTION_REQUESTED',
  'ROLE_CHANGED', 'BUREAU_RESTRUCTURE',
  'REMOVE_MEMBER', 'RESTORE_MEMBER', 'ORG_CORRECTION_INITIATED',
  // Justice identity + DOJ coverage
  'JUSTICE_GRANTED', 'JUSTICE_APPOINTED', 'JUSTICE_DEACTIVATED', 'JUSTICE_REACTIVATED',
  'PROSECUTOR_COVERAGE_GRANTED', 'PROSECUTOR_COVERAGE_ENDED',
  'TRANSFER_DOJ_REQUESTED', 'TRANSFER_DOJ_EFFECTIVE',
  // Field Intelligence appointments
  'FIELD_OFFICER_APPOINTED', 'FIELD_OFFICER_ENDED',
  // Owner-only controls
  'PERMANENT_DELETE_ARMED', 'PERMANENT_DELETE_EXECUTED', 'CASE_PERMANENT_DELETE',
  'SIU_RELEASE_SET', 'TEST_FLAG_SET',
]

/** 'ROLE_CHANGED' → 'Role changed' — display form for the audit action codes. */
export function adminActionLabel(action: string): string {
  const s = action.replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Total reference count from a deleted_member_ledger `references` snapshot.
 *  The column is jsonb: bucket → (table.column → count), plus scalar counts
 *  (role_events). Sums every numeric leaf one level down; returns null when
 *  the shape is not an object (never guesses). */
export function ledgerReferenceCount(refs: unknown): number | null {
  if (refs === null || typeof refs !== 'object' || Array.isArray(refs)) return null
  let total = 0
  for (const v of Object.values(refs as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) total += v
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const n of Object.values(v as Record<string, unknown>)) {
        if (typeof n === 'number' && Number.isFinite(n)) total += n
      }
    } else if (Array.isArray(v)) total += v.length
  }
  return total
}

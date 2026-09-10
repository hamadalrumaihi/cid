/** Owner Console — pure derivations for the Owner Dashboard.
 *
 *  Hook-free on purpose: the curated admin audit set and the ledger reference
 *  counter are plain functions with a unit test beside them
 *  (ownerQueue.test.ts), so the dashboard's judgement calls are verifiable
 *  without a fetch layer. The former pending-action queue is gone — the
 *  Action Center's Owner signals (lib/actionItems) carry those rows now. */

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

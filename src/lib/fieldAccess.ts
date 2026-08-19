/** Getting Field Intelligence access — the client mirror of
 *  20260920120000_field_access_class.sql.
 *
 *  ── There is no queue any more ─────────────────────────────────────────────
 *  Asking to send CID information is not asking for a job. The access grants
 *  nothing except the ability to write a report addressed to CID, so a human
 *  decision in front of it was a delay with no decision in it — the answer was
 *  always going to be yes. `field_access_self_serve()` creates the standing
 *  immediately.
 *
 *  That is safe because of what the standing IS, not because anybody checked
 *  it: a field officer is not `profiles.active`, so all 22 is_active()-gated
 *  intelligence tables stay shut, and they cannot read another officer's
 *  submission, the review queue, claim verdicts, matching or anything SIU.
 *  Approval was never the boundary; the access class is.
 *
 *  ── The queue below is history ─────────────────────────────────────────────
 *  `field_access_requests` is kept because rows already filed are a record, and
 *  because command may still appoint somebody administratively. Nothing files a
 *  new one.
 */

import { list, rpc } from './db'
import type { Tables } from './database.types'
import { FIELD_AGENCIES, FIELD_AGENCY_NAME, type FieldAgency } from './fieldOfficers'

export type FieldAccessRequestRow = Tables<'field_access_requests'>

export { FIELD_AGENCIES, FIELD_AGENCY_NAME }
export type { FieldAgency }

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for a decision',
  approved: 'Approved',
  denied: 'Not approved',
  withdrawn: 'Withdrawn',
}

/** Every request an investigator may see, newest first. RLS returns the
 *  applicant only their own. */
export async function loadAccessRequests(): Promise<FieldAccessRequestRow[]> {
  return list('field_access_requests', { order: 'created_at', ascending: false })
    .catch(() => [])
}

/** Create the access. The database stamps the caller as the officer, so a
 *  client cannot create standing for somebody else, and it refuses an account
 *  that is already CID, already a field officer, removed, or login-denied —
 *  that last one is the refusal that matters, because self-service with no
 *  check against a denial would undo a command decision. */
export async function selfServeFieldAccess(
  agency: FieldAgency, callsign?: string, rank?: string, unit?: string,
): Promise<string | null> {
  const res = await rpc('field_access_self_serve', {
    p_agency: agency,
    p_callsign: callsign?.trim() || undefined,
    p_rank: rank?.trim() || undefined,
    p_unit: unit?.trim() || undefined,
  })
  return res.error?.message ?? null
}

/** Approve or decline. Command only — the RPC re-checks, so this is
 *  convenience. Declining requires a reason because the applicant reads it;
 *  "no" with no explanation is how somebody applies four more times. */
export async function decideAccessRequest(
  id: string, approve: boolean, reason?: string,
): Promise<string | null> {
  const res = await rpc('field_access_decide', {
    p_request: id, p_approve: approve, p_reason: reason?.trim() || undefined,
  })
  return res.error?.message ?? null
}

/** Why this request cannot be filed yet, or null. The trigger refuses these
 *  too — this is so the officer reads a sentence rather than a raised
 *  exception. */
export function requestProblem(agency: string): string | null {
  if (!(FIELD_AGENCIES as readonly string[]).includes(agency)) {
    return 'Choose your agency.'
  }
  return null
}

/** How to describe an applicant in the queue. */
export function requestLabel(r: FieldAccessRequestRow): string {
  return [r.callsign, r.agency, r.officer_rank, r.unit].filter(Boolean).join(' · ')
}

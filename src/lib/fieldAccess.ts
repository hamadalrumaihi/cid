/** Asking for Field Intelligence access — the client mirror of
 *  20260916120000_field_access_and_jurisdiction.sql.
 *
 *  ── Why this exists ────────────────────────────────────────────────────────
 *  Until now a field officer could only come into being if command appointed
 *  them out of nowhere, which required command to already know the officer
 *  wanted in. A patrol officer who signed in saw the CID membership application
 *  and nothing else — so their only options were to apply for a job they were
 *  not asking for, or to leave.
 *
 *  ── A request grants nothing ───────────────────────────────────────────────
 *  Approving one calls the SAME assign_field_officer() that already existed, so
 *  there is one way to become a field officer and one audit trail for it. This
 *  is a queue in front of that door, not a second door.
 */

import { insert, list, rpc, update } from './db'
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

/** Ask for access. `user_id` is sent because the INSERT policy checks it, but
 *  the trigger overwrites it with the caller regardless — a client cannot file
 *  a request on somebody else's behalf. */
export async function requestFieldAccess(
  userId: string, agency: FieldAgency,
  callsign?: string, rank?: string, unit?: string,
): Promise<string | null> {
  const res = await insert('field_access_requests', {
    user_id: userId,
    agency,
    callsign: callsign?.trim() || null,
    officer_rank: rank?.trim() || null,
    unit: unit?.trim() || null,
  })
  return res.error?.message ?? null
}

/** Take back a request you have not had answered yet. */
export async function withdrawRequest(id: string): Promise<string | null> {
  const res = await update('field_access_requests', id, { status: 'withdrawn' })
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

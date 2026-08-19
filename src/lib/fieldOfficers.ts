/** Field officers — the client mirror of 20260910120000_field_officers.sql.
 *
 *  A field officer is a SAHP, BCSO or LSPD account that reaches the Field
 *  Intelligence portal and nothing else. The important property is what they
 *  are NOT: `profiles.active`. Twenty-two intelligence tables grant SELECT on
 *  `private.is_active()` alone, so making an external officer active would hand
 *  them every person, gang member and stash house in the database. Keeping
 *  standing in its own table means every CID policy stays shut against them
 *  without one of them being edited.
 *
 *  ── This file decides nothing ──────────────────────────────────────────────
 *  Appointment and revocation both run through SECURITY DEFINER RPCs that
 *  re-check `private.is_command()`. Hiding this panel from a detective is
 *  convenience; the RPC refusing them is the boundary.
 */

import { list, rpc } from './db'
import type { Tables } from './database.types'

/** The agencies Field Intelligence serves. Mirrors the check constraint on
 *  field_officers.agency — an agency added there must be added here, and the
 *  constraint is what actually refuses an unknown one. */
export const FIELD_AGENCIES = ['SAHP', 'BCSO', 'LSPD'] as const
export type FieldAgency = (typeof FIELD_AGENCIES)[number]

export const FIELD_AGENCY_NAME: Record<FieldAgency, string> = {
  SAHP: 'San Andreas Highway Patrol',
  BCSO: 'Blaine County Sheriff’s Office',
  LSPD: 'Los Santos Police Department',
}

export type FieldOfficerRow = Tables<'field_officers'>

/** Every appointment, current and ended. Ended ones are kept deliberately:
 *  they are the provenance of submissions the officer already made, so the
 *  roster shows history rather than pretending a revoked officer never existed. */
export async function loadFieldOfficers(): Promise<FieldOfficerRow[]> {
  return list('field_officers', { order: 'appointed_at', ascending: false })
    .catch(() => [])
}

/** Appoint, or re-appoint. The RPC updates in place on conflict, so an officer
 *  who returns keeps the SAME account and therefore the same submission
 *  history — which is the whole reason shared agency logins are refused. */
export async function appointFieldOfficer(
  userId: string, agency: FieldAgency,
  callsign?: string, rank?: string, unit?: string,
): Promise<string | null> {
  const res = await rpc('assign_field_officer', {
    p_user: userId,
    p_agency: agency,
    p_callsign: callsign?.trim() || undefined,
    p_rank: rank?.trim() || undefined,
    p_unit: unit?.trim() || undefined,
  })
  return res.error?.message ?? null
}

/** End an appointment. Never a delete, and the reason is required by the
 *  database rather than by this form. */
export async function endFieldOfficer(userId: string, reason: string): Promise<string | null> {
  const res = await rpc('end_field_officer', { p_user: userId, p_reason: reason })
  return res.error?.message ?? null
}

/** How to describe an appointment in one line. */
export function fieldOfficerLabel(o: FieldOfficerRow): string {
  return [o.callsign, o.agency, o.officer_rank, o.unit].filter(Boolean).join(' · ')
}

/** Why an appointment cannot be made, or null when it looks usable. The
 *  database is still the guarantee — this only catches the common mistakes
 *  before a round trip. */
export function appointmentProblem(
  userId: string, agency: string,
  profiles: ReadonlyArray<{ id: string; active: boolean | null }>,
): string | null {
  if (!userId) return 'Choose the account to appoint.'
  if (!(FIELD_AGENCIES as readonly string[]).includes(agency)) return 'Choose an agency.'
  const p = profiles.find((x) => x.id === userId)
  if (!p) return 'That account has not signed in yet. It must exist before it can be appointed.'
  // A CID member does not need a field appointment and would be routed to the
  // investigative portal anyway (CID wins at the gate), so this is almost
  // certainly the wrong account rather than a deliberate dual identity.
  if (p.active) {
    return 'That is an active CID account. It already has full portal access, so a field appointment would have no effect.'
  }
  return null
}

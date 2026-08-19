/** What follows from an intelligence record that matters — the client mirror of
 *  20260924120000_intelligence_actions.sql.
 *
 *  Three things happen to a report worth acting on: it becomes a case, it joins
 *  a case somebody already opened, or it tells a surveillance team what to look
 *  for. All three existed before this; all three lived on a different screen,
 *  which meant retyping what the reviewer had just finished reading.
 *
 *  ── Provenance is permanent, links are not ────────────────────────────────
 *  A case opened FROM a record carries an `originated` link that nobody can
 *  remove — not the person who made it, not command, not the Owner. It is a
 *  fact about how the case came to exist. A link somebody added afterwards is
 *  `linked` and can be taken back, and taking it back stamps the row rather
 *  than deleting it, so the history reads "linked on the 4th, unlinked on the
 *  9th, wrong Rodriguez" instead of losing both events.
 *
 *  ── The identity of a confidential source is not in this file ─────────────
 *  Nor is it in any table the browser can read. `field_submission_sources` has
 *  RLS on with no policy and no grants at all, so PostgREST returns nothing to
 *  anybody at any rank. `revealSource()` below is the only way in, it admits
 *  the handler and the Owner, and it writes an audit row saying who looked.
 *  What the record itself carries is the CODENAME, which is what a reviewer
 *  needs to weigh what the source said.
 */

import { list, rpc } from './db'
import type { Tables } from './database.types'

export type FieldCaseLinkRow = Tables<'field_submission_cases'>
export type ObservationRow = Tables<'surveillance_observations'>

export const CASE_BUREAUS = ['LSB', 'BCB', 'SAB', 'JTF'] as const
export type CaseBureau = (typeof CASE_BUREAUS)[number]

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/** Every link this record has ever had to a case, newest first — including the
 *  removed ones, which are the whole point of keeping history. */
export async function loadCaseLinks(submissionId: string): Promise<FieldCaseLinkRow[]> {
  return list('field_submission_cases', {
    eq: { submission_id: submissionId },
    order: 'linked_at',
    ascending: false,
  })
}

/** The other direction: what a case was built on. Used from the case side, so
 *  an investigation can say where it came from. */
export async function loadCaseProvenance(caseId: string): Promise<FieldCaseLinkRow[]> {
  return list('field_submission_cases', {
    eq: { case_id: caseId },
    order: 'linked_at',
    ascending: false,
  })
}

export function liveLinks(links: FieldCaseLinkRow[]): FieldCaseLinkRow[] {
  return links.filter((l) => !l.unlinked_at)
}

/** True when this link records that the case was opened from the record. */
export function isProvenance(l: FieldCaseLinkRow): boolean {
  return l.relation === 'originated'
}

export function linkLine(l: FieldCaseLinkRow): string {
  if (l.unlinked_at) {
    return `Unlinked${l.unlink_reason ? ` — ${l.unlink_reason}` : ''}`
  }
  return l.relation === 'originated'
    ? 'This case was opened from this record'
    : l.note || 'Linked to this case'
}

/** Open a case from the record. Returns the new case id, or an error message.
 *
 *  The case number comes from the bureau's established series, the same
 *  generator the New case form uses — a second numbering scheme for cases that
 *  happen to start from intelligence would be a second numbering scheme. */
export async function createCaseFrom(
  submissionId: string,
  bureau: CaseBureau,
  title: string,
  summary?: string,
  lead?: string,
): Promise<{ caseId?: string; error?: string }> {
  const res = await rpc('field_submission_create_case', {
    p_submission: submissionId,
    p_bureau: bureau,
    p_title: title.trim(),
    p_summary: summary?.trim() || undefined,
    p_lead: lead || undefined,
  })
  if (res.error) return { error: res.error.message }
  return { caseId: typeof res.data === 'string' ? res.data : undefined }
}

export async function linkCase(
  submissionId: string, caseId: string, note?: string,
): Promise<string | null> {
  const res = await rpc('field_submission_link_case', {
    p_submission: submissionId, p_case: caseId, p_note: note?.trim() || undefined,
  })
  return res.error?.message ?? null
}

/** Removing a link needs a reason for the same reason archiving does: somebody
 *  will ask later why these two stopped being related. */
export async function unlinkCase(linkId: string, reason: string): Promise<string | null> {
  const res = await rpc('field_submission_unlink_case', {
    p_link: linkId, p_reason: reason,
  })
  return res.error?.message ?? null
}

// ---------------------------------------------------------------------------
// Surveillance
// ---------------------------------------------------------------------------

/** Confidence a reviewer may set on an observation drawn from a report.
 *  'confirmed' is absent deliberately — a report OF something is not a
 *  confirmation of it, and the database applies the same rule. */
export const OBSERVATION_CONFIDENCE = [
  'probable', 'possible', 'unverified', 'disproven',
] as const
export type ObservationConfidence = (typeof OBSERVATION_CONFIDENCE)[number]

export async function loadObservationsFrom(submissionId: string): Promise<ObservationRow[]> {
  return list('surveillance_observations', {
    eq: { field_submission_id: submissionId },
    order: 'observed_at',
    ascending: false,
  })
}

/** An observation belongs to a case, so the record has to be on that case
 *  first. That is not a technicality: it keeps every route from intelligence to
 *  a case visible in the same link history, instead of a third one nobody
 *  thinks to look at. */
export async function createObservationFrom(
  submissionId: string,
  caseId: string,
  activity: string,
  opts: { observedAt?: string; location?: string; confidence?: ObservationConfidence } = {},
): Promise<{ observationId?: string; error?: string }> {
  const res = await rpc('field_submission_create_observation', {
    p_submission: submissionId,
    p_case: caseId,
    p_activity: activity.trim(),
    p_observed_at: opts.observedAt || undefined,
    p_location: opts.location?.trim() || undefined,
    p_confidence: opts.confidence || undefined,
  })
  if (res.error) return { error: res.error.message }
  return { observationId: typeof res.data === 'string' ? res.data : undefined }
}

/** For an observation logged before anybody realised which report it answered. */
export async function linkObservation(
  submissionId: string, observationId: string,
): Promise<string | null> {
  const res = await rpc('field_submission_link_observation', {
    p_submission: submissionId, p_observation: observationId,
  })
  return res.error?.message ?? null
}

// ---------------------------------------------------------------------------
// Confidential sources
// ---------------------------------------------------------------------------

export interface RevealedSource {
  codename: string
  source_name: string | null
  source_contact: string | null
  handler_notes: string | null
  handler_id: string
  created_at: string
}

/** Register the source behind a record. The identity goes into a table nobody
 *  can read; the record gets the codename and, only then, is allowed to say its
 *  source was confidential — the before-update trigger checks for the protected
 *  row first, so the option and the protection cannot come apart. */
export async function setSource(
  submissionId: string,
  codename: string,
  details: { name?: string; contact?: string; notes?: string; handler?: string } = {},
): Promise<string | null> {
  const res = await rpc('field_submission_set_source', {
    p_submission: submissionId,
    p_codename: codename.trim(),
    p_name: details.name?.trim() || undefined,
    p_contact: details.contact?.trim() || undefined,
    p_notes: details.notes?.trim() || undefined,
    p_handler: details.handler || undefined,
  })
  return res.error?.message ?? null
}

/** Reading an identity is an event, not a query: this is audited, and refused
 *  for anybody who is neither the handler nor the Owner. Rank does not open it
 *  — command can see that a source exists and what it is called, because that
 *  is on the record, and that is as far as rank gets you. */
export async function revealSource(
  submissionId: string,
): Promise<{ source?: RevealedSource; error?: string }> {
  const res = await rpc('field_submission_source_reveal', { p_submission: submissionId })
  if (res.error) return { error: res.error.message }
  const d = res.data as Partial<RevealedSource> | null
  if (!d || typeof d.codename !== 'string') return { error: 'No source came back.' }
  return {
    source: {
      codename: d.codename,
      source_name: d.source_name ?? null,
      source_contact: d.source_contact ?? null,
      handler_notes: d.handler_notes ?? null,
      handler_id: typeof d.handler_id === 'string' ? d.handler_id : '',
      created_at: typeof d.created_at === 'string' ? d.created_at : '',
    },
  }
}

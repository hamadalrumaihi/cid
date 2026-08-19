/** SIU handling of a Field Intelligence report — the client mirror of
 *  20260918120000_field_siu_referral.sql.
 *
 *  ── SIU is not a second inbox ──────────────────────────────────────────────
 *  A patrol officer cannot know whether what they saw is a bureau matter or a
 *  criminal enterprise, so they are never asked. The report lands in its
 *  jurisdiction's queue and an INVESTIGATOR marks the SIU angle afterwards —
 *  either a flag (a workflow indicator, and nothing more) or a referral (a
 *  formal ask, with a reason, that SIU take it on).
 *
 *  ── Referral does not make the report disappear ────────────────────────────
 *  Jurisdiction, reporting officer, CID assignee and every claim verdict stay
 *  as they were, and the report stays in its CID queue. SIU interest is a layer
 *  on top. The one exception is public corruption, which marks the report
 *  sensitive server-side — an allegation against an officer cannot sit in a
 *  queue readable by the bureau it may concern.
 *
 *  ── This file decides nothing ──────────────────────────────────────────────
 *  Only SIU can answer a referral, and only the Special Agent in Charge can
 *  assign SIU work — not a CID Bureau Lead, not the CID Director. Every rule
 *  here is re-checked by a SECURITY DEFINER function; hiding a button is
 *  courtesy.
 */

import { list, rpc } from './db'
import type { Tables } from './database.types'

export type FieldSiuActionRow = Tables<'field_siu_actions'>
export type FieldSiuFollowupRow = Tables<'field_siu_followups'>

// ---------------------------------------------------------------------------
// What SIU is for
// ---------------------------------------------------------------------------

/** Mirrors the check constraint. These are the SOP's own categories — the list
 *  is what SIU exists to do, not a taxonomy somebody invented for a dropdown. */
export const SIU_CATEGORIES = [
  'organized_crime', 'gang_mc_enterprise', 'narcotics_trafficking',
  'firearms_trafficking', 'public_corruption', 'fugitive',
  'major_crime_scene', 'cross_jurisdiction', 'other_complex',
] as const
export type SiuCategory = (typeof SIU_CATEGORIES)[number]

export const SIU_CATEGORY_LABEL: Record<SiuCategory, string> = {
  organized_crime: 'Organized crime',
  gang_mc_enterprise: 'Gang / MC enterprise',
  narcotics_trafficking: 'Narcotics trafficking',
  firearms_trafficking: 'Firearms trafficking',
  public_corruption: 'Public corruption',
  fugitive: 'Fugitive',
  major_crime_scene: 'Major crime scene',
  cross_jurisdiction: 'Cross-jurisdiction investigation',
  other_complex: 'Other complex investigation',
}

export function siuCategoryLabel(c: string | null): string {
  return SIU_CATEGORY_LABEL[c as SiuCategory] ?? 'Not stated'
}

/** Referring under this category restricts the report server-side. Surfaced so
 *  the person referring is told BEFORE they do it, rather than discovering that
 *  colleagues can no longer see the report. */
export const SENSITIVE_CATEGORY: SiuCategory = 'public_corruption'

// ---------------------------------------------------------------------------
// The SIU lane
// ---------------------------------------------------------------------------

export const SIU_STATES = ['flagged', 'referred', 'accepted', 'declined'] as const
export type SiuState = (typeof SIU_STATES)[number]

export const SIU_STATE_LABEL: Record<SiuState, string> = {
  flagged: 'Possible SIU relevance',
  referred: 'Referred to SIU',
  accepted: 'SIU handling',
  declined: 'SIU declined',
}

/** Deliberately spelled out, because the difference between a flag and a case
 *  is the thing most likely to be misread. */
export const SIU_STATE_MEANING: Record<SiuState, string> = {
  flagged: 'An investigator thinks this may be SIU work. It is not a referral '
    + 'and nothing about who handles it has changed.',
  referred: 'Somebody has formally asked SIU to take this on. SIU has not '
    + 'answered yet.',
  accepted: 'SIU is working this alongside CID. The CID assignment is '
    + 'unchanged.',
  declined: 'SIU looked and is not taking it. It stays with CID.',
}

export function siuStateLabel(s: string | null): string {
  return s ? (SIU_STATE_LABEL[s as SiuState] ?? s) : ''
}

export function siuStateMeaning(s: string | null): string {
  return s ? (SIU_STATE_MEANING[s as SiuState] ?? '') : ''
}

/** A flag is a workflow indicator. Anything past a referral is real handling,
 *  and the badge should not read the same for both. */
export function siuStateTone(s: string | null): 'neutral' | 'accent' | 'warn' | 'good' {
  switch (s) {
    case 'flagged': return 'neutral'
    case 'referred': return 'warn'
    case 'accepted': return 'good'
    case 'declined': return 'neutral'
    default: return 'neutral'
  }
}

/** Whether an investigator can still mark this one. Once it is with SIU the
 *  answer belongs to SIU. */
export function canFlag(state: string | null): boolean {
  return state !== 'referred' && state !== 'accepted'
}

export function canRefer(state: string | null): boolean {
  return state !== 'referred' && state !== 'accepted'
}

// ---------------------------------------------------------------------------
// Follow-up candidates — SIU eyes only
// ---------------------------------------------------------------------------

/** Surveillance, undercover work, source development and controlled operations
 *  are methods, and a method is only useful while its subject does not know it
 *  is in use. The policy on this table is `private.siu_is_agent()` and nothing
 *  else: not the submitting officer, not the CID detective holding the report. */
export const FOLLOWUP_KINDS = [
  'surveillance', 'undercover', 'source_development',
  'controlled_operation', 'target_development',
] as const
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number]

export const FOLLOWUP_LABEL: Record<FollowupKind, string> = {
  surveillance: 'Surveillance follow-up',
  undercover: 'Undercover follow-up',
  source_development: 'Source development',
  controlled_operation: 'Controlled operation',
  target_development: 'Target development',
}

export function followupLabel(k: string): string {
  return FOLLOWUP_LABEL[k as FollowupKind] ?? k
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** What SIU has done with this report, oldest first. Readable by anybody who
 *  can read the report — that is what "referral is not a disappearance" means
 *  in practice. */
export async function loadSiuActions(submissionId: string): Promise<FieldSiuActionRow[]> {
  return list('field_siu_actions', {
    eq: { submission_id: submissionId }, order: 'created_at',
  }).catch(() => [])
}

/** Returns [] for everybody who is not an SIU agent. The empty array is the
 *  policy answering, not this function deciding. */
export async function loadFollowups(submissionId: string): Promise<FieldSiuFollowupRow[]> {
  return list('field_siu_followups', {
    eq: { submission_id: submissionId }, order: 'created_at',
  }).catch(() => [])
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function flagForSiu(
  id: string, category: SiuCategory, note?: string,
): Promise<string | null> {
  const res = await rpc('field_submission_siu_flag', {
    p_submission: id, p_category: category, p_note: note?.trim() || undefined,
  })
  return res.error?.message ?? null
}

export async function unflagForSiu(id: string, reason: string): Promise<string | null> {
  const res = await rpc('field_submission_siu_unflag', { p_submission: id, p_reason: reason })
  return res.error?.message ?? null
}

/** Refer. The reason is required by the database — SIU reads it to decide, and
 *  "looks dodgy" is not a decision anybody can act on. */
export async function referToSiu(
  id: string, category: SiuCategory, reason: string,
): Promise<string | null> {
  const res = await rpc('field_submission_siu_refer', {
    p_submission: id, p_category: category, p_reason: reason,
  })
  return res.error?.message ?? null
}

/** SIU answers. Declining needs a note, because the CID investigator who
 *  referred it is still holding the report and needs to know what to do next. */
export async function decideSiuReferral(
  id: string, accept: boolean, note?: string,
): Promise<string | null> {
  const res = await rpc('field_submission_siu_decide', {
    p_submission: id, p_accept: accept, p_note: note?.trim() || undefined,
  })
  return res.error?.message ?? null
}

/** X-1 assigns accepted work to a Special Agent. Deliberately not available to
 *  CID command at any rank. */
export async function assignSiuAgent(
  id: string, userId: string, reason?: string,
): Promise<string | null> {
  const res = await rpc('field_submission_siu_assign', {
    p_submission: id, p_user: userId, p_reason: reason?.trim() || undefined,
  })
  return res.error?.message ?? null
}

export async function setSiuSensitive(
  id: string, on: boolean, reason: string,
): Promise<string | null> {
  const res = await rpc('field_submission_siu_sensitive', {
    p_submission: id, p_on: on, p_reason: reason,
  })
  return res.error?.message ?? null
}

export async function addFollowup(
  id: string, kind: FollowupKind, note?: string,
): Promise<string | null> {
  const res = await rpc('field_siu_followup_add', {
    p_submission: id, p_kind: kind, p_note: note?.trim() || undefined,
  })
  return res.error?.message ?? null
}

export async function clearFollowup(id: string, reason: string): Promise<string | null> {
  const res = await rpc('field_siu_followup_clear', { p_id: id, p_reason: reason })
  return res.error?.message ?? null
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** One line of the SIU history. */
export function siuActionLine(
  a: FieldSiuActionRow, nameOf: (id: string | null) => string,
): string {
  const who = nameOf(a.actor_id)
  switch (a.action) {
    case 'flagged': return `${who} flagged possible ${siuCategoryLabel(a.category).toLowerCase()}`
    case 'unflagged': return `${who} removed the SIU flag`
    case 'referred': return `${who} referred it to SIU — ${siuCategoryLabel(a.category)}`
    case 'accepted': return `${who} accepted it for SIU`
    case 'declined': return `${who} declined it for SIU`
    case 'assigned': return `${who} assigned it to ${nameOf(a.to_user)}`
    case 'reassigned': return `${who} moved it from ${nameOf(a.from_user)} to ${nameOf(a.to_user)}`
    case 'sensitive_on': return `${who} restricted this report to SIU`
    case 'sensitive_off': return `${who} lifted the restriction`
    default: return a.action
  }
}

/** Why a referral cannot be sent yet, or null. The RPC refuses these too. */
export function referralProblem(category: string, reason: string): string | null {
  if (!(SIU_CATEGORIES as readonly string[]).includes(category)) {
    return 'Choose one of the SIU categories.'
  }
  if (!reason.trim()) return 'Say why this needs SIU — they read this to decide.'
  return null
}

/** What referring under this category will do to who can see the report. Shown
 *  before the referral, not after. */
export function referralWarning(category: string): string | null {
  return category === SENSITIVE_CATEGORY
    ? 'A corruption referral is restricted to SIU. Colleagues in your bureau — '
      + 'including command — will no longer see this report. You will, because '
      + 'you referred it.'
    : null
}

/** The CID/SIU side of a Field Intelligence submission — the client mirror of
 *  20260913120000_field_review.sql.
 *
 *  ── Two kinds of writing, kept apart ───────────────────────────────────────
 *  `field_submission_reviews` is reviewer-to-reviewer and the officer NEVER
 *  sees it: its SELECT policy is `private.is_active()` and nothing else, and a
 *  field officer is not active. `field_submission_messages` is the thread both
 *  sides read. They are different tables rather than one table with a
 *  "visible to officer" flag, because that flag is the sort of thing somebody
 *  eventually forgets to set and internal reasoning ends up in front of the
 *  person it is about.
 *
 *  ── Reviewers act through RPCs, not UPDATE ─────────────────────────────────
 *  CID has no UPDATE policy on field_submissions at all. Claiming, deciding,
 *  rerouting and asking are SECURITY DEFINER functions that each write their
 *  own audit row. That is not ceremony: if a direct update also worked, the
 *  audited path would be the polite option rather than the only one, and a
 *  reroute between CID and SIU would go unrecorded exactly when somebody wanted
 *  it to.
 */

import { insert, list, rpc } from './db'
import type { Tables } from './database.types'
import type { FieldStatus, FieldSubmissionRow } from './fieldSubmissions'

export type FieldMessageRow = Tables<'field_submission_messages'>
export type FieldReviewNoteRow = Tables<'field_submission_reviews'>

// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

/** Mirrors private.field_submission_transition_ok(). Archived and rejected
 *  reopen to 'reviewing' on purpose: a wrong rejection should be fixable, and a
 *  report archived before its moment can matter later. */
const NEXT: Record<FieldStatus, readonly FieldStatus[]> = {
  draft: [],
  submitted: ['reviewing', 'archived', 'rejected'],
  reviewing: ['needs_info', 'partially_reviewed', 'intel_added', 'linked_existing',
    'linked_case', 'archived', 'rejected'],
  needs_info: ['reviewing', 'archived', 'rejected'],
  partially_reviewed: ['reviewing', 'intel_added', 'linked_existing', 'linked_case',
    'archived', 'rejected'],
  intel_added: ['linked_existing', 'linked_case', 'archived'],
  linked_existing: ['linked_case', 'archived'],
  linked_case: ['archived'],
  archived: ['reviewing'],
  rejected: ['reviewing'],
}

export function reviewNext(from: string): readonly FieldStatus[] {
  return NEXT[from as FieldStatus] ?? []
}

/** Statuses that still want a decision, for the default queue filter. */
export const OPEN_STATUSES: readonly FieldStatus[] = [
  'submitted', 'reviewing', 'needs_info', 'partially_reviewed',
]

export function isOpen(s: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(s)
}

/** What a reviewer is being asked to do next, in one phrase. Null when the
 *  report is settled. */
export function reviewPrompt(s: FieldSubmissionRow): string | null {
  switch (s.status) {
    case 'submitted': return 'Not picked up yet'
    case 'reviewing': return s.assigned_to ? 'In review' : 'In review, unassigned'
    case 'needs_info': return 'Waiting on the officer'
    case 'partially_reviewed': return 'Part-decided'
    default: return null
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
//
// All RLS-scoped. A reviewer's policy returns submitted reports and never a
// draft, so there is no "exclude drafts" filter here to forget.

export async function loadReviewQueue(): Promise<FieldSubmissionRow[]> {
  return list('field_submissions', { order: 'submitted_at', ascending: false })
    .catch(() => [])
}

export async function loadMessages(submissionId: string): Promise<FieldMessageRow[]> {
  return list('field_submission_messages', {
    eq: { submission_id: submissionId }, order: 'created_at',
  }).catch(() => [])
}

/** Reviewer-private notes. Returns [] for anyone the policy refuses, which is
 *  every field officer — this function is not the wall, the policy is. */
export async function loadReviewNotes(submissionId: string): Promise<FieldReviewNoteRow[]> {
  return list('field_submission_reviews', {
    eq: { submission_id: submissionId }, order: 'created_at', ascending: false,
  }).catch(() => [])
}

// ---------------------------------------------------------------------------
// Actions — each one audits itself server-side
// ---------------------------------------------------------------------------

/** Take it. Also moves 'submitted' to 'reviewing', because picking a report up
 *  and saying you are reviewing it are the same act. */
export async function claimSubmission(id: string): Promise<string | null> {
  const res = await rpc('field_submission_claim', { p_submission: id })
  return res.error?.message ?? null
}

/** Move it along the lane. `note` is reviewer-private — it is recorded in
 *  field_submission_reviews, which the officer cannot read. Anything meant FOR
 *  the officer is a message, not a note. */
export async function decideSubmission(
  id: string, status: FieldStatus, note?: string,
): Promise<string | null> {
  const res = await rpc('field_submission_decide', {
    p_submission: id, p_status: status, p_note: note?.trim() || undefined,
  })
  return res.error?.message ?? null
}

/** Ask the officer something. One call, so the question and the status move
 *  cannot come apart: a report sitting in 'needs_info' with no question in it
 *  is a dead end for the officer. */
export async function askOfficer(id: string, question: string): Promise<string | null> {
  const res = await rpc('field_submission_ask', {
    p_submission: id, p_question: question,
  })
  return res.error?.message ?? null
}

/** The officer's answer. An ordinary insert rather than an RPC, because it is
 *  not a decision — the INSERT policy allows it only while the report is
 *  actually in 'needs_info', so the thread cannot become a channel for chasing
 *  an investigation.
 *
 *  `from_reviewer` is not sent: a trigger sets it from who is really writing.
 *  Answering does NOT move the status back to 'reviewing'. That was considered
 *  and rejected — an officer replying does not mean a reviewer has resumed, and
 *  it would need a trigger writing a status the officer is otherwise forbidden
 *  to write. The reviewer moves it when they pick it up; the queue shows them a
 *  reply is waiting. */
export async function replyAsOfficer(id: string, body: string): Promise<string | null> {
  const text = body.trim()
  if (!text) return 'Write an answer first.'
  const res = await insert('field_submission_messages', {
    submission_id: id, body: text,
  })
  return res.error?.message ?? null
}

/** True when the last word in the thread is the officer's — what tells a
 *  reviewer a reply is waiting, since answering deliberately does not change
 *  the status. */
export function awaitingReviewer(messages: FieldMessageRow[]): boolean {
  const last = messages[messages.length - 1]
  return !!last && !last.from_reviewer
}

// ---------------------------------------------------------------------------
// Claim-level verification
// ---------------------------------------------------------------------------

export type ClaimKind = 'person' | 'vehicle' | 'org' | 'location' | 'item'
export type FieldVerdictRow = Tables<'field_claim_verdicts'>

export const VERDICTS = ['verified', 'unverified', 'disputed', 'rejected'] as const
export type Verdict = (typeof VERDICTS)[number]

/** What each verdict actually asserts. `unverified` is the one worth wording
 *  carefully: it is not a synonym for wrong, and a reviewer choosing between it
 *  and `disputed` is making a real distinction. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  verified: 'Verified',
  unverified: 'Unverified',
  disputed: 'Disputed',
  rejected: 'Rejected',
}
export const VERDICT_MEANING: Record<Verdict, string> = {
  verified: 'Confirmed against what CID already holds.',
  unverified: 'Useful, but not confirmed. This is not the same as wrong.',
  disputed: 'Something CID holds contradicts this.',
  rejected: 'Should not be treated as intelligence.',
}

export const VERDICT_TONE: Record<Verdict, 'good' | 'neutral' | 'warn' | 'danger'> = {
  verified: 'good', unverified: 'neutral', disputed: 'warn', rejected: 'danger',
}

export interface ClaimProgress {
  claims: number
  decided: number
  verified: number
  unverified: number
  disputed: number
  rejected: number
}

const NO_PROGRESS: ClaimProgress = {
  claims: 0, decided: 0, verified: 0, unverified: 0, disputed: 0, rejected: 0,
}

/** Verdicts on one report. Empty for a field officer — verdicts are
 *  reviewer-only, and that is the policy's doing, not this function's. */
export async function loadVerdicts(submissionId: string): Promise<FieldVerdictRow[]> {
  return list('field_claim_verdicts', { eq: { submission_id: submissionId } })
    .catch(() => [])
}

export async function loadClaimProgress(submissionId: string): Promise<ClaimProgress> {
  const res = await rpc('field_claim_progress', { p_submission: submissionId })
  return (res.data as unknown as ClaimProgress | null) ?? NO_PROGRESS
}

/** Record — or change — the verdict on one claim. The RPC upserts, so changing
 *  your mind replaces the verdict rather than accumulating contradictory ones,
 *  and the audit log keeps what it was before. */
export async function decideClaim(
  kind: ClaimKind, claimId: string, verdict: Verdict, note?: string,
): Promise<string | null> {
  const res = await rpc('field_claim_decide', {
    p_kind: kind, p_claim: claimId, p_verdict: verdict,
    p_note: note?.trim() || undefined,
  })
  return res.error?.message ?? null
}

/** The verdict on a given claim, or null when nobody has decided yet. */
export function verdictFor(
  verdicts: FieldVerdictRow[], kind: ClaimKind, claimId: string,
): FieldVerdictRow | null {
  const col = ({
    person: 'person_id', vehicle: 'vehicle_id', org: 'org_id',
    location: 'location_id', item: 'item_id',
  } as const)[kind]
  return verdicts.find((v) => v[col] === claimId) ?? null
}

// ---------------------------------------------------------------------------
// Entity matching and publication
// ---------------------------------------------------------------------------
//
// Nothing here creates a person, a vehicle, a gang or a case. Matching
// SUGGESTS; a reviewer links; publishing records the link as intelligence with
// the submission attached as its source. An external report that could mint
// records on its own would mean a patrol officer's guess becoming a database
// fact with nobody's name against it.

export type TargetKind = 'person' | 'vehicle' | 'gang' | 'place'

export interface EntityMatch {
  kind: TargetKind
  id: string
  label: string
  /** The normalizers made this compare equal, rather than it merely being
   *  similar. Still a suggestion, not a conclusion. */
  exact: boolean
}

export interface MatchResult {
  matches: EntityMatch[]
  /** How many OTHER submissions named the same plate, person or organization.
   *  Repetition is a signal worth surfacing and is NOT corroboration — three
   *  officers can repeat the same rumour. */
  also_reported: number
  /** False for items: a seizure is an event, not a standing record, so there is
   *  no table for it to be a duplicate of. */
  matchable: boolean
}

const NO_MATCHES: MatchResult = { matches: [], also_reported: 0, matchable: false }

export async function loadMatches(kind: ClaimKind, claimId: string): Promise<MatchResult> {
  const res = await rpc('field_claim_matches', { p_kind: kind, p_claim: claimId })
  return (res.data as unknown as MatchResult | null) ?? NO_MATCHES
}

export type FieldClaimLinkRow = Tables<'field_claim_links'>

export async function loadClaimLinks(submissionId: string): Promise<FieldClaimLinkRow[]> {
  return list('field_claim_links', { eq: { submission_id: submissionId } }).catch(() => [])
}

/** Assert that this claim refers to that existing record. It does not edit
 *  either one — the record keeps its data and the claim keeps the officer's
 *  words. */
export async function linkClaim(
  kind: ClaimKind, claimId: string, targetKind: TargetKind, targetId: string,
): Promise<string | null> {
  const res = await rpc('field_claim_link', {
    p_kind: kind, p_claim: claimId, p_target_kind: targetKind, p_target: targetId,
  })
  return res.error?.message ?? null
}

/** Put the report into the intelligence database: one `intelligence_tips` row
 *  carrying the submission id, plus a tip link per linked claim.
 *
 *  The tip arrives as `new` / `unverified` whatever a reviewer decided about
 *  individual claims. A tip's own triage is a separate judgement, and an
 *  external submission arriving pre-accepted is the thing to avoid. */
export async function publishSubmission(id: string): Promise<string | null> {
  const res = await rpc('field_submission_publish', { p_submission: id })
  return res.error?.message ?? null
}

/** Whether a claim has already been matched to a record. */
export function linkFor(
  links: FieldClaimLinkRow[], kind: ClaimKind, claimId: string,
): FieldClaimLinkRow | null {
  const col = ({
    person: 'claim_person_id', vehicle: 'claim_vehicle_id',
    org: 'claim_org_id', location: 'claim_location_id',
  } as const)[kind as 'person' | 'vehicle' | 'org' | 'location'] ?? null
  if (!col) return null
  return links.find((l) => l[col] === claimId) ?? null
}

/** How to summarise review progress in one line. Deliberately does NOT say
 *  "complete" when every claim is decided: the reviewer decides when a report
 *  is finished, not an arithmetic check. */
export function progressLabel(p: ClaimProgress): string {
  if (!p.claims) return 'No structured claims to decide'
  if (!p.decided) return `${p.claims} claim${p.claims === 1 ? '' : 's'}, none decided`
  return `${p.decided} of ${p.claims} decided`
    + (p.verified ? ` · ${p.verified} verified` : '')
    + (p.disputed ? ` · ${p.disputed} disputed` : '')
}

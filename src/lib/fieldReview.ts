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

/** Send it to the other unit. The reason is required by the database, not by
 *  this function — which unit sees a report about police conduct is not a
 *  filing detail. */
export async function rerouteSubmission(
  id: string, route: string, reason: string,
): Promise<string | null> {
  const res = await rpc('field_submission_route', {
    p_submission: id, p_route: route, p_reason: reason,
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

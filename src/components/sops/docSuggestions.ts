/** Detective document-suggestion model — the pure vocabulary + grouping rules
 *  for the SOPs improvement-request system (migration 20260802010000).
 *
 *  Intentionally PURE (no React, no db, no I/O): labels, tones, the status
 *  lifecycle, the review-workspace grouping, and the metadata builder all live
 *  here so the form, the reader's "Suggest a change" affordance, and the
 *  bureau-lead review workspace share one source of truth and stay
 *  unit-testable. Authority stays server-side (RLS + the definer RPCs); nothing
 *  here decides access — it only shapes what is shown. */
import type { Tables } from '@/lib/database.types'

export type Suggestion = Tables<'document_suggestions'>
export type SuggestionEvent = Tables<'document_suggestion_events'>
export type SuggestionComment = Tables<'document_suggestion_comments'>

/* ── Suggestion type (why the reader is flagging the document) ─────────────── */
export type SuggestionType =
  | 'unclear' | 'outdated' | 'incorrect' | 'missing_procedure' | 'new_section'
  | 'legal_concern' | 'broken_link' | 'formatting' | 'new_document' | 'other'

export const SUGGESTION_TYPES: readonly SuggestionType[] = [
  'unclear', 'outdated', 'incorrect', 'missing_procedure', 'new_section',
  'legal_concern', 'broken_link', 'formatting', 'new_document', 'other',
]

export const SUGGESTION_TYPE_LABEL: Record<SuggestionType, string> = {
  unclear: 'Unclear or confusing',
  outdated: 'Out of date',
  incorrect: 'Incorrect information',
  missing_procedure: 'Missing a procedure',
  new_section: 'Needs a new section',
  legal_concern: 'Legal concern',
  broken_link: 'Broken link or reference',
  formatting: 'Formatting problem',
  new_document: 'Propose a new document',
  other: 'Something else',
}

/** Short hint shown under each type in the picker. */
export const SUGGESTION_TYPE_HINT: Record<SuggestionType, string> = {
  unclear: 'A step or definition is hard to follow.',
  outdated: 'The guidance no longer matches current practice or law.',
  incorrect: 'A fact, figure, or procedure here is wrong.',
  missing_procedure: 'A situation this document should cover isn’t addressed.',
  new_section: 'A whole topic is missing and should be added.',
  legal_concern: 'This may conflict with statute, policy, or rights.',
  broken_link: 'A link, citation, or cross-reference doesn’t resolve.',
  formatting: 'Layout, ordering, or presentation gets in the way.',
  new_document: 'This should be its own reference document.',
  other: 'Anything that doesn’t fit the categories above.',
}

/* ── Status lifecycle ─────────────────────────────────────────────────────── */
export type SuggestionStatus =
  | 'submitted' | 'under_review' | 'accepted' | 'partially_accepted'
  | 'declined' | 'duplicate' | 'needs_more_information' | 'implemented'

export const SUGGESTION_STATUSES: readonly SuggestionStatus[] = [
  'submitted', 'under_review', 'accepted', 'partially_accepted',
  'declined', 'duplicate', 'needs_more_information', 'implemented',
]

export const SUGGESTION_STATUS_LABEL: Record<SuggestionStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  accepted: 'Accepted',
  partially_accepted: 'Partially accepted',
  declined: 'Declined',
  duplicate: 'Duplicate',
  needs_more_information: 'Needs more info',
  implemented: 'Implemented',
}

export type BadgeTone = 'neutral' | 'info' | 'warn' | 'danger' | 'success'
export const SUGGESTION_STATUS_TONE: Record<SuggestionStatus, BadgeTone> = {
  submitted: 'info',
  under_review: 'info',
  accepted: 'success',
  partially_accepted: 'success',
  declined: 'neutral',
  duplicate: 'neutral',
  needs_more_information: 'warn',
  implemented: 'success',
}

/** The decision statuses a manager may set through `decide_document_suggestion`
 *  (submitted is the initial state; duplicate/implemented have their own RPCs). */
export const DECISION_STATUSES: readonly SuggestionStatus[] = [
  'under_review', 'accepted', 'partially_accepted', 'needs_more_information', 'declined',
]

/** Decline and needs-more-info require a note (enforced server-side too). */
export function decisionRequiresNote(s: SuggestionStatus): boolean {
  return s === 'declined' || s === 'needs_more_information'
}

/* ── Review-workspace grouping — grouped cards, never a table ─────────────── */
export type SuggestionGroup = 'new' | 'under_review' | 'accepted' | 'implemented' | 'closed'

export const SUGGESTION_GROUPS: readonly SuggestionGroup[] = [
  'new', 'under_review', 'accepted', 'implemented', 'closed',
]

export const SUGGESTION_GROUP_LABEL: Record<SuggestionGroup, string> = {
  new: 'New',
  under_review: 'Under review',
  accepted: 'Accepted',
  implemented: 'Implemented',
  closed: 'Closed',
}

export function suggestionGroup(status: string): SuggestionGroup {
  switch (status) {
    case 'submitted': return 'new'
    case 'under_review':
    case 'needs_more_information': return 'under_review'
    case 'accepted':
    case 'partially_accepted': return 'accepted'
    case 'implemented': return 'implemented'
    case 'declined':
    case 'duplicate': return 'closed'
    default: return 'closed'
  }
}

/** True while the suggestion is still open work (not implemented/declined/dup). */
export function isOpenSuggestion(status: string): boolean {
  const g = suggestionGroup(status)
  return g === 'new' || g === 'under_review' || g === 'accepted'
}

/** Group a flat list into the five review columns, preserving input order
 *  (callers sort first — typically newest-first within each group). */
export function groupSuggestions<T extends { status: string }>(
  rows: readonly T[],
): Record<SuggestionGroup, T[]> {
  const out: Record<SuggestionGroup, T[]> = {
    new: [], under_review: [], accepted: [], implemented: [], closed: [],
  }
  for (const r of rows) out[suggestionGroup(r.status)].push(r)
  return out
}

/* ── Reader → form context ────────────────────────────────────────────────── */
/** What the reader's "Suggest a change" affordance hands to the form, so the
 *  suggestion is anchored to the exact document / version / section / URL. */
export interface SuggestChangeContext {
  documentId: string
  documentVersion: number
  sectionId?: string
  sectionTitle?: string
  url: string
}

/** Arguments for `submit_document_suggestion`, built from form state + context.
 *  A new-document proposal carries a null documentId. */
export interface SubmitSuggestionInput {
  documentId: string | null
  type: SuggestionType
  title: string
  explanation: string
  sectionId?: string | null
  sectionTitle?: string | null
  proposedText?: string | null
  relatedCaseId?: string | null
  sourceUrl?: string | null
}

/** Map form input to the RPC's positional `p_*` params (kept in one place so the
 *  form never hand-assembles the payload). */
export function submitSuggestionParams(input: SubmitSuggestionInput): {
  p_document: string | null
  p_type: string
  p_title: string
  p_explanation: string
  p_section_id: string | null
  p_section_title: string | null
  p_proposed_text: string | null
  p_related_case: string | null
  p_source_url: string | null
} {
  const clean = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim()
    return t === '' ? null : t
  }
  return {
    p_document: input.documentId,
    p_type: input.type,
    p_title: input.title.trim(),
    p_explanation: input.explanation.trim(),
    p_section_id: clean(input.sectionId),
    p_section_title: clean(input.sectionTitle),
    p_proposed_text: clean(input.proposedText),
    p_related_case: input.relatedCaseId ?? null,
    p_source_url: clean(input.sourceUrl),
  }
}

/** Client-side validity mirror of the RPC's required fields (title + explanation
 *  non-empty). The server is still the authority; this only gates the button. */
export function suggestionFormError(input: {
  title: string; explanation: string; type: SuggestionType | ''
}): string | null {
  if (!input.type) return 'Choose what kind of change this is.'
  if (input.title.trim() === '') return 'Add a short title.'
  if (input.explanation.trim() === '') return 'Explain the change you’re suggesting.'
  return null
}

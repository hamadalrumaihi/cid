/** Justice-domain vocabulary — the client mirror of the DOJ legal-review
 *  schema (justice_identity/legal_core migrations). CID and justice roles are
 *  SEPARATE domains: nothing here touches ROLE_ORDER or app_role, and none of
 *  these labels grant anything — RLS + the legal workflow RPCs are the
 *  authority for every read and transition.
 *
 *  Justice authority is intentionally separate from CID rank. Do not derive
 *  DOJ/Judiciary permissions from profiles.role or profiles.division —
 *  justice identity lives only in justice_memberships. */
import type { Tables } from './database.types'
import { deadlineInfo as sharedDeadlineInfo } from './deadlines'

export type JusticeRole =
  | 'assistant_district_attorney' | 'district_attorney' | 'attorney_general' | 'judge'
  | 'prosecutor'
export type JusticeAgency = 'doj' | 'judiciary'

/** A historical prosecution-side membership title (never offered, still
 *  rendered). Only judge / attorney_general can still be appointed (L16,
 *  P4-01): justice_appoint refuses everything else, and a prosecutor who needs
 *  to see a request today is granted per-request observer access instead. */
export const isRetiredJusticeRole = (r?: string | null): boolean =>
  r === 'prosecutor' || r === 'assistant_district_attorney' || r === 'district_attorney'

export const JUSTICE_ROLE_LABEL: Record<JusticeRole, string> = {
  // Legacy titles are preserved exactly — historical rows keep their name.
  // None of the three prosecution-side titles is grantable any more
  // (isRetiredJusticeRole); surfaces that list them add a "retired role" mark.
  assistant_district_attorney: 'Assistant District Attorney',
  district_attorney: 'District Attorney',
  attorney_general: 'Attorney General',
  judge: 'Judge',
  prosecutor: 'Prosecutor',
}
export const AGENCY_LABEL: Record<JusticeAgency, string> = {
  doj: 'Department of Justice',
  judiciary: 'Judiciary',
}

export const justiceRoleLabel = (r?: string | null): string =>
  (r && JUSTICE_ROLE_LABEL[r as JusticeRole]) || r || '—'

export type LegalRequest = Tables<'legal_requests'>
export type LegalVersion = Tables<'legal_request_versions'>
export type LegalExhibit = Tables<'legal_request_exhibits'>
export type LegalSignature = Tables<'legal_request_signatures'>

/** legal_request_actions is column-revoked (internal_note) — always select
 *  this projection, never '*'. */
export const LEGAL_ACTION_COLS =
  'id,legal_request_id,version_id,actor_id,action,from_status,to_status,public_note,created_at' as const
export const SUBPOENA_TYPES = [
  ['testimony', 'Testimony'],
  ['document_production', 'Document Production'],
  ['medical_records', 'Medical Records'],
  ['financial_records', 'Financial Records'],
  ['phone_records', 'Phone Records'],
  ['surveillance_cctv', 'Surveillance / CCTV'],
  ['employment_records', 'Employment Records'],
  ['housing_records', 'Housing Records'],
  ['social_media_accounts', 'Social Media Accounts'],
  ['other', 'Other'],
] as const
export type SubpoenaType = (typeof SUBPOENA_TYPES)[number][0]

/** Type-specific subpoena fields — rendered conditionally and stored in
 *  legal_requests.form_data. `req` marks the fields the form must fill. */
export const SUBPOENA_FIELDS: Record<SubpoenaType, { key: string; label: string; req?: boolean; kind?: 'textarea' | 'datetime' }[]> = {
  testimony: [
    { key: 'testimony_subject', label: 'Testimony Subject', req: true, kind: 'textarea' },
    { key: 'appearance_date', label: 'Requested Appearance Date' },
    { key: 'appearance_time', label: 'Requested Appearance Time' },
    { key: 'appearance_location', label: 'Requested Appearance Location' },
  ],
  document_production: [
    { key: 'items_requested', label: 'Items / Records Requested', req: true, kind: 'textarea' },
    { key: 'date_range', label: 'Date Range' },
  ],
  medical_records: [
    { key: 'items_requested', label: 'Items / Records Requested', req: true, kind: 'textarea' },
    { key: 'provider_facility', label: 'Provider / Facility' },
    { key: 'date_range', label: 'Date Range' },
  ],
  financial_records: [
    { key: 'items_requested', label: 'Items / Records Requested', req: true, kind: 'textarea' },
    { key: 'financial_institution', label: 'Financial Institution' },
    { key: 'account_identifier', label: 'Account Identifier' },
    { key: 'date_range', label: 'Date Range' },
  ],
  phone_records: [
    { key: 'items_requested', label: 'Items / Records Requested', req: true, kind: 'textarea' },
    { key: 'phone_number', label: 'Phone Number / Subscriber Identifier' },
    { key: 'date_range', label: 'Date Range' },
  ],
  surveillance_cctv: [
    { key: 'items_requested', label: 'Items / Records Requested', req: true, kind: 'textarea' },
    { key: 'location_property', label: 'Location / Property' },
    { key: 'start_at', label: 'Start Date and Time', kind: 'datetime' },
    { key: 'end_at', label: 'End Date and Time', kind: 'datetime' },
  ],
  employment_records: [
    { key: 'items_requested', label: 'Items / Records Requested', req: true, kind: 'textarea' },
    { key: 'employer', label: 'Employer' },
    { key: 'employment_period', label: 'Employment Period' },
  ],
  housing_records: [
    { key: 'items_requested', label: 'Items / Records Requested', req: true, kind: 'textarea' },
    { key: 'property_address', label: 'Property / Address' },
    { key: 'occupancy_period', label: 'Occupancy Period' },
  ],
  social_media_accounts: [
    { key: 'platform', label: 'Platform', req: true },
    { key: 'username', label: 'Username', req: true },
    { key: 'requested_content', label: 'Requested Content / Records', kind: 'textarea' },
    { key: 'date_range', label: 'Date Range' },
  ],
  other: [
    { key: 'custom_type_label', label: 'Custom Type Label', req: true },
    { key: 'items_requested', label: 'Items / Records Requested', kind: 'textarea' },
  ],
}
/** In-RP platforms only — real-world platforms are out of scope. */
export const SOCIAL_PLATFORMS = ['Birdy', 'InstaPic'] as const

export const WARRANT_TYPES = [
  ['arrest_warrant', 'Arrest Warrant'],
  ['search_warrant', 'Search Warrant'],
] as const
export type WarrantType = (typeof WARRANT_TYPES)[number][0]

/** Type-specific warrant fields — parallel to SUBPOENA_FIELDS, stored in the
 *  same free `form_data` jsonb. The standard of proof and the probable-cause
 *  statement (P4-04) are NOT listed here: they are shared by every warrant
 *  subtype and live on the wizard's Narrative step (form_data.standard_of_proof
 *  / form_data.pc_statement — see STANDARDS_OF_PROOF). `req` marks the fields
 *  the form must fill; every requirement is revalidated server-side. */
export const WARRANT_FIELDS: Record<WarrantType, { key: string; label: string; req?: boolean; kind?: 'textarea' | 'datetime' }[]> = {
  arrest_warrant: [
    { key: 'charges', label: 'Charges', kind: 'textarea' },
    { key: 'items_to_seize', label: 'Items to Seize', kind: 'textarea' },
  ],
  search_warrant: [
    { key: 'search_targets', label: 'Search Targets (one per line — person / property / place / postal / vehicle)', req: true, kind: 'textarea' },
    { key: 'place_to_search', label: 'Place to Search', kind: 'textarea' },
    { key: 'items_sought', label: 'Items Sought', req: true, kind: 'textarea' },
    { key: 'vehicle_targets', label: 'Vehicle Targets' },
  ],
}

/** Review-status labels (decision L5, contract §2). Live values read as
 *  plain workflow language; every RETIRED value keeps its old label behind a
 *  "Retired stage — " prefix so historical rows stay legible and can never be
 *  mistaken for a live queue. The prefix is the ONE cue every surface shares
 *  (registry chips, dossier header, stage tracker). */
export const RETIRED_STAGE_PREFIX = 'Retired stage — '

/** The review_status values the P4-01 migration retired. They stay in the
 *  CHECK for history, render read-only, and never own an action. In-flight
 *  rows were remapped by the migration (prosecutor_queue / prosecutor_review /
 *  ag_review → submitted_to_judge; returned_by_prosecutor → returned_by_judge),
 *  so a live row only lands here if it predates the remap. */
export const RETIRED_REVIEW_STATES: ReadonlySet<string> = new Set([
  'prosecutor_queue', 'prosecutor_review', 'returned_by_prosecutor', 'declined',
  'submitted_to_doj', 'ada_review', 'returned_by_ada',
  'submitted_to_da', 'da_review', 'returned_by_da',
  'submitted_to_ag', 'ag_review', 'returned_by_ag',
])
export const isRetiredReviewStatus = (s?: string | null): boolean => !!s && RETIRED_REVIEW_STATES.has(s)

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  not_submitted: 'Draft',
  cid_supervisor_review: 'Awaiting bureau review',
  returned_by_cid: 'Returned for revision (bureau)',
  // The SIB lane (20260903170000). Named for who actually decides: an SIB
  // warrant must never read "bureau review", because the Director of CID
  // holds no SIB authority and cannot act on it.
  siu_command_review: 'Awaiting SIB command review',
  returned_by_siu_command: 'Returned for revision (SIB command)',
  submitted_to_judge: 'Awaiting judge',
  judicial_review: 'Under judicial review',
  returned_by_judge: 'Returned for revision (judge)',
  approved: 'Approved',
  partially_approved: 'Partially approved',
  denied: 'Denied',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
  superseded: 'Superseded',
  // Retired stages (P4-01) — history only.
  submitted_to_doj: `${RETIRED_STAGE_PREFIX}Submitted to DOJ`,
  ada_review: `${RETIRED_STAGE_PREFIX}ADA review`,
  returned_by_ada: `${RETIRED_STAGE_PREFIX}Returned by ADA`,
  submitted_to_da: `${RETIRED_STAGE_PREFIX}Submitted to DA`,
  da_review: `${RETIRED_STAGE_PREFIX}DA review`,
  returned_by_da: `${RETIRED_STAGE_PREFIX}Returned by DA`,
  submitted_to_ag: `${RETIRED_STAGE_PREFIX}Submitted to AG`,
  ag_review: `${RETIRED_STAGE_PREFIX}AG review`,
  returned_by_ag: `${RETIRED_STAGE_PREFIX}Returned by AG`,
  prosecutor_queue: `${RETIRED_STAGE_PREFIX}Prosecutor queue`,
  prosecutor_review: `${RETIRED_STAGE_PREFIX}Prosecutorial review`,
  returned_by_prosecutor: `${RETIRED_STAGE_PREFIX}Returned by prosecutor`,
  declined: `${RETIRED_STAGE_PREFIX}Declined by prosecutor`,
}
export const FULFILMENT_LABEL: Record<string, string> = {
  unissued: 'Not issued',
  issued: 'Issued',
  executed: 'Executed',
  returned: 'Return filed',
  expired: 'Expired',
  revoked: 'Revoked',
  closed: 'Closed',
  served: 'Served',
  compliance_pending: 'Compliance pending',
  records_received: 'Records received',
  testimony_completed: 'Testimony completed',
  non_compliance: 'Non-compliance',
  return_recorded: 'Return recorded',
}
export const CLASSIFICATIONS = ['standard', 'restricted', 'classified', 'sealed'] as const
export type Classification = (typeof CLASSIFICATIONS)[number]

export const CLASSIFICATION_STYLE: Record<Classification, string> = {
  standard: 'border-slate-400/30 bg-slate-400/10 text-slate-300',
  restricted: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  classified: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  sealed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
}

export const reviewStatusLabel = (s?: string | null) => (s && REVIEW_STATUS_LABEL[s]) || s || '—'
export const fulfilmentLabel = (s?: string | null) => (s && FULFILMENT_LABEL[s]) || s || '—'

/** The editable (draft/returned) states — EXACT mirror of
 *  private.can_edit_legal_draft (unchanged by P4-01; the retired returned_by_*
 *  values stay so a pre-remap row can still be revised by its author). */
export const EDITABLE_REVIEW_STATES = new Set([
  'not_submitted', 'returned_by_cid', 'returned_by_siu_command',
  'returned_by_ada', 'returned_by_da', 'returned_by_ag', 'returned_by_judge',
  'returned_by_prosecutor',
])
export const isEditableDraft = (r: Pick<LegalRequest, 'document_status' | 'review_status'>): boolean =>
  (r.document_status === 'draft' || r.document_status === 'reopened') &&
  EDITABLE_REVIEW_STATES.has(r.review_status)

/** The two DECIDED-APPROVED states (P4-07): a partial approval is a judicial
 *  approval whose scope was narrowed per target — it issues, executes and
 *  closes exactly like `approved` (issue_legal_request / close_legal_request
 *  accept both). Anything that asks "was this granted?" reads this set. */
export const PARTIAL_APPROVAL_STATES: ReadonlySet<string> = new Set(['approved', 'partially_approved'])
export const isDecidedApproved = (s?: string | null): boolean => !!s && PARTIAL_APPROVAL_STATES.has(s)

/** Standard of proof a warrant must declare (P4-04) — stored in
 *  form_data.standard_of_proof; submit_legal_request_to_cid refuses a warrant
 *  without one (and without a non-blank form_data.pc_statement). */
export const STANDARDS_OF_PROOF = [
  ['probable_cause', 'Probable cause'],
  ['reasonable_suspicion', 'Reasonable suspicion'],
] as const
export type StandardOfProof = (typeof STANDARDS_OF_PROOF)[number][0]
export const isStandardOfProof = (v: unknown): v is StandardOfProof =>
  v === 'probable_cause' || v === 'reasonable_suspicion'

/** Deadline helper — server timestamps in, human warning out. Thin
 *  delegation to the shared engine (lib/deadlines): same labels
 *  ('Expires'/'Expired', 'Response due'/'Response overdue'), same
 *  {text, urgent} | null shape for legalShared callers. */
export function deadlineInfo(iso: string | null | undefined, kind: 'expires' | 'deadline'): { text: string; urgent: boolean } | null {
  const info = sharedDeadlineInfo(iso, kind)
  return info ? { text: info.text, urgent: info.urgent } : null
}

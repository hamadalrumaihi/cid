/** Justice-domain vocabulary — the client mirror of the DOJ legal-review
 *  schema (justice_identity/legal_core migrations). CID and justice roles are
 *  SEPARATE domains: nothing here touches ROLE_ORDER or app_role, and none of
 *  these labels grant anything — RLS + the legal workflow RPCs are the
 *  authority for every read and transition. */
import type { Tables } from './database.types'

export type JusticeRole =
  | 'assistant_district_attorney' | 'district_attorney' | 'attorney_general' | 'judge'
export type JusticeAgency = 'doj' | 'judiciary'

export const JUSTICE_ROLE_LABEL: Record<JusticeRole, string> = {
  assistant_district_attorney: 'Assistant District Attorney',
  district_attorney: 'District Attorney',
  attorney_general: 'Attorney General',
  judge: 'Judge',
}
export const JUSTICE_ROLE_ABBR: Record<JusticeRole, string> = {
  assistant_district_attorney: 'ADA',
  district_attorney: 'DA',
  attorney_general: 'AG',
  judge: 'Judge',
}
export const AGENCY_LABEL: Record<JusticeAgency, string> = {
  doj: 'Department of Justice',
  judiciary: 'Judiciary',
}
/** Valid roles per agency — mirrors the CHECK constraints; the review RPC
 *  revalidates every combination server-side. */
export const AGENCY_ROLES: Record<JusticeAgency, JusticeRole[]> = {
  doj: ['assistant_district_attorney', 'district_attorney', 'attorney_general'],
  judiciary: ['judge'],
}

export const justiceRoleLabel = (r?: string | null): string =>
  (r && JUSTICE_ROLE_LABEL[r as JusticeRole]) || r || '—'
export const justiceRoleAbbr = (r?: string | null): string =>
  (r && JUSTICE_ROLE_ABBR[r as JusticeRole]) || r || '—'

export type LegalRequest = Tables<'legal_requests'>
export type LegalVersion = Tables<'legal_request_versions'>
export type LegalExhibit = Tables<'legal_request_exhibits'>
export type LegalParticipant = Tables<'legal_request_participants'>
export type LegalSignature = Tables<'legal_request_signatures'>
export type JusticeMembership = Tables<'justice_memberships'>
export type ProsecutorAssignment = Tables<'prosecutor_bureau_assignments'>

/** legal_request_actions is column-revoked (internal_note) — always select
 *  this projection, never '*'. */
export const LEGAL_ACTION_COLS =
  'id,legal_request_id,version_id,actor_id,action,from_status,to_status,public_note,created_at' as const
/** justice_membership_requests hides internal_decision_note the same way. */
export const JMR_COLS =
  'id,applicant_id,display_name,justice_identifier,requested_agency,requested_justice_role,reason,additional_notes,status,decided_agency,decided_justice_role,applicant_visible_decision_note,decided_by,decided_at,submitted_at,created_at,updated_at' as const

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

/** Type-specific subpoena fields (§35) — rendered conditionally and stored in
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
/** In-RP platforms only — real-world platforms are out of scope (§35). */
export const SOCIAL_PLATFORMS = ['Birdy', 'InstaPic'] as const

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  not_submitted: 'Draft — not submitted',
  cid_supervisor_review: 'CID supervisor review',
  returned_by_cid: 'Returned by CID',
  submitted_to_doj: 'Submitted to DOJ — awaiting assignment',
  ada_review: 'ADA review',
  returned_by_ada: 'Returned by ADA',
  submitted_to_da: 'Submitted to DA',
  da_review: 'DA review',
  returned_by_da: 'Returned by DA',
  submitted_to_ag: 'Submitted to AG',
  ag_review: 'AG review',
  returned_by_ag: 'Returned by AG',
  submitted_to_judge: 'Awaiting judicial assignment',
  judicial_review: 'Judicial review',
  returned_by_judge: 'Returned by Judge',
  approved: 'Approved',
  denied: 'Denied',
  withdrawn: 'Withdrawn',
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

/** The editable (draft/returned) states — mirrors private.can_edit_legal_draft. */
export const EDITABLE_REVIEW_STATES = new Set([
  'not_submitted', 'returned_by_cid', 'returned_by_ada',
  'returned_by_da', 'returned_by_ag', 'returned_by_judge',
])
export const isEditableDraft = (r: Pick<LegalRequest, 'document_status' | 'review_status'>): boolean =>
  (r.document_status === 'draft' || r.document_status === 'reopened') &&
  EDITABLE_REVIEW_STATES.has(r.review_status)

/** Deadline helper — server timestamps in, human warning out (§49). */
export function deadlineInfo(iso: string | null | undefined, kind: 'expires' | 'deadline'): { text: string; urgent: boolean } | null {
  if (!iso) return null
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return null
  const ms = at - Date.now()
  const label = kind === 'expires' ? 'Expires' : 'Response due'
  if (ms <= 0) return { text: kind === 'expires' ? 'Expired' : 'Response overdue', urgent: true }
  const hours = Math.round(ms / 3_600_000)
  if (hours <= 48) return { text: `${label} in ${hours}h`, urgent: hours <= 24 }
  return { text: `${label} ${new Date(iso).toLocaleDateString()}`, urgent: false }
}

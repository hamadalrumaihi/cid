/** Row builders for the core tables — every builder returns a COMPLETE
 *  Tables<'…'> Row (typed from src/lib/database.types.ts), so a schema
 *  migration that adds/renames/retypes a column breaks `tsc --noEmit` here
 *  instead of letting the mock layer drift into a parallel domain model.
 *  Builders are pure; seeding happens in cases.ts / via seedRows(). */
import type { Tables } from '@/lib/database.types'
import { mockId, mockTimestamp } from '../store'

export function caseRow(overrides: Partial<Tables<'cases'>> = {}): Tables<'cases'> {
  return {
    area: 'Mirror Park',
    archived_at: null,
    archived_by: null,
    bureau: 'major_crimes',
    case_authority: 'cid',
    case_number: 'CID-26-0101',
    siu_assumed_at: null,
    siu_assumed_by: null,
    siu_assumption_reason: null,
    siu_category: null,
    siu_closure_note: null,
    siu_closure_reason: null,
    siu_returned_at: null,
    siu_stage: null,
    charges: [],
    closed_at: null,
    created_at: mockTimestamp(),
    created_by: null,
    follow_up_at: null,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    id: mockId(),
    investigative_stage: 'intake',
    is_joint_case: false,
    joint_case_created_at: null,
    joint_case_created_by: null,
    joint_case_ended_at: null,
    joint_case_ended_by: null,
    last_stale_notified_at: null,
    lead_detective_id: null,
    notes: null,
    operation_id: null,
    originating_bureau: null,
    priority: 'medium',
    signoff_assignee_id: null,
    signoff_stage: null,
    signoff_status: 'none',
    signoff_submitted_at: null,
    signoff_submitted_by: null,
    siu_classification: null,
    status: 'open',
    summary: 'Mock case seeded by src/mocks fixtures.',
    title: 'Mock Case',
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

export function reportRow(overrides: Partial<Tables<'reports'>> & Pick<Tables<'reports'>, 'case_id'>): Tables<'reports'> {
  return {
    author_id: null,
    created_at: mockTimestamp(),
    fields: { narrative: 'Mock narrative.' },
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    finalized: false,
    id: mockId(),
    kind: 'initial',
    parent_id: null,
    seq: 1,
    signature: null,
    template: 'general',
    review_note: null,
    review_status: 'draft',
    reviewed_at: null,
    reviewed_by: null,
    reviewer_signature: null,
    submitted_at: null,
    submitted_by: null,
    template_version_id: null,
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

export function caseTaskRow(overrides: Partial<Tables<'case_tasks'>> & Pick<Tables<'case_tasks'>, 'case_id'>): Tables<'case_tasks'> {
  return {
    assignee: null,
    created_at: mockTimestamp(),
    created_by: null,
    done: false,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    due: null,
    id: mockId(),
    parent_id: null,
    title: 'Canvass the scene',
    updated_at: mockTimestamp(),
    waive_reason: null,
    waived_at: null,
    waived_by: null,
    ...overrides,
  }
}

/** Integrity / custody / derivative columns (2026-11 platform upgrade) — null until `evidence_register` runs. */
export const MEDIA_INTEGRITY_DEFAULTS = {
  byte_size: null, classification: null, collected_at: null, collected_by: null, current_custodian: null, derivative_service: null,
  derivative_service_version: null, derivative_type: null, evidence_number: null, integrity_status: null, last_integrity_check: null,
  location_collected: null, mime: null, original_filename: null, parent_media_id: null, parent_sha256: null, sealed_at: null, sealed_by: null,
  sha256: null, source: null,
} as const

export function mediaRow(overrides: Partial<Tables<'media'>> = {}): Tables<'media'> {
  return {
    archived_at: null,
    case_id: null,
    category: null,
    created_at: mockTimestamp(),
    evidence_designated_at: null,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    evidence_designated_by: null,
    evidence_ref: null,
    external_url: 'https://r2.fivemanage.com/mock/evidence-1.png',
    ...MEDIA_INTEGRITY_DEFAULTS,
    featured: false,
    gang_id: null,
    id: mockId(),
    kind: 'image',
    narcotic_id: null,
    observation_id: null,
    person_id: null,
    place_id: null,
    report_id: null,
    restricted: false,
    storage_path: null,
    tags: [],
    title: 'Scene photo',
    type: 'fivemanage',
    updated_at: mockTimestamp(),
    uploaded_by: null,
    vehicle_id: null,
    ...overrides,
  }
}

/** Temporary cross-bureau prosecutor coverage (20260818120000). Live rows are
 *  AG/Owner-granted and audited; a fixture defaults to an open (unexpired,
 *  unended) grant. prosecutor_id + authorized_by are NOT NULL in the schema,
 *  so the builder demands them. */
export function prosecutorCoverageRow(
  overrides: Partial<Tables<'prosecutor_coverage'>> & Pick<Tables<'prosecutor_coverage'>, 'prosecutor_id' | 'authorized_by'>,
): Tables<'prosecutor_coverage'> {
  return {
    bureau: 'major_crimes',
    created_at: mockTimestamp(),
    ended_at: null,
    ended_by: null,
    expires_at: null,
    id: mockId(),
    reason: 'Bureau bench empty — temporary coverage',
    starts_at: mockTimestamp(),
    ...overrides,
  }
}

export function personRow(overrides: Partial<Tables<'persons'>> = {}): Tables<'persons'> {
  return {
    source_submission_id: null,
    phone_normalized: null,
    siu_hidden_flag: false,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    alias: null,
    bolo: false,
    bolo_case_id: null,
    bolo_expires_at: null,
    bolo_instructions: null,
    bolo_issued_at: null,
    bolo_issued_by: null,
    bolo_reason: null,
    bolo_risk: null,
    ccw: null,
    classification: null,
    confidence: null,
    created_at: mockTimestamp(),
    created_by: null,
    dob: null,
    felony_count: 0,
    gang_id: null,
    id: mockId(),
    identity: {},
    intelligence_summary: {},
    lead_detective_id: null,
    lifecycle: 'active',
    merged_into: null,
    mugshot_url: null,
    name: 'Mock Suspect',
    next_review_at: null,
    notes: null,
    phone: null,
    priority: null,
    properties: {},
    review_note: null,
    reviewed_at: null,
    reviewed_by: null,
    status: null,
    updated_at: mockTimestamp(),
    vch: null,
    ...overrides,
  }
}

export function notificationRow(overrides: Partial<Tables<'notifications'>> & Pick<Tables<'notifications'>, 'user_id'>): Tables<'notifications'> {
  return {
    created_at: mockTimestamp(),
    id: mockId(),
    payload: { title: 'Mock notification' },
    read: false,
    read_at: null,
    type: 'case_update',
    ...overrides,
  }
}

export function legalHoldRow(overrides: Partial<Tables<'legal_holds'>> = {}): Tables<'legal_holds'> {
  return {
    case_id: null,
    id: mockId(),
    legal_request_id: null,
    lift_reason: null,
    lifted_at: null,
    lifted_by: null,
    placed_at: mockTimestamp(),
    placed_by: null,
    reason: 'Pending DOJ review',
    ...overrides,
  }
}

export function legalRequestRow(
  overrides: Partial<Tables<'legal_requests'>> & Pick<Tables<'legal_requests'>, 'case_id' | 'created_by'>,
): Tables<'legal_requests'> {
  return {
    amends_request_id: null,
    approval_route: null,
    stage_entered_at: null,
    nudged_at: null,
    escalated_at: null,
    assigned_ada_id: null,
    assigned_judge_id: null,
    assigned_prosecutor_id: null,
    case_number_snapshot: 'CID-26-0101',
    case_title_snapshot: 'Mock Case',
    cid_reviewed_at: null,
    cid_reviewed_by: null,
    cid_reviewed_role: null,
    citizen_id_snapshot: null,
    classification: 'standard',
    close_note: null,
    closed_at: null,
    closed_by: null,
    compliance_date: null,
    compliance_notes: null,
    compliance_status: 'not_applicable',
    created_at: mockTimestamp(),
    current_version_id: null,
    decided_at: null,
    decided_by: null,
    decision: null,
    decision_note: null,
    document_status: 'draft',
    executed_at: null,
    executed_by: null,
    execution_incident_number: null,
    execution_notes: null,
    execution_officers: null,
    execution_outcome: null,
    execution_result: null,
    expires_at: null,
    form_data: {},
    fulfilment_status: 'pending',
    id: mockId(),
    import_key: null,
    imported_at: null,
    imported_by: null,
    issued_at: null,
    issued_by: null,
    judicial_conditions: null,
    narrative: 'Mock warrant narrative.',
    non_compliance_reason: null,
    person_id: null,
    person_name_snapshot: null,
    priority: 'routine',
    recipient_acknowledged: null,
    prosecutor_claimed_at: null,
    queue_entered_at: null,
    recipient_name: null,
    recipient_type: null,
    request_number: 'LR-26-0001',
    request_type: 'warrant',
    response_deadline: null,
    responsible_bureau: 'major_crimes',
    return_filed_by: null,
    return_narrative: null,
    return_report_id: null,
    returned_at: null,
    review_status: 'draft',
    revoke_reason: null,
    revoked_at: null,
    revoked_by: null,
    served_at: null,
    served_by: null,
    service_method: null,
    service_notes: null,
    service_status: 'not_served',
    source_report_id: null,
    source_report_seq: null,
    source_submitted_at: null,
    source_submitter_id: null,
    source_system: null,
    submitted_to_cid_at: null,
    submitted_to_doj_at: null,
    submitted_to_judge_at: null,
    subtype: 'search_warrant',
    superseded_by_id: null,
    title: 'Search Warrant — Mock Case',
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** An authored case note (20261021120000, P3-03). `author_id` defaults to
 *  null so a fixture must name the author when the restricted-note reading
 *  matters (the handler hides restricted_to_command rows from a session that
 *  is neither command / owner nor the author). */
export function caseNoteRow(overrides: Partial<Tables<'case_notes'>> & Pick<Tables<'case_notes'>, 'case_id'>): Tables<'case_notes'> {
  return {
    author_id: null,
    body_md: 'Mock note body.',
    created_at: mockTimestamp(),
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    id: mockId(),
    pinned: false,
    restricted_to_command: false,
    source: 'manual',
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** A relationship between two cases (20261022120000, P3-04): one live link
 *  per pair and direction, never self — the builder demands both ends. */
export function caseLinkRow(
  overrides: Partial<Tables<'case_links'>> & Pick<Tables<'case_links'>, 'case_id' | 'related_case_id'>,
): Tables<'case_links'> {
  return {
    created_at: mockTimestamp(),
    created_by: null,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    id: mockId(),
    kind: 'related',
    note: null,
    ...overrides,
  }
}

/* ── Legal workflow (Phase 4, migrations 20261024120000 → 20261027120000) ── */

/** A justice identity. Judge + Attorney General are the only live roles
 *  since P4-01 (L16); a prosecutor row is history the handlers ignore. */
export function justiceMembershipRow(
  overrides: Partial<Tables<'justice_memberships'>> & Pick<Tables<'justice_memberships'>, 'user_id'>,
): Tables<'justice_memberships'> {
  return {
    active: true,
    agency: 'judiciary',
    approved_at: mockTimestamp(),
    approved_by: null,
    created_at: mockTimestamp(),
    ended_at: null,
    expires_at: null,
    justice_identifier: 'CT-1001',
    justice_role: 'judge',
    prosecutor_bureau: null,
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** A charge on a case (20260905130000) with its statute snapshot — the
 *  source `legal_set_charges` copies from. */
export function caseChargeRow(
  overrides: Partial<Tables<'case_charges'>> & Pick<Tables<'case_charges'>, 'case_id'>,
): Tables<'case_charges'> {
  return {
    added_at: mockTimestamp(),
    added_by: null,
    charge_id: mockId(),
    counts: 1,
    decided_at: null,
    decided_by: null,
    decision_note: null,
    id: mockId(),
    imposed_at: null,
    imposed_by: null,
    imposed_fine: null,
    imposed_jail_months: null,
    note: null,
    snap_charge_class: 'felony',
    snap_code: '(1)09',
    snap_fine: 110_000,
    snap_is_modifier: false,
    snap_is_rico: false,
    snap_jail_months: 60,
    snap_judge_set_fine: false,
    snap_judge_set_jail: false,
    snap_offense: 'Attempted Murder',
    snap_penal_title: 'Crimes Against Persons',
    snap_stackable: true,
    snap_substance_schedule: null,
    status: 'approved',
    substance_note: null,
    substance_quantity: null,
    substance_unit: null,
    updated_at: mockTimestamp(),
    version_id: mockId(),
    ...overrides,
  }
}

export function legalRequestExhibitRow(
  overrides: Partial<Tables<'legal_request_exhibits'>> & Pick<Tables<'legal_request_exhibits'>, 'legal_request_id' | 'added_by'>,
): Tables<'legal_request_exhibits'> {
  return {
    created_at: mockTimestamp(),
    display_title: 'Exhibit A',
    exhibit_type: 'external_link',
    id: mockId(),
    rationale: null,
    snapshot_metadata: { url: 'https://evidence.example/a' },
    source_id: null,
    version_id: null,
    ...overrides,
  }
}


/* ── Report builder (Phase 5, migrations 20261028120000 → 20261029120000) ── */

/** A report template catalog row (P5-01). The mock seeds the 14 FORM_SCHEMAS
 *  keys lazily (src/mocks/handlers/reports.ts); this builder exists for a
 *  spec that needs an extra — typically retired — template. */
export function reportTemplateRow(overrides: Partial<Tables<'report_templates'>> = {}): Tables<'report_templates'> {
  return {
    active: true,
    created_at: mockTimestamp(),
    created_by: null,
    description: null,
    id: mockId(),
    is_default: false,
    key: 'mock_template',
    name: 'Mock Template',
    sort_order: 99,
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** A template version: the FormSchema plus the `required` / `advisory`
 *  keys and the review rule. Defaults to a published v1 that requires
 *  review, with a minimal but valid schema. */
export function reportTemplateVersionRow(
  overrides: Partial<Tables<'report_template_versions'>> & Pick<Tables<'report_template_versions'>, 'template_id'>,
): Tables<'report_template_versions'> {
  return {
    advisory: [],
    change_summary: null,
    created_at: mockTimestamp(),
    created_by: null,
    id: mockId(),
    published_at: mockTimestamp(),
    published_by: null,
    required: ['case_number', 'narrative'],
    review_required: true,
    schema: {
      title: 'Mock Template',
      subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
      sections: [
        { id: 'hdr', label: 'Report', type: 'kv', fields: [{ key: 'case_number', label: 'Case Number', type: 'text' }] },
        { id: 'narrative', label: 'Narrative', type: 'textarea', key: 'narrative' },
      ],
    },
    status: 'published',
    superseded_at: null,
    version_number: 1,
    ...overrides,
  }
}

/** A record inserted into (or mentioned by) a report (P5-04). `ref_id` is
 *  null only for a `timeline_event`; the builder defaults to a person
 *  subject with an empty snapshot. */
export function reportEntityRow(
  overrides: Partial<Tables<'report_entities'>> & Pick<Tables<'report_entities'>, 'report_id'>,
): Tables<'report_entities'> {
  return {
    created_at: mockTimestamp(),
    edited: false,
    id: mockId(),
    inserted_by: null,
    kind: 'person',
    label: 'Mock Suspect',
    ref_id: mockId(),
    role: 'subject',
    snapshot: {},
    ...overrides,
  }
}

/** An export receipt (P5-07): the format, the sealed version it rendered
 *  (null for a draft) and the 10-character verification code. */
export function reportExportRow(
  overrides: Partial<Tables<'report_exports'>> & Pick<Tables<'report_exports'>, 'report_id'>,
): Tables<'report_exports'> {
  return {
    exported_at: mockTimestamp(),
    exported_by: null,
    format: 'pdf',
    id: mockId(),
    verification_code: 'ABCDEF0123',
    version_number: null,
    ...overrides,
  }
}

/* ── Intelligence triage (Phase 6, migrations 20261030120000 → 20261031120000) ── */

/** An intelligence record (field_submissions). Defaults to a SENT record
 *  (`status: 'new'`, numbered) authored by an investigator in the city
 *  jurisdiction; `officer_id` must be named (the author is the read wall's
 *  first clause). A draft is `status: 'draft', submission_no: null`. */
export function fieldSubmissionRow(
  overrides: Partial<Tables<'field_submissions'>> & Pick<Tables<'field_submissions'>, 'officer_id'>,
): Tables<'field_submissions'> {
  const id = overrides.id ?? mockId()
  return {
    archive_reason: null,
    archived_at: null,
    archived_by: null,
    assigned_at: null,
    assigned_to: null,
    created_at: mockTimestamp(),
    created_by: overrides.officer_id,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    details: 'Mock intelligence details.',
    id,
    jurisdiction: 'city',
    mdt_reference: null,
    observed_at: null,
    observed_precision: 'unknown',
    observed_to: null,
    rejected_at: null,
    rejected_by: null,
    reliability: null,
    siu_assigned_at: null,
    siu_assigned_to: null,
    siu_case_id: null,
    siu_category: null,
    siu_reason: null,
    siu_referred_at: null,
    siu_referred_by: null,
    siu_sensitive: false,
    siu_state: null,
    snap_agency: 'major_crimes',
    snap_callsign: '4021',
    snap_officer_name: 'Det. Mara Voss',
    snap_rank: 'detective',
    snap_unit: null,
    source_codename: null,
    source_type: 'detective',
    status: 'new',
    submission_no: `FI-26-${id.slice(-4)}`,
    submitted_at: mockTimestamp(),
    summary: 'Mock intelligence summary.',
    updated_at: mockTimestamp(),
    urgency: null,
    validated_at: null,
    validated_by: null,
    ...overrides,
  }
}

/** A person claim on a record. */
export function fieldSubmissionPersonRow(
  overrides: Partial<Tables<'field_submission_persons'>> & Pick<Tables<'field_submission_persons'>, 'submission_id'>,
): Tables<'field_submission_persons'> {
  return {
    alias: null,
    basis: 'observed',
    created_at: mockTimestamp(),
    description: null,
    full_name: 'Mock Claimed Person',
    id: mockId(),
    note: null,
    org_name: null,
    org_role: null,
    phone: null,
    phone_normalized: null,
    reason: null,
    ...overrides,
  }
}

/** An item / seizure claim on a record (the claim kind that converts to a narcotic). */
export function fieldSubmissionItemRow(
  overrides: Partial<Tables<'field_submission_items'>> & Pick<Tables<'field_submission_items'>, 'submission_id'>,
): Tables<'field_submission_items'> {
  return {
    basis: 'observed',
    category: 'narcotics',
    created_at: mockTimestamp(),
    description: 'Mock seized substance',
    id: mockId(),
    note: null,
    package_count: null,
    packaging: null,
    quantity: null,
    seized_from_location: null,
    seized_from_person: null,
    seized_from_vehicle: null,
    suspected_substance: 'Mock substance',
    tested: null,
    weight_grams: null,
    weight_unit: null,
    weight_value: null,
    ...overrides,
  }
}

/** A verdict on one claim — exactly one of the claim columns is set. */
export function fieldClaimVerdictRow(
  overrides: Partial<Tables<'field_claim_verdicts'>> & Pick<Tables<'field_claim_verdicts'>, 'submission_id'>,
): Tables<'field_claim_verdicts'> {
  return {
    decided_at: mockTimestamp(),
    decided_by: null,
    id: mockId(),
    item_id: null,
    location_id: null,
    note: null,
    org_id: null,
    person_id: null,
    vehicle_id: null,
    verdict: 'verified',
    ...overrides,
  }
}

/** A claim → registry link (one claim column, one target column). */
export function fieldClaimLinkRow(
  overrides: Partial<Tables<'field_claim_links'>> & Pick<Tables<'field_claim_links'>, 'submission_id'>,
): Tables<'field_claim_links'> {
  return {
    account_id: null,
    claim_item_id: null,
    claim_location_id: null,
    claim_org_id: null,
    claim_person_id: null,
    claim_vehicle_id: null,
    gang_id: null,
    id: mockId(),
    indicator_id: null,
    linked_at: mockTimestamp(),
    linked_by: null,
    narcotic_id: null,
    person_id: null,
    place_id: null,
    vehicle_id: null,
    ...overrides,
  }
}

/** A reviewer-private note (RPC-only since P6-02). */
export function fieldSubmissionReviewRow(
  overrides: Partial<Tables<'field_submission_reviews'>> & Pick<Tables<'field_submission_reviews'>, 'submission_id'>,
): Tables<'field_submission_reviews'> {
  return {
    author_id: null,
    created_at: mockTimestamp(),
    id: mockId(),
    note: 'Mock reviewer note.',
    ...overrides,
  }
}

/** A message on the officer thread (`from_reviewer` is trigger-stamped live). */
export function fieldSubmissionMessageRow(
  overrides: Partial<Tables<'field_submission_messages'>> & Pick<Tables<'field_submission_messages'>, 'submission_id'>,
): Tables<'field_submission_messages'> {
  return {
    author_id: null,
    body: 'Mock message to the officer.',
    created_at: mockTimestamp(),
    from_reviewer: true,
    id: mockId(),
    ...overrides,
  }
}

/** The realtime shadow row (P6-06): status / assignee / SIB state only —
 *  never a summary, a jurisdiction or a reason. */
export function fieldSubmissionEventRow(
  overrides: Partial<Tables<'field_submission_events'>> & Pick<Tables<'field_submission_events'>, 'submission_id'>,
): Tables<'field_submission_events'> {
  return {
    assigned_to: null,
    siu_state: null,
    status: 'new',
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** An intelligence group (P6-03) — the lead record is always a member. */
export function intelGroupRow(
  overrides: Partial<Tables<'intel_groups'>> & Pick<Tables<'intel_groups'>, 'lead_submission_id'>,
): Tables<'intel_groups'> {
  return {
    close_reason: null,
    closed_at: null,
    closed_by: null,
    created_at: mockTimestamp(),
    created_by: null,
    id: mockId(),
    note: null,
    title: 'Mock intelligence group',
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** A group membership; a removed member keeps its row with `removed_*` set. */
export function intelGroupMemberRow(
  overrides: Partial<Tables<'intel_group_members'>> & Pick<Tables<'intel_group_members'>, 'group_id' | 'submission_id'>,
): Tables<'intel_group_members'> {
  return {
    added_at: mockTimestamp(),
    added_by: null,
    id: mockId(),
    note: null,
    remove_reason: null,
    removed_at: null,
    removed_by: null,
    ...overrides,
  }
}

/** A case linked to a group (a group fact — members are not individually linked). */
export function intelGroupCaseRow(
  overrides: Partial<Tables<'intel_group_cases'>> & Pick<Tables<'intel_group_cases'>, 'group_id' | 'case_id'>,
): Tables<'intel_group_cases'> {
  return {
    id: mockId(),
    linked_at: mockTimestamp(),
    linked_by: null,
    note: null,
    unlink_reason: null,
    unlinked_at: null,
    unlinked_by: null,
    ...overrides,
  }
}

/** Per-viewer Action Center state (P7-01) — one row per (viewer, dedupe
 *  key); RPC-only on the server (`action_item_set_state`). */
export function actionItemStateRow(
  overrides: Partial<Tables<'action_item_state'>> & Pick<Tables<'action_item_state'>, 'user_id' | 'dedupe_key'>,
): Tables<'action_item_state'> {
  return {
    dismissed_at: null,
    seen_at: null,
    snoozed_until: null,
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** An escalation rule (P7-03) — the Owner-tuned ladder; the migration seeds
 *  four kinds (`handlers/action.ts` seeds them lazily, like the templates). */
export function actionEscalationRuleRow(
  overrides: Partial<Tables<'action_escalation_rules'>> & Pick<Tables<'action_escalation_rules'>, 'kind'>,
): Tables<'action_escalation_rules'> {
  return {
    after_hours: 48,
    enabled: true,
    note: null,
    target: 'the case lead',
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** An escalation ledger row (P7-03) — the shared fact the "Escalated" badge
 *  reads; unique per (kind, source_id), read with the case's visibility
 *  (`access_request` rows only by the lead / command); `stage` is the
 *  sign-off stage the row was raised at. */
export function actionEscalationRow(
  overrides: Partial<Tables<'action_escalations'>> & Pick<Tables<'action_escalations'>, 'kind' | 'source_id'>,
): Tables<'action_escalations'> {
  return {
    case_id: null,
    escalated_at: mockTimestamp(),
    id: mockId(),
    notified: [],
    resolved_at: null,
    stage: null,
    ...overrides,
  }
}

/* ── Confidential Informants (the CI compartment, 20261103120000) ────────── */

export function confidentialInformantRow(
  overrides: Partial<Tables<'confidential_informants'>> & Pick<Tables<'confidential_informants'>, 'person_id'>,
): Tables<'confidential_informants'> {
  return {
    alias: null,
    bureau: 'major_crimes',
    ci_number: 'CI-0001',
    created_at: mockTimestamp(),
    created_by: null,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    id: mockId(),
    last_contact_at: null,
    motive_explanation: null,
    motive_primary: null,
    motive_secondary: [],
    next_contact_at: null,
    recruited_at: null,
    recruited_by: null,
    recruitment_notes: null,
    reliability: 'unknown',
    risk: 'medium',
    status: 'candidate',
    status_changed_at: mockTimestamp(),
    status_reason: null,
    supervising_lead_id: null,
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

export function ciHandlerRow(
  overrides: Partial<Tables<'ci_handlers'>> & Pick<Tables<'ci_handlers'>, 'ci_id' | 'user_id'>,
): Tables<'ci_handlers'> {
  return {
    assigned_at: mockTimestamp(),
    assigned_by: null,
    counts_toward_capacity: true,
    end_reason: null,
    ended_at: null,
    ended_by: null,
    id: mockId(),
    reason: null,
    role: 'primary',
    ...overrides,
  }
}

export function ciHandlerCapacityRow(
  overrides: Partial<Tables<'ci_handler_capacity'>> & Pick<Tables<'ci_handler_capacity'>, 'user_id' | 'approved_by'>,
): Tables<'ci_handler_capacity'> {
  return {
    approved_at: mockTimestamp(),
    expires_at: null,
    limit_override: 8,
    reason: 'Mock capacity override',
    request_id: null,
    ...overrides,
  }
}

export function ciCapacityRequestRow(
  overrides: Partial<Tables<'ci_capacity_requests'>> & Pick<Tables<'ci_capacity_requests'>, 'requester_id'>,
): Tables<'ci_capacity_requests'> {
  return {
    bureau: 'major_crimes',
    case_id: null,
    comments: null,
    created_at: mockTimestamp(),
    created_ci_id: null,
    current_count: 6,
    decided_at: null,
    decided_by: null,
    decision_note: null,
    estimated_risk: null,
    expected_usefulness: null,
    id: mockId(),
    kind: 'capacity',
    operational_need: null,
    proposed_motive: null,
    proposed_person_id: null,
    reason: 'Mock capacity request',
    requested_capacity: 8,
    status: 'pending',
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

export function ciIntelligenceRow(
  overrides: Partial<Tables<'ci_intelligence'>> & Pick<Tables<'ci_intelligence'>, 'ci_id' | 'handler_id'>,
): Tables<'ci_intelligence'> {
  return {
    body: null,
    case_id: null,
    corroboration: 'unverified',
    corroboration_note: null,
    created_at: mockTimestamp(),
    created_by: null,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    follow_up_done_at: null,
    follow_up_required: false,
    handler_notes: null,
    id: mockId(),
    received_at: mockTimestamp(),
    reliability: 'unknown',
    sensitivity: 'sensitive',
    summary: 'Mock source intelligence',
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

export function ciIntelligenceLinkRow(
  overrides: Partial<Tables<'ci_intelligence_links'>> & Pick<Tables<'ci_intelligence_links'>, 'intel_id' | 'target_id'>,
): Tables<'ci_intelligence_links'> {
  return { created_at: mockTimestamp(), id: mockId(), kind: 'person', note: null, ...overrides }
}

export function ciContactRow(
  overrides: Partial<Tables<'ci_contacts'>> & Pick<Tables<'ci_contacts'>, 'ci_id' | 'handler_id'>,
): Tables<'ci_contacts'> {
  return {
    case_id: null,
    created_at: mockTimestamp(),
    created_by: null,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    follow_up_required: false,
    id: mockId(),
    location: null,
    method: 'in_person',
    next_contact_at: null,
    occurred_at: mockTimestamp(),
    restricted_notes: null,
    summary: 'Mock contact',
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

export function ciAssessmentRow(
  overrides: Partial<Tables<'ci_assessments'>> & Pick<Tables<'ci_assessments'>, 'ci_id'>,
): Tables<'ci_assessments'> {
  return {
    access: null,
    assessed_at: mockTimestamp(),
    assessed_by: null,
    compromise_likelihood: null,
    credibility: null,
    id: mockId(),
    note: null,
    reliability: null,
    risk: null,
    usefulness: null,
    ...overrides,
  }
}

export function ciPaymentRow(
  overrides: Partial<Tables<'ci_payments'>> & Pick<Tables<'ci_payments'>, 'ci_id' | 'handler_id'>,
): Tables<'ci_payments'> {
  return {
    amount: 0,
    approved_at: null,
    approved_by: null,
    case_id: null,
    created_at: mockTimestamp(),
    created_by: null,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    id: mockId(),
    intel_id: null,
    notes: null,
    paid_at: mockTimestamp().slice(0, 10),
    reason: 'Mock payment',
    ...overrides,
  }
}

export function ciCaseLinkRow(
  overrides: Partial<Tables<'ci_case_links'>> & Pick<Tables<'ci_case_links'>, 'ci_id' | 'case_id'>,
): Tables<'ci_case_links'> {
  return {
    id: mockId(), linked_at: mockTimestamp(), linked_by: null, note: null, unlink_reason: null, unlinked_at: null, unlinked_by: null,
    ...overrides,
  }
}

export function caseIntelReleaseRow(
  overrides: Partial<Tables<'case_intel_releases'>> & Pick<Tables<'case_intel_releases'>, 'case_id'>,
): Tables<'case_intel_releases'> {
  return {
    body: 'Sanitized intelligence body.',
    handling: 'law_enforcement_sensitive',
    id: mockId(),
    released_at: mockTimestamp(),
    released_by: null,
    revoke_reason: null,
    revoked_at: null,
    revoked_by: null,
    title: 'Sanitized intelligence',
    ...overrides,
  }
}

export function ciReleaseRow(
  overrides: Partial<Tables<'ci_releases'>> & Pick<Tables<'ci_releases'>, 'ci_id' | 'intel_id' | 'case_release_id'>,
): Tables<'ci_releases'> {
  return { id: mockId(), released_at: mockTimestamp(), released_by: null, ...overrides }
}

export function ciAuditEventRow(
  overrides: Partial<Tables<'ci_audit_events'>> & Pick<Tables<'ci_audit_events'>, 'id' | 'action'>,
): Tables<'ci_audit_events'> {
  return { actor_id: null, ci_id: null, created_at: mockTimestamp(), detail: null, entity: 'confidential_informants', entity_id: null, ...overrides }
}

export function ciEventRow(
  overrides: Partial<Tables<'ci_events'>> & Pick<Tables<'ci_events'>, 'id' | 'kind'>,
): Tables<'ci_events'> {
  return { at: mockTimestamp(), ci_id: null, user_id: null, ...overrides }
}

/* ── Platform upgrade (2026-11 — evidence, jobs, packets, documents, sources, search, health) ── */

/** feature_flags — the seed keys ship false except the three that need no external service. */
export function featureFlagRow(overrides: Partial<Tables<'feature_flags'>> & Pick<Tables<'feature_flags'>, 'key'>): Tables<'feature_flags'> {
  return {
    enabled: false,
    note: null,
    updated_at: mockTimestamp(),
    updated_by: null,
    ...overrides,
  }
}

/** background_jobs — a queued row; `created_by` is the visibility key (creator or Owner). */
export function backgroundJobRow(
  overrides: Partial<Tables<'background_jobs'>> & Pick<Tables<'background_jobs'>, 'queue' | 'kind'>,
): Tables<'background_jobs'> {
  const id = overrides.id ?? mockId()
  return {
    args: {},
    attempts: 0,
    case_id: null,
    claimed_at: null,
    claimed_by: null,
    created_at: mockTimestamp(),
    created_by: null,
    error: null,
    finished_at: null,
    id,
    idempotency_key: `${overrides.kind}:${id}`,
    lease_until: null,
    max_attempts: 5,
    priority: 100,
    progress: {},
    result: null,
    run_after: mockTimestamp(),
    started_at: null,
    status: 'queued',
    subject_id: null,
    subject_kind: null,
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

let custodyEventSeq = 0
/** evidence_custody_events — append-only, hash-chained; the builder stamps a deterministic hash. */
export function evidenceCustodyEventRow(
  overrides: Partial<Tables<'evidence_custody_events'>> & Pick<Tables<'evidence_custody_events'>, 'media_id' | 'event_type'>,
): Tables<'evidence_custody_events'> {
  custodyEventSeq += 1
  return {
    actor_id: null,
    case_id: null,
    event_hash: `\\x${custodyEventSeq.toString(16).padStart(64, '0')}`,
    export_id: null,
    id: custodyEventSeq,
    job_id: null,
    metadata: {},
    new_custodian: null,
    occurred_at: mockTimestamp(custodyEventSeq),
    prev_hash: null,
    previous_custodian: null,
    reason: null,
    ...overrides,
  }
}

/** export_manifests — immutable; `manifest` is the canonical JSON the bundle's manifest.json carries. */
export function exportManifestRow(overrides: Partial<Tables<'export_manifests'>> = {}): Tables<'export_manifests'> {
  const id = overrides.id ?? mockId()
  const bundle = overrides.bundle_id ?? mockId()
  return {
    bundle_id: bundle,
    case_id: null,
    classification: null,
    created_at: mockTimestamp(),
    created_by: null,
    id,
    kind: 'case_packet',
    manifest: { manifest_version: 1, bundle_id: bundle, kind: 'case_packet', files: [], source_evidence_ids: [] },
    manifest_sha256: `\\x${'0'.repeat(64)}`,
    storage_path: `case/${overrides.case_id ?? mockId()}/${bundle}/manifest.json`,
    ...overrides,
  }
}

/** case_packets — a queued packet request (status moves queued → rendering → ready). */
export function casePacketRow(
  overrides: Partial<Tables<'case_packets'>> & Pick<Tables<'case_packets'>, 'case_id'>,
): Tables<'case_packets'> {
  return {
    byte_size: null,
    created_at: mockTimestamp(),
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    error: null,
    finished_at: null,
    id: mockId(),
    job_id: null,
    manifest_id: null,
    options: {},
    packet_type: 'full',
    page_count: null,
    requested_by: null,
    sections: ['cover', 'overview', 'summary'],
    sha256: null,
    snapshot: null,
    status: 'queued',
    storage_path: null,
    watermark: null,
    ...overrides,
  }
}

let documentPageSeq = 0
/** document_pages — one extracted page of a media document (`tsv` is server-generated). */
export function documentPageRow(
  overrides: Partial<Tables<'document_pages'>> & Pick<Tables<'document_pages'>, 'media_id'>,
): Tables<'document_pages'> {
  documentPageSeq += 1
  return {
    id: documentPageSeq,
    page_no: 1,
    text: 'Mock extracted page text.',
    tsv: null,
    ...overrides,
  }
}

/** document_extractions — one per media row (unique media_id). */
export function documentExtractionRow(
  overrides: Partial<Tables<'document_extractions'>> & Pick<Tables<'document_extractions'>, 'media_id'>,
): Tables<'document_extractions'> {
  return {
    created_at: mockTimestamp(),
    error: null,
    id: mockId(),
    page_count: null,
    service: null,
    service_version: null,
    status: 'queued',
    structure: null,
    tables: null,
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** crawler_policy — the singleton (id = 1) with the migration's defaults. */
export function crawlerPolicyRow(overrides: Partial<Tables<'crawler_policy'>> = {}): Tables<'crawler_policy'> {
  return {
    allow_domains: [],
    block_domains: [],
    id: 1,
    max_bytes: 5_242_880,
    max_depth: 1,
    max_pages: 5,
    rate_per_min: 30,
    recheck_hours: 168,
    timeout_ms: 20_000,
    updated_at: mockTimestamp(),
    updated_by: null,
    ...overrides,
  }
}

let sourceSeq = 0
/** external_sources — a pending submission (`SRC-000001` numbers). */
export function externalSourceRow(
  overrides: Partial<Tables<'external_sources'>> & Pick<Tables<'external_sources'>, 'submitted_by'>,
): Tables<'external_sources'> {
  sourceSeq += 1
  const url = overrides.url ?? `https://example.org/article-${sourceSeq}`
  return {
    analyst_notes: null,
    author: null,
    canonical_url: url,
    case_id: null,
    classification: 'unclassified',
    content_type: null,
    created_at: mockTimestamp(),
    current_version_id: null,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    domain: new URL(url).hostname,
    fetch_error: null,
    http_status: null,
    id: mockId(),
    last_checked_at: null,
    published_at: null,
    reliability: 'unknown',
    retrieved_at: null,
    source_number: `SRC-${String(sourceSeq).padStart(6, '0')}`,
    status: 'pending',
    title: null,
    updated_at: mockTimestamp(),
    url,
    verification_status: 'unverified',
    verified_at: null,
    verified_by: null,
    version_count: 0,
    ...overrides,
  }
}

/** external_source_versions — immutable snapshots (`tsv` is server-generated). */
export function externalSourceVersionRow(
  overrides: Partial<Tables<'external_source_versions'>> & Pick<Tables<'external_source_versions'>, 'source_id'>,
): Tables<'external_source_versions'> {
  return {
    byte_size: 1024,
    content_hash: `\\x${'1'.repeat(64)}`,
    content_type: 'text/html',
    diff_summary: null,
    http_status: 200,
    id: mockId(),
    markdown: '# Mock page\n\nMock external source text.',
    retrieved_at: mockTimestamp(),
    retrieved_by: null,
    service: 'basic-fetch',
    service_version: '1',
    snapshot_path: null,
    text: 'Mock page. Mock external source text.',
    title: 'Mock page',
    tsv: null,
    version_no: 1,
    ...overrides,
  }
}

/** external_source_links — source → registry record (never `ci`). */
export function externalSourceLinkRow(
  overrides: Partial<Tables<'external_source_links'>> & Pick<Tables<'external_source_links'>, 'source_id' | 'kind' | 'ref_id'>,
): Tables<'external_source_links'> {
  return {
    created_at: mockTimestamp(),
    created_by: null,
    id: mockId(),
    note: null,
    ...overrides,
  }
}

let indexQueueSeq = 0
/** search_index_queue — service-role only; never visible to a client session. */
export function searchIndexQueueRow(
  overrides: Partial<Tables<'search_index_queue'>> & Pick<Tables<'search_index_queue'>, 'kind' | 'ref_id'>,
): Tables<'search_index_queue'> {
  indexQueueSeq += 1
  return {
    attempts: 0,
    error: null,
    id: indexQueueSeq,
    indexed_at: null,
    op: 'upsert',
    page_no: null,
    queued_at: mockTimestamp(),
    ...overrides,
  }
}

let chunkSeq = 0
/** semantic_chunks — `embedding` is pgvector text (`[0.1,…]`) or null when no provider ran. */
export function semanticChunkRow(
  overrides: Partial<Tables<'semantic_chunks'>> & Pick<Tables<'semantic_chunks'>, 'source_kind' | 'source_id'>,
): Tables<'semantic_chunks'> {
  chunkSeq += 1
  return {
    case_id: null,
    chunk_no: 0,
    content: 'Mock chunk text.',
    content_hash: `\\x${'2'.repeat(64)}`,
    created_at: mockTimestamp(),
    embedding: null,
    id: chunkSeq,
    media_id: null,
    model: null,
    page_no: null,
    ...overrides,
  }
}

let healthSeq = 0
/** service_health_events — Owner-readable probe results; never a URL or credential in `detail`. */
export function serviceHealthEventRow(
  overrides: Partial<Tables<'service_health_events'>> & Pick<Tables<'service_health_events'>, 'service'>,
): Tables<'service_health_events'> {
  healthSeq += 1
  return {
    checked_at: mockTimestamp(),
    detail: {},
    id: healthSeq,
    latency_ms: 12,
    status: 'healthy',
    ...overrides,
  }
}

/* ---- guide library (20261107120000) -------------------------------------- */

/** A library entry. Defaults to a PUBLISHED guide because that is what a
 *  reader sees; pass `status: 'draft'` (and leave `published_at` null) for the
 *  editors-only case. `body_key` names the typed content module that renders
 *  the prose — the database never holds it. */
export function guideRow(overrides: Partial<Tables<'guides'>> = {}): Tables<'guides'> {
  const at = mockTimestamp()
  return {
    id: mockId(),
    slug: 'undergrnd',
    title: 'UNDERGRND System Guide',
    summary: 'Contracts, equipment, daily objectives, milestones and recorded progression information.',
    category: 'systems',
    status: 'published',
    body_key: 'undergrnd',
    pinned: false,
    audience: 'all',
    custom_roles: [],
    tags: [],
    keywords: null,
    body_kind: 'module',
    read_minutes: null,
    view_count: 0,
    content_owner: null,
    last_reviewed_at: null,
    next_review_at: null,
    archived_at: null,
    archived_by: null,
    publication_note: null,
    outdated_at: null,
    outdated_by: null,
    outdated_reason: null,
    published_at: at,
    created_by: null,
    updated_by: null,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    deleted_by: null,
    delete_reason: null,
    delete_batch: null,
    ...overrides,
  }
}

/** One category in the library's vocabulary. Categories are rows, not a
 *  CHECK constraint: an administrator adds one without a deploy. */
export function guideCategoryRow(
  overrides: Partial<Tables<'guide_categories'>> & Pick<Tables<'guide_categories'>, 'slug'>,
): Tables<'guide_categories'> {
  return {
    label: overrides.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    description: null,
    sort_order: 10,
    active: true,
    created_at: mockTimestamp(),
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** One anchor section of a guide written in the editor. A guide whose prose
 *  lives in a code-reviewed module has no rows here. */
export function guideSectionRow(
  overrides: Partial<Tables<'guide_sections'>> & Pick<Tables<'guide_sections'>, 'guide_id'>,
): Tables<'guide_sections'> {
  return {
    id: mockId(),
    anchor: 'getting-started',
    heading: 'Getting started',
    body: 'What this section explains.',
    sort_order: 0,
    created_at: mockTimestamp(),
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** One searchable section. The server maintains these rows from the guide's
 *  own sections; the mock takes them as given. */
export function guideSearchIndexRow(
  overrides: Partial<Tables<'guide_search_index'>> & Pick<Tables<'guide_search_index'>, 'guide_id'>,
): Tables<'guide_search_index'> {
  return {
    id: mockId(),
    anchor: 'getting-started',
    heading: 'Getting started',
    terms: 'Getting started What this section explains.',
    sort_order: 0,
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

/** One optional image on a guide. `section` is a section id, or null for the
 *  cover. A guide with no rows here renders no imagery and no placeholder. */
export function guideMediaRow(
  overrides: Partial<Tables<'guide_media'>> & Pick<Tables<'guide_media'>, 'guide_id'>,
): Tables<'guide_media'> {
  const id = overrides.id ?? mockId()
  return {
    id,
    section: null,
    sort_order: 0,
    storage_path: `${overrides.guide_id}/${id}/image.png`,
    alt: 'A photograph illustrating the section',
    caption: null,
    mime: 'image/png',
    byte_size: 4096,
    created_by: null,
    created_at: mockTimestamp(),
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

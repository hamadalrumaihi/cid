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

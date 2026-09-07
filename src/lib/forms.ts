/** Fillable CID form schemas + report-template helpers — ported from vanilla
 *  core.js FORM_SCHEMAS (:79-360), persons.js REPORT_TEMPLATES (:31-45) and
 *  reports.js pure helpers. Rendering lives in components/cases/FormBody.tsx;
 *  everything here is data + pure functions. */
import { parseFormValues } from '@/lib/jsonShapes'
import { BUREAUS } from '@/lib/roles'

export type FormFieldType = 'text' | 'date' | 'money' | 'select' | 'textarea' | 'checks'

export interface FormField {
  key: string
  label: string
  type: FormFieldType
  opts?: string[]
  /** Person-name field: autocompletes against the Persons registry and is a
   *  target for suspect quick-fill. */
  person?: boolean
}

export interface FormGridCol {
  key: string
  label: string
  type?: FormFieldType
  opts?: string[]
  person?: boolean
}

export type FormSection =
  /** evidenceLookup: kv section whose ev_items/ev_files fields offer a
   *  case-scoped pick-list of logged evidence + attachments (free-text append).
   *  evidencePick/mediaPick: grid/textarea variants of the same pick-list —
   *  evidence rows append a grid row, attachments append a `title — url` line. */
  | { id: string; label: string; type: 'kv'; fields: FormField[]; evidenceLookup?: boolean }
  | { id: string; label: string; type: 'grid'; cols: FormGridCol[]; evidencePick?: boolean }
  | { id: string; label: string; type: 'textarea'; key: string; mediaPick?: boolean }
  | { id: string; label: string; type: 'note'; text: string }

export interface FormSchema {
  title: string
  subtitle: string
  sections: FormSection[]
}

/** Values object: kv/textarea keys → string; checks keys → string[];
 *  grid section ids → array of row objects. Underscore keys (_refs,
 *  _warrant_status, _warrant_log) are workflow metadata riding along. */
export type FormValues = Record<string, unknown>

/** External field agencies on printable forms — police departments, NOT CID
 *  bureaus. */
const FORM_DEPT_OPTS = ['', 'LSPD', 'BCSO', 'SAHP']
/** CID bureau display names (lib/roles BUREAUS). */
const FORM_BUREAU_OPTS = ['', ...Object.values(BUREAUS)]

export const FORM_SCHEMAS: Record<string, FormSchema> = {
  cid_investigative_report: {
    title: 'CID Investigative Report',
    subtitle: 'Criminal Investigations Department — Major Crimes Bureau — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'details', label: 'Case / Report Details', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'report_type', label: 'Report Type', type: 'select', opts: ['Initial', 'Supplemental', 'Follow-up'] },
        { key: 'filed_at', label: 'Date / Time Filed', type: 'text' },
      ] },
      { id: 'detective', label: 'Detective Information', type: 'kv', fields: [
        { key: 'det_name', label: 'Name', type: 'text' },
        { key: 'det_rank', label: 'Rank', type: 'text' },
        { key: 'det_callsign', label: 'Callsign', type: 'text' },
        { key: 'det_dept', label: 'Department', type: 'select', opts: FORM_DEPT_OPTS },
      ] },
      { id: 'subjects', label: 'Suspect / Witness Information', type: 'grid', cols: [
        { key: 'name', label: 'Name', type: 'text', person: true },
        { key: 'phone', label: 'Phone', type: 'text' },
        { key: 'dob', label: 'DOB', type: 'text' },
        { key: 'affiliation', label: 'Affiliation', type: 'text' },
      ] },
      { id: 'rights', label: 'Rights Advisement', type: 'kv', fields: [
        { key: 'rights_admin', label: 'Article 31 / Miranda Administered', type: 'select', opts: ['', 'Yes', 'No'] },
        { key: 'rights_dt', label: 'Date / Time', type: 'text' },
        { key: 'rights_waived', label: 'Rights Waived?', type: 'select', opts: ['', 'Yes', 'No'] },
        { key: 'rights_witness', label: 'Rights Witness', type: 'text' },
      ] },
      { id: 'incident', label: 'Incident Details', type: 'kv', fields: [
        { key: 'inc_type', label: 'Type of Incident', type: 'text' },
        { key: 'inc_dt', label: 'Date / Time of Incident', type: 'text' },
        { key: 'inc_loc', label: 'Location of Incident', type: 'text' },
        { key: 'inc_parties', label: 'Involved Parties', type: 'text' },
        { key: 'inc_class', label: 'MCB Classification', type: 'text' },
      ] },
      { id: 'narrative', label: 'Narrative / Statement', type: 'textarea', key: 'narrative' },
      { id: 'evidence', label: 'Evidence / Property', type: 'kv', evidenceLookup: true, fields: [
        { key: 'ev_items', label: 'Item(s)', type: 'text' },
        { key: 'ev_collected_by', label: 'Collected by', type: 'text' },
        { key: 'ev_files', label: 'Files', type: 'text' },
      ] },
      { id: 'remarks', label: 'Detective Remarks', type: 'textarea', key: 'remarks' },
      { id: 'actions', label: 'Investigative Actions', type: 'grid', cols: [
        { key: 'action', label: 'Action Taken', type: 'text' },
      ] },
      { id: 'understanding', label: 'Statement of Understanding', type: 'note', text: 'By completing this report, I understand that I am strictly prohibited from disclosing any information, reports, or materials pertaining to Criminal Investigation Division (CID) matters, whether ongoing, past, or closed, as doing so may jeopardize the integrity of investigative processes, compromise the rights and safety of individuals involved, and undermine the mission of CID. I further acknowledge that any unauthorized disclosure of such information may result in disciplinary, administrative, or criminal consequences under applicable laws and regulations.' },
    ],
  },
  raid_seizure: {
    title: 'Raid Seizure Value Distribution & Allocation Form',
    subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'case', label: 'Case Information', type: 'kv', fields: [
        { key: 'bureau', label: 'Bureau', type: 'select', opts: FORM_BUREAU_OPTS },
        { key: 'case_number', label: 'Case #', type: 'text' },
        { key: 'operation', label: 'Operation Name', type: 'text' },
        { key: 'seizure_date', label: 'Date of Seizure', type: 'text' },
        { key: 'seizure_loc', label: 'Location of Seizure', type: 'text' },
      ] },
      { id: 'inventory', label: 'Seizure Inventory & Valuation', type: 'grid', cols: [
        { key: 'item', label: 'Item', type: 'text' },
        { key: 'qty', label: 'Quantity', type: 'text' },
        { key: 'unit_value', label: 'Unit Street Value', type: 'money' },
        { key: 'total_value', label: 'Total Street Value', type: 'money' },
      ] },
      { id: 'distribution', label: 'Authorized Director Distribution', type: 'kv', fields: [
        { key: 'net_value', label: 'Total Net Seizure Value ($)', type: 'money' },
        { key: 'lead_amount', label: 'Amount to Lead Detective ($)', type: 'money' },
        { key: 'division_amount', label: 'Amount to Division', type: 'money' },
        { key: 'other_alloc', label: 'Other Allocations (if any)', type: 'text' },
        { key: 'dir_sig', label: 'Director Signature', type: 'text' },
        { key: 'dist_date', label: 'Date', type: 'text' },
      ] },
      { id: 'lead_alloc', label: 'Lead Detective Allocation', type: 'grid', cols: [
        { key: 'recipient_type', label: 'Recipient Type', type: 'text' },
        { key: 'recipient', label: 'Recipient Name / Identifier', type: 'text' },
        { key: 'allocation', label: 'Allocation ($)', type: 'money' },
      ] },
      { id: 'final', label: 'Final Authorization', type: 'kv', fields: [
        { key: 'final_dir_sig', label: 'Director Signature', type: 'text' },
        { key: 'final_lead_sig', label: 'Lead Detective Signature', type: 'text' },
      ] },
    ],
  },
  uc_operation: {
    title: 'Undercover Operation Activity Report',
    subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'report', label: 'Report Information', type: 'kv', fields: [
        { key: 'report_type', label: 'Report Type', type: 'select', opts: ['Initial', 'Supplemental', 'Final'] },
        { key: 'submitted', label: 'Date Submitted', type: 'text' },
        { key: 'uc_officer', label: 'UC Officer Name', type: 'text' },
        { key: 'bureau', label: 'Bureau', type: 'select', opts: FORM_BUREAU_OPTS },
        { key: 'op_code', label: 'Operation Code / Case ID', type: 'text' },
      ] },
      { id: 'overview', label: 'Operation Overview', type: 'kv', fields: [
        { key: 'activity_dates', label: 'Date(s) of UC Activity', type: 'text' },
        { key: 'objective', label: 'Primary Objective', type: 'text' },
      ] },
      { id: 'summary', label: 'Summary of Activities', type: 'textarea', key: 'summary' },
      { id: 'contacts', label: 'Contacts & Interactions', type: 'grid', cols: [
        { key: 'individual', label: 'Individuals Met or Observed', type: 'text' },
        { key: 'nature', label: 'Nature of Interaction', type: 'text' },
        { key: 'key_actions', label: 'Key Conversations / Actions', type: 'text' },
      ] },
      { id: 'intel', label: 'Intelligence & Evidence', type: 'grid', evidencePick: true, cols: [
        { key: 'item', label: 'Items Observed or Discussed', type: 'text' },
        { key: 'description', label: 'Description of Evidence / Intelligence', type: 'text' },
      ] },
      { id: 'media', label: 'Photos / Recordings Captured (attach references)', type: 'textarea', key: 'media_refs', mediaPick: true },
      { id: 'assessment', label: 'Operational Assessment', type: 'kv', fields: [
        { key: 'threat_level', label: 'Threat Level', type: 'select', opts: ['', 'Low', 'Medium', 'High', 'Critical'] },
        { key: 'cover_status', label: 'UC Cover Status', type: 'select', opts: ['', 'Intact', 'At Risk', 'Compromised', 'Withdrawn'] },
      ] },
      { id: 'notes', label: 'Additional Notes', type: 'textarea', key: 'notes' },
      { id: 'approval', label: 'Review & Approval', type: 'kv', fields: [
        { key: 'uc_sig', label: 'UC Officer Signature', type: 'text' },
        { key: 'lead_sig', label: 'Unit Lead Signature', type: 'text' },
      ] },
    ],
  },
  arrest_warrant: {
    title: 'Arrest Warrant Request',
    subtitle: 'State of San Andreas — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'hdr', label: 'Request', type: 'kv', fields: [
        // Confirmed warrant form: readable legal-request title + queue priority.
        // Priority orders review queues only — it never bypasses review/signing.
        { key: 'warrant_title', label: 'Warrant Title', type: 'text' },
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'detective', label: 'Requesting Detective', type: 'text' },
        { key: 'department', label: 'Department', type: 'select', opts: FORM_DEPT_OPTS },
        { key: 'priority', label: 'Priority', type: 'select', opts: ['', 'Medium', 'High', 'Critical'] },
        { key: 'date', label: 'Date', type: 'text' },
      ] },
      { id: 'suspects', label: 'Suspect Information', type: 'grid', cols: [
        { key: 'full_name', label: 'Full Name', type: 'text', person: true },
        { key: 'dob', label: 'DOB', type: 'text' },
        { key: 'address', label: 'Known Address', type: 'text' },
      ] },
      { id: 'charges', label: 'Charges Requested', type: 'textarea', key: 'charges' },
      { id: 'summary', label: 'Summary of Incident', type: 'textarea', key: 'summary' },
      { id: 'pc', label: 'Probable Cause Statement', type: 'textarea', key: 'probable_cause' },
      { id: 'evidence', label: 'Supporting Evidence', type: 'kv', fields: [
        { key: 'supporting_evidence', label: 'Evidence', type: 'checks', opts: ['Witness Statements', 'Surveillance Footage', 'Bodycam Footage', 'Physical Evidence', 'Other'] },
      ] },
      // Confirmed warrant form: structured evidence/supporting links drawn from
      // the case's logged evidence, attachments and finalized reports — not a
      // single unrestricted text field (free text stays allowed in the fields).
      { id: 'links', label: 'Evidence / Supporting Links', type: 'kv', evidenceLookup: true, fields: [
        { key: 'ev_items', label: 'Item(s)', type: 'text' },
        { key: 'ev_files', label: 'Files / Links', type: 'text' },
      ] },
      { id: 'affirm', label: 'Detective Affirmation', type: 'note', text: 'I affirm that probable cause exists for the arrest of the above-named individual.' },
      { id: 'sign', label: 'Authorization', type: 'kv', fields: [
        { key: 'detective_sig', label: 'Detective Signature', type: 'text' },
        { key: 'supervisor_approval', label: 'Supervisor Approval', type: 'text' },
        { key: 'judge_approval', label: 'Judge Approval', type: 'text' },
      ] },
    ],
  },
  search_warrant: {
    title: 'Search Warrant Affidavit',
    subtitle: 'State of San Andreas — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'hdr', label: 'Affidavit', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'affiant', label: 'Affiant (Detective)', type: 'text' },
        { key: 'department', label: 'Department', type: 'select', opts: FORM_DEPT_OPTS },
        { key: 'date', label: 'Date', type: 'text' },
      ] },
      { id: 'location', label: 'Location to be Searched', type: 'textarea', key: 'location' },
      { id: 'properties', label: 'Properties / Premises to Search', type: 'grid', cols: [
        { key: 'address', label: 'Address / Location', type: 'text' },
        { key: 'type', label: 'Type', type: 'select', opts: ['', 'Residence', 'Business', 'Vehicle', 'Storage Unit', 'Other'] },
        { key: 'notes', label: 'Notes', type: 'text' },
      ] },
      { id: 'persons', label: 'Person(s) Involved', type: 'textarea', key: 'persons_involved' },
      { id: 'items', label: 'Items to be Seized', type: 'kv', fields: [
        { key: 'items_to_seize', label: 'Items', type: 'checks', opts: ['Narcotics', 'Firearms (Class 2 / Class 3)', 'Currency / Proceeds', 'Documents / Records', 'Electronic Devices', 'Other'] },
      ] },
      { id: 'pc', label: 'Probable Cause Narrative', type: 'textarea', key: 'probable_cause' },
      { id: 'basis', label: 'Basis of Information', type: 'kv', fields: [
        { key: 'basis', label: 'Basis', type: 'checks', opts: ['Officer Observations', 'Witness Statements', 'Confidential Informant', 'Surveillance', 'Other'] },
      ] },
      { id: 'affirm', label: 'Detective Affirmation', type: 'note', text: 'I affirm that the information provided is true and accurate to the best of my knowledge.' },
      { id: 'sign', label: 'Authorization', type: 'kv', fields: [
        { key: 'detective_sig', label: 'Detective Signature', type: 'text' },
        { key: 'supervisor_approval', label: 'Supervisor Approval', type: 'text' },
        { key: 'judge_approval', label: 'Judge Approval', type: 'text' },
      ] },
    ],
  },
  wiretap_warrant: {
    title: 'Wiretap / Electronic Surveillance Request',
    subtitle: 'State of San Andreas — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'hdr', label: 'Request', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'detective', label: 'Requesting Detective', type: 'text' },
        { key: 'department', label: 'Department', type: 'select', opts: FORM_DEPT_OPTS },
        { key: 'date', label: 'Date', type: 'text' },
      ] },
      { id: 'targets', label: 'Target Information', type: 'grid', cols: [
        { key: 'name_alias', label: 'Name / Alias', type: 'text', person: true },
        { key: 'phone_device', label: 'Phone Number / Device', type: 'text' },
      ] },
      { id: 'type', label: 'Type of Surveillance Requested', type: 'kv', fields: [
        { key: 'surveillance_type', label: 'Type', type: 'checks', opts: ['Phone Intercept', 'Text Message Monitoring', 'Electronic Communication Monitoring', 'Other'] },
      ] },
      { id: 'details', label: 'Investigation Details', type: 'textarea', key: 'investigation_details' },
      { id: 'pc', label: 'Probable Cause', type: 'textarea', key: 'probable_cause' },
      { id: 'necessity', label: 'Necessity Statement', type: 'textarea', key: 'necessity' },
      { id: 'duration', label: 'Duration Requested', type: 'kv', fields: [
        { key: 'duration', label: 'Duration', type: 'select', opts: ['', '24 Hours', '48 Hours', '72 Hours', 'Other'] },
      ] },
      { id: 'affirm', label: 'Detective Affirmation', type: 'note', text: 'I affirm that this request is necessary for the investigation and supported by probable cause.' },
      { id: 'sign', label: 'Authorization', type: 'kv', fields: [
        { key: 'detective_sig', label: 'Detective Signature', type: 'text' },
        { key: 'supervisor_approval', label: 'Supervisor Approval', type: 'text' },
        { key: 'judge_approval', label: 'Judge Approval', type: 'text' },
      ] },
    ],
  },
  subpoena: {
    title: 'Subpoena — Records / Witness',
    subtitle: 'State of San Andreas — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'hdr', label: 'Issuance', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'detective', label: 'Requesting Detective', type: 'text' },
        { key: 'department', label: 'Department', type: 'select', opts: FORM_DEPT_OPTS },
        { key: 'date', label: 'Date', type: 'text' },
      ] },
      { id: 'type', label: 'Subpoena Type', type: 'kv', fields: [
        { key: 'subpoena_type', label: 'Type', type: 'checks', opts: ['Records (Duces Tecum)', 'Witness Testimony (Ad Testificandum)', 'Financial / Bank Records', 'Phone / Communications Records', 'Other'] },
      ] },
      { id: 'recipients', label: 'Recipient / Custodian', type: 'grid', cols: [
        { key: 'recipient_name', label: 'Name / Business', type: 'text', person: true },
        { key: 'recipient_address', label: 'Address', type: 'text' },
      ] },
      { id: 'records', label: 'Records / Items / Testimony Requested', type: 'textarea', key: 'records_requested' },
      { id: 'relevance', label: 'Relevance to the Investigation', type: 'textarea', key: 'relevance' },
      { id: 'return', label: 'Return / Compliance', type: 'kv', fields: [
        { key: 'return_date', label: 'Return Date', type: 'text' },
        { key: 'return_location', label: 'Deliver To', type: 'text' },
      ] },
      { id: 'affirm', label: 'Detective Affirmation', type: 'note', text: 'I affirm that the records or testimony sought are relevant and necessary to an active investigation.' },
      { id: 'sign', label: 'Authorization', type: 'kv', fields: [
        { key: 'detective_sig', label: 'Detective Signature', type: 'text' },
        { key: 'supervisor_approval', label: 'Supervisor Approval', type: 'text' },
        { key: 'judge_approval', label: 'Judge / DA Approval', type: 'text' },
      ] },
    ],
  },
  surveillance_report: {
    title: 'Surveillance Report',
    subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'hdr', label: 'Report', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'detective', label: 'Reporting Detective', type: 'text' },
        { key: 'department', label: 'Department', type: 'select', opts: FORM_DEPT_OPTS },
        { key: 'date', label: 'Date', type: 'text' },
      ] },
      { id: 'authorization', label: 'Authorization', type: 'kv', fields: [
        { key: 'target_label', label: 'Target Label', type: 'text' },
        { key: 'authorized_by', label: 'Authorized By', type: 'text' },
        { key: 'period_from', label: 'Period From', type: 'text' },
        { key: 'period_to', label: 'Period To', type: 'text' },
        { key: 'auth_objective', label: 'Objective', type: 'text' },
      ] },
      { id: 'scope', label: 'Objective / Scope', type: 'textarea', key: 'scope' },
      { id: 'detectives', label: 'Participating Detectives', type: 'grid', cols: [
        { key: 'name', label: 'Name', type: 'text', person: true },
        { key: 'role', label: 'Role', type: 'text' },
      ] },
      { id: 'obs_note', label: 'Observations — Selection', type: 'note', text: 'Copy in only the observations you intend to include. Selection is a deliberate investigative decision — observations are never auto-dumped into a report, and unverified entries must be identified as such.' },
      { id: 'observations', label: 'Observations Included', type: 'grid', cols: [
        { key: 'observed_at', label: 'Observed At', type: 'text' },
        { key: 'source', label: 'Source', type: 'text' },
        { key: 'summary', label: 'Summary', type: 'text' },
        { key: 'verified', label: 'Verified', type: 'select', opts: ['', 'Yes', 'No'] },
      ] },
      { id: 'entities', label: 'Relevant Persons / Vehicles', type: 'grid', cols: [
        // Mixed name-OR-plate column: NOT a person field — a plate must never be
        // routed through the Persons-registry picker / person_id capture
        // (forms.test.ts pins this; P2-08).
        { key: 'name_or_plate', label: 'Name / Plate', type: 'text' },
        { key: 'relevance', label: 'Relevance', type: 'text' },
      ] },
      { id: 'meetings', label: 'Notable Meetings & Patterns', type: 'textarea', key: 'meetings' },
      { id: 'assessment', label: 'Investigative Assessment', type: 'textarea', key: 'assessment' },
      { id: 'outcome', label: 'Outcome / Recommendations', type: 'textarea', key: 'outcome' },
    ],
  },
  incident_followup: {
    title: 'Incident Follow-up Report',
    subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'details', label: 'Report Details', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'detective', label: 'Reporting Detective', type: 'text' },
        { key: 'bureau', label: 'Bureau', type: 'select', opts: FORM_BUREAU_OPTS },
        { key: 'incident_ref', label: 'Original Incident / Report', type: 'text' },
        { key: 'location', label: 'Location', type: 'text' },
      ] },
      { id: 'developments', label: 'Developments Since the Last Report', type: 'textarea', key: 'developments' },
      { id: 'contacts', label: 'Contacts Made', type: 'grid', cols: [
        { key: 'name', label: 'Name', type: 'text', person: true },
        { key: 'role', label: 'Role', type: 'text' },
        { key: 'summary', label: 'Summary', type: 'text' },
      ] },
      { id: 'evidence', label: 'Evidence Collected / Reviewed', type: 'grid', cols: [
        { key: 'item', label: 'Item', type: 'text' },
        { key: 'source', label: 'Source', type: 'text' },
        { key: 'status', label: 'Status', type: 'select', opts: ['', 'Logged', 'Pending', 'Returned'] },
      ], evidencePick: true },
      { id: 'narrative', label: 'Narrative', type: 'textarea', key: 'narrative' },
      { id: 'next_steps', label: 'Next Steps', type: 'textarea', key: 'next_steps' },
    ],
  },
  interview: {
    title: 'Interview Report',
    subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'details', label: 'Interview Details', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'start_time', label: 'Start', type: 'text' },
        { key: 'end_time', label: 'End', type: 'text' },
        { key: 'location', label: 'Location', type: 'text' },
        { key: 'detective', label: 'Interviewing Detective', type: 'text' },
        { key: 'second_officer', label: 'Second Officer', type: 'text' },
      ] },
      { id: 'subject', label: 'Subject', type: 'kv', fields: [
        { key: 'subject_name', label: 'Name', type: 'text', person: true },
        { key: 'subject_role', label: 'Role', type: 'select', opts: ['', 'Suspect', 'Witness', 'Victim', 'Informant', 'Other'] },
        { key: 'rights_advised', label: 'Rights Advised', type: 'select', opts: ['', 'Yes', 'No', 'Not applicable'] },
        { key: 'rights_dt', label: 'Rights Advised At', type: 'text' },
        { key: 'counsel', label: 'Counsel Present', type: 'select', opts: ['', 'Yes', 'No', 'Waived'] },
        { key: 'recorded', label: 'Recorded', type: 'select', opts: ['', 'Audio', 'Video', 'Not recorded'] },
      ] },
      { id: 'summary', label: 'Summary of Statements', type: 'textarea', key: 'summary' },
      { id: 'narrative', label: 'Narrative', type: 'textarea', key: 'narrative' },
      { id: 'assessment', label: 'Investigative Assessment', type: 'textarea', key: 'assessment' },
    ],
  },
  arrest_report: {
    title: 'Arrest Report',
    subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'details', label: 'Arrest Details', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'time', label: 'Time', type: 'text' },
        { key: 'location', label: 'Location', type: 'text' },
        { key: 'detective', label: 'Arresting Detective', type: 'text' },
        { key: 'assisting', label: 'Assisting Officers', type: 'text' },
        { key: 'warrant_ref', label: 'Warrant Reference', type: 'text' },
      ] },
      { id: 'arrestee', label: 'Arrestee', type: 'kv', fields: [
        { key: 'arrestee_name', label: 'Name', type: 'text', person: true },
        { key: 'arrestee_dob', label: 'Date of Birth', type: 'text' },
        { key: 'rights_advised', label: 'Rights Advised', type: 'select', opts: ['', 'Yes', 'No'] },
        { key: 'rights_dt', label: 'Rights Advised At', type: 'text' },
        { key: 'injuries', label: 'Injuries / Medical', type: 'text' },
        { key: 'transported_to', label: 'Transported To', type: 'text' },
      ] },
      { id: 'charges', label: 'Charges', type: 'grid', cols: [
        { key: 'code', label: 'Code', type: 'text' },
        { key: 'offense', label: 'Offense', type: 'text' },
        { key: 'counts', label: 'Counts', type: 'text' },
      ] },
      { id: 'seized', label: 'Property Seized', type: 'grid', cols: [
        { key: 'item', label: 'Item', type: 'text' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'disposition', label: 'Disposition', type: 'text' },
      ], evidencePick: true },
      { id: 'narrative', label: 'Narrative / Probable Cause', type: 'textarea', key: 'narrative' },
    ],
  },
  search_report: {
    title: 'Search Report',
    subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'details', label: 'Search Details', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'start_time', label: 'Start', type: 'text' },
        { key: 'end_time', label: 'End', type: 'text' },
        { key: 'location', label: 'Location Searched', type: 'text' },
        { key: 'detective', label: 'Lead Detective', type: 'text' },
        { key: 'officers', label: 'Officers Present', type: 'text' },
        { key: 'authority', label: 'Authority', type: 'select', opts: ['', 'Search warrant', 'Consent', 'Exigent circumstances', 'Incident to arrest', 'Other'] },
        { key: 'warrant_ref', label: 'Warrant Reference', type: 'text' },
      ] },
      { id: 'present', label: 'Persons Present', type: 'grid', cols: [
        { key: 'name', label: 'Name', type: 'text', person: true },
        { key: 'role', label: 'Role', type: 'text' },
      ] },
      { id: 'items', label: 'Items Seized', type: 'grid', cols: [
        { key: 'item', label: 'Item', type: 'text' },
        { key: 'found_at', label: 'Found At', type: 'text' },
        { key: 'seized_by', label: 'Seized By', type: 'text' },
        { key: 'evidence_ref', label: 'Evidence Ref', type: 'text' },
      ], evidencePick: true },
      { id: 'narrative', label: 'Narrative', type: 'textarea', key: 'narrative' },
      { id: 'damage', label: 'Damage / Property Left', type: 'textarea', key: 'damage' },
    ],
  },
  case_closure: {
    title: 'Case Closure Report',
    subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'details', label: 'Closure Details', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'detective', label: 'Lead Detective', type: 'text' },
        { key: 'bureau', label: 'Bureau', type: 'select', opts: FORM_BUREAU_OPTS },
        { key: 'disposition', label: 'Disposition', type: 'select', opts: ['', 'Cleared by arrest', 'Cleared exceptionally', 'Unfounded', 'Inactive — leads exhausted', 'Referred', 'Other'] },
        { key: 'prosecution_status', label: 'Prosecution Status', type: 'text' },
      ] },
      { id: 'note', label: 'Before you submit', type: 'note', text: 'Every open task on this case must be done or waived before a closure report can be submitted.' },
      { id: 'summary', label: 'Investigation Summary', type: 'textarea', key: 'summary' },
      { id: 'outcome', label: 'Outcome', type: 'textarea', key: 'outcome' },
      { id: 'evidence_disposition', label: 'Evidence Disposition', type: 'grid', cols: [
        { key: 'item', label: 'Item', type: 'text' },
        { key: 'disposition', label: 'Disposition', type: 'select', opts: ['', 'Retained', 'Returned', 'Destroyed', 'Transferred'] },
        { key: 'note', label: 'Note', type: 'text' },
      ], evidencePick: true },
      { id: 'recommendations', label: 'Recommendations', type: 'textarea', key: 'recommendations' },
    ],
  },
  warrant_return: {
    title: 'Warrant Return',
    subtitle: 'Criminal Investigations Department — Return of Service — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'details', label: 'Warrant', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'warrant_ref', label: 'Warrant / Legal Request Number', type: 'text' },
        { key: 'warrant_type', label: 'Warrant Type', type: 'select', opts: ['', 'Arrest warrant', 'Search warrant'] },
        { key: 'issued_by', label: 'Issuing Judge', type: 'text' },
        { key: 'issued_on', label: 'Issued On', type: 'date' },
        { key: 'detective', label: 'Executing Detective', type: 'text' },
      ] },
      { id: 'execution', label: 'Execution', type: 'kv', fields: [
        { key: 'executed_on', label: 'Executed On', type: 'date' },
        { key: 'time', label: 'Time', type: 'text' },
        { key: 'location', label: 'Location', type: 'text' },
        { key: 'outcome', label: 'Outcome', type: 'select', opts: ['', 'Executed', 'Executed — nothing found', 'Not executed', 'Expired unexecuted'] },
        { key: 'subject', label: 'Subject', type: 'text', person: true },
        { key: 'officers', label: 'Officers Present', type: 'text' },
      ] },
      { id: 'inventory', label: 'Inventory / Persons Taken Into Custody', type: 'grid', cols: [
        { key: 'item', label: 'Item / Person', type: 'text' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'evidence_ref', label: 'Evidence Ref', type: 'text' },
      ], evidencePick: true },
      { id: 'return_narrative', label: 'Return Narrative', type: 'textarea', key: 'return_narrative' },
    ],
  },
}

/** The fillable CID forms ARE the canonical report templates (persons.js:31). */
export interface ReportTemplate {
  id: string
  isDefault: boolean
  name: string
  schema: FormSchema
}

const TEMPLATE_META: { id: string; isDefault?: boolean }[] = [
  { id: 'cid_investigative_report', isDefault: true },
  { id: 'raid_seizure' },
  { id: 'uc_operation' },
  { id: 'arrest_warrant' },
  { id: 'search_warrant' },
  { id: 'wiretap_warrant' },
  { id: 'subpoena' },
  { id: 'surveillance_report' },
  { id: 'incident_followup' },
  { id: 'interview' },
  { id: 'arrest_report' },
  { id: 'search_report' },
  { id: 'case_closure' },
  { id: 'warrant_return' },
]

export const REPORT_TEMPLATES: ReportTemplate[] = TEMPLATE_META
  .filter((t) => FORM_SCHEMAS[t.id])
  .map((t) => ({ id: t.id, isDefault: !!t.isDefault, name: FORM_SCHEMAS[t.id].title, schema: FORM_SCHEMAS[t.id] }))

export const tplById = (id: string | null | undefined): ReportTemplate | undefined =>
  REPORT_TEMPLATES.find((t) => t.id === id)

export interface ReportLike {
  id?: string
  template: string | null
  kind: string | null
  seq: number | null
  case_id?: string | null
  created_at?: string
  finalized?: boolean | null
  fields?: unknown
  signature?: unknown
}

/** `name` overrides the FORM_SCHEMAS title — the Reports tab passes the DB
 *  catalog's template name so a template that exists only in the database
 *  (no FORM_SCHEMAS entry) still titles its reports. */
export function reportTitle(r: ReportLike, name?: string | null): string {
  const tpl = tplById(r.template)
  const base = name || (tpl ? tpl.name : 'Report')
  if (r.kind === 'supplemental') return `${base} — Supplemental #${r.seq}`
  if (r.kind === 'followup') return `${base} — Follow-up #${r.seq}`
  return base
}

/** Warrant lifecycle rides inside report fields — vanilla reports.js:29-35. */
export const WARRANT_TPLS: Record<string, 1> = { arrest_warrant: 1, search_warrant: 1, wiretap_warrant: 1 }
export const WARRANT_TINT: Record<string, string> = {
  draft: 'bg-white/5 text-slate-400',
  signed: 'bg-blue-500/15 text-blue-300',
  executed: 'bg-amber-500/15 text-amber-300',
  returned: 'bg-emerald-500/15 text-emerald-300',
}
export const warrantStatusOf = (r: ReportLike): string => {
  const f = r.fields as { _warrant_status?: string } | null
  return f?._warrant_status || 'draft'
}

/* ---- required-field checker (P5-03) ------------------------------------
 * The pinned template version carries `required` / `advisory` key lists; the
 * server (report_submit / report_review) enforces `required` and the client
 * mirrors it here for the editor checklist and the pre-submit modal. The
 * rules are the contract's: a key is satisfied by a non-blank string, a
 * non-empty array, or a grid with ≥ 1 row. lib/reportTemplates wraps these
 * with the version-aware requiredGaps / advisoryGaps. */

export interface FormKeyLabel { key: string; label: string }

/** Every value key a template can require, in schema order: kv field keys,
 *  textarea keys and grid section ids (a grid's rows live under its id). */
export function formValueKeys(schema: FormSchema): FormKeyLabel[] {
  const out: FormKeyLabel[] = []
  for (const s of schema.sections) {
    if (s.type === 'kv') for (const f of s.fields) out.push({ key: f.key, label: f.label })
    else if (s.type === 'textarea') out.push({ key: s.key, label: s.label })
    else if (s.type === 'grid') out.push({ key: s.id, label: s.label })
  }
  return out
}

/** Mirror of the server's presence test: non-blank string, non-empty array
 *  (checks values, grid rows), or any other non-null scalar. */
export function formKeySatisfied(values: FormValues, key: string): boolean {
  const v = values[key]
  if (Array.isArray(v)) return v.length > 0
  if (v == null) return false
  return String(v).trim() !== ''
}

/** The keys of `keys` that are NOT satisfied, labelled from the schema
 *  (unknown keys fall back to the key itself so a stale list still reads). */
export function formGapsForKeys(schema: FormSchema, keys: readonly string[], values: FormValues): FormKeyLabel[] {
  const labels = new Map(formValueKeys(schema).map((k) => [k.key, k.label]))
  return keys.filter((k) => !formKeySatisfied(values, k)).map((k) => ({ key: k, label: labels.get(k) ?? k }))
}

/** The migration's seeded `required` map (20261028120000_report_templates,
 *  REQUIRED) — the tiebreaker for what version 1 of each template requires.
 *  Used ONLY when a report has no pinned version and the catalog is
 *  unreadable: the client never hard-codes required keys for a pinned
 *  report, it reads the version. A grid key is its section id. */
export const SEEDED_REQUIRED: Readonly<Record<string, readonly string[]>> = {
  cid_investigative_report: ['case_number', 'filed_at', 'det_name', 'narrative'],
  raid_seizure: ['case_number', 'seizure_date', 'operation', 'inventory'],
  uc_operation: ['submitted', 'uc_officer', 'summary'],
  arrest_warrant: ['case_number', 'detective', 'date', 'probable_cause'],
  search_warrant: ['case_number', 'affiant', 'date', 'location', 'probable_cause'],
  wiretap_warrant: ['case_number', 'detective', 'date', 'probable_cause', 'necessity'],
  subpoena: ['case_number', 'detective', 'date', 'records_requested'],
  surveillance_report: ['case_number', 'detective', 'date', 'assessment'],
  incident_followup: ['case_number', 'date', 'detective', 'narrative'],
  interview: ['case_number', 'date', 'detective', 'subject_name', 'summary'],
  arrest_report: ['case_number', 'date', 'detective', 'arrestee_name', 'narrative'],
  search_report: ['case_number', 'date', 'detective', 'location', 'narrative'],
  case_closure: ['case_number', 'date', 'detective', 'disposition', 'summary'],
  warrant_return: ['case_number', 'warrant_ref', 'executed_on', 'outcome', 'return_narrative'],
}

/** Fallback required keys for a template KEY: the seeded map when the key
 *  is known, else the map's shape derived from the schema (case number,
 *  date, the detective / affiant field and the primary narrative key). Only
 *  keys the schema actually has are returned. */
export function fallbackRequiredKeys(key: string | null | undefined, schema?: FormSchema): string[] {
  const sch = schema ?? (key ? FORM_SCHEMAS[key] : undefined)
  if (!sch) return []
  const keys = new Set(formValueKeys(sch).map((k) => k.key))
  const seeded = key ? SEEDED_REQUIRED[key] : undefined
  if (seeded) return seeded.filter((k) => keys.has(k))
  const out: string[] = []
  if (keys.has('case_number')) out.push('case_number')
  if (keys.has('date')) out.push('date')
  const signer = ['affiant', 'detective'].find((k) => keys.has(k))
  if (signer) out.push(signer)
  const primary = ['probable_cause', 'narrative', 'investigation_details', 'necessity'].find((k) => keys.has(k))
  if (primary) out.push(primary)
  return out
}

/** Legacy entry point (reports.js:383-398): the required-field gaps of a
 *  report judged by the FORM_SCHEMAS fallback map. Kept as a thin wrapper
 *  over formGapsForKeys so existing callers keep working; version-aware
 *  callers use lib/reportTemplates requiredGaps. */
export function reportFinalizeGaps(r: ReportLike): string[] {
  const tpl = tplById(r.template)
  if (!tpl) return []
  return formGapsForKeys(tpl.schema, fallbackRequiredKeys(tpl.id, tpl.schema), parseFormValues(r.fields)).map((g) => g.label)
}

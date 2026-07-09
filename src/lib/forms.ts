/** Fillable CID form schemas + report-template helpers — ported from vanilla
 *  core.js FORM_SCHEMAS (:79-360), persons.js REPORT_TEMPLATES (:31-45) and
 *  reports.js pure helpers. Rendering lives in components/cases/FormBody.tsx;
 *  everything here is data + pure functions. */
import { parseFormValues } from '@/lib/jsonShapes'

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
  | { id: string; label: string; type: 'kv'; fields: FormField[] }
  | { id: string; label: string; type: 'grid'; cols: FormGridCol[] }
  | { id: string; label: string; type: 'textarea'; key: string }
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

const FORM_DEPT_OPTS = ['', 'LSPD', 'BCSO', 'SAHP']
const FORM_BUREAU_OPTS = ['', 'Los Santos Bureau', 'Blaine County Bureau', 'State Bureau', 'Joint Task Force']

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
      { id: 'evidence', label: 'Evidence / Property', type: 'kv', fields: [
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
      { id: 'intel', label: 'Intelligence & Evidence', type: 'grid', cols: [
        { key: 'item', label: 'Items Observed or Discussed', type: 'text' },
        { key: 'description', label: 'Description of Evidence / Intelligence', type: 'text' },
      ] },
      { id: 'media', label: 'Photos / Recordings Captured (attach references)', type: 'textarea', key: 'media_refs' },
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
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'detective', label: 'Requesting Detective', type: 'text' },
        { key: 'department', label: 'Department', type: 'select', opts: ['', 'LSPD', 'BCSO', 'SAHP'] },
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
        { key: 'department', label: 'Department', type: 'select', opts: ['', 'LSPD', 'BCSO', 'SAHP'] },
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
        { key: 'department', label: 'Department', type: 'select', opts: ['', 'LSPD', 'BCSO', 'SAHP'] },
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
        { key: 'department', label: 'Department', type: 'select', opts: ['', 'LSPD', 'BCSO', 'SAHP'] },
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
        { key: 'department', label: 'Department', type: 'select', opts: ['', 'LSPD', 'BCSO', 'SAHP'] },
        { key: 'date', label: 'Date', type: 'text' },
      ] },
      { id: 'op', label: 'Operation Details', type: 'kv', fields: [
        { key: 'subject', label: 'Subject / Target', type: 'text', person: true },
        { key: 'location', label: 'Location / Area', type: 'text' },
        { key: 'start_time', label: 'Start Date / Time', type: 'text' },
        { key: 'end_time', label: 'End Date / Time', type: 'text' },
      ] },
      { id: 'method', label: 'Method of Surveillance', type: 'kv', fields: [
        { key: 'method', label: 'Method', type: 'checks', opts: ['Static / Stationary', 'Vehicle (Mobile)', 'Foot', 'Electronic / Camera', 'Aerial', 'Other'] },
      ] },
      { id: 'observations', label: 'Observations / Activity Log', type: 'textarea', key: 'observations' },
      { id: 'persons', label: 'Persons Observed', type: 'grid', cols: [
        { key: 'name', label: 'Name / Description', type: 'text', person: true },
        { key: 'role', label: 'Role / Activity', type: 'text' },
      ] },
      { id: 'vehicles', label: 'Vehicles Observed', type: 'grid', cols: [
        { key: 'vehicle', label: 'Vehicle', type: 'text' },
        { key: 'plate', label: 'Plate', type: 'text' },
        { key: 'notes', label: 'Notes', type: 'text' },
      ] },
      { id: 'media', label: 'Photos / Recordings Captured (attach references)', type: 'textarea', key: 'media_refs' },
      { id: 'assessment', label: 'Assessment / Findings', type: 'textarea', key: 'assessment' },
      { id: 'sign', label: 'Review', type: 'kv', fields: [
        { key: 'detective_sig', label: 'Detective Signature', type: 'text' },
        { key: 'supervisor_sig', label: 'Supervisor Signature', type: 'text' },
      ] },
    ],
  },
}

/** The fillable CID forms ARE the canonical report templates (persons.js:31). */
export interface ReportTemplate {
  id: string
  icon: string
  isDefault: boolean
  name: string
  schema: FormSchema
}

const TEMPLATE_META: { id: string; icon: string; isDefault?: boolean }[] = [
  { id: 'cid_investigative_report', icon: '📄', isDefault: true },
  { id: 'raid_seizure', icon: '💰' },
  { id: 'uc_operation', icon: '🕶️' },
  { id: 'arrest_warrant', icon: '⚖️' },
  { id: 'search_warrant', icon: '🔍' },
  { id: 'wiretap_warrant', icon: '📡' },
  { id: 'subpoena', icon: '📜' },
  { id: 'surveillance_report', icon: '🛰️' },
]

export const REPORT_TEMPLATES: ReportTemplate[] = TEMPLATE_META
  .filter((t) => FORM_SCHEMAS[t.id])
  .map((t) => ({ id: t.id, icon: t.icon, isDefault: !!t.isDefault, name: FORM_SCHEMAS[t.id].title, schema: FORM_SCHEMAS[t.id] }))

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

export function reportTitle(r: ReportLike): string {
  const tpl = tplById(r.template)
  const base = tpl ? tpl.name : 'Report'
  if (r.kind === 'supplemental') return `${base} — Supplemental #${r.seq}`
  if (r.kind === 'followup') return `${base} — Follow-up #${r.seq}`
  return base
}

export function reportKindLabel(r: ReportLike): string {
  return r.kind === 'initial' ? 'Initial' : r.kind === 'supplemental' ? `Supplemental #${r.seq}` : `Follow-up #${r.seq}`
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

/** Flatten a filled form to text for exports (drive.js:125-136). */
export function formToText(schema: FormSchema, values: FormValues): string {
  const V = values || {}
  const lines: string[] = []
  schema.sections.forEach((s) => {
    lines.push(s.label.toUpperCase())
    if (s.type === 'note') lines.push(s.text)
    else if (s.type === 'textarea') lines.push(String(V[s.key] ?? '') || '—')
    else if (s.type === 'kv') {
      s.fields.forEach((f) => {
        const rawVal = V[f.key]
        const val = Array.isArray(rawVal) ? rawVal.join(', ') : String(rawVal ?? '')
        lines.push(`${f.label}: ${val || '—'}`)
      })
    } else {
      const rows = Array.isArray(V[s.id]) ? (V[s.id] as Record<string, string>[]) : []
      lines.push(s.cols.map((c) => c.label).join(' | '))
      if (!rows.length) lines.push('—')
      rows.forEach((r) => lines.push(s.cols.map((c) => r[c.key] || '').join(' | ')))
    }
    lines.push('')
  })
  return lines.join('\n')
}

/** Pull the person-flagged field values out of a filled form (reports.js:144). */
export function collectPersonNames(schema: FormSchema, fields: FormValues): string[] {
  const names: string[] = []
  schema.sections.forEach((s) => {
    if (s.type === 'kv') s.fields.forEach((f) => { if (f.person && fields[f.key]) names.push(String(fields[f.key]).trim()) })
    else if (s.type === 'grid') {
      const rows = Array.isArray(fields[s.id]) ? (fields[s.id] as Record<string, string>[]) : []
      rows.forEach((row) => s.cols.forEach((col) => { if (col.person && row[col.key]) names.push(String(row[col.key]).trim()) }))
    }
  })
  return names.filter(Boolean)
}

/** Soft "required field" check before a report is sealed (reports.js:383-398).
 *  Non-blocking: the modal shows gaps but lets the officer finalize anyway. */
export function reportFinalizeGaps(r: ReportLike): string[] {
  const tpl = tplById(r.template)
  if (!tpl) return []
  const f = parseFormValues(r.fields)
  const keys = new Set<string>()
  tpl.schema.sections.forEach((s) => {
    if (s.type === 'kv') s.fields.forEach((fl) => keys.add(fl.key))
    else if (s.type === 'textarea') keys.add(s.key)
  })
  const has = (k: string) => {
    const v = f[k]
    return Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== ''
  }
  const gaps: string[] = []
  if (keys.has('case_number') && !has('case_number')) gaps.push('Case number')
  if ((keys.has('affiant') || keys.has('detective')) && !(has('affiant') || has('detective'))) gaps.push('Affiant / detective')
  if (keys.has('date') && !has('date')) gaps.push('Date')
  const primary = ['probable_cause', 'narrative', 'investigation_details', 'necessity'].filter((k) => keys.has(k))
  if (primary.length && !primary.some(has)) gaps.push('Narrative / probable cause')
  return gaps
}

/** Reusable boilerplate snippets for report prose (reports.js:115-121). */
export const REPORT_SNIPPETS: { label: string; text: string }[] = [
  { label: 'Miranda', text: 'The subject was advised of their Miranda rights per Article 31 and indicated understanding prior to questioning. ' },
  { label: 'Chain of custody', text: 'All recovered items were photographed, sealed, and entered into the chain of custody at the time of recovery. ' },
  { label: 'Positive ID', text: 'A positive identification was made via comparison of the subject against their DOC booking photograph. ' },
  { label: 'Vehicle stop', text: 'A traffic stop was initiated; the operator was identified via the vehicle registration return. ' },
  { label: 'Use of force', text: 'No use of force was applied during this contact. ' },
]

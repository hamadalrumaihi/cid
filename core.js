/* core.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";


    /* ============================================================ 1. DATA MODELS ============================================================ */

    const BUREAUS = {
      LSB: { name: 'Los Santos Bureau', prefix: 'LSB', dept: 'LSPD' },
      BCB: { name: 'Blaine County Bureau', prefix: 'BCB', dept: 'BCSO' },
      SAB: { name: 'State Bureau', prefix: 'SAB', dept: 'SAHP' },
    };
    // Case numbers are typed manually by the detective (format BUREAU-NUMBER,
    // e.g. SAB-900023), validated + uniqueness-enforced at the UI and DB. No
    // auto-generation (removed in the 2026-06-17 patch).
    // Map a reporting department to its bureau key / ticket rename prefix
    const DEPT_ROUTING = {
      LSPD: { bureau: 'LSB', rename: 'losangeles' },
      BCSO: { bureau: 'BCB', rename: 'blaine' },
      SAHP: { bureau: 'SAB', rename: 'state' },
    };

    // Raid compensation brackets (the "given" percentage), then sub-split
    const BRACKETS = [
      { min: 1000000,  max: 2499999,  pct: 60, label: '$1.00M – $2.49M' },
      { min: 2500000,  max: 7499999,  pct: 50, label: '$2.50M – $7.49M' },
      { min: 7500000,  max: 14999999, pct: 40, label: '$7.50M – $14.99M' },
      { min: 15000000, max: 24999999, pct: 30, label: '$15.0M – $24.99M' },
      { min: 25000000, max: Infinity, pct: 20, label: '$25.0M +' },
    ];
    const COMP_SPLIT = { 'Primary Detective': 0.5, 'Supporting Units': 0.3, 'Confidential Informants': 0.2 };

    /* ---- Narcotics registry ---- */
    // Narcotics are now Supabase-backed; DRUGS is a normalized read cache (see fetchDrugs).
    let DRUGS = [];

    /* ---- Weapon benches ---- */
    // Ballistics now Supabase-backed; caches populated by fetchBenches/fetchFootprints.
    let BENCHES_CACHE = [];
    let FOOTPRINTS = [];

    /* ---- Personnel ---- */
    // Personnel/media/commendations are Supabase-backed caches (see fetch* in modules).
    let COMMENDATIONS = [];
    let MEDIA = [];
    let mediaFilter = 'all';

    /* ---- M.O. detector dictionary (config) — matching runs against live mo_profiles ---- */
    const MO_DICT = {
      names:    ['tre', 'marcus', 'dion', 'lena', 'omar', 'reyes', 'ghost', 'switch'],
      entry:    ['lockpick', 'lockpicked', 'thermite', 'breach', 'breached', 'crowbar', 'kicked', 'drilled', 'cut the lock'],
      vehicles: ['black cid suv', 'unmarked burrito', 'burrito', 'black suv', 'sandking', 'motorcycle', 'getaway sedan', 'unmarked'],
      weapons:  ['class 2 ap pistol', 'ap pistol', 'class 3', 'rifle', 'smg', 'switch', 'auto-sear', 'shotgun', '9mm', '5.56'],
    };


    /* ---- Documents library (documents table) ----
       The Drive tab was retired: SOPs/rosters/gang intel surface on their own
       tabs, report templates live in the case Reports tab (FORM_SCHEMAS), and
       case-linked paperwork lists under the case detail. DOCS stays the shared
       client cache for all of those surfaces. */
    let DOCS = []; // Supabase-backed cache of the documents library
    // Confidential Informant risk matrix — alert flag when violent felonies >= 8 (live read-only view)
    const CI_MATRIX = [
      { id: 'CI-0093', handler: 'Sr. Det. Hale', exclusive: true, agreement: 'Active', felonies: 4 },
      { id: 'CI-0088', handler: 'Det. Och', exclusive: true, agreement: 'Active', felonies: 7 },
      { id: 'CI-0071', handler: 'Det. Reyes', exclusive: false, agreement: 'Pending', felonies: 9 },
      { id: 'CI-0066', handler: 'Det. Voss', exclusive: true, agreement: 'Expired', felonies: 2 },
    ];

    /* ---- Fillable CID forms ----
     * Structured schemas for the standard paperwork. A `documents` row becomes a
     * fillable form when content.view==='form' OR its name matches a schema below.
     * Section types: 'kv' (label/field rows), 'grid' (repeatable table), 'textarea', 'note'.
     * Field types: text | date | money | select (opts) | textarea. Saved as content.values. */
    const FORM_DEPT_OPTS = ['', 'LSPD', 'BCSO', 'SAHP'];
    const FORM_BUREAU_OPTS = ['', 'Los Santos Bureau', 'Blaine County Bureau', 'State Bureau', 'Joint Task Force'];
    const FORM_SCHEMAS = {
      'cid_investigative_report': {
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
      'raid_seizure': {
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
      'uc_operation': {
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
      'arrest_warrant': {
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
      'search_warrant': {
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
      'wiretap_warrant': {
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
      'subpoena': {
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
      'surveillance_report': {
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
    };
    // Map a documents row → its form schema id (by explicit content.form, or by name).
    const FORM_NAME_MAP = {
      'cid investigative report': 'cid_investigative_report',
      'raid seizure value distribution & allocation form': 'raid_seizure',
      'uc operation activity report': 'uc_operation',
      'undercover operation activity report': 'uc_operation',
      'arrest warrant request': 'arrest_warrant',
      'search warrant affidavit': 'search_warrant',
      'wiretap / electronic surveillance request': 'wiretap_warrant',
      'electronic surveillance request': 'wiretap_warrant',
      'subpoena — records / witness': 'subpoena',
      'subpoena': 'subpoena',
      'surveillance report': 'surveillance_report',
    };
    function formSchemaIdFor(doc) {
      if (!doc) return null;
      if (doc.content && doc.content.view === 'form' && doc.content.form && FORM_SCHEMAS[doc.content.form]) return doc.content.form;
      const base = String(doc.name || '').replace(/\.[a-z0-9]+$/i, '').trim().toLowerCase();
      if (FORM_NAME_MAP[base]) return FORM_NAME_MAP[base];
      // Tolerate per-subject/per-case prefixes or suffixes (e.g. "Drake - Raid
      // Seizure …") by matching a known form title anywhere in the document name.
      for (const key in FORM_NAME_MAP) { if (base.includes(key)) return FORM_NAME_MAP[key]; }
      return null;
    }

    /* ============================================================ 2. UTILITIES ============================================================ */
    const $  = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const el = (tag, attrs = {}, html = '') => {
      const n = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') n.className = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      });
      if (html) n.innerHTML = html;
      return n;
    };
    const fmtUSD = (n) => '$' + Math.round(n).toLocaleString('en-US');
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const escapeHTML = esc;   // alias: feature files use escapeHTML; both share one scope
    // Allow-list URL schemes for href/src so a user-supplied URL can't smuggle a
    // javascript:/data:/vbscript: payload into a link or iframe. Returns '' if unsafe.
    // Always combine with esc() for attribute-quote safety: esc(safeUrl(url)).
    const safeUrl = (u) => {
      const s = String(u == null ? '' : u).trim();
      if (!s) return '';
      for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) < 32) return ''; }
      const m = s.match(/^([a-z][a-z0-9+.-]*):/i);
      if (m) { const sch = m[1].toLowerCase(); return (sch === 'http' || sch === 'https' || sch === 'mailto') ? s : ''; }
      return s; // protocol-relative (//host) or relative path is safe
    };
    // Shared double-submit guard: blocks a second click on a record-saving button
    // while the first click's async handler is still in flight, preventing
    // duplicate inserts. Targets primary submit buttons only (id ends in -save,
    // plus a small allow-list / opt-in [data-guard-submit]); steppers, add-row,
    // pagination and other rapid-click controls are untouched. The flag is set
    // synchronously so a fast second click is suppressed before its onclick runs.
    (function () {
      const isSubmit = (b) => b && b.id && (/-save$/.test(b.id) || b.id === 'gen' || b.id === 'fb-add' || b.hasAttribute('data-guard-submit'));
      document.addEventListener('click', function (e) {
        const b = e.target && e.target.closest && e.target.closest('button');
        if (!isSubmit(b)) return;
        if (b.dataset.busy === '1') { e.preventDefault(); e.stopImmediatePropagation(); return; }
        b.dataset.busy = '1';
        // Fallback release covers multi-statement saves (e.g. the report save runs
        // several sequential DB calls); a successful save closes its modal, which
        // clears the flag immediately (see closeModal), so this is only a backstop.
        setTimeout(function () { b.dataset.busy = '0'; }, 4000);
      }, true);
    })();
    // One-click copy to clipboard with a confirmation toast.
    function copyText(text, label) {
      const t = String(text == null ? '' : text);
      const done = () => toast((label || 'Value') + ' copied', 'success');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => toast(t, 'info'));
      else { try { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (e) { toast(t, 'info'); } }
    }
    const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;
    // Debounce: collapse rapid input/sync bursts into one call (perf, #10).
    const debounce = (fn, ms = 200) => { let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); }; };

    // Map raw Postgres/PostgREST error text to human copy so DB internals never
    // surface in a toast (audit M6: "permission denied for table profiles"). Any
    // message without a known pattern passes through unchanged.
    function humanizeError(message) {
      const s = String(message == null ? '' : message);
      if (/permission denied|row-level security|not authorized|violates .*(policy|row-level)/i.test(s)) return 'You don’t have permission to do that.';
      if (/duplicate key|already exists|23505/i.test(s)) return 'That already exists — use a unique value.';
      if (/foreign key|23503|still referenced/i.test(s)) return 'That’s still linked to other records and can’t be removed yet.';
      if (/\bJWT\b|not authenticated|invalid (token|claim)|token .*expired/i.test(s)) return 'Your session expired — please sign in again.';
      if (/could not find .*column|column .* does not exist|schema cache|PGRST\d+/i.test(s)) return 'Something didn’t save correctly — please retry.';
      if (/fetch|network|failed to load|connection/i.test(s)) return 'Connection problem — check your network and retry.';
      return s;
    }
    function toast(message, type = 'info') {
      message = humanizeError(message);
      const colors = { info:'border-blue-500/30 bg-blue-500/10 text-blue-200', success:'border-emerald-500/30 bg-emerald-500/10 text-emerald-200', warn:'border-amber-500/30 bg-amber-500/10 text-amber-200', danger:'border-rose-500/30 bg-rose-500/10 text-rose-200' };
      const icons = { info:'ℹ️', success:'✅', warn:'⚠️', danger:'🚨' };
      const t = el('div', { class: `flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-glow backdrop-blur-xl ${colors[type] || colors.info}` }, `<span>${icons[type] || icons.info}</span><span>${esc(message)}</span>`);
      t.style.animation = 'popIn .25s cubic-bezier(.16,.84,.44,1) both';
      $('#toast-root').appendChild(t);
      setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; setTimeout(() => t.remove(), 300); }, 3400);
    }

    // Undo-able toast: shows an "Undo" button for `ms` (default 6s); clicking it
    // runs onUndo, otherwise it self-dismisses.
    function undoToast(message, onUndo, ms = 6000) {
      const t = el('div', { class: 'flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-100 shadow-glow backdrop-blur-xl' });
      t.innerHTML = `<span>↩️</span><span>${esc(message)}</span><button class="undo-btn ml-1 rounded-md border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/20">Undo</button>`;
      t.style.animation = 'popIn .25s cubic-bezier(.16,.84,.44,1) both';
      $('#toast-root').appendChild(t);
      let done = false;
      const dismiss = () => { if (done) return; done = true; t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; setTimeout(() => t.remove(), 300); };
      t.querySelector('.undo-btn').onclick = () => { dismiss(); try { onUndo(); } catch (e) {} };
      setTimeout(dismiss, ms);
    }
    // Delete a row (or array of rows) with a 6s "Undo" that re-inserts them,
    // preserving id so references survive. `opts.after` runs after the delete and
    // after a successful undo. For cascade parents, pass `opts.children` —
    // [{table, column}] of ON DELETE CASCADE children keyed by the FK to the
    // parent id — and they're snapshotted before the delete and re-inserted (after
    // the parents) on undo, so undo stays honest. Returns true if the delete stuck.
    async function deleteWithUndo(table, rows, opts) {
      opts = opts || {};
      const list = Array.isArray(rows) ? rows.slice() : [rows];
      if (!list.length) return false;
      // Every destructive path warns before acting. Callers that already showed
      // their own uiConfirm pass noConfirm to avoid a double prompt.
      if (!opts.noConfirm && !(await uiConfirm('Delete ' + (opts.label || 'this record') + '? Restorable via Undo for a short while.', { confirmText: 'Delete' }))) return false;
      const ids = list.map((r) => r.id);
      // Snapshot cascade children before the DB removes them with the parent. If a
      // snapshot query fails, ABORT — deleting anyway would cascade-wipe children we
      // could no longer restore (the raw builder returns {error}, never throws).
      const childSnap = [];
      for (const spec of (opts.children || [])) {
        const r = await DB().from(spec.table).select('*').in(spec.column, ids);
        if (r.error) { toast('Delete aborted — could not snapshot related ' + spec.table + ' for undo.', 'danger'); return false; }
        childSnap.push({ table: spec.table, rows: r.data || [] });
      }
      // Snapshot ON DELETE SET NULL references (rows that point AT the deleted row via
      // an FK Postgres will null). Undo re-inserts the parent but can't recover these
      // unless we re-apply the FK value afterwards.
      const refSnap = [];
      for (const spec of (opts.setNullRefs || [])) {
        const r = await DB().from(spec.table).select('id,' + spec.column).in(spec.column, ids);
        if (r.error) { toast('Delete aborted — could not snapshot ' + spec.table + ' references for undo.', 'danger'); return false; }
        refSnap.push({ table: spec.table, column: spec.column, rows: r.data || [] });
      }
      const deleted = [];
      let ok = 0, fail = 0;
      for (const row of list) { const r = await DB().remove(table, row.id); if (r && r.error) fail++; else { ok++; deleted.push(row); } }
      if (typeof opts.after === 'function') opts.after();
      const one = list.length === 1;
      const noun = opts.label || (one ? 'Item' : list.length + ' items');
      if (fail && !ok) { toast(noun + ' delete failed', 'danger'); return false; }
      undoToast((one ? noun + ' deleted' : ok + ' deleted') + (fail ? ' · ' + fail + ' failed' : ''), async () => {
        // Re-insert ONLY the parents that were actually deleted (never-deleted rows
        // would duplicate-key), then their snapshotted children; count both honestly.
        let rok = 0, rfail = 0;
        for (const row of deleted) { const r = await DB().insert(table, row); if (r && r.error) rfail++; else rok++; }
        let ckid = 0, cfail = 0;
        for (const snap of childSnap) for (const kid of snap.rows) { const r = await DB().insert(snap.table, kid); if (r && r.error) cfail++; else ckid++; }
        // Re-apply nulled-out FK references now that the parent row exists again.
        for (const ref of refSnap) for (const rr of ref.rows) { const r = await DB().update(ref.table, rr.id, { [ref.column]: rr[ref.column] }); if (r && r.error) cfail++; else ckid++; }
        const allOk = rfail === 0 && cfail === 0;
        toast(allOk ? (one ? noun + ' restored' : rok + ' restored')
          : 'Restored ' + rok + ' of ' + deleted.length + (childSnap.length ? ' (+' + ckid + ' related' + (cfail ? ', ' + cfail + ' failed' : '') + ')' : ''),
          (rok || ckid) ? (allOk ? 'success' : 'warn') : 'danger');
        if (typeof opts.after === 'function') opts.after();
      });
      return true;
    }

    const Store = {
      KEY: 'cid-portal-v3', OLD: 'cid-portal-v2', _d: null,
      _load() {
        if (this._d) return this._d;
        try {
          this._d = JSON.parse(localStorage.getItem(this.KEY));
          if (!this._d) { // one-time migration from v2
            const old = JSON.parse(localStorage.getItem(this.OLD) || 'null');
            this._d = old || {};
            if (old) localStorage.setItem(this.KEY, JSON.stringify(this._d));
          }
        } catch (e) { this._d = {}; }
        return this._d;
      },
      get(k, f = null) { const v = this._load()[k]; return v === undefined ? f : v; },
      set(k, v) { const d = this._load(); d[k] = v; try { localStorage.setItem(this.KEY, JSON.stringify(d)); } catch (e) {} },
    };

    /* ============================================================ BULK IMPORT (CSV / JSON) ============================================================
     * One-time per-module importer. Accepts a JSON array of objects, or CSV with
     * a header row; maps to an allow-listed column set, coerces types, batch-inserts
     * via Supabase (RLS still applies), and reports inserted/skipped counts. */
    function parseCSVText(text) {
      const rows = []; let i = 0, field = '', row = [], inQ = false;
      while (i < text.length) {
        const c = text[i];
        if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
        else if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
        i++;
      }
      if (field.length || row.length) { row.push(field); rows.push(row); }
      const clean = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
      if (clean.length < 2) return [];
      const headers = clean[0].map((h) => h.trim());
      return clean.slice(1).map((r) => { const o = {}; headers.forEach((h, idx) => { o[h] = r[idx] !== undefined ? r[idx] : ''; }); return o; });
    }
    function importRows(rawText, cfg) {
      const t = (rawText || '').trim();
      if (!t) return { rows: [], skipped: 0, error: 'Nothing to import.' };
      let raw;
      if (t[0] === '[' || t[0] === '{') {
        try { raw = JSON.parse(t); } catch (e) { return { rows: [], skipped: 0, error: 'Invalid JSON: ' + e.message }; }
        if (!Array.isArray(raw)) raw = [raw];
      } else raw = parseCSVText(t);
      const num = cfg.num || [], bool = cfg.bool || [], lower = cfg.lower || [], upper = cfg.upper || [];
      let skipped = 0; const rows = [];
      raw.forEach((src) => {
        if (!src || typeof src !== 'object') { skipped++; return; }
        const o = {};
        cfg.allow.forEach((k) => {
          if (src[k] === undefined || src[k] === null) return;
          let v = src[k];
          if (typeof v === 'string') v = v.trim();
          if (v === '') return;
          if (num.includes(k)) { v = Number(String(v).replace(/[^0-9.\-]/g, '')); if (isNaN(v)) return; }
          else if (bool.includes(k)) v = /^(1|true|yes|y)$/i.test(String(v));
          else if (lower.includes(k)) v = String(v).toLowerCase();
          else if (upper.includes(k)) v = String(v).toUpperCase();
          o[k] = v;
        });
        if (cfg.coerce) { const r = cfg.coerce(o, src); if (r === null) { skipped++; return; } }
        if ((cfg.required || []).some((k) => o[k] === undefined || o[k] === '')) { skipped++; return; }
        rows.push(o);
      });
      return { rows, skipped, error: null };
    }
    function openImportModal(cfg) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      const cols = cfg.allow.map((k) => k + ((cfg.required || []).includes(k) ? '*' : '')).join(', ');
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Import ${esc(cfg.label)}</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-2 text-xs text-slate-400">Paste a <b>JSON array</b> of objects or <b>CSV</b> with a header row, or pick a <b>.csv / .xlsx</b> file. Columns (<span class="text-rose-300">*</span> required): <span class="font-mono text-blue-300">${esc(cols)}</span></p>
        <button id="imp-tpl" class="mb-2 text-xs font-semibold text-blue-300 transition hover:text-blue-200">⬇ Download CSV template</button>
        <input id="imp-file" type="file" accept=".csv,.json,.xlsx,.xls,text/csv,application/json" class="mb-2 block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-white" />
        <textarea id="imp-text" rows="9" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-badge-500" placeholder='[{"key":"value"}]   — or —   col1,col2&#10;val1,val2'></textarea>
        <div id="imp-msg" class="mt-2 text-xs text-slate-400"></div>
        <button id="imp-go" class="mt-4 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Import</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      const ta = node.querySelector('#imp-text'), msg = node.querySelector('#imp-msg');
      const tpl = node.querySelector('#imp-tpl'); if (tpl) tpl.onclick = () => { if (typeof downloadCsv === 'function') downloadCsv(String(cfg.label).replace(/\s+/g, '-') + '-template.csv', cfg.allow, []); };
      node.querySelector('#imp-file').onchange = (e) => {
        const f = e.target.files[0]; if (!f) return;
        const isXlsx = /\.(xlsx|xls)$/i.test(f.name);
        if (isXlsx) {
          if (!window.XLSX) { msg.innerHTML = '<span class="text-rose-300">Excel library unavailable (offline). Use CSV/JSON.</span>'; return; }
          const rd = new FileReader();
          rd.onload = () => { try { const wb = window.XLSX.read(rd.result, { type: 'array' }); ta.value = window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]); msg.textContent = 'Loaded sheet "' + wb.SheetNames[0] + '" — review then Import.'; } catch (err) { msg.innerHTML = '<span class="text-rose-300">Could not read workbook.</span>'; } };
          rd.readAsArrayBuffer(f);
        } else if (/^(image|video|audio)\//.test(f.type)) {
          // A media file read as text becomes mojibake — steer to the right tool.
          msg.innerHTML = '<span class="text-amber-300">That looks like a media file (' + esc(f.type) + '), not CSV/JSON data. To add photos, open the case → <b>Evidence → Upload photos</b>.</span>';
          e.target.value = '';
        } else { const rd = new FileReader(); rd.onload = () => { ta.value = rd.result; }; rd.readAsText(f); }
      };
      node.querySelector('#imp-go').onclick = async () => {
        const { rows, skipped, error } = importRows(ta.value, cfg);
        if (error) { msg.innerHTML = '<span class="text-rose-300">' + esc(error) + '</span>'; return; }
        if (!rows.length) { msg.innerHTML = '<span class="text-amber-300">No valid rows found' + (skipped ? ' (' + skipped + ' skipped)' : '') + '.</span>'; return; }
        // Skip duplicates on a natural key (name where present) — checked against existing
        // rows AND within the pasted batch. RLS-scoped, so the dup check only sees rows the user can.
        const dedupe = cfg.dedupe || (cfg.allow.includes('name') ? 'name' : (cfg.required || [])[0]);
        let toInsert = rows, dupes = 0;
        if (dedupe) {
          msg.textContent = 'Checking for duplicates…';
          const seen = new Set();
          try { (await DB().list(cfg.table, { select: dedupe, eq: cfg.dedupeFilter || undefined })).forEach((r) => { if (r[dedupe] != null) seen.add(String(r[dedupe]).trim().toLowerCase()); }); } catch (e) {}
          toInsert = rows.filter((o) => {
            const key = o[dedupe] != null ? String(o[dedupe]).trim().toLowerCase() : '';
            if (!key) return true;
            if (seen.has(key)) { dupes++; return false; }
            seen.add(key); return true;
          });
        }
        if (!toInsert.length) { msg.innerHTML = '<span class="text-amber-300">Nothing new to import — ' + dupes + ' duplicate(s) skipped.</span>'; return; }
        msg.textContent = 'Importing ' + toInsert.length + ' row(s)…';
        const res = await DB().insert(cfg.table, toInsert);
        if (res.error) { msg.innerHTML = '<span class="text-rose-300">Import failed: ' + esc(res.error.message) + '</span>'; return; }
        closeModal();
        const parts = ['Imported ' + toInsert.length + ' ' + cfg.label];
        if (dupes) parts.push(dupes + ' duplicate' + (dupes > 1 ? 's' : '') + ' skipped');
        if (skipped) parts.push(skipped + ' invalid skipped');
        toast(parts.join(' · '), 'success');
        if (typeof cfg.after === 'function') cfg.after();
      };
      openModal(node);
    }
    // Inject an "⇪ Import" button next to a module's primary "+ New" action; visibility mirrors it.
    function wireImport(anchorSel, cfg) {
      const a = $(anchorSel); if (!a) return null;
      const btn = el('button', { class: 'imp-btn rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10' }, '⇪ Import');
      btn.addEventListener('click', () => openImportModal(cfg));
      a.parentNode.insertBefore(btn, a);
      const sync = () => btn.classList.toggle('hidden', a.classList.contains('hidden') || !(DB() && DB().canEdit()));
      sync();
      try { new MutationObserver(sync).observe(a, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
      return btn;
    }
    function wireAllImports() {
      const I = [
        ['#case-new',      { table:'cases',                label:'cases',         allow:['case_number','title','bureau','status','summary','area'], required:['case_number'], upper:['bureau'], lower:['status'], after:fetchCases }],
        ['#person-new',    { table:'persons',              label:'persons',       allow:['name','alias','dob','ccw','vch','felony_count','status','notes'], required:['name'], bool:['ccw'], num:['vch','felony_count'], after:fetchPersons }],
        ['#add-gang',      { table:'gangs',                label:'gangs',         allow:['name','colors','threat_level','notes'], required:['name'], lower:['threat_level'], after:fetchGangs }],
        ['#narc-new',      { table:'narcotics',            label:'narcotics',     allow:['name','classification','icon','popularity','street_price','wholesale_price'], required:['name'], num:['popularity','street_price','wholesale_price'], after:fetchDrugs }],
        ['#add-place',     { table:'places',               label:'places',        allow:['name','type','area','notes'], required:['name','type'], lower:['type'], after:fetchPlaces }],
        ['#bench-new',     { table:'ballistics_benches',   label:'benches',       allow:['bench_type','name','tier','heat'], required:['bench_type','name'], lower:['bench_type'], after:fetchBenches }],
        ['#footprint-new', { table:'ballistic_footprints', label:'footprints',    allow:['signature','weapon'], required:['signature'], after:fetchFootprints }],
        ['#new-tracker',   { table:'trackers',             label:'trackers',      allow:['tracker_code','target','duration_hours'], required:['tracker_code','target'], num:['duration_hours'], after:fetchTrackers }],
        ['#new-ticket-btn',{ table:'tickets',              label:'tickets',       allow:['ticket_code','source','description','reported_dept'], required:['ticket_code'], after:fetchTickets }],
        ['#add-commend',   { table:'commendations',        label:'commendations', allow:['title','recipient_name','note','icon','tint'], required:['title'], after:fetchCommendations }],
        ['#add-media',     { table:'media',                label:'media',         allow:['title','type','external_url','kind'], required:['title','type'], lower:['type'], after:fetchMedia }],
      ];
      I.forEach(([sel, cfg]) => wireImport(sel, cfg));
    }

    /* ============================================================ 3. ROUTER / SHELL ============================================================ */
    const PAGE_META = {
      command:    { title: 'Central Command', sub: 'Case assignment & operational hub' },
      cases:      { title: 'Case Files', sub: 'Live case records, evidence & chain-of-custody' },
      persons:    { title: 'Persons', sub: 'Suspects & persons of interest (live)' },
      narcotics:  { title: 'Narcotics Intelligence', sub: 'Drug processing & market analytics' },
      ballistics: { title: 'Ballistics & Logistics', sub: 'Weapon benches & component tracing' },
      personnel:  { title: 'Personnel & Roster', sub: 'Roster & digital commendations' },
      media:      { title: 'Media Vault', sub: 'Universal media-to-case intake (all detectives)' },
      modus:      { title: 'M.O. Detector', sub: 'Tactical profiling & cross-reference' },
      gangs:      { title: 'Gangs & Turf', sub: 'Organizations, ranks, properties & territory' },
      places:     { title: 'Criminal Places', sub: 'Locations & production processes' },
      network:    { title: 'Relationship Network', sub: 'Gangs, members & properties as a navigable graph' },
      reports:    { title: 'Report Generation', sub: 'Template-driven reports & supplemental chains' },
      rico:       { title: 'RICO Builder', sub: 'Enterprise & predicate-act element tracker' },
      penal:      { title: 'Penal Code', sub: 'San Andreas statutes, sentences & fines' },
      sops:       { title: 'Standard Operating Procedures', sub: 'Division policy & reference library, managed by command staff' },
      records:    { title: 'CID Records', sub: 'Live shared division records' },
      announce:   { title: 'Announcements', sub: 'Division-wide notices from command staff' },
      'case-files': { title: 'Case Files — Attachments', sub: 'Files uploaded and linked per case' },
      heatmap:    { title: 'Commander Heatmap', sub: 'Gang turf, places, raids & case concentration by area' },
      inbox:      { title: 'My Desk', sub: 'Everything waiting on you — sign-off, overdue cases, mentions & draft reports' },
      shifts:     { title: 'Weekly Shift Reports', sub: 'Detective activity rolled up to bureau leadership' },
      audit:      { title: 'Audit Log', sub: 'Division-wide action history (owner-only)' },
      feedback:   { title: 'Feedback', sub: 'Suggest a feature or report a bug' },
      vehicles:   { title: 'Vehicle Registry', sub: 'Plates, owners & cross-case matches' },
      bolo:       { title: 'BOLO Board', sub: 'At-large subjects — be on the lookout' },
    };

    // ---- Two-tier navigation: 5 top-level categories, each a set of tool tabs ----
    // The router still navigates to leaf tabs (hash, onEnter, #view-* unchanged);
    // categories + the sub-tab strip are a grouping layer over the same leaves.
    const NAV_CATEGORIES = [
      { id: 'command',   label: 'Command',      tabs: ['command', 'announce', 'heatmap', 'personnel'] },
      { id: 'cases',     label: 'Cases',        tabs: ['cases', 'case-files', 'rico'] },
      { id: 'intel',     label: 'Intelligence', tabs: ['persons', 'bolo', 'gangs', 'places', 'vehicles', 'network', 'narcotics', 'ballistics', 'modus', 'media', 'records'] },
      { id: 'reference', label: 'Reference',    tabs: ['penal', 'sops'] },
      { id: 'oversight', label: 'Oversight',    tabs: ['inbox', 'shifts', 'audit'] },
    ];
    const TAB_LABEL = {
      command: 'Dashboard', announce: 'Announcements', heatmap: 'Heatmap', personnel: 'Roster & Commendations',
      cases: 'Case Files', 'case-files': 'Attachments', rico: 'RICO',
      persons: 'Persons', bolo: 'BOLO Board', gangs: 'Gangs', places: 'Places', vehicles: 'Vehicles', network: 'Network', narcotics: 'Narcotics', ballistics: 'Ballistics', modus: 'M.O. Detector', media: 'Media Vault',
      records: 'Records', penal: 'Penal Code', sops: 'SOPs & Library', inbox: 'My Desk', shifts: 'Shift Reports', audit: 'Audit Log',
    };
    const TAB_CATEGORY = {}; NAV_CATEGORIES.forEach((c) => c.tabs.forEach((t) => { TAB_CATEGORY[t] = c.id; }));
    const CAT_DEFAULT = {}; NAV_CATEGORIES.forEach((c) => { CAT_DEFAULT[c.id] = c.tabs[0]; });
    const ROUTE_ENTER = {
      cases: 'onEnterCases',
      penal: 'onEnterPenal',
      sops: 'onEnterSops',
      persons: 'onEnterPersons',
      gangs: 'onEnterGangs',
      narcotics: 'onEnterNarcotics',
      places: 'onEnterPlaces',
      network: 'onEnterNetwork',
      ballistics: 'onEnterBallistics',
      rico: 'renderRico',
      command: 'onEnterCommand',
      personnel: 'onEnterPersonnel',
      media: 'onEnterMedia',
      modus: 'onEnterModus',
      announce: 'onEnterAnnounce',
      'case-files': 'onEnterCaseFiles',
      heatmap: 'onEnterHeatmap',
      inbox: 'onEnterInbox',
      shifts: 'onEnterShifts',
      audit: 'onEnterAudit',
      feedback: 'onEnterFeedback',
      vehicles: 'onEnterVehicles',
      bolo: 'onEnterBolo',
    };
    function runRouteEnter(tab) {
      const hook = ROUTE_ENTER[tab];
      if (!hook) return;
      const fn = window[hook];
      if (typeof fn === 'function') fn();
    }
    function activeRoute() {
      const view = $('.view.active');
      return view && view.id ? view.id.replace(/^view-/, '') : Store.get('tab', 'command');
    }
    // Audit log is owner-only (server-enforced by the audit_sel RLS policy).
    // This gates the UI to match: the sub-tab is hidden and the view shows a
    // restricted notice for anyone who isn't the owner.
    const AUDIT_OWNER_ID = '25466146-c512-4497-8ee8-88cbf3b1d22d';
    const isAuditOwner = () => { const me = DB() && DB().me; return !!(me && me.active && me.id === AUDIT_OWNER_ID); };
    /* ---- Reusable data table (audit M-series: sort + sticky + paginate + copy) --
       Renders `opts.rows` into `mount`. The caller keeps sort/page state and
       passes it in; the table calls opts.onState({sortKey,sortDir,page}) on any
       header/pager click so the caller re-renders. Columns:
         { key, label, cell(row)->html, sortVal(row)->comparable?, mono, nowrap,
           align:'right'?, tint? }.  Density: 'comfortable' (default) | 'compact'. */
    function copyId(full) {
      const s = String(full == null ? '' : full);
      if (!s) return '';
      return '<button type="button" class="copy-chip text-slate-500 hover:text-white" data-copy="' + esc(s) + '" title="Copy full ID: ' + esc(s) + '">' + esc(s.slice(0, 8)) + '</button>';
    }
    // One delegated clipboard handler for every [data-copy] chip in the app.
    document.addEventListener('click', (e) => {
      const c = e.target.closest && e.target.closest('[data-copy]'); if (!c) return;
      const v = c.getAttribute('data-copy'); if (!v) return;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(() => toast('Copied to clipboard', 'info')).catch(() => {});
    });
    function renderDataTable(mount, opts) {
      if (!mount) return;
      const columns = opts.columns || [];
      const pageSize = opts.pageSize || 50;
      const rowPad = opts.density === 'compact' ? 'py-1' : 'py-2';
      const rows = opts.rows || [];
      const sortKey = opts.sortKey || null;
      const sortDir = opts.sortDir === 'desc' ? 'desc' : 'asc';
      const scol = columns.find((c) => c.key === sortKey && c.sortVal);
      let sorted = rows;
      if (scol) {
        const dir = sortDir === 'asc' ? 1 : -1;
        sorted = rows.slice().sort((a, b) => {
          let av = scol.sortVal(a), bv = scol.sortVal(b);
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
          av = String(av == null ? '' : av); bv = String(bv == null ? '' : bv);
          return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * dir;
        });
      }
      const total = sorted.length;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(Math.max(0, opts.page || 0), pages - 1);
      const start = page * pageSize;
      const slice = sorted.slice(start, start + pageSize);
      const arrow = (c) => c.key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : (c.sortVal ? ' <span class="opacity-30">↕</span>' : '');
      const thBase = 'sticky top-0 z-10 bg-ink-900 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400';
      const head = '<tr>' + columns.map((c) => '<th class="' + thBase + (c.sortVal ? ' cursor-pointer select-none hover:text-white' : '') + (c.align === 'right' ? ' text-right' : '') + '"' + (c.sortVal ? ' data-sort="' + esc(c.key) + '"' : '') + '>' + esc(c.label) + arrow(c) + '</th>').join('') + '</tr>';
      const body = slice.length ? slice.map((r) => '<tr>' + columns.map((c) => {
        const cls = 'px-3 ' + rowPad + (c.mono ? ' font-mono' : '') + (c.nowrap ? ' whitespace-nowrap' : '') + (c.align === 'right' ? ' text-right' : '') + ' ' + (c.tint || 'text-slate-200');
        return '<td class="' + cls + '">' + c.cell(r) + '</td>';
      }).join('') + '</tr>').join('') : '<tr><td colspan="' + columns.length + '" class="px-3 py-4 text-center text-slate-500">' + esc(opts.empty || 'Nothing to show.') + '</td></tr>';
      const from = total ? start + 1 : 0, to = Math.min(start + pageSize, total);
      const pager = pages > 1
        ? '<div class="mt-2 flex items-center justify-between text-[11px] text-slate-400"><span>Showing ' + from + '–' + to + ' of ' + total + '</span><span class="flex items-center gap-1"><button class="dt-prev rounded border border-white/10 bg-white/5 px-2 py-1' + (page === 0 ? ' pointer-events-none opacity-40' : ' hover:bg-white/10') + '">Prev</button><span class="px-1 tabular-nums">Page ' + (page + 1) + ' / ' + pages + '</span><button class="dt-next rounded border border-white/10 bg-white/5 px-2 py-1' + (page >= pages - 1 ? ' pointer-events-none opacity-40' : ' hover:bg-white/10') + '">Next</button></span></div>'
        : '<div class="mt-2 text-[11px] text-slate-500">' + total + ' row' + (total === 1 ? '' : 's') + '</div>';
      mount.innerHTML = '<div class="max-h-[28rem] overflow-auto rounded-lg border border-white/5"><table class="w-full text-left text-xs"><thead>' + head + '</thead><tbody class="divide-y divide-white/5">' + body + '</tbody></table></div>' + pager;
      const restate = (patch) => { if (typeof opts.onState === 'function') opts.onState(Object.assign({ sortKey: sortKey, sortDir: sortDir, page: page }, patch)); };
      mount.querySelectorAll('th[data-sort]').forEach((th) => { const k = th.getAttribute('data-sort'); th.onclick = () => { if (k === sortKey) restate({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' }); else restate({ sortKey: k, sortDir: 'asc', page: 0 }); }; });
      const pv = mount.querySelector('.dt-prev'); if (pv) pv.onclick = () => restate({ page: Math.max(0, page - 1) });
      const nx = mount.querySelector('.dt-next'); if (nx) nx.onclick = () => restate({ page: Math.min(pages - 1, page + 1) });
    }
    function renderSubtabs(activeTab, cat) {
      const bar = $('#subtabs'); if (!bar) return;
      const def = NAV_CATEGORIES.find((c) => c.id === cat);
      if (!def) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
      bar.classList.remove('hidden');
      bar.innerHTML = def.tabs.filter((t) => t !== 'audit' || isAuditOwner()).map((t) => {
        const on = t === activeTab;
        return `<button class="subtab flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${on ? 'bg-blue-500/15 text-white shadow-[inset_0_-2px_0_0_#3b82f6]' : 'text-slate-400 hover:bg-white/5 hover:text-white'}" data-tab="${t}" role="tab" aria-selected="${on}">${esc(TAB_LABEL[t] || t)}</button>`;
      }).join('');
      bar.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.tab)));
    }

    function navigate(tab) {
      if (!PAGE_META[tab]) tab = 'command';
      // Guard against tabs that have PAGE_META but no rendered <section> (e.g. the
      // legacy 'reports' leaf whose authoring now lives inside the case detail):
      // without a view, every .view would deactivate and the shell would blank —
      // and that blank state would persist across reloads via the saved tab.
      if (!$('#view-' + tab)) tab = 'cases';
      $$('.view').forEach((v) => v.classList.remove('active'));
      const view = $('#view-' + tab); if (view) view.classList.add('active');
      const cat = TAB_CATEGORY[tab] || 'command';
      $$('.nav-cat').forEach((b) => { const on = b.dataset.cat === cat; b.classList.toggle('active', on); on ? b.setAttribute('aria-current','page') : b.removeAttribute('aria-current'); });
      $$('.bnav-link').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
      renderSubtabs(tab, cat);
      // Standalone owner-only leaf (Feedback) sits outside the category model:
      // highlight its own nav button and hide the sub-tab strip when active.
      const fbBtn = $('#nav-feedback'); if (fbBtn) fbBtn.classList.toggle('active', tab === 'feedback');
      if (tab === 'feedback') { $$('.nav-cat').forEach((b) => { b.classList.remove('active'); b.removeAttribute('aria-current'); }); const sb = $('#subtabs'); if (sb) { sb.classList.add('hidden'); sb.innerHTML = ''; } }
      const m = PAGE_META[tab]; if (m) { $('#page-title').textContent = m.title; $('#page-subtitle').textContent = m.sub; }
      if (location.hash !== '#' + tab) { try { history.replaceState(null, '', '#' + tab); } catch (e) {} }
      Store.set('tab', tab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      closeDrawer();
      runRouteEnter(tab);
    }
    $$('.nav-cat, .bnav-link').forEach((b) => b.addEventListener('click', () => navigate(CAT_DEFAULT[b.dataset.cat] || 'command')));

    function openDrawer() { $('#sidebar').classList.remove('-translate-x-full'); $('#sidebar-backdrop').classList.remove('hidden'); document.body.classList.add('overflow-hidden','lg:overflow-auto'); $('#menu-toggle').setAttribute('aria-expanded','true'); }
    function closeDrawer() { if (isDesktop()) return; $('#sidebar').classList.add('-translate-x-full'); $('#sidebar-backdrop').classList.add('hidden'); document.body.classList.remove('overflow-hidden','lg:overflow-auto'); $('#menu-toggle').setAttribute('aria-expanded','false'); }
    function wireDrawer() {
      $('#menu-toggle').addEventListener('click', openDrawer);
      $('#menu-close').addEventListener('click', closeDrawer);
      $('#sidebar-backdrop').addEventListener('click', closeDrawer);
      window.matchMedia('(min-width: 1024px)').addEventListener('change', (e) => {
        if (e.matches) { $('#sidebar').classList.remove('-translate-x-full'); $('#sidebar-backdrop').classList.add('hidden'); document.body.classList.remove('overflow-hidden','lg:overflow-auto'); $('#menu-toggle').setAttribute('aria-expanded','false'); }
        else { $('#sidebar').classList.add('-translate-x-full'); }
      });
    }
    function applyCollapse(c) {
      document.body.classList.toggle('nav-collapsed', c);
      const b = $('#collapse-toggle'); b.setAttribute('aria-pressed', String(c)); b.setAttribute('aria-label', c ? 'Expand sidebar' : 'Collapse sidebar');
      $('#collapse-icon').innerHTML = c ? '<path d="m9 18 6-6-6-6"/>' : '<path d="m15 18-6-6 6-6"/>';
      Store.set('collapsed', c);
    }
    /* ---- Appearance: per-device accent + density (stored in Store) -------- */
    function applyAppearance() {
      const acc = Store.get('accent', 'amber'), den = Store.get('density', 'comfortable');
      if (document.body) document.body.dataset.accent = acc;
      document.documentElement.dataset.density = den;
    }
    function openAppearanceModal() {
      const acc = Store.get('accent', 'amber'), den = Store.get('density', 'comfortable');
      const ACCENTS = [['blue', 'Electric Blue', '#3b82f6'], ['amber', 'Amber', '#f59e0b'], ['emerald', 'Emerald', '#10b981'], ['rose', 'Rose', '#f43f5e']];
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">🎨 Appearance</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Accent</p>
        <div class="grid grid-cols-2 gap-2">${ACCENTS.map(([k, label, hex]) => `<button class="ap-accent flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${k === acc ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}" data-k="${k}"><span class="h-3.5 w-3.5 rounded-full" style="background:${hex}"></span>${label}</button>`).join('')}</div>
        <p class="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">Density</p>
        <div class="grid grid-cols-2 gap-2">${[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([k, label]) => `<button class="ap-density rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${k === den ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}" data-k="${k}">${label}</button>`).join('')}</div>
        <p class="mt-4 text-[11px] text-slate-500">Saved on this device. Applies instantly.</p>`;
      node.querySelector('.close-x').onclick = closeModal;
      $$('.ap-accent', node).forEach((b) => b.onclick = () => { Store.set('accent', b.dataset.k); applyAppearance(); closeModal(); openAppearanceModal(); });
      $$('.ap-density', node).forEach((b) => b.onclick = () => { Store.set('density', b.dataset.k); applyAppearance(); closeModal(); openAppearanceModal(); });
      openModal(node);
    }
    function wireAppearance() {
      applyAppearance();
      const b = $('#appearance-btn'); if (b) b.addEventListener('click', openAppearanceModal);
    }
    function wireCollapse() { applyCollapse(Store.get('collapsed', false)); $('#collapse-toggle').addEventListener('click', () => applyCollapse(!document.body.classList.contains('nav-collapsed'))); }

    /* ============================================================ 4. MODAL ENGINE (focus-trapped) ============================================================ */
    let lastFocused = null, modalOnClose = null;
    // dismissible:false → a tap on the backdrop no longer closes the modal (use the
    // × button). onClose → handler the × / Escape route through (e.g. step back to the
    // parent page instead of exiting); defaults to a full close.
    function openModal(node, { wide = false, dismissible = true, onClose = null, slide = false } = {}) {
      closeModal(); lastFocused = document.activeElement; modalOnClose = onClose;
      const backdrop = el('div', { class: `modal-backdrop fixed inset-0 z-50 flex bg-ink-950/80 backdrop-blur-sm ${slide ? 'items-stretch justify-end' : 'items-center justify-center p-4'}` });
      // slide → right-anchored full-height drawer; otherwise the centered card.
      const card = el('div', { class: slide
        ? 'modal-card modal-slide relative ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-white/10 bg-ink-850 shadow-glow'
        : `modal-card relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-ink-850 shadow-glow`, role:'dialog', 'aria-modal':'true', tabindex:'-1' });
      card.appendChild(node); backdrop.appendChild(card);
      if (dismissible) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) requestCloseModal(); });
      $('#modal-root').appendChild(backdrop); document.body.classList.add('overflow-hidden');
      document.addEventListener('keydown', modalKey);
      (focusable(card)[0] || card).focus();
    }
    function focusable(c) { return $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', c).filter((n) => n.offsetParent !== null); }
    function modalKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); requestCloseModal(true); return; }
      if (e.key !== 'Tab') return;
      const card = $('.modal-card'); if (!card) return; const f = focusable(card); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function closeModal() {
      modalOnClose = null; Guard.clear();
      // Release any double-submit guard flag: a successful save closes its modal,
      // so the button is free again immediately rather than waiting on the fallback.
      $$('[data-busy="1"]').forEach((b) => b.dataset.busy = '0');
      $('#modal-root').innerHTML = ''; document.removeEventListener('keydown', modalKey);
      if ($('#sidebar').classList.contains('-translate-x-full') || isDesktop()) document.body.classList.remove('overflow-hidden');
      if (lastFocused && document.contains(lastFocused)) lastFocused.focus(); lastFocused = null;
    }
    // Phones/tablets: the soft keyboard doesn't resize the fixed modal, so a
    // field low in a tall form can be hidden behind it. Re-center the focused
    // field once the keyboard has animated in.
    document.addEventListener('focusin', (e) => {
      if (window.innerWidth >= 1024) return;
      const t = e.target;
      if (!t || !t.closest || !t.closest('.modal-card')) return;
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) {} }, 250);
    });

    /* ---- Never-lose-work layer (Cluster 1) -----------------------------------
     * Drafts: namespaced localStorage stash for in-progress forms/chat, so a
     * crash or accidental close can be recovered. Guard: a single "is the open
     * editor dirty?" check that gates modal close (× / Esc / backdrop) and the
     * browser unload, prompting before unsaved work is lost. */
    const Drafts = {
      _k(key) { return 'cid-draft:' + key; },
      save(key, data) { try { localStorage.setItem(this._k(key), JSON.stringify({ at: Date.now(), data })); } catch (e) {} },
      load(key) { try { return JSON.parse(localStorage.getItem(this._k(key)) || 'null'); } catch (e) { return null; } },
      clear(key) { try { localStorage.removeItem(this._k(key)); } catch (e) {} },
    };
    const Guard = {
      _fn: null,
      set(fn) { this._fn = typeof fn === 'function' ? fn : null; },
      clear() { this._fn = null; },
      dirty() { try { return !!(this._fn && this._fn()); } catch (e) { return false; } },
      confirmDiscard() { return this.dirty() ? uiConfirm('You have unsaved changes here. Leave without saving?', { title: 'Unsaved changes', confirmText: 'Discard changes', cancelText: 'Keep editing' }) : Promise.resolve(true); },
    };
    window.addEventListener('beforeunload', (e) => { if (Guard.dirty()) { e.preventDefault(); e.returnValue = ''; } });
    // Guarded close used by the backdrop / Esc paths: prompt if dirty, else close.
    function requestCloseModal(viaOnClose) {
      Guard.confirmDiscard().then((ok) => { if (!ok) return; Guard.clear(); if (viaOnClose && modalOnClose) modalOnClose(); else closeModal(); });
    }

    /* ---- Calm-under-pressure layer (Cluster 7) -------------------------------
     * A persistent "offline — reconnecting…" banner so a dropped connection reads
     * as a known state rather than a broken app, and withRetry() for one silent
     * retry on transient (network-blip) failures. */
    function setupConnectionWatch() {
      const show = (online) => {
        let b = document.getElementById('conn-banner');
        if (online) { if (b) b.remove(); return; }
        if (!b) { b = el('div', { id: 'conn-banner', class: 'fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-full border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-200 shadow-glow backdrop-blur' }, '⚠ Offline — reconnecting…'); document.body.appendChild(b); }
      };
      window.addEventListener('online', () => { show(true); toast('Back online', 'success'); });
      window.addEventListener('offline', () => show(false));
      if (!navigator.onLine) show(false);
    }
    async function withRetry(fn, tries = 2, delay = 600) {
      let last;
      for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, delay * (i + 1))); } }
      throw last;
    }
    window.CIDApp = window.CIDApp || {};
    window.CIDApp.activeRoute = activeRoute;
    window.CIDApp.isRouteActive = function (tab) { return activeRoute() === tab; };
    window.CIDApp.enterActiveRoute = function () { runRouteEnter(activeRoute()); };
    window.CIDApp.realtime = window.CIDApp.realtime || {
      _tables: new Set(),
      subscribeOnce(table, handler) {
        if (!dbReady() || !table || this._tables.has(table)) return;
        DB().subscribe(table, handler);
        this._tables.add(table);
      },
      reset() {
        this._tables.clear();
      },
    };

    /* Themed replacements for the native window.confirm / window.prompt (which
     * can't be styled). Promise-based; rendered as a top-layer overlay (inline
     * z-index above the modal at z-50) so they stack over an open modal without
     * disturbing it. uiConfirm → boolean; uiPrompt → string|null (matches native). */
    function uiDialog({ title, message, input, confirmText, cancelText, danger }) {
      return new Promise((resolve) => {
        const back = el('div', { class: 'fixed inset-0 flex items-center justify-center bg-ink-950/70 p-4 backdrop-blur-sm', style: 'z-index:70' });
        const card = el('div', { class: 'rounded-2xl border border-white/10 bg-ink-850 p-6 shadow-glow', style: 'width:100%;max-width:26rem', role: 'dialog', 'aria-modal': 'true' });
        const okCls = danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-gradient-to-r from-badge-500 to-blue-700 hover:brightness-110';
        card.innerHTML = `
          ${title ? `<h3 class="text-base font-bold text-white">${esc(title)}</h3>` : ''}
          ${message ? `<p class="mt-1 whitespace-pre-wrap text-sm text-slate-300">${esc(message)}</p>` : ''}
          ${input ? `<input id="ui-dlg-input" class="mt-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="${esc(input.placeholder || '')}" value="${esc(input.value || '')}" />` : ''}
          <div class="mt-5 flex justify-end gap-2">
            <button id="ui-dlg-cancel" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">${esc(cancelText || 'Cancel')}</button>
            <button id="ui-dlg-ok" class="rounded-lg ${okCls} px-4 py-2 text-sm font-semibold text-white shadow-glow transition">${esc(confirmText || (input ? 'OK' : 'Confirm'))}</button>
          </div>`;
        back.appendChild(card); document.body.appendChild(back);
        const inp = card.querySelector('#ui-dlg-input');
        const finish = (val) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(val); };
        const cancelVal = input ? null : false;
        const okFn = () => finish(input ? (inp ? inp.value.trim() : '') : true);
        // Capture-phase + stopImmediatePropagation so this dialog's keys win over the
        // underlying modal's Escape handler (which would otherwise close the modal too).
        // Enter on the focused Cancel button cancels rather than confirming a destructive action.
        const onKey = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(cancelVal); }
          else if (e.key === 'Enter') {
            e.preventDefault(); e.stopImmediatePropagation();
            if (document.activeElement === card.querySelector('#ui-dlg-cancel')) finish(cancelVal); else okFn();
          }
        };
        card.querySelector('#ui-dlg-ok').onclick = okFn;
        card.querySelector('#ui-dlg-cancel').onclick = () => finish(cancelVal);
        back.addEventListener('mousedown', (e) => { if (e.target === back) finish(cancelVal); });
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => { (inp || card.querySelector('#ui-dlg-ok')).focus(); }, 30);
      });
    }
    const uiConfirm = (message, opts = {}) => uiDialog({ message, title: opts.title || 'Please confirm', confirmText: opts.confirmText || 'Confirm', cancelText: opts.cancelText, danger: opts.danger !== false });
    const uiPrompt = (message, opts = {}) => uiDialog({ message, title: opts.title || '', input: { placeholder: opts.placeholder || '', value: opts.value || '' }, confirmText: opts.confirmText || 'OK' });



    /* ---- Tactical icon set (Control Panel restyle) --------------------------
       Static inline-SVG micro-icons replacing emoji on the chrome, case board
       and Command dashboard. Stroke follows currentColor so existing text-color
       utilities tint them; aria-hidden because every use sits beside a label. */
    const T_ICONS = {
      command: '<path d="M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z"/>',
      cases: '<path d="M3 7.5a2 2 0 0 1 2-2h4.2l1.8 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
      intel: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6"/>',
      drive: '<path d="M3.5 5h17v4h-17z"/><path d="M5.5 9v9.5h13V9"/><path d="M10 13h4"/>',
      oversight: '<path d="M12 3.5l7.5 2.8v5.4c0 4.2-3 7.3-7.5 8.8-4.5-1.5-7.5-4.6-7.5-8.8V6.3z"/><path d="M9 12l2 2 4-4"/>',
      feedback: '<path d="M20.5 12a8.5 8.5 0 1 0-3.3 6.7l3.3 1.3-1-3.4a8.4 8.4 0 0 0 1-4.6z"/>',
      user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 19.5c1.3-3.4 3.9-5 7-5s5.7 1.6 7 5"/>',
      folder: '<path d="M3 7.5a2 2 0 0 1 2-2h4.2l1.8 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
      pen: '<path d="M4.5 19.5l3.8-.9L19.5 7.4l-2.9-2.9L5.4 15.7z"/>',
      scale: '<path d="M12 4.5v15M6.5 6.5h11"/><path d="M6.5 6.5l-2.5 5.5a3 3 0 0 0 5 0zM17.5 6.5L15 12a3 3 0 0 0 5 0z"/>',
      timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2M9.5 3.5h5"/>',
      cold: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>',
      cash: '<rect x="3" y="7" width="18" height="10" rx="1"/><circle cx="12" cy="12" r="2.6"/>',
      capsule: '<rect x="3.5" y="8.5" width="17" height="7" rx="3.5"/><path d="M12 8.5v7"/>',
      crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 3.5V7M12 17v3.5M3.5 12H7M17 12h3.5"/>',
      users: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c1-2.8 3-4.2 5.5-4.2s4.5 1.4 5.5 4.2"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M16.8 14.6c2 .3 3.3 1.6 4 3.9"/>',
    };
    function tIcon(name, size) {
      const d = T_ICONS[name]; if (!d) return '';
      const s = size || 18;
      return `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    }

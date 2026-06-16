-- CID General "Drive" — seed the shared documents library.
-- Folders are presentation config in the client (FOLDER_META); each file is a
-- documents row keyed by (folder, name). The CI Risk Matrix is a live read-only
-- view (content.view = 'matrix') rendered client-side from static CI data.

-- One document per (folder, name): lets the client upsert/replace safely.
alter table public.documents
  add constraint documents_folder_name_key unique (folder, name);

insert into public.documents (folder, name, kind, content, modified_label) values
-- ===== Joint Task Force Cases =====
('Joint Task Force Cases', 'JTF-Master-Index.sheet', 'sheet',
 '{"cols":["Operation","Bureaus","Status","Lead"],"rows":[["Operation Crosshair","LSB + SAB","Active","Lt. A. Stone"],["Operation Dry Harbor","BCB + SAB","Planning","Lt. D. Honce"]]}'::jsonb,
 '16/03/2026'),
('Joint Task Force Cases', 'Operation Crosshair (active).doc', 'doc',
 jsonb_build_object('body', $body$JOINT TASK FORCE — OPERATION CROSSHAIR
Classification: Restricted // CID Eyes Only

OBJECTIVE
Dismantle the cross-bureau Class 3 weapons pipeline linking the Vagos Cartel cell (Sandy Shores CNC foundry) to Los Santos street distribution.

PARTICIPATING BUREAUS
- Los Santos Bureau (LSB) — street interdiction
- State Bureau (SAB) — corridor surveillance

CURRENT STATUS
Active. Tracker authorization on file (see [SAB] Case-9000007). Awaiting raid window.

NEXT STEPS
1. Confirm dual-signature tracker still in window.
2. Coordinate simultaneous entry with BCSO SWAT.
3. Stage seizure inventory team for compensation log.$body$),
 '16/03/2026'),
('Joint Task Force Cases', 'Inter-Agency MOU.pdf', 'pdf',
 jsonb_build_object('body', $body$MEMORANDUM OF UNDERSTANDING
Between the Los Santos Police Department, Blaine County Sheriff's Office, and San Andreas Highway Patrol

1. PURPOSE
This MOU governs the joint operation of the Criminal Investigation Division (CID) as a multi-agency body.

2. JURISDICTION
Each bureau retains primary jurisdiction within its territory. Joint Task Force cases supersede single-bureau assignment where activity crosses boundaries.

3. EVIDENCE SHARING
All structured records and media are maintained in the shared CID system under role-based access control.

4. CHAIN OF COMMAND
The Director holds ultimate authority. Tracker deployments require dual written authorization (Director + Deputy Director).$body$),
 '16/03/2026'),
-- ===== Blaine County Bureau Cases =====
('Blaine County Bureau Cases', '[BCB] Case-2000001 — Sandy Shores Meth.doc', 'doc',
 jsonb_build_object('body', $body$CRIMINAL INVESTIGATION DIVISION — CASE FILE
Case Number: [BCB] Case-2000001
Bureau: Blaine County Bureau
Status: OPEN
Lead Detective: Det. Oliver Och (915)

SUMMARY
Meth lab operation discovered in a Sandy Shores trailer. Blue Meth production tied to the Vagos Cartel cell.

NARRATIVE
Initial tip received via Odyssey ticket-20089. Surveillance confirmed precursor deliveries (pseudoephedrine, anhydrous ammonia).

EVIDENCE LOG
- Photographs of trailer exterior (see Evidence Vault).
- Precursor purchase records.

DISPOSITION
Pending raid coordination under Operation Crosshair.$body$),
 '16/03/2026'),
('Blaine County Bureau Cases', '[BCB] Case-2000004 (COLD).doc', 'doc',
 jsonb_build_object('body', $body$CRIMINAL INVESTIGATION DIVISION — CASE FILE
Case Number: [BCB] Case-2000004
Bureau: Blaine County Bureau
Status: COLD (2 weeks inactive)
Lead Detective: Det. D. Reyes (930)

SUMMARY
Grapeseed moonshine distribution ring. Leads exhausted; reclassified COLD pending new intelligence.

REOPEN CRITERIA
New informant testimony or seizure linking the Paleto Bay distribution node.$body$),
 '02/03/2026'),
('Blaine County Bureau Cases', 'BCB Case Log.sheet', 'sheet',
 '{"cols":["Case #","Subject","Status","Lead","Updated"],"rows":[["[BCB] Case-2000001","Sandy Shores Meth","Open","Och","16/03/2026"],["[BCB] Case-2000004","Grapeseed Moonshine","Cold","Reyes","02/03/2026"]]}'::jsonb,
 '16/03/2026'),
-- ===== Los Santos Bureau Cases =====
('Los Santos Bureau Cases', '[LSB] Case-1000001 — Legion Sq Trafficking.doc', 'doc',
 jsonb_build_object('body', $body$CRIMINAL INVESTIGATION DIVISION — CASE FILE
Case Number: [LSB] Case-1000001
Bureau: Los Santos Bureau
Status: OPEN
Lead Detective: Det. Oliver Och (915)

SUMMARY
Suspect trafficking Class 3 weapons near Legion Square. Linked to Davis Ballas distribution.

NARRATIVE
Originating Odyssey ticket-10040. Ballistic footprint BLSTC-49-B recovered (auto-sear pistol).

EVIDENCE LOG
- Dashcam — Legion Sq stop (Evidence Vault).
- Recovered filed-serial pistol.

DISPOSITION
Active investigation.$body$),
 '16/03/2026'),
('Los Santos Bureau Cases', '[LSB] Case-1000044 — Vinewood Arson (CLOSED).doc', 'doc',
 jsonb_build_object('body', $body$CRIMINAL INVESTIGATION DIVISION — CASE FILE
Case Number: [LSB] Case-1000044
Bureau: Los Santos Bureau
Status: CLOSED
Lead Detective: Det. Oliver Och (915)

SUMMARY
Vinewood arson ring dismantled. Three arrests, prosecution complete.

DISPOSITION
Closed — convictions secured. Distinguished Service Medal awarded.$body$),
 '10/02/2026'),
('Los Santos Bureau Cases', 'LSB Case Log.sheet', 'sheet',
 '{"cols":["Case #","Subject","Status","Lead","Updated"],"rows":[["[LSB] Case-1000001","Legion Sq Trafficking","Open","Och","16/03/2026"],["[LSB] Case-1000007","Davis Ballas Network","Cold","Hale","01/03/2026"],["[LSB] Case-1000044","Vinewood Arson","Closed","Och","10/02/2026"]]}'::jsonb,
 '16/03/2026'),
-- ===== State Bureau Cases =====
('State Bureau Cases', '[SAB] Case-9000001 — Corridor Interdiction.doc', 'doc',
 jsonb_build_object('body', $body$CRIMINAL INVESTIGATION DIVISION — CASE FILE
Case Number: [SAB] Case-9000001
Bureau: State Bureau
Status: OPEN
Lead Detective: Det. L. Voss (948)

SUMMARY
Highway trafficking corridor interdiction on Route 68. CNC Class 3 rifles in transit.

EVIDENCE LOG
- Ballistic footprint BLSTC-12-C (5.56 chamber mark).$body$),
 '16/03/2026'),
('State Bureau Cases', '[SAB] Case-9000007 — Tracker Auth.doc', 'doc',
 jsonb_build_object('body', $body$CRIMINAL INVESTIGATION DIVISION — TRACKER AUTHORIZATION
Case Number: [SAB] Case-9000007
Bureau: State Bureau

AUTHORIZATION
GPS tracker deployment on target vehicle (Black Sandking, plate 4XYZ).
Director Signature: A. Stone
Deputy Director Signature: R. Cole
Duration: 18 hours.

Per SOP Title 7 — no single-person approval permitted.$body$),
 '15/03/2026'),
('State Bureau Cases', 'SAB Case Log.sheet', 'sheet',
 '{"cols":["Case #","Subject","Status","Lead","Updated"],"rows":[["[SAB] Case-9000001","Corridor Interdiction","Open","Voss","16/03/2026"],["[SAB] Case-9000007","Tracker Authorization","Open","Stone","15/03/2026"]]}'::jsonb,
 '16/03/2026'),
-- ===== Archives =====
('Archives', 'Closed Cases 2025.zip', 'zip',
 '{"items":["[LSB] Case-0900012 — Del Perro Smuggling (CLOSED).doc","[BCB] Case-1900003 — Cattle Theft Ring (CLOSED).doc","2025 Annual Disposition Report.pdf"]}'::jsonb,
 '16/03/2026'),
('Archives', 'Retired CI Records.zip', 'zip',
 '{"items":["CI-0042 (deceased).doc","CI-0051 (relocated).doc","Handler Reassignment Log 2025.sheet"]}'::jsonb,
 '16/03/2026'),
-- ===== Case assignment Help??!? =====
('Case assignment Help??!?', 'HOW TO ASSIGN A CASE (read me).doc', 'doc',
 jsonb_build_object('body', $body$HOW TO ASSIGN A CASE — QUICK GUIDE

1. Open Central Command → Odyssey Ticket Intake Queue.
2. Click "Process Ticket".
3. STEP 1 — Confirm jurisdiction (LSPD / BCSO / SAHP). If misrouted, the ticket auto-renames (e.g. ticket-2001 → blaine-2001).
4. STEP 2 — A 7-digit case number is generated from the bureau prefix:
     Los Santos  → [LSB] Case-1000001
     Blaine      → [BCB] Case-2000001
     State       → [SAB] Case-9000001
5. STEP 3 — Discord channel + Drive folder are provisioned automatically.

QUESTIONS? Ping a Bureau Lead in #cid-command.$body$),
 '17/03/2026'),
('Case assignment Help??!?', 'Prefix cheat-sheet.sheet', 'sheet',
 '{"cols":["Bureau","Prefix","Starting #"],"rows":[["Los Santos Bureau","LSB","1000001"],["Blaine County Bureau","BCB","2000001"],["State Bureau","SAB","9000001"]]}'::jsonb,
 '17/03/2026'),
-- ===== Confidential Informant =====
('Confidential Informant', 'CI Risk Matrix (live).sheet', 'sheet',
 '{"view":"matrix"}'::jsonb,
 '18/03/2026'),
('Confidential Informant', 'Gang Fact Sheet (template).sheet', 'sheet',
 '{"cols":["Name","Rank","Threat Level","CCW","VCH"],"rows":[["Marcus \"Tre\" Bell","Shot Caller","High","Yes","7"],["Dion Park","Lieutenant","High","Yes","5"],["Lena Cruz","Enforcer","Medium","Yes","3"],["Omar Reyes","Soldier","Low","No","1"]]}'::jsonb,
 '18/03/2026'),
-- ===== Dirty $- Tracker =====
('Dirty $- Tracker', 'Seizure Ledger FY26.sheet', 'sheet',
 '{"cols":["Date","Case","Item","Street Value","Disposition"],"rows":[["14/03/2026","[LSB] Case-1000001","Class 3 rifle x2","$48,000","Booked"],["11/03/2026","[BCB] Case-2000001","Blue Meth (2kg)","$2,400,000","Booked"]]}'::jsonb,
 '19/03/2026'),
('Dirty $- Tracker', 'Distribution Bracket Calc.sheet', 'sheet',
 '{"cols":["Net Seizure Range","% Given"],"rows":[["$1.00M – $2.49M","60%"],["$2.50M – $7.49M","50%"],["$7.50M – $14.99M","40%"],["$15.0M – $24.99M","30%"],["$25.0M +","20%"]]}'::jsonb,
 '19/03/2026'),
-- ===== Forms =====
('Forms', 'Detective Incident Report (template).doc', 'doc',
 jsonb_build_object('body', $body$DETECTIVE / INCIDENT REPORT  (FORM CID-IR-01)

Case Number: __________________________
Date / Time of Incident: ______________
Reporting Detective: Oliver Och   Callsign: 915   Unit: MCB

SUSPECT INFORMATION
Name: ________________________________
DOB: ____________   Known Affiliation: ____________

MIRANDA: [ ] Read & Acknowledged   [ ] Waived — Yes   [ ] Waived — No

INCIDENT NARRATIVE
______________________________________________________________
______________________________________________________________

STATEMENT OF UNDERSTANDING
I declare under penalty of perjury that the foregoing is true and correct, authored solely by me without AI generation.

Signature: ____________________   Date: ____________$body$),
 '16/03/2026'),
('Forms', 'UC Activity Log (template).doc', 'doc',
 jsonb_build_object('body', $body$UNDERCOVER (UC) ACTIVITY LOG  (FORM CID-UC-02)   — CONFIDENTIAL

Report Type: ____________   UC Officer: ____________   Operation Code: ____________

CONTACTS & INTERACTIONS
Time | Subject | Interaction | Outcome
____ | _______ | __________ | _______

INTELLIGENCE / EVIDENCE OBSERVED
______________________________________________________________

THREAT LEVEL: [ ] Low   [ ] Medium   [ ] High$body$),
 '16/03/2026'),
-- ===== Resources =====
('Resources', 'Penal Code Quick Reference.pdf', 'pdf',
 jsonb_build_object('body', $body$SAN ANDREAS PENAL CODE — QUICK REFERENCE

WEAPONS
- Class 1: Civilian small arms.
- Class 2: Submachine guns, restricted.
- Class 3: Military rifles — prohibited; trafficking is a felony.

NARCOTICS
- Manufacture/distribution of controlled substances: felony.
- Precursor possession with intent: chargeable.

RICO PREDICATES (sample)
Drug trafficking, extortion, money laundering, witness tampering, murder-for-hire, illegal firearms trafficking.

Note: ≥2 predicate acts within 10 years required to establish a pattern.$body$),
 '16/03/2026'),
('Resources', 'Radio Callsign Directory.sheet', 'sheet',
 '{"cols":["Callsign","Officer","Unit"],"rows":[["915","Oliver Och","MCB"],["922","Marcus Hale","Narcotics"],["930","Dana Reyes","Ballistics"],["901","Aria Stone","Command"],["903","Derek Honce","Command"],["948","Lena Voss","Tech Ops"]]}'::jsonb,
 '16/03/2026'),
-- ===== SOP/Training =====
('SOP/Training', 'CID SOP v4.2.pdf', 'pdf',
 jsonb_build_object('body', $body$CRIMINAL INVESTIGATION DIVISION — STANDARD OPERATING PROCEDURE (v4.2)

TITLE 1 — INTRODUCTION
Mission: investigate serious, organized and cross-jurisdictional crime. Strict anti-AI / anti-plagiarism hiring clause.

TITLE 2 — CHAIN OF COMMAND
Director › Deputy Director › Bureau Leads › Senior Detectives › Detectives.

TITLE 5 — CASE MANAGEMENT
Open vs. Cold (2 weeks inactive) vs. Closed. Major incidents documented within 12 hours.

TITLE 6 & 7 — CI & SURVEILLANCE
Max 6 CIs per handler; ineligible at ≥8 violent felonies. Tracker deployment requires written Director + Deputy authorization — no single-person approval.$body$),
 '16/03/2026'),
('SOP/Training', 'New Detective Onboarding.doc', 'doc',
 jsonb_build_object('body', $body$NEW DETECTIVE ONBOARDING

WEEK 1
- Read CID SOP v4.2 (Resources / SOP-Training).
- Set radio callsign with the "CID" prefix.
- Shadow a Senior Detective.

WEEK 2
- Process a live Odyssey ticket end-to-end.
- File your first Incident Report.

REMEMBER
Plainclothes is standard. Tactical loadouts require Bureau Lead approval.$body$),
 '16/03/2026')
on conflict (folder, name) do nothing;

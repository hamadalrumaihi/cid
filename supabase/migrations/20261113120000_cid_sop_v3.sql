-- ============================================================================
-- 20261113120000_cid_sop_v3.sql
-- The active CID Standard Operating Procedure — content correction, version 3
-- ============================================================================
--
-- What this is
-- ------------
-- One document changes: the ACTIVE Criminal Investigation Division (CID)
-- Standard Operating Procedure (guides.slug = 'cid-standard-operating-
-- procedure', version 2, effective 2026-08-03). Its body is replaced with a
-- corrected text and its version becomes 3. The superseded June 2026 SOP
-- ('cid-sop-superseded-2026-06') is NOT touched — it is the historical record
-- and stays exactly as migrated.
--
-- Why a migration and not the editor
-- ----------------------------------
-- The corrected text is policy. It belongs in a reviewed diff, applied once,
-- with the previous wording preserved where a restore can reach it — which is
-- what guide_revisions is for. The editor's guide_section_upsert does not take
-- a revision on a body edit (it is for drafting); this migration does, twice:
-- the version-2 text as it stood BEFORE the change, and the version-3 text
-- with the change summary AFTER it. Nothing is lost and both are restorable
-- through guide_revision_restore.
--
-- What changed in the text — and what deliberately did not
-- ---------------------------------------------------------
--   · Title 1C now describes the division as it is: the Major Crimes Bureau,
--     the Street Crimes Bureau, the compartmentalized Special Investigations
--     Bureau, and JTF as a temporary joint-case designation. The LSPD / BCSO /
--     SAHP jurisdiction structure is gone from the active text. Case
--     identifiers issued under it are historical and are not rewritten.
--   · The mission statement no longer names a Firearms & Drug Enforcement
--     bureau that does not exist. Its intent is unchanged.
--   · Title 2C's clauses are numbered 2C.1 / 2C.2 (they were 2B.2 / 2B.3).
--   · Title 7A (the old UC certification regime) is replaced by a reference
--     to the CID Undercover Operations Procedure, which is the authoritative
--     UC policy. Old requirements it did not carry over — certification, the
--     two-operation prerequisite, Bureau Lead as automatic handler, the old
--     reporting and closure rules — are not preserved anywhere.
--   · Title 7 is renumbered 7A / 7B / 7C: the imported text had 7A, 7C, 7D
--     and no 7B. Nothing was retired under 7B; the gap was an export artifact.
--   · Justice roles: the Assistant District Attorney, District Attorney and
--     prosecutor are retired in the portal (Phase 4, legal_reroute). Wiretap
--     authority and the DOJ liaison now describe the current path — the
--     responsible Bureau Lead as the CID gate, a Judge as the deciding
--     authority, the Attorney General for oversight and sealed assignments.
--   · Vehicle policy: personal vehicles are no longer listed as fleet
--     vehicles; 3A.4 states separately when one may be used. The conversational
--     UC sentences in 3A.2 / 3A.4 / 3B.3 are gone, and no UC rule remains in
--     Title 3 beyond the vehicle and attire rules themselves.
--   · Ticket procedure (5D) states the responsibility and drops the Discord
--     rename instructions; the how-to belongs to the guides it now links.
--   · Evidence access (5C.3) follows the case-access model the portal actually
--     enforces — the assigned team and its supervisory chain, restricted items
--     to command and specifically authorized personnel, every access logged.
--   · Case status (5A.4) distinguishes the policy status (Open / Cold / Closed
--     / Archived) from the portal's investigative stage.
--   · CI policy (Title 6) is aligned with the CI compartment: a handler's own
--     sources; oversight for Bureau Leads, the Deputy Director, the Director
--     and active SIB members; capacity six with recorded overrides; the CI
--     number and codename; sanitized release as the only route from a source
--     to a case. Identity protection is not weakened — 11B now points at 6B.
--   · Surveillance (7C) separates trackers / GPS, camera and audio monitoring,
--     and electronic intercepts, and states the authorization the portal
--     records (a Bureau Lead over the case's bureau, the Deputy Director or
--     the Director; never the requester).
--   · Formatting: the export's "Tab 1", the underscore rules, the duplicated
--     title, the broken nested bullet in 9C, the tab-separated compensation
--     table and the unnumbered sub-headings are all corrected. Contextual
--     callouts mark the 12-hour reporting rule, the evidence-destruction
--     prohibition, CI confidentiality, the UC procedure reference, and the
--     related documents for each Title.
--
-- Everything else — hiring, chain of command duties, patrol restrictions,
-- reporting standards, discipline, training, records, compensation brackets —
-- is the same policy language as version 2.
--
-- Two forms gain `related_policy` = this SOP, because the SOP is the policy
-- they are filled in under: the CID Investigative Report (5B) and the Raid
-- Seizure Value Distribution & Allocation Form (12B). Additive metadata only.
--
-- Verification (recorded in MIGRATION-HISTORY.md): two guide_revisions rows
-- for the SOP (before / after), version_label '3', the superseded SOP's body
-- byte-identical to before, guide_search_index re-indexed by its trigger.
-- ============================================================================

do $do$
declare
  v_sop     uuid := 'd5ce98b9-5de8-4fd8-9b7b-beeffc0a32e4';   -- the active SOP
  v_section uuid := '3204226e-4831-465e-9ca3-3200e62f45c4';   -- its one section
  v_old     uuid := '551baa11-6273-4ea8-8c9a-6d52f58cc345';   -- superseded, untouched
  v_before  integer;
  v_after   integer;
  v_summary text :=
    'Updated CID organizational structure, replaced superseded UC policy with the current '
    || 'Undercover Operations Procedure, corrected justice-role terminology and document numbering '
    || '(2C clauses; Title 7 renumbered 7A/7B/7C), removed legacy workflow instructions, resolved '
    || 'conflicting policy language, aligned evidence, case-status, surveillance and confidential-'
    || 'informant wording with the portal''s current access model, and standardized Guide Library presentation.';
begin
  -- Guard: the row we are about to change must be the one we think it is.
  if not exists (select 1 from public.guides
                  where id = v_sop and slug = 'cid-standard-operating-procedure'
                    and status = 'published' and version_label = '2' and deleted_at is null) then
    raise exception 'cid_sop_v3: the active SOP is not in the expected state (v2, published)';
  end if;
  if not exists (select 1 from public.guide_sections where id = v_section and guide_id = v_sop) then
    raise exception 'cid_sop_v3: the SOP section was not found';
  end if;

  -- 1. Preserve version 2 exactly as it stands, before anything changes.
  v_before := private.guide_revision_save(v_sop,
    'Version 2 as imported from the retired library — preserved before the September 2026 correction');

  -- 2. The corrected text. Markdown for the Guide Library renderer: `##` is a
  --    Title, `###` a sub-title, `####` a clause; `> [!KIND]` is a callout.
  update public.guide_sections
     set body = $sop$## Title 1 | Introduction

### 1A | Mission Statement

The mission of the Criminal Investigation Division (CID) is to detect, investigate, disrupt, and dismantle criminal activity through professional investigative practices, intelligence gathering, and coordinated operations with internal and external law enforcement partners.

CID is dedicated to protecting the citizens of Los Santos by targeting street-level criminal activity, repeat offenders, and organized criminal enterprises, with an emphasis on long-term case development, lawful evidence collection, and prosecutorial integrity.

Through an organizational structure built on the Major Crimes Bureau and the Street Crimes Bureau, supported by the Special Investigations Bureau and by joint task force designation when an investigation crosses bureau lines, CID maintains the ability to respond swiftly to emergent threats while sustaining complex, intelligence-driven investigations aimed at dismantling long-term criminal networks.

### 1B | Hiring and Selection Process

Any sworn officer, deputy, or trooper within their respective department who wishes to transfer into the Criminal Investigation Division (CID) must submit a CID application in a professional and complete manner.

The following standards apply:

- Applications must be personally authored by the applicant
- Use of outside assistance, templates, AI tools, or third-party drafting resources is strictly prohibited
- Any application determined to be falsified, externally assisted, or plagiarized will be immediately disqualified
- Submission of an invalid application may result in temporary or permanent ineligibility for CID selection at the discretion of CID Command

CID selection is competitive and based on, but not limited to:

- Investigative aptitude and critical thinking
- Written communication and report quality
- Prior disciplinary history and integrity
- Demonstrated professionalism, discretion, and reliability

Submission of an application does not guarantee acceptance into CID.

### 1C | CID Structure

The Criminal Investigation Division is organized into two permanent investigative bureaus, one compartmentalized investigative bureau, and a temporary joint-case designation. Every detective is assigned to one permanent bureau. Where a matter could reasonably sit in either permanent bureau, CID Command assigns it.

#### 1C.1 | Major Crimes Bureau (MCB)

The Major Crimes Bureau conducts major, complex, and long-term investigations, including violent crime, organized criminal enterprises, and large-scale narcotics or firearms trafficking networks, together with any investigation that requires sustained, intelligence-driven case development.

#### 1C.2 | Street Crimes Bureau (SCB)

The Street Crimes Bureau conducts street-level and related investigations, including repeat-offender activity, localized narcotics and firearms activity, and investigations that originate from patrol referrals or field intelligence and can be resolved through focused investigation.

#### 1C.3 | Special Investigations Bureau (SIB)

The Special Investigations Bureau is a compartmentalized investigative bureau. Membership in SIB is by appointment only; it is not a bureau assignment and is not reached by transfer. SIB investigations, personnel, and records are governed by the Special Investigations Bureau SOP and by SIB's own access controls. Nothing in this document grants access to SIB material, and SIB material is not visible to CID personnel unless SIB releases it. The Director of CID holds read-only oversight standing over SIB as defined in the Special Investigations Bureau SOP.

#### 1C.4 | Joint Task Force (JTF) Designation

JTF is not a permanent bureau. It is a temporary joint-case designation applied when an investigation requires personnel or resources from more than one bureau.

- A joint task force case or operation has a lead bureau and one or more participating bureaus.
- Personnel are not transferred by a JTF designation. Access to the joint case is granted for the duration of the designation and ends when the designation ends.
- Intelligence and investigative resources are shared across the participating bureaus for the joint case.
- A JTF case routes its legal requests and supervisory approvals through its responsible bureau.

Case identifiers issued under the former jurisdiction-based structure retain their original prefixes as historical records and are not reissued.

## Title 2 | Chain of Command

The CID rank structure, from entry to senior authority, is: Detective, Senior Detective, Bureau Lead, Deputy Director, Director. "CID Command" in this document refers to the Deputy Director and the Director.

### 2A | CID Command Staff

#### 2A.1 | CID Director

The CID Director is the senior authority within the Criminal Investigation Division and is responsible for the overall leadership, direction, and integrity of the division. The Director establishes investigative priorities, assigns and oversees case ownership, maintains custody of sensitive investigative materials, and serves as the primary liaison to Department Command, High Command, the Department of Justice, and external agencies while ensuring professionalism, accountability, and compliance with all applicable policies and legal standards.

Duties include, but are not limited to:

- Assigning investigative leads and case ownership to appropriate bureaus or units
- Maintaining custody and oversight of sensitive case files, intelligence reports, and classified investigative materials
- Serving as the primary liaison between CID and Department Command, High Command, the Department of Justice, and external agencies
- Establishing investigative priorities and division-wide investigative standards
- Upholding professionalism and maintaining the public image and credibility of the division
- Final authority on CID personnel assignments, removals, and disciplinary recommendations

#### 2A.2 | Deputy Director

The Deputy Director serves as the second-in-command of the Criminal Investigation Division and acts with full authority in the absence of the CID Director. The Deputy Director assists in the oversight and coordination of all CID bureaus, ensures compliance with CID policies and investigative standards, reviews case progress and investigative documentation, and serves as the primary intermediary between Bureau Leads and the CID Director to maintain operational continuity and accountability across the division.

Duties include:

- Assisting in the oversight and coordination of all CID bureaus
- Ensuring bureau compliance with CID SOPs, investigative standards, and reporting requirements
- Reviewing case progress, warrants, and investigative documentation
- Serving as the primary chain-of-command intermediary between Bureau Leads and the CID Director
- Assuming command authority when delegated or when the CID Director is unavailable

### 2B | Bureau Leadership

#### 2B.1 | Bureau Lead

Bureau Leads are responsible for the direct supervision, management, and operational effectiveness of detectives assigned to their respective bureau. They oversee case assignment and progression, ensure investigations comply with CID policy and legal standards, review investigative documentation and warrant submissions, and maintain accountability for personnel and case outcomes within their bureau. Bureau Leads serve as the primary point of coordination between detectives and CID Command and are responsible for reporting investigative status, operational needs, and personnel matters up the chain of command.

Responsibilities include:

- Assigning cases and investigative tasks within the bureau
- Monitoring case progression and ensuring timely investigative follow-ups
- Reviewing and approving reports, affidavits, and warrant submissions prior to command-level review
- Ensuring detectives operate within legal, procedural, and policy boundaries
- Reporting bureau status, personnel performance, and investigative needs to CID Command
- Maintaining accountability, discipline, and professionalism within the bureau

### 2C | Investigative Personnel

#### 2C.1 | Senior Detective

Senior Detectives serve as experienced investigators and mentors within their assigned bureau.

Responsibilities include:

- Leading complex or high-priority investigations as assigned
- Providing guidance, oversight, and mentorship to Detectives
- Assisting Bureau Leads with case reviews, evidence organization, and investigative planning
- Acting as a temporary supervisory authority when directed by a Bureau Lead or CID Command
- Ensuring investigative quality, accuracy, and compliance with CID standards

#### 2C.2 | Detective

Detectives are responsible for carrying out investigative duties within their assigned bureau under the supervision of a Bureau Lead or Senior Detective.

Responsibilities include, but are not limited to:

- Conducting investigations consistent with CID SOPs and bureau scope
- Filing incident reports, supplemental reports, and investigative summaries
- Preparing and submitting search warrants, arrest warrants, subpoenas, and affidavits
- Collecting, documenting, and maintaining evidence in accordance with chain-of-custody standards
- Conducting interviews and witness statements
- Completing any lawful tasks assigned by a Senior Detective, Bureau Lead, or CID Command

## Title 3 | Equipment

### 3A | Vehicle Policy

#### 3A.1 | Department and CID Vehicles

Detectives conducting CID operations shall use CID-approved vehicles. Approved CID vehicles are:

- CID SUV
- CID Bravado Banshee
- CID Burrito

All CID vehicles must be operated in an unmarked configuration when used for division work. Use of any other department-issued vehicle for CID operations is prohibited unless expressly authorized by CID Command.

#### 3A.2 | Emergency Equipment Requirements

Any CID vehicle used for CID operations must be equipped with functional, low-profile emergency lighting that is visible from all directions while maintaining the vehicle's unmarked appearance. Lighting systems shall be discreet in design and shall not resemble standard marked patrol configurations.

Emergency lighting may only be activated in exigent or emergency circumstances where immediate identification as law enforcement is necessary to preserve life, prevent serious harm, or ensure operational safety.

#### 3A.3 | Non-CID Operations

When not actively engaged in CID duties, detectives shall comply with all vehicle policies and restrictions of their primary department.

#### 3A.4 | Personal Vehicles

Personal vehicles are not CID fleet vehicles and are not authorized for routine CID activity. A personal vehicle may be used only for surveillance or for an authorized undercover operation, and only within the scope and limitations of that assignment. Authorization for the undercover operation itself is governed by the CID Undercover Operations Procedure.

A personal vehicle used for CID work shall not display emergency lighting, sirens, law enforcement identifiers, or equipment that would compromise the vehicle's civilian appearance. Personal vehicles shall not be used for enforcement actions, traffic stops, pursuits, or routine CID operations.

### 3B | Uniform Policy

#### 3B.1 | Plainclothes Attire

Detectives assigned to CID are authorized to wear plainclothes attire while performing division-related duties. For routine investigative duties, plainclothes attire shall be business casual in appearance and must maintain a professional standard consistent with investigative work.

All plainclothes outfits must receive prior approval from the detective's respective Bureau Lead. Attire that is overly casual, tactical in nature, or inconsistent with a professional investigative appearance is prohibited unless expressly authorized for a specific operation.

#### 3B.2 | Tactical Attire

Tactical uniforms, loadouts, or external identifying gear are restricted to authorized operations only, including warrant service, planned enforcement actions, or high-risk operations approved by CID Command or a Bureau Lead.

#### 3B.3 | Undercover and Surveillance Attire

While conducting surveillance or an authorized undercover operation, detectives may wear attire intended to blend with the civilian population, including casual clothing and clothing associated with a target group. Such attire is worn only within the scope of the assignment. The conduct of an undercover operation is governed by the CID Undercover Operations Procedure.

#### 3B.4 | Non-CID Duties

When not performing CID duties, detectives are required to return to uniforms compliant with their primary department's uniform policy.

### 3C | Police Equipment

#### 3C.1 | Required Equipment

Detectives shall carry a department-issued firearm at all times while on duty.

#### 3C.2 | Investigative Equipment

Detectives must maintain access to necessary investigative equipment within their assigned vehicle, including tools required for evidence collection, documentation, and reporting, except where the detective is operating in an undercover capacity and such equipment would compromise the assignment.

#### 3C.3 | Long Guns and Specialized Weapons

Detectives are authorized to carry Class 2 or Class 3 weapons secured within their vehicle gun rack, provided all weapons and attachments comply with the Weapons and Attachments SOP. Deployment of such weapons is restricted to authorized operational circumstances only.

## Title 4 | Patrol Policies

### 4A | General Patrol Restrictions

When actively performing CID division work, detectives are not authorized to conduct routine patrol duties. This includes, but is not limited to:

- Traffic stops unrelated to an investigation
- Vehicle pursuits
- Checkpoints or saturation patrols
- General patrol enforcement activities

CID operations are investigative in nature and shall not be used as a substitute for routine patrol functions unless specifically authorized.

### 4B | Investigation-Related Enforcement

Detectives may conduct limited or "light" traffic enforcement only when such action is directly related to an active investigation. This includes enforcement actions necessary to:

- Identify, locate, or monitor a suspect
- Prevent immediate compromise of an ongoing investigation
- Address violations discovered incidental to investigative activity

All enforcement actions taken under this authority must remain reasonable, minimal, and investigative in purpose, not patrol-driven.

### 4C | Department Priority

Primary department obligations take precedence over CID duties. If a detective is requested or directed to handle department-level work, they are required to deactivate CID operations and comply with department tasking unless operationally unable to do so.

Detectives actively engaged in a time-sensitive or critical CID investigation shall notify a Bureau Lead or CID Command when department tasking conflicts with division work.

### 4D | Radio Identification

Detectives performing CID duties must clearly identify their status by displaying the "CID" designation in their radio callsign while actively engaged in division work.

Once CID operations are deactivated, the CID designation must be removed from the callsign until CID duties are reactivated.

## Title 5 | Case Management

### 5A | Case Assignment and Tracking

#### 5A.1 | Case Assignment Authority

Detectives may initiate or accept cases that fall within the scope of their assigned bureau. Cases may also be directly assigned to a detective by a Bureau Lead or the CID Director at any time.

#### 5A.2 | Case Responsibility

The assigned detective is responsible for maintaining active oversight of their case, including evidence development, intelligence gathering, surveillance, and follow-up actions necessary to advance the investigation.

#### 5A.3 | Supervisory Oversight

Bureau Leads are responsible for monitoring, tracking, and reviewing all investigations initiated or assigned within their bureau and ensuring appropriate progress and documentation.

#### 5A.4 | Case Status Definitions

All CID cases shall be classified under one of the following statuses:

- **Open Case:** A case in which active surveillance, investigative actions, intelligence development, or evidence gathering is ongoing.
- **Cold Case:** A case that has remained open for more than two (2) weeks without the development of new evidence, investigative leads, or actionable intelligence.
- **Closed Case:** A case formally closed by the assigned detective with approval from a Bureau Lead or CID Command, regardless of whether the case resulted in an arrest, prosecution, or was deemed no longer actionable.
- **Archived Case:** A closed case removed from the working views by CID Command. An archived case is read-only and may be restored by command.

The portal additionally records an investigative stage for an open case — Intake, Active Investigation, Legal Process, Enforcement Ready, Pending Closure, and Closed. The stage describes where the work stands within the investigation and is maintained by the assigned detective and supervisors. It is a workflow marker and does not replace the case status defined above.

### 5B | Case File Documentation Standards

#### 5B.1 | Reporting Requirements

Detectives are required to complete a detective report and/or incident report following any scene, operation, or investigative action related to their bureau's responsibilities.

#### 5B.2 | Major Incident Reporting

> [!IMPORTANT] Twelve-hour reporting requirement
> Following a major incident or significant investigative event, detectives must complete and submit all required reports within twelve (12) hours of scene conclusion unless otherwise authorized by CID Command.

#### 5B.3 | Report Content Standards

All reports must include:

- A complete and accurate summary of events
- All known investigative information and actions taken
- The assigned detective's name and badge number
- Any associated evidence, witnesses, or follow-up requirements

Failure to meet documentation standards may result in corrective action.

### 5C | Evidence Handling and Chain of Custody

#### 5C.1 | Evidence Collection

All evidence must be photographed prior to collection whenever feasible. Evidence shall be properly collected, packaged, and preserved, including the recovery of latent or trace evidence from weapons, vehicles, or relevant surfaces when applicable.

#### 5C.2 | Documentation

All collected evidence must be clearly documented within the corresponding incident report or detective report, including the method of collection and relevance to the investigation.

#### 5C.3 | Evidence Access Control

Access to case evidence follows access to the case. Once submitted, evidence is available to the personnel assigned to the case, to the supervisory chain responsible for it (the Bureau Lead, the Deputy Director, and the Director), and to personnel granted access to the case through an approved access request or a joint-case designation. Evidence marked restricted is limited to CID Command and to personnel specifically authorized for that item.

Every access to an evidence item is logged. Custody transfers are recorded as they occur. Sealing an evidence item requires a Senior Detective or above, or the detective who submitted it; release of a sealed item requires CID Command.

#### 5C.4 | Evidence Retention

> [!WARNING] Evidence is never destroyed
> No evidence shall be destroyed or disposed of. All evidence must be secured in an approved evidence locker and retained until legal proceedings are complete or formal authorization for disposition is granted by CID Command or the Department of Justice.

> [!RELATED]
> - [Reports and Evidence Guide](/guides/reports-evidence) — how reports and evidence are filed in the portal
> - [CID Investigative Report](/guides/cid-investigative-report) — the report form

### 5D | Ticket Procedure and Management

#### 5D.1 | Ticket Assignment

When an information or investigative request is received, a detective from the relevant bureau must respond in a timely manner. A request that falls outside the handling detective's bureau or investigative scope shall be redirected to the appropriate bureau or jurisdiction.

#### 5D.2 | Information Gathering

The handling detective is responsible for gathering all relevant details, requesting additional information as necessary, and determining investigative viability.

#### 5D.3 | Documentation

All information obtained through the ticket process must be documented using the CID investigative report.

#### 5D.4 | Ticket Timelines

CID tickets should not remain open longer than three (3) to five (5) days unless investigative circumstances require additional time and such extension is documented or approved by a Bureau Lead.

> [!PROCEDURE] Operating the intake and case tools
> This section states what a detective is responsible for. The portal and communication-channel steps that carry it out — where a request is received, how it is redirected, how a case is opened from it — are described in the guides below and are maintained there, not here.

> [!RELATED]
> - [Case Assignment Procedure](/guides/case-assignment-procedure)
> - [Case Management Guide](/guides/case-management)
> - [CID Case Building Playbook](/guides/cid-case-building-playbook)

## Title 6 | Confidential Informant (CI) Policy

### 6A | CI Recruitment

#### 6A.1 | Eligibility Standards

Individuals considered for recruitment as a Confidential Informant (CI) must not possess a criminal record consisting of more than eight (8) violent felony convictions. Final eligibility determinations remain at the discretion of CID Command.

#### 6A.2 | Recruitment Authorization and Capacity

Prior to recruiting a CI, the handling detective must notify their respective Bureau Lead.

Each handler may manage up to six (6) active confidential informants at a time. CI oversight — a Bureau Lead, the Deputy Director, or the Director — may raise a handler's limit with a recorded reason, or approve a handler's request for additional capacity or for the assignment of a source. A candidate, dormant, or retired informant does not count toward a handler's capacity.

#### 6A.3 | Informant Briefing and Agreement

The assigned handler is responsible for fully briefing the informant on all applicable CI policies, expectations, and restrictions. A CI Agreement Document must be provided to the informant for completion and acknowledgment prior to any use.

#### 6A.4 | CI Identification and Documentation

Each CI is assigned a unique CI number by the portal and a codename by their handler. The CI number or codename shall be used exclusively in all reports, legal documents, and investigative references to protect the informant's identity.

### 6B | CI Handling and Security

#### 6B.1 | Handler Exclusivity

Confidential Informants may only be contacted by their assigned handlers. Any unauthorized contact with a CI will trigger an internal investigation to determine the source and intent of the contact.

#### 6B.2 | Confidentiality Protections

> [!RESTRICTED] Informant identity
> The disclosure of a CI's identity or confidential status is strictly prohibited. Any violation of CI confidentiality will result in immediate removal from CID and may result in administrative or legal action.

#### 6B.3 | Documentation Standards

CIs shall be referenced solely by their assigned CI number or codename in all investigative documents, reports, warrants, court proceedings, and internal communications.

#### 6B.4 | Access to Informant Records

Informant records — identity, handler assignments, contacts, assessments, payments, and intelligence — are held in the CID informant compartment. They are accessible only to the informant's assigned handlers and to CI oversight: Bureau Leads, the Deputy Director, the Director, and active members of the Special Investigations Bureau.

Access to a case does not confer access to a source. Intelligence a CI provides is filed in the compartment and reaches a case only as a sanitized release approved by CI oversight. A release shall not identify the source by CI number, name, alias, or handler.

### 6C | CI Use in Operations

#### 6C.1 | Operational Consent

CIs may be utilized in investigative or operational activities only after signing a document acknowledging:

- Their voluntary participation
- The inherent risks involved
- The limitations of protection afforded during CI operations

#### 6C.2 | Post-Contact Reporting

Following any interaction with a target individual or organization, the CI must report back to their handler as soon as reasonably possible to relay all relevant information obtained.

#### 6C.3 | Operational Control

CIs shall not act independently, initiate enforcement actions, or deviate from handler instructions unless doing so is necessary to preserve their safety.

### 6D | Compensation

#### 6D.1 | Compensation Determination

Any form of CI compensation must be documented. Compensation is not guaranteed and is determined based on investigative value and contribution.

#### 6D.2 | Approval Authority

All CI compensation must be reviewed and approved by CI oversight — a Bureau Lead, the Deputy Director, or the Director — prior to issuance, and the approval recorded on the informant's payment record.

#### 6D.3 | Compensation Structure

When authorized, CIs may receive compensation calculated as a percentage of the street value of seized items or assets, proportional to their level of contribution and the success of the investigation.

## Title 7 | Surveillance and Undercover Operations

### 7A | Undercover Operations

CID undercover operations shall be conducted in accordance with the current CID Undercover Operations Procedure maintained in the Guide Library.

> [!PROCEDURE] CID Undercover Operations Procedure
> The [CID Undercover Operations Procedure](/guides/undercover-procedure) is the authoritative policy governing:
>
> - activation requirements
> - recording and media requirements
> - undercover identity protection
> - prohibited conduct
> - use of undercover authority
> - safety and operational integrity
> - command oversight
> - violations and accountability
>
> Where this document and the Procedure differ on the conduct of an undercover operation, the Procedure governs.

> [!RELATED]
> - [CID Undercover Operations Procedure](/guides/undercover-procedure)
> - [UC Operation Activity Report](/guides/uc-operation-activity-report) — filed after each undercover contact

### 7B | Wiretaps and Electronic Intercepts

#### 7B.1 | Authorization Authority

A wiretap or electronic interception requires judicial authorization. The request is submitted as a legal request through the portal, reviewed and approved by the responsible Bureau Lead as the CID gate — or by CID Command where the Bureau Lead is unavailable or the case carries a joint task force designation — and decided by a Judge. A sealed request is assigned to a Judge by the Attorney General.

#### 7B.2 | Logging and Oversight

All approved wiretaps must be logged and tracked separately from standard investigative reports and maintained under strict access control by CID Command.

Unauthorized wiretaps or electronic monitoring are strictly prohibited and subject to disciplinary action.

### 7C | Surveillance, Tracking, and Monitoring

#### 7C.1 | Scope

This section governs three distinct investigative methods, which are authorized and handled separately:

- **Vehicle tracking devices (trackers / GPS)** — placed on a vehicle to establish movement.
- **Camera and audio monitoring devices** — placed at a location to record activity or conversation.
- **Electronic intercepts** — the interception of communications, governed by 7B.

#### 7C.2 | Authorized Purposes

A tracking or monitoring device may only be deployed for CID-approved investigative purposes, including:

- Organized crime and racketeering investigations (RICO-type cases)
- Narcotics manufacturing, trafficking, and distribution networks
- Firearms trafficking and illegal weapons manufacturing
- Ongoing violent felony investigations
- Locating suspects actively evading arrest
- Corroboration of Confidential Informant intelligence
- Evidence collection in long-term covert investigations

A tracking or monitoring device shall not be used for:

- Personal surveillance or curiosity
- Fishing expeditions without articulated cause
- Monitoring civilians absent investigative justification
- Routine patrol or enforcement activity
- Political, social, retaliatory, or biased targeting
- Internal disputes or non-investigative matters

#### 7C.3 | Deployment Authorization

Deployment of a tracking or monitoring device requires written authorization, recorded in the portal, from a Bureau Lead with authority over the case's bureau, the Deputy Director, or the Director. The requesting detective may not authorize their own request. Where the law requires a warrant, the warrant is obtained through the legal request process before deployment.

Each deployment request must include:

- Associated case number
- Identified suspect(s) or investigative target
- Clearly articulated probable cause or investigative necessity
- Defined duration of deployment
- Intended evidentiary objective

Open-ended or indefinite deployments are strictly prohibited. Extensions may only be granted with renewed justification and approval.

#### 7C.4 | Trackers and GPS

- A tracking device may be placed on a vehicle only with probable cause or an approved warrant.
- GPS tracking may be used to establish movement patterns, meeting locations, or flight risk.
- Tracking duration is time-limited and requires renewal with justification.
- GPS data is classified as controlled evidence and logged accordingly.

#### 7C.5 | Camera and Audio Monitoring

- Devices may only be used in locations that are legally permissible or judicially authorized.
- Audio monitoring requires explicit authorization due to heightened privacy considerations.
- Recordings shall be limited to case-relevant material only.
- Non-pertinent recordings must be flagged, excluded from evidence, and handled per policy.

#### 7C.6 | Abuse Prevention and Safeguards

To prevent misuse, CID enforces the following structural safeguards:

- No single-person authorization
- Mandatory written justification
- Supervisory review
- Time-limited deployments
- DOJ or Command oversight when required

Violations may result in:

- Removal from CID
- Disciplinary action
- Criminal charges when applicable

## Title 8 | Joint Operations and Inter-Bureau Cooperation

### 8A | Collaboration with SWAT and Patrol

#### 8A.1 | Coordination Authority

Any CID detective may coordinate investigative support with SWAT or patrol units; however, the detective should notify their respective Bureau Lead and the CID Director prior to initiating joint operational coordination.

#### 8A.2 | Command Boundaries

CID detectives do not exercise command authority over SWAT units. Detectives may work alongside SWAT personnel in a collaborative role, providing investigative intelligence, target information, and case context while SWAT maintains tactical command and control.

### 8B | Task Force Operations (TFOs)

#### 8B.1 | Task Force Authorization

A Bureau Lead may coordinate with SWAT and CID Command to establish a Task Force Operation (TFO) focused on a specific geographic area, criminal organization, or investigative objective aligned with the bureau's mission. A Task Force Operation is an operational arrangement with SWAT; it is distinct from the joint task force (JTF) case designation described in 1C.4.

#### 8B.2 | Operational Roles

During a TFO:

- CID detectives are responsible for intelligence development, target identification, and investigative direction
- SWAT maintains tactical execution and enforcement authority
- Detectives may advise SWAT on priority targets and investigative objectives, but shall not issue tactical commands

#### 8B.3 | Documentation Requirements

All arrests, searches, seizures, or enforcement actions resulting from a TFO must be fully documented by CID detectives using the appropriate investigative or incident reports.

### 8C | DOJ Liaison

#### 8C.1 | Liaison Role

Bureaus may designate a detective to serve as a Department of Justice (DOJ) Liaison.

#### 8C.2 | Liaison Responsibilities

The DOJ Liaison acts as the primary point of communication between CID and the Department of Justice and the Judiciary — the Attorney General and the Judges who decide legal requests — regarding:

- Search warrants
- Wiretap requests
- Subpoenas
- Organized crime or enterprise-level investigations

#### 8C.3 | Authority Limitations

The DOJ Liaison facilitates communication and coordination only and does not independently authorize legal actions. Every legal request follows the approval path described in 7B and the legal request process, with approval from CID Command or the responsible Bureau Lead and a decision by a Judge.

> [!RELATED]
> - [Legal Requests Guide](/guides/legal-requests) — warrants, subpoenas and the review path in the portal

## Title 9 | Disciplinary and Professional Standards

### 9A | General Expectations

All detectives assigned to the Criminal Investigation Division are expected to maintain a professional demeanor and conduct both on and off duty.

CID detectives are sworn peace officers of the State of San Andreas and shall, at no time:

- Violate any applicable law
- Violate departmental or CID SOPs
- Engage in conduct that undermines the integrity, credibility, or public trust of the division

Detectives shall conduct themselves with discretion and professionalism in all interactions, including with the public, other departments, command staff, and within internal communications. Confidential information, investigative access, and CID resources shall only be used for legitimate investigative purposes and never for personal gain, retaliation, favoritism, or harassment. Any behavior — on or off duty — that creates the appearance of bias, abuse of authority, or misuse of investigative powers may be treated as a violation of CID standards regardless of intent.

Detectives are further expected to respect the chain of command, comply promptly with lawful instructions, and maintain accountability for their actions at all times. Failure to uphold these expectations may result in disciplinary review even in the absence of a criminal or policy violation.

### 9B | Grounds for Disciplinary Action

Any detective found to have engaged in the following conduct may be subject to disciplinary action, up to and including removal from CID:

- Violation of CID or departmental SOPs
- Violation of the Penal Code or other applicable laws
- Disrespect toward CID Command, Bureau Leads, or Department Command
- Failure or refusal to obey lawful instructions issued by a Bureau Lead or CID Command
- Violation of any signed agreement, policy acknowledgment, or conditions of assignment within CID

Violations of CID agreements or misuse of investigative authority may also expose the detective to administrative or legal action as applicable.

### 9C | Probation and Removal Process

At the discretion of the CID Director, a detective may be placed on CID probation for a specified period pending review, investigation, or corrective action.

A detective placed on probation remains assigned to CID but is prohibited from exercising detective authority, including but not limited to:

- Operating or driving CID or unmarked investigative vehicles
- Wearing plainclothes or tactical investigative attire
- Representing themselves as a CID detective
- Participating in investigative or enforcement actions

If the CID Director determines that a detective should no longer remain within the division, the detective shall be immediately notified of their removal.

Upon removal from CID, the detective must:

- Surrender all CID-issued equipment and materials
- Cease operation of CID or unmarked vehicles unless otherwise authorized by their primary department
- Discontinue use of CID plainclothes or tactical attire unless permitted by department policy
- Have all access revoked to CID documents, intelligence, case files, and systems previously available through their CID assignment

## Title 10 | Training and Certifications

### 10A | Continued Education

Detectives assigned to CID are expected to engage in ongoing professional development throughout their assignment.

Continued education expectations include:

- Learning new investigative and surveillance methods
- Familiarization with newly introduced equipment or technology
- Updates to legal procedures, evidentiary standards, or prosecutorial requirements
- Any additional training or instruction deemed necessary by the CID Director or CID Command

Failure to participate in required training or continued education may impact a detective's standing within the division or eligibility for specialized assignments.

## Title 11 | Administrative Policies

### 11A | Documentation and Records Management

The CID Director is responsible for the maintenance, organization, and oversight of all investigative records, reports, intelligence files, and administrative documentation within the Criminal Investigation Division.

In the event that Department Command or executive leadership requests access to CID records or information, such requests must be submitted through a formal request process. Requests may be approved or denied by the CID Director, with justification provided when access is restricted due to investigative sensitivity, confidentiality concerns, or legal limitations.

The CID Director reports directly to executive leadership, including the Chief of Police, Sheriff, Colonel, and Commissioner, and is accountable for ensuring CID records are maintained in a manner consistent with legal, administrative, and departmental standards.

### 11B | Data Security and Confidentiality

All CID documents, intelligence, and investigative materials are restricted to authorized CID personnel only unless otherwise approved by CID Command.

Confidential Informant records, including agreement forms and related documentation, are restricted as set out in 6B.4. Unauthorized access, duplication, or dissemination of CI materials is strictly prohibited.

Any breach of data security, unauthorized disclosure, or violation of confidentiality agreements within CID will result in an internal investigation conducted by the CID Director in coordination with Department Command and may result in disciplinary or legal action.

## Title 12 | Detective Compensation

### 12A | Performance-Based Compensation

Detectives assigned to the Criminal Investigation Division may be eligible for bi-weekly or monthly bonus compensation based on their investigative workload, case progression, initiative, and overall contribution during the applicable period.

All bonus compensation is discretionary and subject to approval by CID Command. Compensation is not guaranteed and may be adjusted or withheld based on performance, compliance with CID standards, or disciplinary status.

### 12B | Operational and Raid-Based Compensation

In the event a raid, enforcement action, or coordinated operation results in the seizure of illegal items, evidence, or assets, detectives may submit a compensation request for:

- The primary case detective
- Supporting CID detectives
- Authorized Confidential Informants (CIs), when applicable

All compensation requests must be formally submitted and justified based on investigative contribution and operational involvement.

Compensation requests shall accurately reflect each individual's level of participation, risk exposure, and investigative contribution to the operation. Requests based solely on presence or minimal involvement may be reduced or denied. Detectives are prohibited from submitting compensation requests for themselves without supporting documentation outlining their role in the operation.

Compensation requests involving Confidential Informants must clearly document the CI's contribution and comply with all CI policies and approval requirements. Any misrepresentation, exaggeration, or attempt to manipulate compensation determinations may result in denial of payment and potential disciplinary action.

### 12C | Compensation Approval and Payment Brackets

All compensation requests are reviewed and approved by CID Command. Final payment determinations shall be based on established compensation brackets, investigative impact, risk exposure, and level of contribution.

CID Command shall utilize the following compensation bracket framework when determining payments:

| Street Value | Percentage Given |
|---|---|
| $1,000,000 – $2,499,999 | 60% |
| $2,500,000 – $7,499,999 | 50% |
| $7,500,000 – $14,999,999 | 40% |
| $15,000,000 – $24,999,999 | 30% |
| $25,000,000 + | 20% |

CID Command retains final authority to approve, modify, or deny any compensation request to ensure fairness, consistency, and compliance with CID policy.

> [!RELATED]
> - [Raid Seizure Value Distribution & Allocation Form](/guides/raid-seizure-allocation-form) — the request form for operational compensation$sop$
   where id = v_section and guide_id = v_sop;

  -- 3. Version 3. The effective date is the policy's (2026-08-03) and stays;
  --    "last updated" is the row's updated_at, which the section trigger and
  --    this statement both advance. Reading time is recomputed from the text.
  update public.guides
     set version_label  = '3',
         change_summary = v_summary,
         summary        = 'The division''s standing rules: structure, chain of command, equipment, patrol, '
                          || 'case management, informants, surveillance and undercover operations, joint '
                          || 'operations, discipline, training, records and compensation.',
         read_minutes   = null,
         keywords       = coalesce(keywords,
           'SOP standard operating procedure MCB SCB SIB JTF chain of command vehicle uniform '
           || 'patrol case status evidence custody ticket confidential informant CI surveillance '
           || 'tracker GPS wiretap undercover task force DOJ liaison discipline probation '
           || 'training records compensation raid'),
         updated_at     = now()
   where id = v_sop;

  -- 4. The two forms this SOP governs. Additive; a form that already names a
  --    policy keeps it.
  update public.guides
     set related_policy = v_sop
   where slug in ('cid-investigative-report', 'raid-seizure-allocation-form')
     and deleted_at is null and related_policy is null;

  -- 5. Record version 3 as it now stands, with why.
  v_after := private.guide_revision_save(v_sop, 'Version 3 — ' || v_summary);

  -- 6. Prove the superseded SOP was not touched by any of the above.
  if (select updated_at from public.guides where id = v_old) > now() - interval '1 minute' then
    raise exception 'cid_sop_v3: the superseded SOP changed during this migration';
  end if;

  raise notice 'cid_sop_v3: revisions % (before) and % (after) saved; version 3 published', v_before, v_after;
end $do$;

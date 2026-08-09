-- ============================================================================
-- CID SOP content refresh — replace the portal's CID Standard Operating
-- Procedure with the CURRENT OdysseyRP CID SOP (authoritative Google Drive
-- document, source last modified 2026-08-03).
--
-- This is the canonical in-repo copy of the SOP body. The reader consumes the
-- live `documents` row this migration maintains; there is deliberately NO
-- second copy of the text anywhere else in the codebase. Future edits happen
-- through the portal's governed editor (document_save RPC) or a follow-up
-- migration like this one.
--
-- WHAT THIS DOES (mirrors public.document_save semantics, non-destructive):
--   · Updates the existing SOP row in place (same id — acknowledgements,
--     version history, relations and bookmarks all survive).
--   · Moves it to folder 'SOPs' so the command-staff write-lock added by
--     20260706120000_sops_command_writes applies (Title 11A: the CID Director
--     oversees records; detectives read, command edits) and classifies it
--     category='sops' / document_type='sop' (the 20260801010000 backfill left
--     the legacy 'SOP/Training' folder as uncategorised reference).
--   · Renames it so the visible title is the source document's full title.
--   · Writes the post-save state as a NEW documents_versions row and bumps
--     current_version_number, exactly like document_save — the previous SOP
--     text remains available in version history (nothing is deleted).
--   · Records provenance: source_system='imported', source_modified_at /
--     effective_at = 2026-08-03 (the source document's last-modified date).
--
-- CONTENT FIDELITY: the body below is the Google Docs → Markdown export of
-- the current SOP with ONLY export artifacts cleaned (the "Tab 1" heading,
-- empty headings, spacer lines, horizontal-rule separators, one empty list
-- bullet in Title 9C). Two bold pseudo-headings in Title 5B were normalised
-- to the '###' heading level their sibling subsections already use, and the
-- Title 2A heading level was normalised to match Titles 2B/2C. No policy
-- wording was altered. Section numbering (including the source's 2B.2/2B.3
-- under Title 2C and the absence of a Title 7B) is preserved verbatim.
--
-- Idempotent: re-running is a no-op once the body hash matches. RLS and all
-- grants are untouched.
-- ============================================================================

do $mig$
declare
  d public.documents;
  v_next int;
  v_name constant text := 'Criminal Investigation Division (CID) Standard Operating Procedure.doc';
  v_body constant text := $sop$# **Criminal Investigation Division (CID) Standard Operating Procedure**

> **Document:** Criminal Investigation Division (CID) Standard Operating Procedure
> **Source:** Current OdysseyRP CID SOP
> **Source last modified:** August 3, 2026

# **Title 1 | Introduction**

## **Title 1A | Mission Statement**

The mission of the Criminal Investigation Division (CID) is to detect, investigate, disrupt, and dismantle criminal activity through professional investigative practices, intelligence gathering, and coordinated operations with internal and external law enforcement partners.

CID is dedicated to protecting the citizens of Los Santos by targeting street-level criminal activity, repeat offenders, and organized criminal enterprises, with an emphasis on long-term case development, lawful evidence collection, and prosecutorial integrity.

Through an organizational structure that balances Street Crimes, Major Crimes, and Firearms & Drug Enforcement, CID maintains the ability to respond swiftly to emergent threats while sustaining complex, intelligence-driven investigations aimed at dismantling long-term criminal networks.

## **Title 1B | Hiring and Selection Process**

Any sworn officer, deputy, or trooper within their respective department who wishes to transfer into the Criminal Investigation Division (CID) must submit a CID application in a professional and complete manner.

**The following standards apply:**

* Applications must be personally authored by the applicant
* Use of outside assistance, templates, AI tools, or third-party drafting resources is strictly prohibited
* Any application determined to be falsified, externally assisted, or plagiarized will be immediately disqualified
* Submission of an invalid application may result in temporary or permanent ineligibility for CID selection at the discretion of CID Command

**CID selection is competitive and based on, but not limited to:**

* Investigative aptitude and critical thinking
* Written communication and report quality
* Prior disciplinary history and integrity
* Demonstrated professionalism, discretion, and reliability

Submission of an application does not guarantee acceptance into CID.

## **Title 1C | CID Structure**

The Criminal Investigation Division is organized into three (3) operational bureaus, each with defined investigative responsibilities:

### **1C.1 | Los Santos CID (LSPD)**

The Los Santos Police Department CID team will primarily focus on investigations occurring within city jurisdiction.
These detectives will handle investigations involving:

* Criminal activity occurring within Los Santos city limits
* Violent crime investigations within the city
* Organized crime activity operating inside the city
* Narcotics trafficking occurring in urban areas
* Businesses or locations operating within city jurisdiction
* LSPD detectives will typically take the lead on investigations that originate within the city.

### **1C.2 | Blaine County Sheriff’s Office CID (BCSO CID)**

The Blaine County Sheriff’s Office CID team will focus on investigations occurring throughout Blaine County and surrounding rural jurisdictions.
These detectives will primarily investigate:

* Criminal activity occurring in Blaine County jurisdiction
* Rural narcotics operations
* Criminal activity occurring in areas such as Sandy Shores, Grapeseed, and Paleto Bay
* Gang activity operating in county areas
* Criminal organizations operating outside of city jurisdiction
* BCSO detectives will generally take the lead on investigations originating within the county.

### **1C.3 | Statewide Investigations CID (SAHP CID)**

The San Andreas Highway Patrol CID team will operate as a statewide investigative unit. Unlike the LSPD and BCSO teams, SAHP CID detectives are not limited to a single jurisdiction. Instead, they will focus on investigations that involve multiple jurisdictions or require statewide authority. SAHP CID detectives will work heavily within joint task force investigations, assisting both city and county detectives when cases extend beyond a single jurisdiction.
Their responsibilities may include:

* Assisting investigations that cross city and county lines
* Investigating organized crime groups operating across multiple jurisdictions
* Supporting major criminal investigations requiring statewide authority
* Coordinating large joint task force investigations between agencies
* Assisting with investigations involving interstate or large-scale criminal activity
* Because SAHP operates with statewide authority, their detectives will play a critical role in helping advance investigations when jurisdictional limitations would otherwise slow the process.
* In many cases, SAHP detectives may assist other agencies by helping expand investigations beyond city or county boundaries.

### **1C.4 | Joint Task Force Operations (All bureaus)**

Even though CID will now operate in departmental teams, the division will still function as a joint investigative task force when necessary. Criminal organizations rarely operate within a single jurisdiction. As investigations develop, detectives from different agencies may need to work together to fully investigate criminal activity.
Under the new system:

* Detectives may request assistance from other CID teams when investigations expand beyond their jurisdiction.
* Multi-agency cases may form joint investigative teams made up of detectives from multiple departments.
* Intelligence and investigative resources will continue to be shared across all CID teams.
* For example:
* An investigation that begins in Los Santos but later expands into Blaine County may involve both LSPD and BCSO detectives working together. If the same case begins to involve multiple jurisdictions or a large criminal organization, SAHP CID detectives may join the investigation to provide statewide authority and coordination.
* This structure allows CID to remain organized while still maintaining flexibility when large investigations occur.

# **Title 2 | Chain of Command**

## **Title 2A | CID Command Staff**

### **2A.1 | CID Director**

The CID Director is the senior authority within the Criminal Investigation Division and is responsible for the overall leadership, direction, and integrity of the division. The Director establishes investigative priorities, assigns and oversees case ownership, maintains custody of sensitive investigative materials, and serves as the primary liaison to Department Command, High Command, the Department of Justice, and external agencies while ensuring professionalism, accountability, and compliance with all applicable policies and legal standards.

**Duties include, but are not limited to:**

* Assigning investigative leads and case ownership to appropriate bureaus or units
* Maintaining custody and oversight of sensitive case files, intelligence reports, and classified investigative materials
* Serving as the primary liaison between CID and Department Command, High Command, the Department of Justice, and external agencies
* Establishing investigative priorities and division-wide investigative standards
* Upholding professionalism and maintaining the public image and credibility of the division
* Final authority on CID personnel assignments, removals, and disciplinary recommendations

### **2A.2 | Deputy CID Director**

The Deputy CID Director serves as the second-in-command of the Criminal Investigation Division and acts with full authority in the absence of the CID Director. The Deputy Director assists in the oversight and coordination of all CID bureaus, ensures compliance with CID policies and investigative standards, reviews case progress and investigative documentation, and serves as the primary intermediary between Bureau Leads and the CID Director to maintain operational continuity and accountability across the division.

**Duties include:**

* Assisting in the oversight and coordination of all CID bureaus
* Ensuring bureau compliance with CID SOPs, investigative standards, and reporting requirements
* Reviewing case progress, warrants, and investigative documentation
* Serving as the primary chain-of-command intermediary between Bureau Leads and the CID Director
* Assuming command authority when delegated or when the CID Director is unavailable

## **Title 2B | Bureau Leadership**

### **2B.1 | Bureau Lead**

Bureau Leads are responsible for the direct supervision, management, and operational effectiveness of detectives assigned to their respective bureau. They oversee case assignment and progression, ensure investigations comply with CID policy and legal standards, review investigative documentation and warrant submissions, and maintain accountability for personnel and case outcomes within their bureau. Bureau Leads serve as the primary point of coordination between detectives and CID Command and are responsible for reporting investigative status, operational needs, and personnel matters up the chain of command.

**Responsibilities include:**

* Assigning cases and investigative tasks within the bureau
* Monitoring case progression and ensuring timely investigative follow-ups
* Reviewing and approving reports, affidavits, and warrant submissions prior to command-level review
* Ensuring detectives operate within legal, procedural, and policy boundaries
* Reporting bureau status, personnel performance, and investigative needs to CID Command
* Maintaining accountability, discipline, and professionalism within the bureau

## **Title 2C | Investigative Personnel**

### **2B.2 | Senior Detective**

Senior Detectives serve as experienced investigators and mentors within their assigned bureau.

**Responsibilities include:**

* Leading complex or high-priority investigations as assigned
* Providing guidance, oversight, and mentorship to Detectives
* Assisting Bureau Leads with case reviews, evidence organization, and investigative planning
* Acting as a temporary supervisory authority when directed by a Bureau Lead or CID Command
* Ensuring investigative quality, accuracy, and compliance with CID standards

### **2B.3 | Detective**

Detectives are responsible for carrying out investigative duties within their assigned bureau under the supervision of a Bureau Lead or Senior Detective.

**Responsibilities include, but are not limited to:**

* Conducting investigations consistent with CID SOPs and bureau scope
* Filing incident reports, supplemental reports, and investigative summaries
* Preparing and submitting search warrants, arrest warrants, subpoenas, and affidavits
* Collecting, documenting, and maintaining evidence in accordance with chain-of-custody standards
* Conducting interviews and witness statements
* Completing any lawful tasks assigned by a Senior Detective, Bureau Lead, or CID Command

# **Title 3 | Equipment**

## **Title 3A Vehicle Policy**

### **3A.1 | Authorized Vehicles**

Detectives are authorized to utilize CID-approved vehicles only while conducting CID operations. Authorized vehicles are limited to the following:

* CID SUV
* CID Bravado Banshee
* CID Burrito
* Personal Vehicles

All authorized CID vehicles must be operated in an unmarked configuration when used for division work. Use of any other department-issued or personal vehicles for CID operations is prohibited unless expressly authorized by CID Command.

### **3A.2 | Emergency Equipment Requirements**

Any vehicle used for CID operations must be equipped with functional, low-profile emergency lighting that is visible from all directions while maintaining the vehicle’s unmarked appearance. Lighting systems shall be discreet in design and not resemble standard marked patrol configurations. When you are using a personal vehicle, you should not be making arrests, stopping people, etc. Using a personal vehicle is strictly for undercover surveillance (not deep undercover like joining gangs, that must be approved by CID command).

Emergency lighting may only be activated in exigent or emergency circumstances where immediate identification as law enforcement is necessary to preserve life, prevent serious harm, or ensure operational safety.

### **3A.3 | Non-CID Operations**

When not actively engaged in CID duties, detectives shall comply with all vehicle policies and restrictions of their primary department.

### **3A.4 | Personal Vehicles**

Use of personal vehicles is restricted to undercover operations only (you will typically use this for surveillance, deep undercovers like joining a gang requires command approval).

Personal vehicles utilized for CID operations shall not display emergency lighting, sirens, law enforcement identifiers, or equipment that would compromise the vehicle’s civilian appearance. Personal vehicles may not be used for enforcement actions, traffic stops, pursuits, or routine CID operations and shall only be operated within the scope and limitations of the approved UC assignment.

## **Title 3B | Uniform Policy**

### **3B.1 | Plainclothes Attire**

Detectives assigned to CID are authorized to wear plainclothes attire while performing division-related duties. For routine investigative duties, plainclothes attire shall be business casual in appearance and must maintain a professional standard consistent with investigative work.

All plainclothes outfits must receive prior approval from the detective’s respective Bureau Lead. Attire that is overly casual, tactical in nature, or inconsistent with a professional investigative appearance is prohibited unless expressly authorized for a specific operation.

### **3B.2 | Tactical Attire**

Tactical uniforms, loadouts, or external identifying gear are restricted to authorized operations only, including warrant service, planned enforcement actions, or high-risk operations approved by CID Command or a Bureau Lead.

### **3B.3 | Under Cover Attire**

Detectives, when conducting surveillance or working in an undercover capacity, may wear attire with intent to blend in with regular civilians. Detectives can mimic gang clothing, wear casual clothing, etc.

### **3B.4 | Non-CID Duties**

When not performing CID duties, detectives are required to return to uniforms compliant with their primary department’s uniform policy.

## **Title 3C | Police Equipment**

### **3C.1 | Required Equipment**

Detectives shall carry a department-issued firearm at all times while on duty.

### **3C.2 | Investigative Equipment**

Detectives must maintain access to necessary investigative equipment within their assigned vehicle, including tools required for evidence collection, documentation, and reporting unless undercover.

### **3C.3 | Long Guns / Specialized Weapons**

Detectives are authorized to carry Class 2 or Class 3 weapons secured within their vehicle gun rack, provided all weapons and attachments comply with the [Weapons and Attachments SOP](https://docs.google.com/spreadsheets/u/0/d/1hoQlhXfJEhlF0REDe_zTK2l4qfv5Vex1pvs07OOGSxg/edit). Deployment of such weapons is restricted to authorized operational circumstances only.

# **Title 4 | Patrol Policies**

## **Title 4A | General Patrol Restrictions**

When actively performing CID division work, detectives are not authorized to conduct routine patrol duties. This includes, but is not limited to:

* Traffic stops unrelated to an investigation
* Vehicle pursuits
* Checkpoints or saturation patrols
* General patrol enforcement activities

CID operations are investigative in nature and shall not be used as a substitute for routine patrol functions unless specifically authorized.

## **Title 4B | Investigation Related Enforcement**

Detectives may conduct limited or “light” traffic enforcement only when such action is directly related to an active investigation. This includes enforcement actions necessary to:

* Identify, locate, or monitor a suspect
* Prevent immediate compromise of an ongoing investigation
* Address violations discovered incidental to investigative activity

All enforcement actions taken under this authority must remain reasonable, minimal, and investigative in purpose, not patrol-driven.

## **Title 4C | Department Priority**

Primary department obligations take precedence over CID duties. If a detective is requested or directed to handle department-level work, they are required to deactivate CID operations and comply with department tasking unless operationally unable to do so.

Detectives actively engaged in a time-sensitive or critical CID investigation shall notify a Bureau Lead or CID Command when department tasking conflicts with division work.

## **Title 4D | Radio Identification**

Detectives performing CID duties must clearly identify their status by displaying the “CID” designation in their radio callsign while actively engaged in division work.

Once CID operations are deactivated, the CID designation must be removed from the callsign until CID duties are reactivated.

# **Title 5 | Case Management**

## **Title 5A | Case Assignment & Tracking**

### **5A.1 | Case Assignment Authority**

Detectives may initiate or accept cases that fall within the scope of their assigned bureau. Cases may also be directly assigned to a detective by a Bureau Lead or the CID Director at any time.

### **5A.2 | Case Responsibility**

The assigned detective is responsible for maintaining active oversight of their case, including evidence development, intelligence gathering, surveillance, and follow-up actions necessary to advance the investigation.

### **5A.3 | Supervisory Oversight**

Bureau Leads are responsible for monitoring, tracking, and reviewing all investigations initiated or assigned within their bureau and ensuring appropriate progress and documentation.

### **5A.4 | Case Status Definitions**

All CID cases shall be classified under one of the following statuses:

* **Open Case:** A case in which active surveillance, investigative actions, intelligence development, or evidence gathering is ongoing.
* **Cold Case:** A case that has remained open for more than two (2) weeks without the development of new evidence, investigative leads, or actionable intelligence.
* **Closed Case:** A case formally closed by the assigned detective with approval from a Bureau Lead or CID Command, regardless of whether the case resulted in an arrest, prosecution, or was deemed no longer actionable.

## **Title 5B | Case File Documentation Standards**

### **5B.1 | Reporting Requirements**

Detectives are required to complete a detective report and/or incident report following any scene, operation, or investigative action related to their bureau’s responsibilities.

### **5B.2 | Major Incident Reporting**

Following a major incident or significant investigative event, detectives must complete and submit all required reports within twelve (12) hours of scene conclusion unless otherwise authorized by CID Command.

### **Report Content Standards**

All reports must include:

* A complete and accurate summary of events
* All known investigative information and actions taken
* The assigned detective’s name and badge number
* Any associated evidence, witnesses, or follow-up requirements

Failure to meet documentation standards may result in corrective action.

## **Title 5C | Evidence Handling & Chain of Custody**

### **5C.1 | Evidence Collection**

All evidence must be photographed prior to collection whenever feasible. Evidence shall be properly collected, packaged, and preserved, including the recovery of latent or trace evidence from weapons, vehicles, or relevant surfaces when applicable.

### **5C.2 | Documentation**

All collected evidence must be clearly documented within the corresponding incident report or detective report, including the method of collection and relevance to the investigation.

### **5C.3 | Evidence Access Control**

Once submitted, access to case evidence is restricted to the assigned case detective and CID Command staff unless otherwise authorized.

### **5C.4 | Evidence Retention**

No evidence shall be destroyed or disposed of. All evidence must be secured in an approved evidence locker and retained until legal proceedings are complete or formal authorization for disposition is granted by CID Command or the Department of Justice.

## **Title 5D | Ticket Procedure & Management**

### **5D.1 | Ticket Assignment**

When a CID information or investigative ticket is created, a detective from the relevant bureau must respond in a timely manner. If the ticket does not fall into your jurisdiction, rename the ticket to the jurisdiction and the ticket number (ex rename ticket-2000001 to blaine-2000001 by saying in the ticket rename blaine-2000001).

### **5D.2 | Information Gathering**

The handling detective is responsible for gathering all relevant details, requesting additional information as necessary, and determining investigative viability.

### **5D.3 | Documentation**

All information obtained through the ticket process must be documented using the detective’s bureau-specific incident or investigative report format.

### **5D.4 | Ticket Timelines**

CID tickets should not remain open longer than three (3) to five (5) days unless investigative circumstances require additional time and such extension is documented or approved by a Bureau Lead.

# **Title 6 | Confidential Informant (CI) Policy**

## **Title 6A | CI Recruitment**

### **6A.1 | Eligibility Standards**

Individuals considered for recruitment as a Confidential Informant (CI) must not possess a criminal record consisting of more than eight (8) violent felony convictions. Final eligibility determinations remain at the discretion of CID Command.

### **6A.2 | Recruitment Authorization**

Prior to recruiting a CI, the handling detective must notify their respective Bureau Lead. Each detective may have up to 6 confidential informants at a time, this can be changed at the discretion of CID command.

### **6A.3 | Informant Briefing & Agreement**

The assigned handler is responsible for fully briefing the informant on all applicable CI policies, expectations, and restrictions. A CI Agreement Document must be provided to the informant for completion and acknowledgment prior to any use. ( /document)

### **6A.4 | CI Identification & Documentation**

Each CI shall be assigned a unique document number and codename by their handler. This codename shall be used exclusively in all reports, legal documents, and investigative references to protect the informant’s identity.

## **Title 6B | CI Handling & Security**

### **6B.1 | Handler Exclusivity**

Confidential Informants may only be contacted by their assigned handler. Any unauthorized contact with a CI will trigger an internal investigation to determine the source and intent of the contact.

### **6B.2 | Confidentiality Protections**

The disclosure of a CI’s identity or confidential status is strictly prohibited. Any violation of CI confidentiality will result in immediate removal from CID and may result in administrative or legal action.

### **6B.3 | Documentation Standards**

CIs shall be referenced solely by their assigned codename in all investigative documents, reports, warrants, court proceedings, and internal communications.

## **Title 6C | CI Use in Operations**

### **6C.1 | Operational Consent**

CIs may be utilized in investigative or operational activities only after signing a document acknowledging:

* Their voluntary participation
* The inherent risks involved
* The limitations of protection afforded during CI operations

### **6C.2 | Post-Contact Reporting**

Following any interaction with a target individual or organization, the CI must report back to their handler as soon as reasonably possible to relay all relevant information obtained.

### **6C.3 | Operational Control**

CIs shall not act independently, initiate enforcement actions, or deviate from handler instructions unless doing so is necessary to preserve their safety.

## **Title 6D | Compensation**

### **6D.1 | Compensation Determination**

Any form of CI compensation must be documented. Compensation is not guaranteed and is determined based on investigative value and contribution.

### **6D.2 | Approval Authority**

All CI compensation requests must be reviewed and approved by the CID Director prior to issuance.

### **6D.3 | Compensation Structure**

When authorized, CIs may receive compensation calculated as a percentage of the street value of seized items or assets, proportional to their level of contribution and the success of the investigation.

# **Title 7 | Surveillance & UC Operations**

## **Title 7A | Undercover (UC) Certification & Use**

### **7A.1 | Certification Requirements**

Detectives must have participated in a minimum of two (2) approved investigative or operational assignments before being considered for undercover (UC) certification.

UC certification requires approval from both:

* The detective’s Bureau Lead
* CID Command

### **7A.2 | UC Authorization & Handling**

Once a UC operation is approved, the detective’s respective Bureau Lead shall serve as the assigned UC handler for the duration of the operation unless otherwise designated by CID Command.

### **7A.3 | UC Operational Standards**

Undercover personnel:

* Must carry a firearm and radio at all times
* Shall comply with all applicable State of San Andreas laws
* Are prohibited from initiating enforcement actions unless exigent circumstances exist to preserve life or safety

### **7A.4 | Reporting Requirements**

All interactions, contacts, or intelligence obtained during a UC operation must be reported immediately or as soon as reasonably possible to the assigned UC handler.

### **7A.5 | Documentation & Closure**

All UC operations must be:

* Requested using the proper authorization documentation
* Documented throughout the operation
* Formally closed using the appropriate closure documentation

## **7C | Wiretaps and Electronic Intercepts**

### **7C.1 | Authorization Authority**

Any request for a wiretap or electronic interception must be submitted through the Attorney General (AG), District Attorney (DA), or an Assistant District Attorney (ADA) in accordance with legal requirements.

### **7C.2 | Logging & Oversight**

All approved wiretaps must be logged and tracked separately from standard investigative reports and maintained under strict access control by CID Command.

Unauthorized wiretaps or electronic monitoring are strictly prohibited and subject to disciplinary action.

## **Title 7D | Surveillance & Tracking System**

### **7D.1 | System Overview**

The CID are authorized to use tracking devices to place on vehicles if there is probable cause or an approved warrant.

### **7D.2 | Authorized Purposes**

The tracker may only be deployed for CID-approved investigative purposes, including:

* Organized crime and racketeering investigations (RICO-type cases)
* Narcotics manufacturing, trafficking, and distribution networks
* Firearms trafficking and illegal weapons manufacturing
* Ongoing violent felony investigations
* Locating suspects actively evading arrest
* Corroboration of Confidential Informant intelligence
* Evidence collection in long-term covert investigations

The tracker shall not be used for:

* Personal surveillance or curiosity
* Fishing expeditions without articulated cause
* Monitoring civilians absent investigative justification
* Routine patrol or enforcement activity
* Political, social, retaliatory, or biased targeting
* Internal disputes or non-investigative matters

### **7D.3 | Deployment Authorization**

**Approval Requirements**

**Deployment of trackers require written authorization from:**

* The CID Director, or
* The CID Deputy Director, and
* Appropriate DOJ oversight authority when a warrant is required

**Each deployment request must include:**

* Associated case number
* Identified suspect(s) or investigative target
* Clearly articulated probable cause or investigative necessity
* Defined duration of deployment
* Intended evidentiary objective

Open-ended or indefinite deployments are strictly prohibited. Extensions may only be granted with renewed justification and approval.

### **7D.4 | Operational Use Guidelines**

**Camera & Audio Deployment**

* Devices may only be used in locations that are legally permissible or judicially authorized
* Audio monitoring requires explicit authorization due to heightened privacy considerations
* Recordings shall be limited to case-relevant material only
* Non-pertinent recordings must be flagged, excluded from evidence, and handled per policy

**GPS Tracking**

* GPS tracking may be used to establish movement patterns, meeting locations, or flight risk
* Tracking duration is time-limited and requires renewal with justification
* GPS data is classified as controlled evidence and logged accordingly

### **7D.5 | Abuse Prevention & Safeguards**

To prevent misuse, CID enforces the following controls:

**Structural Safeguards**

* No single-person authorization
* Mandatory written justification
* Supervisory review
* Time-limited deployments
* DOJ or Command oversight when required

**Violations may result in:**

* Removal from CID
* Disciplinary action
* Criminal charges when applicable

# **Title 8 | Joint Operations & Inter-Bureau Cooperations**

## **Title 8A | Collaboration with SWAT and Patrol**

### **8A.1 | Coordination Authority**

Any CID detective may coordinate investigative support with SWAT or patrol units; however, the detective should notify their respective Bureau Lead and the CID Director prior to initiating joint operational coordination.

### **8A.2 | Command Boundaries**

CID detectives do not exercise command authority over SWAT units. Detectives may work alongside SWAT personnel in a collaborative role, providing investigative intelligence, target information, and case context while SWAT maintains tactical command and control.

## **Title 8B | Task Force Operations (TFOs)**

### **8B.1 | Task Force Authorization**

A Bureau Lead may coordinate with SWAT and CID Command to establish a Task Force Operation (TFO) focused on a specific geographic area, criminal organization, or investigative objective aligned with the bureau’s mission.

**Operational Roles**
During a TFO:

* CID detectives are responsible for intelligence development, target identification, and investigative direction
* SWAT maintains tactical execution and enforcement authority
* Detectives may advise SWAT on priority targets and investigative objectives, but shall not issue tactical commands

### **8B.2 | Documentation Requirements**

All arrests, searches, seizures, or enforcement actions resulting from a TFO must be fully documented by CID detectives using the appropriate bureau investigative or incident reports.

## **Title 8C | Federal / DOJ Liaison**

### **8C.1 | Liaison Role**

Bureaus may designate a detective to serve as a Department of Justice (DOJ) Liaison.

### **8C.2 | Liaison Responsibilities**

The DOJ Liaison acts as the primary point of communication between CID and prosecutorial authorities, including the Attorney General (AG), District Attorney (DA), and Assistant District Attorneys (ADAs), regarding:

* Search warrants
* Wiretap requests
* Subpoenas
* Organized crime or enterprise-level investigations

### **8C.3 | Authority Limitations**

The DOJ Liaison facilitates communication and coordination only and does not independently authorize legal actions without proper approval from CID Command and prosecutorial authorities.

# **Title 9 | Disciplinary & Professional Standards**

## **Title 9A | General Expectations**

All detectives assigned to the Criminal Investigation Division are expected to maintain a professional demeanor and conduct both on and off duty.

CID detectives are sworn peace officers of the State of San Andreas and shall, at no time:

* Violate any applicable law
* Violate departmental or CID SOPs
* Engage in conduct that undermines the integrity, credibility, or public trust of the division

Detectives shall conduct themselves with discretion and professionalism in all interactions, including with the public, other departments, command staff, and within internal communications. Confidential information, investigative access, and CID resources shall only be used for legitimate investigative purposes and never for personal gain, retaliation, favoritism, or harassment. Any behavior—on or off duty—that creates the appearance of bias, abuse of authority, or misuse of investigative powers may be treated as a violation of CID standards regardless of intent.

Detectives are further expected to respect the chain of command, comply promptly with lawful instructions, and maintain accountability for their actions at all times. Failure to uphold these expectations may result in disciplinary review even in the absence of a criminal or policy violation.

## **Title 9B | Grounds for Disciplinary Action**

Any detective found to have engaged in the following conduct may be subject to disciplinary action, up to and including removal from CID:

* Violation of CID or departmental SOPs
* Violation of the Penal Code or other applicable laws
* Disrespect toward CID Command, Bureau Leads, or Department Command
* Failure or refusal to obey lawful instructions issued by a Bureau Lead or CID Command
* Violation of any signed agreement, policy acknowledgment, or conditions of assignment within CID

Violations of CID agreements or misuse of investigative authority may also expose the detective to administrative or legal action as applicable.

## **Title 9C | Probation/Removal Process**

At the discretion of the CID Director, a detective may be placed on CID probation for a specified period pending review, investigation, or corrective action.

A detective placed on probation remains assigned to CID but is prohibited from exercising detective authority, including but not limited to:

* Operating or driving CID or unmarked investigative vehicles
* Wearing plainclothes or tactical investigative attire
* Representing themselves as a CID detective
* Participating in investigative or enforcement actions

If the CID Director determines that a detective should no longer remain within the division, the detective shall be immediately notified of their removal.

Upon removal from CID, the detective must:

* Surrender all CID-issued equipment and materials
* Cease operation of CID or unmarked vehicles unless otherwise authorized by their primary department
* Discontinue use of CID plainclothes or tactical attire unless permitted by department policy
* Have all access revoked to CID documents, intelligence, case files, and systems previously available through their CID assignment

# **Title 10 | Training & Certifications**

## **Title 10A | Continued Education**

Detectives assigned to CID are expected to engage in ongoing professional development throughout their assignment.

Continued education expectations include:

* Learning new investigative and surveillance methods
* Familiarization with newly introduced equipment or technology
* Updates to legal procedures, evidentiary standards, or prosecutorial requirements
* Any additional training or instruction deemed necessary by the CID Director or CID Command

Failure to participate in required training or continued education may impact a detective’s standing within the division or eligibility for specialized assignments.

# **Title 11 | Administrative Policies**

## **Title 11A | Documentation & Records Management**

The CID Director is responsible for the maintenance, organization, and oversight of all investigative records, reports, intelligence files, and administrative documentation within the Criminal Investigation Division.

In the event that Department Command or executive leadership requests access to CID records or information, such requests must be submitted through a formal request process. Requests may be approved or denied by the CID Director, with justification provided when access is restricted due to investigative sensitivity, confidentiality concerns, or legal limitations.

The CID Director reports directly to executive leadership, including the Chief of Police, Sheriff, Colonel, and Commissioner, and is accountable for ensuring CID records are maintained in a manner consistent with legal, administrative, and departmental standards.

## **Title 11B | Data Security & Confidentiality**

All CID documents, intelligence, and investigative materials are restricted to authorized CID personnel only unless otherwise approved by CID Command.

Confidential Informant (CI) agreement forms and related documentation are restricted to the assigned handler and the CID Director. Unauthorized access, duplication, or dissemination of CI materials is strictly prohibited.

Any breach of data security, unauthorized disclosure, or violation of confidentiality agreements within CID will result in an internal investigation conducted by the CID Director in coordination with Department Command and may result in disciplinary or legal action.

# **Title 12 | Detective Compensation**

## **Title 12A | Performance Based Compensation**

Detectives assigned to the Criminal Investigation Division may be eligible for bi-weekly or monthly bonus compensation based on their investigative workload, case progression, initiative, and overall contribution during the applicable period.

All bonus compensation is discretionary and subject to approval by CID Command. Compensation is not guaranteed and may be adjusted or withheld based on performance, compliance with CID standards, or disciplinary status.

## **Title 12B | Operational & Raid-Based Compensation**

In the event a raid, enforcement action, or coordinated operation results in the seizure of illegal items, evidence, or assets, detectives may submit a compensation request for:

* The primary case detective
* Supporting CID detectives
* Authorized Confidential Informants (CIs), when applicable

All compensation requests must be formally submitted and justified based on investigative contribution and operational involvement.

Compensation requests shall accurately reflect each individual’s level of participation, risk exposure, and investigative contribution to the operation. Requests based solely on presence or minimal involvement may be reduced or denied. Detectives are prohibited from submitting compensation requests for themselves without supporting documentation outlining their role in the operation.

Compensation requests involving Confidential Informants must clearly document the CI’s contribution and comply with all CI policies and approval requirements. Any misrepresentation, exaggeration, or attempt to manipulate compensation determinations may result in denial of payment and potential disciplinary action.

## **Title 12C | Compensation Approval & Payment Brackets**

All compensation requests are reviewed and approved by CID Command. Final payment determinations shall be based on established compensation brackets, investigative impact, risk exposure, and level of contribution.

CID Command shall utilize the following compensation bracket framework when determining payments:

| Street Value | Percentage Given |
| :---: | :---: |
| $1,000,000-$2,499,999 | 60% |
| $2,500,000-$7,499,999 | 50% |
| $7,500,000-$14,999,999 | 40% |
| $15,000,000-$24,999,999 | 30% |
| $25,000,000+ | 20% |

CID Command retains final authority to approve, modify, or deny any compensation request to ensure fairness, consistency, and compliance with CID policy.$sop$;
begin
  -- Locate the SOP row: the post-refresh identity first, then the legacy seed
  -- identity from 20260616180000. Same physical row either way — the update
  -- keeps its id, so acknowledgements/versions/relations/bookmarks survive.
  select * into d from public.documents
   where (folder = 'SOPs' and name = v_name)
      or (folder = 'SOP/Training' and name = 'CID Standard Operating Procedure.doc')
   order by case when folder = 'SOPs' then 0 else 1 end
   limit 1
   for update;

  if not found then
    -- Defensive: a database where the seed row was removed. Create the
    -- document fresh rather than silently shipping without the SOP.
    insert into public.documents (folder, name, kind, content, modified_label,
                                  category, document_type, status, classification,
                                  source_system, source_modified_at, effective_at, tags)
    values ('SOPs', v_name, 'doc', jsonb_build_object('body', v_body),
            to_char(now(), 'DD/MM/YYYY'), 'sops', 'sop', 'published', 'internal',
            'imported', timestamptz '2026-08-03 00:00:00+00',
            timestamptz '2026-08-03 00:00:00+00',
            '["OdysseyRP", "CID SOP"]'::jsonb)
    returning * into d;
    insert into public.documents_versions
      (document_id, name, kind, content, modified_label, version_number,
       change_type, change_summary, requires_reack, source_system, effective_at, metadata)
    values (d.id, d.name, d.kind, d.content, d.modified_label, d.current_version_number,
            'procedural',
            'Imported the current OdysseyRP CID SOP (source last modified 2026-08-03).',
            true, 'imported', d.effective_at,
            jsonb_build_object('status', d.status, 'classification', d.classification));
    return;
  end if;

  -- Idempotent: nothing to do when the live body already matches.
  if md5(coalesce(d.content ->> 'body', '')) = md5(v_body) then
    return;
  end if;

  v_next := d.current_version_number + 1;

  update public.documents
     set folder = 'SOPs',
         name = v_name,
         content = coalesce(content, '{}'::jsonb) || jsonb_build_object('body', v_body),
         modified_label = to_char(now(), 'DD/MM/YYYY'),
         category = 'sops',
         document_type = 'sop',
         source_system = 'imported',
         source_modified_at = timestamptz '2026-08-03 00:00:00+00',
         effective_at = timestamptz '2026-08-03 00:00:00+00',
         current_version_number = v_next,
         tags = '["OdysseyRP", "CID SOP"]'::jsonb
   where id = d.id
   returning * into d;

  insert into public.documents_versions
    (document_id, name, kind, content, modified_label, version_number,
     change_type, change_summary, requires_reack, source_system, effective_at, metadata)
  values (d.id, d.name, d.kind, d.content, d.modified_label, v_next,
          'procedural',
          'Replaced with the current OdysseyRP CID SOP (authoritative Google Drive document, source last modified 2026-08-03). Three-bureau jurisdiction model, updated CI/UC/tracking policy, and the Title 12C compensation brackets.',
          true, 'imported', d.effective_at,
          jsonb_build_object('status', d.status, 'classification', d.classification));
end $mig$;

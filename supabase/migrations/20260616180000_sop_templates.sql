-- Official CID standard operating procedures, blank forms & training material.
-- These are ORG-STANDARD templates (not demo/case data): reusable blank forms and
-- a training playbook that ship with the platform. Stored as live `documents` rows
-- so they appear in the CID General Drive and are fully editable / exportable.
-- Idempotent: upsert on the (folder, name) unique key added in 20260616160000.

-- ---- Forms folder: blank, reusable paperwork templates -------------------------

insert into public.documents (folder, name, kind, content, modified_label) values
('Forms', 'CID Investigative Report.doc', 'doc', jsonb_build_object('body', $doc$CID INVESTIGATIVE REPORT
Criminal Investigations Department — Major Crimes Bureau — FOR OFFICIAL USE ONLY

CASE / REPORT DETAILS
| Case Number | Report Type | Date / Time Filed |
| | Initial | |

DETECTIVE INFORMATION
| Name | Rank | Callsign | Department |
| | | | |

SUSPECT / WITNESS INFORMATION
| Name | Phone | DOB |
| | | |

RIGHTS ADVISEMENT
- Article 31 / Miranda rights administered
| Date / Time | Rights Waived? | Rights Witness |
| | Yes / No | |

INCIDENT DETAILS
| Type of Incident | |
| Date/Time of Incident | |
| Location of Incident | |
| Involved Parties | |
| MCB Classification | |

NARRATIVE / STATEMENT
(narrative)

EVIDENCE / PROPERTY
| Item(s) | |
| Collected by | |
| Files | |

DETECTIVE REMARKS
(remarks)

INVESTIGATIVE ACTIONS
| Action Taken |
| |

STATEMENT OF UNDERSTANDING
By completing this report, I understand that I am strictly prohibited from disclosing any information, reports, or materials pertaining to Criminal Investigation Division (CID) matters, whether ongoing, past, or closed, as doing so may jeopardize the integrity of investigative processes, compromise the rights and safety of individuals involved, and undermine the mission of CID. I further acknowledge that any unauthorized disclosure of such information may result in disciplinary, administrative, or criminal consequences under applicable laws and regulations.
$doc$), to_char(now(), 'DD/MM/YYYY')),

('Forms', 'Raid Seizure Value Distribution & Allocation Form.doc', 'doc', jsonb_build_object('body', $doc$RAID SEIZURE VALUE DISTRIBUTION & ALLOCATION FORM
Criminal Investigations Department — FOR OFFICIAL USE ONLY

CASE INFORMATION
| Bureau | Case # | Operation Name | Date of Seizure | Location of Seizure |
| | | | | |

SEIZURE INVENTORY & VALUATION
| Item | Quantity | Unit Street Value | Total Street Value |
| | | | |

AUTHORIZED DIRECTOR DISTRIBUTION
| Total Net Seizure Value ($) | |
| Amount to Lead Detective ($) | |
| Amount to Division | |
| Other Allocations (if any) | |
| Director Signature | |
| Date | |

LEAD DETECTIVE ALLOCATION
| Recipient Type | Recipient Name/Identifier | Allocation ($) |
| | | |

FINAL AUTHORIZATION
| Director Signature | Lead Detective Signature |
| | |
$doc$), to_char(now(), 'DD/MM/YYYY')),

('Forms', 'UC Operation Activity Report.doc', 'doc', jsonb_build_object('body', $doc$UNDERCOVER OPERATION ACTIVITY REPORT
Criminal Investigations Department — FOR OFFICIAL USE ONLY

REPORT INFORMATION
| Report Type | Date Submitted | UC Officer Name | Bureau | Operation Code/Case ID |
| | | | | |

OPERATION OVERVIEW
| Date(s) of UC Activity | |
| Primary Objective | |
| Summary of Activities | |

CONTACTS & INTERACTIONS  (add more rows as needed)
| Individuals Met or Observed | Nature of Interaction | Summary of Key Conversations / Actions |
| | | |

INTELLIGENCE & EVIDENCE  (add more rows as needed)
| Items Observed or Discussed | Description of Evidence / Intelligence |
| | |

Photos / Recordings Captured: (attach references here)

OPERATIONAL ASSESSMENT
| Threat Level | UC Cover Status |
| | |

Additional Notes:

REVIEW & APPROVAL
| UC Officer Signature | Unit Lead Signature |
| | |
$doc$), to_char(now(), 'DD/MM/YYYY'))
on conflict (folder, name) do update
  set content = excluded.content, kind = excluded.kind, modified_label = excluded.modified_label;

-- ---- SOP/Training folder: investigative playbook ------------------------------

insert into public.documents (folder, name, kind, content, modified_label) values
('SOP/Training', 'CID Case Building Playbook.doc', 'doc', jsonb_build_object('body', $doc$CID CASE BUILDING PLAYBOOK
Step-by-Step Investigation Guide — Criminal Investigations Division Training Manual

PURPOSE OF THIS GUIDE
The purpose of this playbook is to provide detectives with a clear and consistent framework for building criminal cases within the Criminal Investigations Division (CID). Investigations conducted by CID often involve complex criminal activity, organized groups, or individuals who actively attempt to avoid law enforcement detection. Because of this, detectives must approach investigations with patience, organization, and attention to detail.

Strong criminal cases are rarely solved through a single arrest or incident. Instead, successful investigations are built over time by gathering information from multiple sources and carefully documenting how each piece of evidence connects to the larger case.

Following a standardized investigative process helps ensure that:
- Investigations remain organized and structured
- Evidence is collected legally and documented properly
- Supervisors can review investigative progress when needed
- Prosecutors receive complete and well-documented case files
- Cases are able to withstand legal review in court

CID detectives must remember that every investigative action may later be examined by a judge, prosecutor, or defense attorney. For this reason, clear documentation and professionalism must be maintained at every stage of the investigation.

STEP 1 — CASE INITIATION
Opening an Investigation
A CID investigation begins when criminal activity is identified that requires follow-up beyond normal patrol operations. Complex cases involving repeated offenses, organized criminal activity, or ongoing investigations are typically assigned to CID detectives.

Investigations may originate from several sources, including:
- Patrol officer incident reports
- Intelligence gathered by CID detectives
- Civilian complaints or witness reports
- Confidential informants
- Surveillance observations
- Evidence discovered during other investigations
- Major incidents such as shootings, robberies, kidnappings, or organized crime activity

Case File Creation
Every investigation must begin with the creation of a documented case file. At minimum the case file should include:
- Case number
- Date the investigation was opened
- Name and badge number of the lead detective
- Brief summary of suspected criminal activity
- Known suspects, persons of interest, or criminal organizations involved

The detective initiating the case should also document HOW the investigation originated (patrol report, citizen complaint, informant tip, or a prior CID investigation).

STEP 2 — INTELLIGENCE GATHERING
Developing the Initial Profile
After opening a case, detectives should build a basic profile of the suspects and their operations, identifying:
- Full legal names and known aliases
- Known associates or accomplices
- Vehicles owned, registered, or regularly used
- Residential addresses and known meeting locations
- Businesses connected to the suspects
- Criminal history records
- Gang affiliations or criminal organization membership

Intelligence Sources
- Patrol Officer Reports — suspect behavior and known locations from stops and calls for service.
- Previous Investigations — past CID cases may contain relevant intelligence.
- Witness Interviews — activities, meeting locations, and associates.
- Surveillance Footage — security and city cameras documenting movements.
- Field Contacts — individuals who frequent areas where suspects operate.
All intelligence gathered should be carefully documented within the case file.

STEP 3 — SURVEILLANCE AND MONITORING
Surveillance lets detectives observe suspects without direct interaction, confirm criminal activity, identify additional individuals, and verify intelligence.

Types of Surveillance
- Mobile Surveillance — following suspects in unmarked vehicles while maintaining distance.
- Static Surveillance — monitoring a fixed residence, business, or meeting area.
- Foot Surveillance — used where vehicle observation is impractical; blend into the environment.

Surveillance Equipment
- Body Cameras — keep active during investigative contacts and enforcement actions.
- Meta Glasses / Covert Recording Devices — document conversations during UC/plain-clothes work.
- Drones — aerial observation of locations difficult to monitor from the ground.
- Unmarked Surveillance Vehicles — observe without alerting suspects to LE presence.

Surveillance Logs must include date/time, location, individuals observed, vehicles used, suspicious or criminal activity, and interactions. These logs may later support search or arrest warrants.

STEP 4 — EVIDENCE COLLECTION
Evidence is the foundation of every criminal case and must be reliable and properly documented.

Common Forms of Evidence: body camera recordings, surveillance footage, drone recordings, witness statements, photographs of criminal activity, physical evidence, electronic communications, and financial records.

Undercover Operations and Disguises should always be carefully planned and documented, maintaining covert recording devices whenever possible.

Evidence Handling and Chain of Custody — all evidence must be:
- Properly labeled
- Logged into evidence storage systems
- Documented in the case file
- Preserved in a condition suitable for court presentation
Improper evidence handling may result in evidence being excluded during prosecution.

STEP 5 — ESTABLISHING PROBABLE CAUSE
Probable cause is the legal standard required before an arrest or search. It exists when the available evidence would lead a reasonable person to believe a crime has been committed and a specific individual is responsible.

The investigation must answer:
- Who committed the crime?
- What crime occurred?
- Where did the crime occur?
- What evidence connects the suspect to the offense?
- Why does the available evidence support the conclusion that the suspect committed the crime?

Probable cause may be established through witness statements, surveillance observations, physical evidence, and recorded conversations.
$doc$), to_char(now(), 'DD/MM/YYYY')),

('SOP/Training', 'CID Standard Operating Procedure.doc', 'doc', jsonb_build_object('body', $doc$CRIMINAL INVESTIGATION DIVISION (CID) STANDARD OPERATING PROCEDURE

TITLE 1 | INTRODUCTION

Title 1A | Mission Statement
The mission of the Criminal Investigation Division (CID) is to detect, investigate, disrupt, and dismantle criminal activity through professional investigative practices, intelligence gathering, and coordinated operations with internal and external law enforcement partners. CID is dedicated to protecting the citizens of Los Santos by targeting street-level criminal activity, repeat offenders, and organized criminal enterprises, with an emphasis on long-term case development, lawful evidence collection, and prosecutorial integrity. Through an organizational structure that balances Street Crimes, Major Crimes, and Firearms & Drug Enforcement, CID maintains the ability to respond swiftly to emergent threats while sustaining complex, intelligence-driven investigations aimed at dismantling long-term criminal networks.

Title 1B | Hiring and Selection Process
Any sworn officer, deputy, or trooper within their respective department who wishes to transfer into CID must submit a CID application in a professional and complete manner.
Standards: applications must be personally authored by the applicant; use of outside assistance, templates, AI tools, or third-party drafting resources is strictly prohibited; any application determined to be falsified, externally assisted, or plagiarized will be immediately disqualified; submission of an invalid application may result in temporary or permanent ineligibility at the discretion of CID Command.
CID selection is competitive and based on, but not limited to: investigative aptitude and critical thinking; written communication and report quality; prior disciplinary history and integrity; demonstrated professionalism, discretion, and reliability. Submission of an application does not guarantee acceptance into CID.

Title 1C | CID Structure — three operational bureaus
1C.1 Los Santos CID (LSPD): investigations within city jurisdiction — violent crime, organized crime, narcotics trafficking, and businesses/locations within city limits. LSPD detectives typically lead investigations originating within the city.
1C.2 Blaine County Sheriff's Office CID (BCSO CID): investigations throughout Blaine County and surrounding rural jurisdictions — rural narcotics, Sandy Shores/Grapeseed/Paleto Bay activity, county gang activity. BCSO detectives generally lead investigations originating within the county.
1C.3 Statewide Investigations CID (SAHP CID): a statewide investigative unit not limited to a single jurisdiction — multi-jurisdiction and joint task force investigations, organized crime operating across jurisdictions, and major investigations requiring statewide authority.
1C.4 Joint Task Force Operations (all bureaus): CID still functions as a joint investigative task force when criminal organizations cross jurisdictions. Detectives may request assistance from other CID teams; multi-agency cases may form joint investigative teams; intelligence and resources are shared across all CID teams.

TITLE 2 | CHAIN OF COMMAND

Title 2A | CID Command Staff
2A.1 CID Director — the senior authority within the Criminal Investigation Division, responsible for overall leadership, direction, and integrity of the division. The Director establishes investigative priorities, assigns and oversees case ownership, maintains custody of sensitive investigative materials, and serves as the primary liaison to Department Command, High Command, the Department of Justice, and external agencies. Duties include: assigning investigative leads and case ownership; maintaining custody of sensitive case files, intelligence reports, and classified materials; serving as primary liaison; establishing investigative priorities and division-wide standards; upholding professionalism and the division's public image; final authority on CID personnel assignments, removals, and disciplinary recommendations.
2A.2 Deputy CID Director — second-in-command, acts with full authority in the Director's absence. Assists oversight and coordination of all CID bureaus; ensures bureau compliance with SOPs and standards; reviews case progress, warrants, and documentation; serves as the primary intermediary between Bureau Leads and the CID Director; assumes command authority when delegated.

Title 2B | Bureau Leadership
2B.1 Bureau Lead — direct supervision, management, and operational effectiveness of detectives in their bureau. Assigns cases and tasks; monitors case progression and follow-ups; reviews and approves reports, affidavits, and warrant submissions prior to command-level review; ensures detectives operate within legal, procedural, and policy boundaries; reports bureau status to CID Command; maintains accountability, discipline, and professionalism.

Title 2C | Investigative Personnel
Senior Detective — experienced investigators and mentors: lead complex/high-priority investigations; mentor detectives; assist Bureau Leads with case reviews, evidence organization, and planning; act as temporary supervisory authority when directed; ensure investigative quality and compliance.
Detective — carry out investigative duties under a Bureau Lead or Senior Detective: conduct investigations per CID SOPs; file incident, supplemental, and investigative reports; prepare and submit search/arrest warrants, subpoenas, and affidavits; collect and maintain evidence per chain-of-custody standards; conduct interviews and witness statements.

TITLE 3 | EQUIPMENT
3A Vehicle Policy — authorized vehicles: CID SUV, CID Bravado Banshee, CID Burrito, and personal vehicles (UC/surveillance only). All authorized CID vehicles operate unmarked. Low-profile emergency lighting only, activated solely in exigent circumstances. Personal vehicles may not be used for enforcement, stops, or pursuits; deep undercover (e.g., joining a gang) requires CID Command approval. When not on CID duty, comply with primary department vehicle policy.
3B Uniform Policy — plainclothes (business casual, Bureau Lead approval) for routine duties; tactical attire restricted to authorized operations (warrant service, planned enforcement, high-risk ops); undercover attire may mimic civilians/gangs for surveillance. Return to primary-department uniform when off CID duty.
3C Police Equipment — carry a department-issued firearm at all times on duty; maintain investigative equipment in-vehicle (unless undercover); Class 2/Class 3 long guns secured in vehicle gun rack per the Weapons and Attachments SOP, deployed only in authorized operational circumstances.

TITLE 4 | PATROL POLICIES
4A General Patrol Restrictions — while on CID work, no routine patrol duties (unrelated traffic stops, pursuits, checkpoints/saturation patrols, general enforcement).
4B Investigation-Related Enforcement — limited/"light" enforcement only when directly related to an active investigation (identify/locate/monitor a suspect; prevent compromise; address incidental violations). Actions must remain reasonable, minimal, and investigative.
4C Department Priority — primary department obligations take precedence; deactivate CID operations when directed to department tasking, notifying a Bureau Lead/CID Command on conflict with time-sensitive work.
4D Radio Identification — display the "CID" designation in the callsign while on division work; remove it once CID operations are deactivated.

TITLE 5 | CASE MANAGEMENT
5A Case Assignment & Tracking — detectives may initiate/accept cases within their bureau scope; cases may be assigned by a Bureau Lead or the CID Director. Assigned detective maintains active oversight. Bureau Leads monitor and review all bureau investigations.
Case Status Definitions: Open (active surveillance/investigation/evidence ongoing); Cold (open >2 weeks without new evidence/leads/intelligence); Closed (formally closed with Bureau Lead/CID Command approval, regardless of arrest outcome).
5B Documentation Standards — complete a detective and/or incident report after any scene, operation, or investigative action. Major incidents: submit required reports within 12 hours of scene conclusion. Reports must include a complete and accurate summary, all investigative info and actions, detective name and badge number, and associated evidence/witnesses/follow-ups.
5C Evidence Handling & Chain of Custody — photograph evidence prior to collection when feasible; collect, package, and preserve properly (including latent/trace evidence); document collection method and relevance; access restricted to assigned detective and CID Command; no evidence destroyed/disposed — secure in an approved locker and retain until proceedings complete or disposition authorized by CID Command/DOJ.
5D Ticket Procedure — respond to CID tickets timely; if out of jurisdiction, rename ticket to jurisdiction + number (e.g., ticket-2000001 -> blaine-2000001); gather all relevant details; document via bureau-specific report; tickets should not remain open longer than 3-5 days without documented/approved extension.

TITLE 6 | CONFIDENTIAL INFORMANT (CI) POLICY
6A Recruitment — CIs must not have more than eight (8) violent felony convictions (final eligibility at CID Command discretion). Notify the Bureau Lead before recruiting. Each detective may have up to 6 CIs at a time (adjustable by CID Command). Brief the informant fully; provide a CI Agreement Document for completion prior to use. Assign each CI a unique document number and codename, used exclusively in all references.
6B Handling & Security — CIs may only be contacted by their assigned handler; unauthorized contact triggers an internal investigation. Disclosure of a CI's identity/status is strictly prohibited; violations result in immediate removal and possible administrative/legal action. Reference CIs solely by codename in all documents.
6C Use in Operations — CIs may be used only after signing acknowledgment of voluntary participation, inherent risks, and limitations of protection. CIs report back to the handler ASAP after contact; CIs do not act independently or initiate enforcement unless necessary for safety.
6D Compensation — all CI compensation documented; not guaranteed; based on investigative value. All CI compensation requests reviewed and approved by the CID Director prior to issuance. When authorized, calculated as a percentage of street value proportional to contribution.

TITLE 7 | SURVEILLANCE & UC OPERATIONS
7A Undercover Certification & Use — minimum two (2) approved assignments before UC certification; requires approval from both the Bureau Lead and CID Command. The Bureau Lead serves as UC handler unless otherwise designated. UC personnel carry a firearm and radio at all times, comply with all SA laws, and may not initiate enforcement unless exigent circumstances exist. Report all interactions/intelligence to the handler ASAP. UC operations are requested, documented throughout, and formally closed with proper documentation.
7C Wiretaps & Electronic Intercepts — requests submitted through the AG, DA, or ADA per legal requirements; approved wiretaps logged/tracked separately under strict access control by CID Command; unauthorized wiretaps prohibited.
7D Surveillance & Tracking System — trackers may be placed on vehicles only with probable cause or an approved warrant, for CID-approved purposes (RICO, narcotics networks, firearms trafficking, ongoing violent felonies, locating evading suspects, corroborating CI intelligence, long-term covert evidence). Prohibited for personal surveillance, fishing expeditions, monitoring civilians without justification, routine patrol, biased/retaliatory targeting, or internal disputes.
Deployment authorization requires written authorization from the CID Director or Deputy Director, plus DOJ oversight when a warrant is required. Each request includes case number, identified target(s), articulated probable cause/necessity, defined duration, and intended evidentiary objective. Open-ended deployments prohibited; extensions require renewed justification.
Safeguards: no single-person authorization; mandatory written justification; supervisory review; time-limited deployments; DOJ/Command oversight when required. Violations may result in removal from CID, disciplinary action, or criminal charges.

TITLE 8 | JOINT OPERATIONS & INTER-BUREAU COOPERATION
8A SWAT/Patrol Collaboration — any detective may coordinate support but should notify their Bureau Lead and the CID Director first; CID does not exercise command over SWAT (SWAT maintains tactical command; CID provides intelligence and case context).
8B Task Force Operations (TFOs) — a Bureau Lead may coordinate with SWAT and CID Command to establish a TFO; CID handles intelligence/target identification/investigative direction while SWAT handles tactical execution; all resulting actions documented by CID.
8C Federal/DOJ Liaison — bureaus may designate a DOJ Liaison as the primary communication point with the AG/DA/ADAs for warrants, wiretaps, subpoenas, and enterprise investigations; the liaison facilitates only and does not independently authorize legal actions.

TITLE 9 | DISCIPLINARY & PROFESSIONAL STANDARDS
9A General Expectations — maintain professional demeanor on and off duty; never violate law or SOPs or undermine the division's integrity; use confidential information and CID resources only for legitimate investigative purposes; respect the chain of command and comply with lawful instructions.
9B Grounds for Disciplinary Action — SOP/penal violations, disrespect toward Command/Bureau Leads, failure/refusal to obey lawful instructions, violation of signed agreements or assignment conditions; may result in removal and administrative/legal action.
9C Probation/Removal — at the CID Director's discretion a detective may be placed on probation (prohibited from exercising detective authority — vehicles, attire, representation, enforcement). On removal, surrender all CID equipment/materials, cease CID vehicle/attire use, and have all CID access revoked.

TITLE 10 | TRAINING & CERTIFICATIONS
10A Continued Education — ongoing professional development: new investigative/surveillance methods, new equipment/technology, legal/evidentiary updates, and any training deemed necessary by CID Director/Command. Failure to participate may impact standing or eligibility for specialized assignments.

TITLE 11 | ADMINISTRATIVE POLICIES
11A Records Management — the CID Director maintains and oversees all investigative records, reports, intelligence files, and administrative documentation. External access requests are submitted formally and may be approved/denied by the Director. The Director reports directly to executive leadership (Chief of Police, Sheriff, Colonel, Commissioner).
11B Data Security & Confidentiality — CID documents/intelligence restricted to authorized CID personnel; CI agreement forms restricted to the assigned handler and the CID Director; breaches trigger an internal investigation and may result in disciplinary/legal action.

TITLE 12 | DETECTIVE COMPENSATION
12A Performance-Based — discretionary bi-weekly/monthly bonus based on workload, case progression, initiative, and contribution; subject to CID Command approval; not guaranteed.
12B Operational & Raid-Based — when an operation seizes illegal items/assets, detectives may submit compensation requests for the primary detective, supporting detectives, and authorized CIs; requests must be justified by contribution and involvement; misrepresentation may result in denial and disciplinary action.
12C Approval & Payment Brackets — reviewed/approved by CID Command using the bracket framework:
$1,000,000-$2,499,999 = 60% | $2,500,000-$7,499,999 = 50% | $7,500,000-$14,999,999 = 40% | $15,000,000-$24,999,999 = 30% | $25,000,000+ = 20%.
CID Command retains final authority to approve, modify, or deny any compensation request.
$doc$), to_char(now(), 'DD/MM/YYYY'))
on conflict (folder, name) do update
  set content = excluded.content, kind = excluded.kind, modified_label = excluded.modified_label;

-- ---- Case assignment & reference material -------------------------------------

insert into public.documents (folder, name, kind, content, modified_label) values
('Case assignment Help??!?', 'Case Assignment Procedure.doc', 'doc', jsonb_build_object('body', $doc$CID CASE ASSIGNMENT PROCEDURE

STEP 1 — CASE SUBMISSION
New cases enter the CID system through the CID Case Intake Form, used by patrol officers requesting follow-up, CID detectives initiating investigations, and supervisors referring cases. The intake form collects: incident report number, date of incident, reporting officer, department (LSPD / BCSO / SAHP), brief summary, known suspects, available evidence, and priority level. On submission the case is logged into the CID Case Tracking Sheet.

STEP 2 — CASE REVIEW
CID leadership or designated case coordinators review the case to determine primary jurisdiction, whether a joint investigation is required, priority level, and which investigative team should handle it. This prevents duplicate investigations.

STEP 3 — CASE ASSIGNMENT
The case is assigned to a lead detective within the appropriate CID team based on availability, workload, specialization (narcotics, gangs, organized crime), and jurisdiction. The assigned detective opens the full case file, conducts follow-up, coordinates efforts, and updates progress. Additional detectives may assist when necessary.

STEP 4 — CASE STATUS TRACKING
Each investigation is assigned a status: New Case (awaiting assignment), Assigned (investigation begun), Active Investigation (actively gathering evidence), Joint Investigation (multiple teams), Pending Evidence/Leads (paused awaiting info), Case Closed (completed or forwarded for prosecution).

STEP 5 — CASE OWNERSHIP RULES
The assigned detective is the primary case holder. Other detectives should not independently investigate the same incident without coordinating with the assigned detective. Detectives may assist when requested, but the lead detective maintains overall responsibility.

STEP 6 — CASE UPDATES
Assigned detectives maintain regular updates whenever significant actions occur: interviews conducted, surveillance completed, evidence recovered, warrants requested/executed, arrests made.

STEP 7 — SUPERVISOR OVERSIGHT
CID supervisors periodically review active investigations to ensure cases progress appropriately, detectives are not overloaded, and documentation is maintained. Supervisors may reassign cases due to workload or investigative needs.
$doc$), to_char(now(), 'DD/MM/YYYY'))
on conflict (folder, name) do update
  set content = excluded.content, kind = excluded.kind, modified_label = excluded.modified_label;

insert into public.documents (folder, name, kind, content, modified_label) values
('Resources', 'CID Roster.doc', 'doc', jsonb_build_object('body', $doc$CID ROSTER

DIVISION OVERSIGHT
E-2  | Active | CID Oversight | Leon Kennedy | j.nowlin88
901  | Active | CID Oversight | Justin Miller | tex_ass.

DETECTIVE COMMAND
902  | Active | Director | Oliver Ocho | ochoyoudidnt
     | N/A    | Deputy Director |

LOS SANTOS BUREAU
Bureau Lead          | Active | Lulu Law-Slappy | trxxma
Detective Supervisor | Active | LaShawne Harris | lashawne
Detective            | Active | Aj Snow | ollyc218

BLAINE COUNTY BUREAU
10C3  | Active | Bureau Lead       | Mitch Morrison  | _gravemilk     | 907-453-7242
10L3  | Active | Senior Detective  | Blake Davis     | domisbetterer  | 907-398-1063 | North — Roxwood & Paleto
10D48 | Active | Detective         | Antonio Moretti | ohare8771      | 602-122-0999 | North — Paleto
10R2  | Active | Detective         | Hunter Jones    | ergology       | 205-248-1363 | South — Grapeseed
10D4  | Active | Detective         | Robert Mcgully  | stonersofmaine | 520-900-7127 | South — Sandy Shores
10D2  | Active | Detective         | Winston Mcgully | drjamz         | 480-641-8858 | South — Route 68
10D21 | Active | Detective         | Zeus Cronus     | z3us.7         | 907-648-9399 | South — Harmony

SAN ANDREAS BUREAU (CRIMES BUREAU)
903 | Active | Bureau Lead          | Terry Simmons
910 | Active | Detective Supervisor | Drake Hayes    |               | Case Assignment
    | Active | Detective            | Conrad Steele  | ares_ishim
    | Active | Detective            | Bruce Harper   | rigsll
931 | Active | Detective            | John Smith     | whancena
927 | Active | Detective            | Jack Crow      | darkriptide979
928 | Active | Detective            | Tom Scott      | _lilrawr
918 | Active | Detective            | Mark Broody    | papajoe47
937 | Active | Detective            | Ethan Griffin  | egriffin.
934 | Active | Detective            | Tom Wood       | ej.carterr
916 | Active | Detective            | Remyngton Steele | rvmy

FDU ROSTER

FDU OVERSIGHT
Active | CID Director   | Justin Miller
Active | Unit Oversight | Jason Hunt
Active | Unit Oversight | Tyler McGarrett
Active | Unit Oversight | Henry Cooper

TEAM 1
202   | Active | Team Lead       | Nate Heal       | mellow_man1
212   | Active | Asst. Team Lead | Conner Fuzz     | haze8489
12O2  | Active | Team Member     | Matthew Larson  | itzlarsen
921   | Active | Team Member     | Devyn Melton    | sirgigglesalot
916   | N/A    | Team Member     | Isaac Sullivan  | sociallyawkwardreaper17

TEAM 2
216   | LOA         | Team Lead       | TJ Snow          | lkayyfrmda3
13P04 | Semi-Active | Asst. Team Lead | Katalina Winters | xitzangx
305   | Semi-Active | Team Member     | Kyle Gaz         | exukin

TEAM 3
932   | Active | Team Lead       | Mike Brown     | tgslammed
954   | Active | Asst. Team Lead | Qunagle Brown  | _bkaay
13P01 | Active | Team Member     | Viper Hill     | cxvezero
955   | Active | Team Member     | Lamar Gato     | Qedser
213   | Active | Team Member     | Doc Pinaera    | cloaxxxx
13P02 | Active | Team Member     | Tomas Avilia   | kllr7256
13P03 | Active | Team Member     | Myles Harper   | mjk_23s

FDU DETECTIVES
Active | Deputy Director  | Violet Snow
Active | Detective        | Ed Urabish
Active | Bureau Lead      | Oliver Ocho
Active | Senior Detective | Jack Einhoff
$doc$), to_char(now(), 'DD/MM/YYYY')),

('Resources', 'Gang Fact Sheet.doc', 'doc', jsonb_build_object('body', $doc$CID GANG FACT SHEET
Condensed from the CID Gang Fact Sheet spreadsheet. Member names, threat levels, properties, and relations preserved where present.

ANARCHY — Street Gang | Threat: Medium | Colors: Black/White (Orange noted) | Updated 31/01/2026 | Relations: mostly Neutral (LZ: Bad)

MISFITS — Street Gang | Threat: High | Colors: Blue | Updated 06/05/2026 | Lead Detective: 110 LaShawne Harris

PREFECTURE BOYS / BOYZ (PB) — Street Gang | Threat: Low | Colors: Red/Black | Updated 05/09/2026 | Relations: Neutral
Known properties: 6035 Hangman Ave / 8074 Palomino Ave; 10011 New Empire Way; 6060 Kimble Hill Dr; Apartment 13 Room 16; Apartment 13 Room 9 / 6006 North Rockford Dr; Apartment 25 Room 32 / 8235 Palomino Ave; 7027 Bay City Ave; 6059 Kimble Hill Dr; 7316 West Mirror Drive.

1s — Street Gang | Threat: Medium | Colors: Pink & White | Updated 5/6/2026 | Lead Detective: 918 Mark Broody
Members: Trey Sanders (Leader), Nando Finn (Co-Leader), Bando Dingleberry, Deion Hover, Emii Santos, Sam Santos, Mr Doot, Kali Doot, Michael Smith, Mia Finn, Malcom Finn — all Medium threat.

FALLEN — Street Gang | Threat: High | Colors: Green/White | Updated 04/27/2026
Members (High threat): John Clay, Tommy Banx, Kayden Gosling.

41 — Street Gang | Threat: Medium | Colors: Black/Peach | Updated 4/26/2026 | Lead Detective: Unassigned
Members: Tal Jenkins, Declan Bennett, Trench Foot, Laquan Kilos, Kait Shalashaska, Sammy Rose (Medium), SirVix D'stroya (Low), Bobby Johnson.

UNLABELED CREW (Bobby Smith) — mugshots hosted on fivemanage
Members: Bobby Smith (Leader, High), Romaan Pachacco (Medium), Ace Boogie (High), Shawn Smith (Low), Rick Sanchez (Low), Kendall Harper (Medium), Tony Gabagoo (Low).

SOUTH SIDE MAFIA (SSM) — Mafia | Threat: Medium | Colors: Black/Yellow | Updated 4/21/2026 | Lead Detective: 921 Quez Rich / 931 John Smith

JAMESTOWN — Street Gang | Threat: Medium | Colors: Yellow/Black | Updated 4/21/2026

Gang-relations columns tracked: 73rd, Anarchy, CCMC, DAM, FDMC, LZ, MH, SSC, SRMC, SSM, THC, B2A, Vitelli, WM, WC, Yakuza, RTP, Envi. Per-member flag columns: VCH, CCW, MGW, CDP (TRUE/FALSE).
$doc$), to_char(now(), 'DD/MM/YYYY'))
on conflict (folder, name) do update
  set content = excluded.content, kind = excluded.kind, modified_label = excluded.modified_label;

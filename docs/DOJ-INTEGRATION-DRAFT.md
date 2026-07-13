# DOJ Integration Draft
Status: **SUPERSEDED** — implemented in v1.13.0. See `docs/DOJ-INTEGRATION.md`
for the shipped system. This file is retained only as the historical proposal.

This document proposes how the CID Portal could later integrate a Department of
Justice (DOJ) workflow — prosecutor and judicial review of warrants, a subpoena
system, court packets, classified legal requests, and a limited MDT
wanted-status projection. **Nothing in this document is built.** It exists so a
future implementation starts from an agreed architecture instead of ad-hoc
decisions.

Everything below is labeled by its evidence level:

- **Confirmed** — field/value supplied by the division's approved forms.
- **Current** — how the CID Portal works today (code-verified at the time of writing).
- **Proposed** — recommendation; requires explicit approval before any implementation.

---

## 1. Where the portal stands today (Current)

- Warrants are **reports**: three templates (`arrest_warrant`, `search_warrant`,
  `wiretap_warrant`) rendered from `FORM_SCHEMAS` and stored in
  `reports.fields` (jsonb).
- Document integrity: `report_finalize()` seals a report (contents locked by a
  DB trigger; signature recorded), `report_reopen()` (bureau lead+, bureau-scoped)
  breaks the seal while preserving the prior signature in the report history.
- Warrant lifecycle: a single status rides in `fields._warrant_status`
  (`draft → signed → executed → returned`), changed only through the validating
  `warrant_set_status()` RPC, which stamps the actor into `fields._warrant_log`.
  **"signed" is a CID-side bookkeeping state — it is NOT judicial approval.**
- Court packet: the case packet dialog already exports Markdown/DOCX/PDF of the
  full case record. There is **no** selective, immutable, judicially-scoped packet.
- There is **no subpoena workflow of any kind** in the codebase today — no
  table, form, route, or component. Everything in §7 below is entirely new and
  proposal-only.
- There are **no DOJ roles**. The `app_role` enum is CID-only.

## 2. Status model separation (Proposed)

Today one field conflates document state and legal state. A DOJ integration
should split three orthogonal axes:

| Axis | Values | Owner |
|---|---|---|
| **Document status** | `draft`, `finalized`, `reopened` | CID (already exists via seal/reopen) |
| **Legal-review status** | `not_submitted`, `cid_supervisor_review`, `returned_by_cid`, `submitted_to_doj`, `prosecutor_review`, `returned_by_prosecutor`, `submitted_to_judiciary`, `judicial_review`, `approved`, `denied`, `withdrawn` | DOJ pipeline |
| **Execution status** | `unissued`, `issued`, `executed`, `returned`, `expired`, `revoked` | CID field units |

Migration note (Proposed): the current `_warrant_status` values map onto the
future axes as `draft → not_submitted / unissued`, `signed → approved` (only if
a judge actually signed in-RP), `executed → executed`, `returned → returned`.
Do **not** migrate production status fields until the DOJ pipeline exists.

## 3. Future DOJ roles (Proposed)

`Prosecutor`, `Senior Prosecutor`, `District Attorney / Chief Prosecutor`,
`Magistrate`, `Judge`, `Court Clerk`.

None of these roles currently exist. They must live in a **separate role
domain** from the CID rank hierarchy (`app_role`): a Judge is not a higher CID
rank than a Director, and a Prosecutor is not a CID Command role. A future
schema should model them as a distinct enum/table (e.g. `doj_role`) with their
own RLS surface, never as new `app_role` values.

## 4. Future warrant lifecycle (Proposed)

```
CID Draft
→ CID Supervisor Review
→ Returned for Revision or Submitted to DOJ
→ Prosecutor Review
→ Returned for Revision or Submitted to Judiciary
→ Judicial Review
→ Approved, Denied, or Returned
→ Issued
→ Executed, Expired, or Revoked
→ Return Filed
→ Closed
```

Priority (`Medium`/`High`/`Critical`, Confirmed — now on the CID drafting form)
orders queues; it must never bypass review, signing, or approval.

## 5. Classified warrant behavior (Proposed)

Possible classifications: `standard`, `restricted`, `classified`, `sealed`.
A classified or sealed request should eventually restrict access to the
justification narrative, evidence, supporting links, reviewer notes, judicial
notes, and internal execution planning — via explicit request-specific access,
not role-wide visibility. No classification infrastructure exists or was added.

## 6. MDT wanted-status projection (Proposed)

A future, strictly limited projection of **approved** warrants to the MDT:

Included: Suspect Identifier · Wanted Status · Warrant Reference Number ·
Warrant Type · Issuing Authority · Issue Date · Expiration Date (if any) ·
Classification-Safe Warning.

Never exposed: probable-cause narrative, evidence, case notes, prosecutor
notes, judicial notes, CID chat, classified links. Not implemented.

## 7. Subpoena workflow (Proposed — entirely new)

No subpoena system exists in the repository today. The future interface may
include **File Subpoena** and **My Subpoenas**.

### 7.1 Common fields

| Field | Status | Notes |
|---|---|---|
| Recipient Type * | Confirmed | `Player`, `Other (Business / Entity)` |
| Recipient / Player * | Confirmed | Player → searchable selector against the Persons registry (store canonical id + submission-time display snapshot). Other → free-text `Recipient Name *`; optionally link to a future business registry (none exists; none created). |
| Case Number * | Confirmed | Searchable case selector limited to cases the detective can access; store case id, display case number. Never unrestricted free text alone. |
| Subpoena Type * | Confirmed | see 7.2 |
| Reason for Subpoena * | Confirmed | investigative/legal reason; frozen with the submitted version during review |
| Items / Records Requested * | Confirmed (conditionally) | see 7.3 |
| Additional Notes | Confirmed (optional) | service instructions, context, limitations — never a substitute for required structured fields |

### 7.2 Subpoena types (Confirmed)

`Testimony`, `Document Production`, `Medical Records`, `Financial Records`,
`Phone Records`, `Surveillance / CCTV`, `Employment Records`, `Housing
Records`, `Social Media Accounts`, `Other`. Keep the list centrally typed in
any future implementation; do not scatter hardcoded values.

### 7.3 Items / Records Requested — conditional matrix

| Type | Behavior |
|---|---|
| Document Production, Medical, Financial, Phone, Surveillance/CCTV, Employment, Housing | **Required** |
| Other (when records are requested) | Required |
| Testimony | Hidden or replaced by a testimony-specific field — *pending approval; the supplied Testimony form does not fully confirm the behavior* |
| Social Media Accounts | Optional or conditional — *pending approval; the supplied form does not clearly confirm this field* |

### 7.4 Social Media Accounts fields (Confirmed)

When the type is `Social Media Accounts`: `Platform *` and `Username *`.
Confirmed platform values: **Birdy**, **InstaPic**. No real-world platforms
unless explicitly approved; keep the list centrally managed and extensible.

### 7.5 Type-specific additions (Proposed, unconfirmed)

- **Testimony**: Testimony Subject · Requested Appearance Date · Requested Appearance Location
- **Medical Records**: Date Range · Record Category · Provider or Facility
- **Financial Records**: Account Identifier · Institution · Date Range · Transaction Categories
- **Phone Records**: Phone Number · Subscriber Identifier · Date Range · Requested Record Categories
- **Surveillance / CCTV**: Location · Camera or Property · Start Date & Time · End Date & Time
- **Employment Records**: Employer · Employment Period · Record Categories
- **Housing Records**: Property or Address · Occupancy Period · Record Categories
- **Social Media Accounts**: Requested Content Categories · Date Range · Account Identifier

### 7.6 Future subpoena lifecycle (Proposed)

```
CID Draft
→ CID Supervisor Review
→ Returned for Revision or Submitted to DOJ
→ Prosecutor Review
→ Returned for Revision or Submitted for Approval
→ Approved or Denied
→ Issued
→ Served
→ Compliance Pending
→ Records Received, Testimony Completed, or Non-Compliance
→ Return Recorded
→ Closed
```

## 8. Access boundaries (Proposed)

- Detectives draft legal requests only for cases they can access.
- CID supervisors review requests within their authority.
- Prosecutors see only requests submitted or assigned to them.
- Judicial users see only the immutable submitted packet.
- Clerks see only required administrative filing information.
- Legal reviewers do **not** gain full case access automatically.
- Only deliberately selected evidence is shared.
- Internal CID chat remains hidden; unrelated intelligence remains hidden.
- DOJ users cannot modify original evidence; chain-of-custody history cannot be altered.
- Classified requests require explicit request-specific access.
- All decisions and revisions are audited; no legal request is silently overwritten.

## 9. Immutable legal versions (Proposed)

Freeze a version when a request is: Submitted to CID Review · Submitted to DOJ ·
Submitted to Judiciary · Approved · Denied · Issued · Returned. A reviewer acts
on the exact submitted version; later edits create a new version. An approved
warrant or issued subpoena is never silently modified. (The portal's existing
seal trigger + `_reopen_log` history is the seed of this model.)

## 10. Court packets (Proposed)

A future court packet is a deliberately selected, immutable package:
Request Cover Information · Warrant or Subpoena Form · Investigator Affidavit
or Reason · Selected Finalized Reports · Selected Evidence Index · Selected
Attachments · Selected Supporting Links · Approval History · Signatures.

Never automatically included: the full case, all case chat, all intelligence
links, all media, all private notes, all evidence, unselected reports. The
judicial reviewer sees only the submitted packet. (The current case-packet
export includes the whole case and is therefore NOT a court packet in this
sense.)

## Non-implementation confirmation
This document is a product and architecture proposal only.
No DOJ roles, profile fields, legal-request tables, warrant approval workflows,
subpoena workflows, prosecutor queues, judicial queues, routes, components,
navigation items, MDT integrations, RPCs, migrations, or RLS policies were
implemented as part of this work.

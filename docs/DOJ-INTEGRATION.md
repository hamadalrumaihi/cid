# DOJ Legal Review System

Shipped in **v1.13.0**. This supersedes `docs/DOJ-INTEGRATION-DRAFT.md` (the
v1.11 proposal) — the draft is kept only as a historical record.

The DOJ system is a **limited legal-review workflow** bolted onto the existing
CID Portal. It processes exactly two kinds of legal request connected to CID
cases — **warrants** and **subpoenas** — and nothing else. It is not a
court-management, prosecution-management, or DOJ-investigation platform.

## Scope

- **DOJ roles:** Assistant District Attorney (ADA), District Attorney (DA),
  Attorney General (AG).
- **Judicial role:** Judge.
- These are a **separate identity domain** from CID. They are **not** in the
  `app_role` enum and never in `ROLE_ORDER`. A Judge does not outrank a
  Director; a DA is not a CID Director; an ADA is not a Bureau Lead. Justice
  permissions are evaluated independently of CID permissions.
- `profiles.division` is **never** consulted for DOJ or Judge access.
- No AI anywhere: every approve / deny / return / assignment is a named human
  actor, validated server-side.

## Identity model

Justice identity lives in two tables, mirroring the CID membership-request
pattern but kept fully separate:

- `justice_memberships` — the durable identity: `agency` (`doj` | `judiciary`),
  `justice_role`, `active`, `justice_identifier` (Bar / Court id). A CHECK
  constraint forbids invalid combinations (Judge-in-DOJ, ADA-in-Judiciary, …).
- `justice_membership_requests` (+ `_history`) — the applicant-owned onboarding
  request. `internal_decision_note` is column-revoked from clients (the
  `membership_requests.email` precedent); reviewers read it via
  `admin_justice_membership_requests()`.

A single person may hold **both** a CID profile and a justice membership; the
two identities remain independently authorized. Justice-only users (no active
CID profile) get the standalone **Justice portal** as their whole app, never
the CID shell.

### Onboarding & approval matrix

The adaptive first-login **Gate** asks which domain the applicant is joining
(CID / DOJ / Judiciary), then shows only that domain's role choices. Selecting
a role grants nothing — activation happens only inside the review RPC.

| Requested role | May approve |
| --- | --- |
| Assistant District Attorney | District Attorney, Attorney General, or Owner |
| District Attorney | Attorney General or Owner |
| Attorney General | Owner |
| Judge | Owner |

No self-approval; no ADA-approves-ADA / DA-approves-DA; a Judge cannot approve
DOJ memberships; CID Bureau Leads cannot approve justice memberships. Approval
is atomic: `review_justice_membership_request()` validates authority, locks the
request, upserts the membership, writes history + the main audit log, and
notifies the applicant — never touching the CID profile.

## Bureau-aligned ADA coverage

Each permanent CID bureau (LSB / BCB / SAB) has designated ADA coverage. These
are **assignments, not roles** — there is no `lsb_ada` role. An LSB ADA is an
`assistant_district_attorney` with a `prosecutor_bureau_assignments` row for
LSB. Assignment grants **routing responsibility only**: no CID case access, no
`profiles.division` change, no JTF membership.

- Types: `primary`, `supporting`, `acting`. Partial unique indexes enforce at
  most one active `primary` and one active `acting` per bureau.
- A DA may serve as **acting** bureau prosecutor when no ADA is available
  (explicit, temporary, audited). A Judge and the AG never take bureau
  assignments. JTF is never a prosecutor bureau.
- Only DA / AG / Owner create, change, or end assignments
  (`assign_ada_to_bureau`, `set_primary_ada`, `set_acting_ada`,
  `end_ada_bureau_assignment`). History is append-only — assignments **end**
  (`ends_at`), never delete.
- `doj_bureau_coverage()` powers the coverage board (primary / acting /
  supporting / covered? per bureau).

### Routing precedence

`get_routing_ada_for_bureau(bureau)` = **active acting (ADA or DA) → active
primary ADA**. Supporting ADAs are never auto-selected. A Judge is never
returned. When coverage is missing the helper returns null and the request is
**parked unassigned** in the DOJ intake (DA / AG / Owner assign manually) — it
is **never** silently routed to another bureau.

## Responsible-bureau resolution

Every legal request resolves to exactly one responsible CID bureau
(`private.legal_resolve_bureau`):

- ordinary case → `cases.bureau`
- joint / JTF case → `cases.originating_bureau`

A legacy JTF case with no `originating_bureau` **blocks** legal submission until
an authorized CID supervisor records the responsible bureau via
`resolve_case_originating_bureau()` (validated, audited). Joint cases route by
their originating bureau, never by the visible JTF designation.

## Legal-request model

One shared model (`legal_requests`) for both request types, with three
**independent** status dimensions (§19) — never one overloaded field:

- `document_status`: draft / finalized / reopened
- `review_status`: not_submitted → cid_supervisor_review → (returned | submitted_to_doj)
  → ada_review → (submitted_to_da | submitted_to_ag | submitted_to_judge) →
  approved | denied | withdrawn (plus every `returned_by_*`)
- `fulfilment_status`: warrant lifecycle (unissued / issued / executed /
  returned / expired / revoked / closed) and subpoena lifecycle (served /
  compliance_pending / records_received / testimony_completed / non_compliance /
  return_recorded / closed)

Supporting tables:

- `legal_request_versions` — **immutable** submitted snapshots (`content_hash`,
  `packet_manifest`). A new version is frozen on every submission; reviewers
  always act on the exact `current_version_id`. Rows are UPDATE/DELETE-blocked
  for clients.
- `legal_request_actions` — append-only history (`internal_note` column-revoked;
  read via `legal_internal_notes()`).
- `legal_request_exhibits` — the deliberately-selected packet (evidence,
  attachment, finalized_report, case_media, related_case, external_link,
  person_record). Reviewers see **only** these items — never the full case,
  all evidence, chat, or unrelated intelligence.
- `legal_request_participants` — request-specific participation (requesting
  investigator, CID supervisor, assigned ADA, DA, AG, judicial reviewer,
  observer). Access is per-request, not per-role.
- `legal_request_signatures` — version-bound signatures. A prosecutor signature
  never satisfies judicial approval; the `action` names the stage it signs.
- `mdt_wanted_projections` — see MDT below.

## Warrant workflow

CID Draft → CID Supervisor Review → (Returned | Submitted to DOJ) → auto-assigned
to the bureau ADA → ADA Review → (Returned | Submitted to Judge) → Judicial
Review → Approved / Denied / Returned → Issued → Executed / Expired / Revoked →
Return Filed → Closed.

A warrant **always** requires Judge approval. DA/AG oversight may reassign,
return, or forward, but never substitutes for judicial approval. The CID
supervisor gate requires: source report finalized, required fields complete,
suspect linked, valid responsible bureau, and at least one supporting item
(unless an authorized supervisor records an override reason). Approval and issue
are **separate** stages. Execution respects expiry. New evidence collected on
execution uses the existing evidence / chain-of-custody system — the legal
request never mutates original evidence.

The **Submit for Legal Review** button on a finalized `arrest_warrant` report
creates the linked legal request (case + source report + suspect `person_id` +
priority + justification) with the report as the first packet exhibit. The CID
report stays investigator-owned; the legal request freezes its own snapshots.

## Subpoena workflow

`File Subpoena` / `My Subpoenas`. Recipient is a Persons-registry player or a
free-text business/entity. Ten confirmed types, each with type-specific fields
(§35); social platforms are the in-RP `Birdy` / `InstaPic` only. Subpoenas
route to the responsible bureau ADA using the same rules as warrants, then
follow the configured **approval route**:

- `da` — RP policy permits DA approval (document production, employment,
  housing, other by default).
- `ag` — AG approval required (financial records by default).
- `judge` — judicial review (medical, phone, social, surveillance, testimony
  by default; and always for warrants).

An ordinary CID user never chooses the route; server rules set it, and DA/AG/Owner
may change a subpoena's route (with a reason) via `set_legal_approval_route()`.
Lifecycle adds service tracking (`record_subpoena_service`) and compliance
tracking (`record_subpoena_compliance`); received materials link back to the
source case through the existing evidence/attachment system.

## Conflict-of-role protection (server-enforced)

- The assigned ADA cannot be assigned as Judge; a DA/AG who reviewed the
  prosecutorial stage cannot act as Judge on the same request.
- A Judge cannot be given an ADA participant role or reassigned as prosecutor.
- An ADA/DA/AG signature can never satisfy judicial approval; a judicial
  signature can never satisfy ADA review.

`private.legal_is_prosecution_side()` backs the check in `assign_judge()` and
`decide_legal_request_as_judge()`.

## Classification & sealed access

`standard` / `restricted` / `classified` / `sealed`. Defaults: warrant →
classified; medical/financial/phone/social → restricted; testimony → standard.
Sealed requests are visible only to the request creator, assigned CID
supervisor, assigned ADA, authorized DA oversight, assigned Judge, and Owner
oversight — and their **existence** is never revealed through search, counts,
navigation badges, notification details, or unauthorized queues. Sealed
notifications carry only generic text ("A sealed legal request requires your
attention."); `legal_search()` is SECURITY INVOKER so RLS makes sealed rows
undiscoverable by construction.

## MDT wanted-status contract

`mdt_wanted_projections` is a server-side projection holding **only**
classification-safe fields (suspect id, wanted status, warrant reference/type,
issuing Judge, issue/expiration dates, a classification-safe warning). It never
contains probable cause, evidence, notes, narratives, or internal plans. There
is **no external MDT endpoint** in this build — rows carry a `sync_status`
(`pending`/`synced`/`failed`/`disabled`) for a future retryable, audited,
secret-protecting sync worker. `mdt_wanted_current()` computes the effective
status at read time so an expired warrant never reads as actively wanted.

## RLS helpers & RPCs

Canonical access helpers (every legal policy delegates to these):
`can_view_legal_request`, `can_edit_legal_draft`, `can_review_as_cid/_ada/_da/_ag/_judge`,
`can_manage_legal_assignment`, `is_active_ada_for_bureau`,
`get_routing_ada_for_bureau`, plus `justice_role_of` / `is_justice_active`.

Every legal table is **SELECT-only** for clients — no INSERT/UPDATE/DELETE
grants exist. All state transitions run through transactional SECURITY DEFINER
RPCs with pinned `search_path`, row locking, explicit state + transition
validation, immutable-version freezing, append-only history, sealed-safe
notifications, and the main audit log. See Chapter 7 of the handbook for the
full RPC list.

> **NULL-guard note (v1.13.0):** `private.justice_role_of()` returns NULL for
> non-justice users, and `NULL in (...)` is NULL — so an early
> `if not <helper>()` guard silently skipped its authorization raise for CID
> callers. Every three-valued justice helper is now `coalesce(..., false)`
> (migration `20260714070000_legal_null_guards`). The live RLS suite caught
> this before release.

## Shared-platform adoption register

Per the shared-platform requirement, these reusable capabilities were built for
DOJ and are candidates for wider CID adoption. **v1.14.0 shipped the rows
marked "Adopted v1.14"** as extracted shared components
(`src/components/ui/`, `src/components/shared/`, `src/lib/deadlines.ts`),
each with two or more non-DOJ consumers:

| Shared capability | Where DOJ uses it now | Recommended future CID adopters | Blockers |
| --- | --- | --- | --- |
| `ClassificationBadge`, `StatusChip` (`justice/legalShared.tsx`) | legal request rows & detail | report sensitivity, case status, tracker status | none — extract to `ui/` when a second consumer lands |
| `DeadlineChip` + `deadlineInfo()` — extracted to `ui/DeadlineChip.tsx` + the shared engine `lib/deadlines.ts` (`lib/justice.ts` now delegates) | warrant expiry, subpoena response deadlines | **Adopted v1.14:** case-task due dates (TasksTab), joint-case access expiry (OverviewTab), case follow-ups (CaseDetail) | none — shipped |
| `WorkflowTimeline` — extracted to `ui/WorkflowTimeline.tsx` | legal action history (`LegalRequestDetail` History tab) | **Adopted v1.14:** case sign-off history (SignoffTab), evidence custody chain (EvidenceTab expandable), Command Center approval-queue history, CID + Justice membership-request applicant history panels | none — shipped |
| Exhibit / record pickers — generalized to `shared/RelatedRecordPicker.tsx` | legal exhibit pickers (packet selection) | **Adopted v1.14:** investigative-report evidence lookup (ReportsTab FormEditor), RICO predicate-act evidence links (RicoTab) | none — shipped (source query generalized) |
| Signature display — extracted to `shared/SignatureViewer.tsx` | version-bound legal signatures | **Adopted v1.14:** report seal signatures incl. superseded seals from the reopen log (ReportsTab), tracker command co-signs (Trackers) | none — shipped |
| Participant assignment/removal (`legal_request_participants` + helpers) | request-specific access | case access grants, joint-case membership | schema is legal-specific; the pattern is reusable |
| Sealed-safe notification fan-out (`private.legal_notify`) | legal notifications | any classified notification path | none — same server-authoritative pattern as announcements |
| `justice_directory()` / `legal_request_people()` name resolution | justice-only name lookup (no roster access) | any cross-domain name display | none |
| Immutable-version display — extracted to `shared/VersionViewer.tsx` | frozen submitted versions (Form tab) | **Adopted v1.14:** finalized report versions (new `report_versions` table, snapshotted by `report_finalize()`, ReportsTab "Versions" toggle), SOP history modal (SopsView) | none — shipped (the reports version model now exists) |

## Verification & known gaps

- Four gates green (typecheck, eslint `--max-warnings 0`, vitest, `npm run
  build`), `check:schema` (63 tables in sync), doc-gen drift checks.
- Live RLS suite: **99/99** (37 new DOJ assertions in `tests/rls/legal.test.ts`).
- E2E (shim): the 5 `tests/e2e/justice.spec.ts` specs pass; the pre-existing
  joint-case lifecycle spec is flaky under full-suite ordering but green in
  isolation.
- **Blocked:** no external MDT endpoint exists, so MDT is a server-side contract
  table only (no live sync). Discord edge-function delivery remains blocked
  (deploy is MCP-gated); portal notifications work.

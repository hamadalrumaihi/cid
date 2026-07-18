# DOJ / Justice Portal Operational Redesign — Current-State Audit (spec §2)

Branch base: `main` @ PR #177 merged. This audit precedes implementation (spec §2).
**Headline: the legal *engine* is complete and correct — this is a presentation /
workflow-clarity redesign, plus a small additive migration for structured
search-warrant targets. No authority rule is weakened.**

## 1. Existing legal request types
`legal_requests.request_type ∈ {warrant, subpoena}`; `subtype` = arrest_warrant /
search_warrant + 10 subpoena subtypes (testimony, document/medical/financial/
phone/employment/housing records, surveillance_cctv, social_media_accounts,
other). Type-specific fields live in `form_data` jsonb, mirrored by
`WARRANT_FIELDS`/`SUBPOENA_FIELDS` in `src/lib/justice.ts`.

## 2. Existing workflow statuses (verbatim CHECKs)
- `document_status`: draft, finalized, reopened
- `review_status` (18): not_submitted, cid_supervisor_review, returned_by_cid,
  submitted_to_doj, ada_review, returned_by_ada, submitted_to_da, da_review,
  returned_by_da, submitted_to_ag, ag_review, returned_by_ag, submitted_to_judge,
  judicial_review, returned_by_judge, approved, denied, withdrawn
- `fulfilment_status`: unissued, issued, executed, returned, expired, revoked,
  closed, served, compliance_pending, records_received, testimony_completed,
  non_compliance, return_recorded
- `service_status`: not_served, service_attempted, served, service_failed, waived
- `compliance_status`: pending, partial, complete, non_compliant, cancelled

## 3. Exact authority at each stage (server-enforced, RPC-only writes)
Draft/return edit = creator (`can_edit_legal_draft`). Submit-to-CID = creator.
CID review = `can_review_as_cid`. ADA review = `can_review_as_ada` (bureau ADA).
DA/AG = `can_review_as_da`/`_as_ag`. Judge assignment = DA/AG/Owner **or** the
assigned ADA; judge decision = the assigned judge (`can_review_as_judge`); judge
self-claim of a parked judge-routed request = `claim_legal_request_as_judge`
(parallel lane, PR #177). Issue/serve/execute/return/compliance/close each have a
dedicated definer RPC with its own authority check. Conflict guards: a
prosecution-side actor or the creator can never judge their own request.

## 4. Current routing rules
Warrants force `approval_route='judge'`; subpoenas route da/ag per
`legal_default_route`. On CID approval the request auto-assigns to the bureau's
routing ADA (`get_routing_ada_for_bureau`, acting→primary); on a coverage gap it
parks at `submitted_to_doj` and alerts DA/AG/Owner (+ bureau prosecutors, PR #177).

## 5. Current assignment rules
`assigned_ada_id` (auto or `reassign_legal_ada`, reason required cross-bureau) and
`assigned_judge_id` (`assign_judge` or judge self-claim). Full history is
recoverable from `legal_request_participants` (append-only) + `legal_request_actions`
+ `audit_log` (`LEGAL_ADA_REASSIGNED` carries old/new/cross_bureau/reason). No
single assignment-history table, but the data is complete.

## 6. Current visibility & classification rules
`classification ∈ {standard, restricted, classified, sealed}`. SELECT gated by
`private.can_view_legal_request`: creator, participant, Owner, DA/AG (DOJ-submitted,
sealed included), all judges + bureau prosecutors (DOJ-submitted, **non-sealed**,
PR #177), and CID case-members for `standard` on accessible cases. Sealed keeps its
explicit-assignment audience; never leaked via search/notifications/counts.

## 7. Existing legal-request detail sections
`LegalRequestDetail` (shared across CID + all Justice seats) already tabs into
Overview / Form / Packet / History (a `WorkflowTimeline`) / Participants /
Fulfilment, with a bottom role-action bar. `SignatureViewer`, `RelatedRecordPicker`,
`VersionViewer` are wired.

## 8. Existing print/export support
**None for `legal_requests`.** `WarrantPrint.tsx` + `packet.ts` serve the older
report-template warrant and case packets, not the DOJ instrument. Data (frozen
version + `packet_manifest`) is all present — export is pure UI.

## 9. Existing deadline & service tracking
`expires_at` + `response_deadline` columns; shared `lib/deadlines.ts` engine +
`DeadlineChip`. Full service/execution/return/compliance columns + RPCs exist
(`issue_/record_warrant_execution/record_warrant_return/record_subpoena_service/
record_subpoena_compliance/close_legal_request`).

## 10. Existing Justice membership workflow
`justice_memberships` + `justice_membership_requests` (+ history) with a review
**matrix** (`can_review_justice_role`: ADA←DA/AG/Owner, DA←AG/Owner, AG/Judge←Owner)
and RPCs (submit/withdraw/review/set-active/admin-list). Prosecutor roster =
`prosecutor_bureau_assignments` + `doj_bureau_coverage()`.

## 11. Current loading & query behaviour (a real problem)
`useLegalRequests` reads **full `legal_requests` rows, unbounded, no projection**,
then every queue in both portals re-filters client-side. The create form
`list('cases')` + `list('persons')` load the ENTIRE registries then filter locally
(persons uncapped). This must become projected + server-scoped.

## 12. Current UX problems
No `PageHeader`/`Breadcrumbs`/`h1` on either landing; two equal-weight create
buttons; a long linear create form; flat "spreadsheet-row" queue chips;
overlapping queue definitions (a row appears in several sections); a bottom
**action button-wall** instead of role decision panels; **no stage tracker**;
hand-rolled tab strip (not deep-linkable); raw `status.replaceAll('_',' ')` machine
strings in places; heavy legacy `rounded-xl border-white/10` surfaces instead of
`Card`.

## 13. Security guarantees that MUST remain
RPC-only writes (client INSERT/UPDATE/DELETE revoked on every legal table);
`can_view_legal_request` SELECT gate; sealed undiscoverability (search/notify/
counts/labels); conflict-of-role guards; column-privacy on `internal_note`;
definer NULL-guards + anon EXECUTE revocation; immutable versions + audit; the
justice authority matrix; CID rank never implies Justice authority.

## 14. Features in this spec ALREADY implemented
Types/subtypes, statuses, versioning (diff-able), assignment + audit, full
service/return/issue RPC set, deadlines + chip, sealed-safe notifications, RLS-safe
search, person/case/BOLO dossier legal sections, Action Center legal branch,
membership + roster + coverage, 37 RLS + 5 E2E tests, a single shared detail
component.

## 15. Proposed additive & visual changes
**Schema-additive (one small migration):** structured search-warrant targets
(`legal_request_targets` typed rows, or extend `legal_request_exhibits` kinds to
vehicle/place/prior_legal_request + a `rationale` column) → unlocks place/vehicle
dossier legal sections; optional stored version `change_summary`/`returned_from`.
**Pure model (`src/lib/legalWorkflow.ts`, unit-tested):** stage mapping,
human status labels, deterministic routing explanation ("why this is here"),
next-action derivation per role, canonical request grouping, urgency, deadline
state, assignment eligibility, approval matrix, target formatting, subtype
requirements, sealed-result suppression.
**Shared primitives:** stage tracker, request-type card picker, create
wizard/stepper, request card, role decision panel, service/return event cards,
document-diff, a legal-request court-packet/print export.
**Surfaces:** investigator LegalView (overview + guided create + unified card
registry + filters), Justice portal (overview + review/decision workspaces +
assignment + coverage cards + roster + applications), and the unified deep-linkable
dossier on `SectionTabs`. All mutations stay on the existing definer RPCs.

---

## Before / after information architecture

| | Before | After |
|---|---|---|
| Investigator `/legal` | 2 create buttons + 6 overlapping flat queues, no header | Overview (metric strip + next actions + activity + warnings) · guided "Create legal request" (type cards → stepper) · unified request-card registry (canonical grouping + simple filters + advanced popover) |
| Justice `/justice` | per-seat flat queues + hand-rolled cards | Authority-aware views (Overview / Requests / Assigned / Review / Issued / Service&Returns / Roster) · role decision workspaces · coverage cards · roster groups · application drawer |
| Detail | hand-rolled tab strip + bottom button-wall, no stage tracker, no deep-link | `Breadcrumbs` + `Card` command header + **stage tracker** + `MetricStrip` + deep-linkable `SectionTabs` (Summary/Request/Supporting/Review/Decision/Service&Return/Activity) + role decision panel + `ActionMenu` overflow + court-packet export |
| Data | full-table + full-registry client filtering | projected/server-scoped request loader + indexed pickers |

## Phased delivery plan (each phase ships green with its own tests)
1. **Foundation** — additive migration (structured targets + exhibit kinds + version change-summary) + `legalWorkflow.ts` pure model + shared primitives (stage tracker, type-card picker, create wizard, request card, decision panel, service/return event cards) + unit tests + RLS v136.
2. **Unified dossier** — rebuild `LegalRequestDetail` on the shared spine (Breadcrumbs/command header/stage tracker/SectionTabs/decision panel) + court-packet export.
3. **Investigator LegalView** — overview + guided create + card registry + projected loader.
4. **Justice portal** — overview + review/decision workspaces + assignment + coverage + roster + applications.
5. **Cross-cuts** — place/vehicle dossier legal sections, Action Center/notifications/search polish.
6. **Verification** — full unit + RLS + E2E (23 flows) + gates + screenshots + 24-point report.

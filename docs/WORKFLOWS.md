# Workflows & State Machines

Every state machine in the CID Portal, with who may trigger each transition and which server-side RPC enforces it — the reviewer's companion to [`docs/handbook/04-features.md`](handbook/04-features.md) and [`docs/DOJ-INTEGRATION.md`](DOJ-INTEGRATION.md).

Every approve / deny / return / assignment below is **recorded with the acting member, whose authority is validated server-side**. Transitions run through SECURITY DEFINER RPCs (pinned `search_path`, row locking, explicit state validation) or RLS-checked writes; routing (sign-off assignee selection, ADA routing, default classification) is rule-based, database-driven logic in `private.*` helper functions. Direct client writes to workflow columns are frozen by triggers or missing grants throughout.

Roles: **Det** = Detective, **SrDet** = Senior Detective, **BL** = Bureau Lead, **DD** = Deputy Director, **Dir** = Director, **Owner** = `profiles.is_owner` flag (never an `app_role`). Justice roles (**ADA/DA/AG/Judge**) live in `justice_memberships`, a separate identity domain.

---

## 1. CID membership requests

Migration [`20260713030000_membership_requests.sql`](../supabase/migrations/20260713030000_membership_requests.sql), tightened by the v1.16 unified matrix [`20260718010000_unified_role_policy.sql`](../supabase/migrations/20260718010000_unified_role_policy.sql). One request per applicant (`unique (applicant_id)`); requested bureau locked to LSB/BCB/SAB (JTF is never a permanent department); since v1.16 any normal CID role (detective … director) may be *requested* — requesting grants nothing.

```mermaid
stateDiagram-v2
    [*] --> draft: applicant insert (RLS mr_ins, inactive + not login-denied)
    draft --> pending: membership_request_submit()
    pending --> correction_requested: review — request_correction
    correction_requested --> pending: membership_request_submit() (resubmit)
    pending --> approved: review — approve (as requested)
    pending --> approved_with_changes: review — approve with final ≠ requested (reason required)
    pending --> rejected: review — reject (profile stays inactive)
    draft --> withdrawn: membership_request_withdraw()
    pending --> withdrawn: membership_request_withdraw()
    correction_requested --> withdrawn: membership_request_withdraw()
    rejected --> pending: re-review — review_membership_request() accepts terminal rows (20260807120000)
    withdrawn --> pending: re-review (20260807120000)
    approved --> [*]
    approved_with_changes --> [*]
```

| Transition | Who | Enforced by |
| --- | --- | --- |
| create draft | the applicant (inactive, not login-denied) | RLS `mr_ins` + column-level INSERT grant |
| edit form fields | applicant, while `draft`/`correction_requested` | RLS `mr_upd`; workflow/decision columns frozen by `trg_guard_membership_request` |
| submit / resubmit | applicant | `membership_request_submit()` (blocks login-denied callers; notifies command, suppressed for `rls-test-*` fixtures) |
| withdraw | applicant, from draft/pending/correction_requested | `membership_request_withdraw()` |
| request correction / reject | any active BL/DD/Dir or Owner (never the applicant — self-review rejected) | `review_membership_request()` |
| approve / approve_with_changes | reviewer with **matrix authority over the FINAL role in the FINAL bureau** (below) | `review_membership_request()` → `private.can_assign_cid_role()` |

**v1.16 decision matrix** (`private.can_assign_cid_role`) — used identically by membership review, role changes, and transfers:

| Final role | May be granted by |
| --- | --- |
| Detective / Senior Detective | Bureau Lead **of that bureau**, or DD / Dir / Owner |
| Bureau Lead | DD, Dir, or Owner |
| Deputy Director | Dir or Owner |
| Director | Owner only |

Approval is atomic: request decided + `profiles.role/division/active` flipped + `role_events` (with reason/source) + history + audit + one applicant notification, in one transaction. `approved_with_changes` requires an applicant-visible reason. Command reads the grant-revoked `internal_decision_note` only via `admin_membership_requests()`.

`rejected` and `withdrawn` are **not** dead ends: since [`20260807120000_membership_rereview_terminal.sql`](../supabase/migrations/20260807120000_membership_rereview_terminal.sql), `review_membership_request()` also accepts a terminal row and decides it again (the supersession is recorded in `membership_request_history` with the real prior status) — the applicant's only path back in, since the unique constraint blocks re-applying. `approved` / `approved_with_changes` decisions remain final.

## 2. Justice membership (DOJ / Judiciary)

> **RETIRED (Phase 1) — 2026-07-22.** Justice memberships are **retired and
> deactivated** — all `justice_memberships` rows are set inactive (preserved for
> history), the justice-membership RPCs are EXECUTE-revoked, and the DOJ/Judiciary
> signup path is removed. No new justice memberships are created or approved.
> Legal-request approval is now **Bureau Lead+** (`private.is_command()`) — see
> §5 and the [DOJ-INTEGRATION.md](DOJ-INTEGRATION.md) Phase-1 banner. The workflow
> below is historical.

Migration [`20260714010000_justice_identity.sql`](../supabase/migrations/20260714010000_justice_identity.sql); overview in [DOJ-INTEGRATION.md](DOJ-INTEGRATION.md#identity-model). Same statuses and shape as §1 (draft → pending → correction_requested / approved / approved_with_changes / rejected / withdrawn; same applicant-owned RPC pair `justice_membership_request_submit()` / `justice_membership_request_withdraw()`), but a **separate identity domain**: approval upserts `justice_memberships` and never touches the CID profile.

| Requested / final role | May decide (per `private.can_review_justice_role`) |
| --- | --- |
| Assistant District Attorney | DA, AG, or Owner |
| District Attorney | AG or Owner |
| Attorney General | Owner only |
| Judge | AG or Owner (Owner-only before [`20260731010000`](../supabase/migrations/20260731010000_justice_request_visibility.sql)) |

Decision RPC: `review_justice_membership_request()` (no self-review; authority checked against the requested role, and again against the final role on approval). Deactivation/reactivation of an existing membership: `set_justice_membership_active()` under the same matrix. Reviewers (DA/AG/Owner) read internal notes via `admin_justice_membership_requests()`. CID Bureau Leads cannot approve justice requests; a Judge cannot approve DOJ requests.

## 3. Cases

Two independent dimensions on `public.cases` (see [handbook ch. 4.1](handbook/04-features.md)):

**Status board** — `status ∈ open / active / cold / closed` (`CASE_STATUSES`, `src/lib/signoff.ts`). Moved by a direct RLS-checked `update('cases', {status})` from anyone with case access (`private.can_access_case`: own bureau, lead, creator, command, access grant, or active joint assignment); a trigger stamps `closed_at`.

**Sign-off chain** — a separate `signoff_status`/`signoff_stage` dimension, movable **only** through the sign-off RPCs ([`20260617190100_signoff_server_side_rpcs.sql`](../supabase/migrations/20260617190100_signoff_server_side_rpcs.sql) as hardened by [`20260702170000`](../supabase/migrations/20260702170000_signoff_owner_only_submit.sql), [`20260706140000`](../supabase/migrations/20260706140000_signoff_decide_assignee_access.sql), and [`20260721040000_signoff_integrity.sql`](../supabase/migrations/20260721040000_signoff_integrity.sql), which adds the command-override lane); direct column writes are trigger-blocked. (A case's *bureau* is likewise frozen — moving one is `case_reassign_bureau()`, DD/Dir/Owner only; see [AUTHORIZATION.md §4](AUTHORIZATION.md).)

```mermaid
stateDiagram-v2
    none --> awaiting_bureau_lead: signoff_submit() — case owner
    awaiting_bureau_lead --> awaiting_deputy: signoff_decide(approve) — BL
    awaiting_bureau_lead --> approved_complete: BL approve, no deputy in chain
    awaiting_deputy --> approved_deputy: signoff_decide(approve) — DD
    approved_deputy --> approved_complete: signoff_owner_action(complete) — case owner
    approved_deputy --> awaiting_director: signoff_owner_action(escalate) — case owner
    awaiting_director --> ready_doj: signoff_decide(approve) — Dir
    awaiting_bureau_lead --> denied: signoff_decide(deny, note required)
    awaiting_deputy --> denied: signoff_decide(deny)
    awaiting_director --> denied: signoff_decide(deny)
    awaiting_bureau_lead --> changes_requested: signoff_decide(changes, note required)
    awaiting_deputy --> changes_requested: signoff_decide(changes)
    awaiting_director --> changes_requested: signoff_decide(changes)
    denied --> awaiting_bureau_lead: signoff_submit() (resubmit)
    changes_requested --> awaiting_bureau_lead: signoff_submit() (resubmit)
```

| RPC | Who | Notes |
| --- | --- | --- |
| `signoff_submit(case)` | the **case owner** — lead detective, or creator when no lead is set | LOA-aware routing: `private.signoff_route(step, bureau)` picks the stage + a non-LOA assignee, **excluding the submitter and lead detective** (a lead's own case escalates rather than routing back to its author); fails if no active reviewer exists. Submit/escalate notify the routed assignee |
| `signoff_decide(case, approve\|deny\|changes, note)` | the **routed assignee** (a Director may override the assignee) **with case access** — the submitter/lead can never decide their own case (`private.signoff_assert_decider`, [`20260807060000`](../supabase/migrations/20260807060000_signoff_authority_restore.sql)) | deny/changes require a note; every action appends to the append-only `case_signoff_history` and notifies the case owner |
| `signoff_owner_action(case, complete\|escalate)` | the case owner, only at the `approved_deputy` stop-point | escalate re-routes to an active Director |
| `signoff_command_override(case, complete\|escalate, reason)` | Deputy Director / Director / Owner (never Bureau Lead) | acts in the owner's place at the `approved_deputy` stop-point when the owner is unavailable; reason required, recorded in history with `source='command_override'` ([`20260721040000`](../supabase/migrations/20260721040000_signoff_integrity.sql)) |

## 4. Reports

Reports belong to a case (`private.can_access_case` gates everything). Lifecycle RPCs: [`20260617190200_report_finalize_rpc.sql`](../supabase/migrations/20260617190200_report_finalize_rpc.sql) → versioned by [`20260715010000_report_versions.sql`](../supabase/migrations/20260715010000_report_versions.sql); reopen: [`20260713010000`](../supabase/migrations/20260713010000_report_reopen_rpc.sql) hardened by [`20260713020000_report_seal_hardening.sql`](../supabase/migrations/20260713020000_report_seal_hardening.sql).

- **draft → finalized (sealed)** — `report_finalize(report, badge?)`: any active member with case access. The signature's `signer_id` comes from `auth.uid()` (never client input), and the exact sealed content + signature are frozen as the next `report_versions` row (immutable: no client write grants, UPDATE-blocking trigger; seal v1 → reopen → edit → seal again = v2 with v1 still readable).
- **finalized → draft (logged seal break)** — `report_reopen(report)`: Bureau Lead **of the case's bureau only** (JTF cases shared), DD/Dir unrestricted. The permission check runs before the state check (no probing), and the broken seal is preserved in `fields._reopen_log` (`at`, `by`, `prev_signature`) rather than erased.
- **Lockdown** — `private.block_direct_report_finalize()` rejects any direct client write to `finalized`/`signature`, and locks a finalized report's `fields` entirely.
- **CID warrant-report tracker** (distinct from the DOJ legal workflow in §5): reports on warrant templates carry a `fields._warrant_status` of `draft → signed → executed → returned`, movable only via `warrant_set_status()` (status whitelist, warrant templates only, actor stamped server-side into `fields._warrant_log`).

## 5. Warrants & subpoenas (CID legal review)

> **RETIRED (Phase 1) — 2026-07-22.** The multi-stage DOJ pipeline
> (`not_submitted → … → ada_review → judicial_review → approved`) shown in the
> legacy block below is **retired** (migration
> [`20260808140000`](../supabase/migrations/20260808140000_legal_lead_approval.sql)).
> Legal-request approval is now **Bureau Lead+** (`private.is_command()`). The
> ADA/DA/AG/Judge review RPCs are EXECUTE-revoked and `justice_memberships` are
> deactivated. Historical requests may still **display** the old stages
> read-only, but nothing new moves through them.

Full narrative in [DOJ-INTEGRATION.md](DOJ-INTEGRATION.md); server surface in [`20260714040000_legal_workflow.sql`](../supabase/migrations/20260714040000_legal_workflow.sql) + [`20260714045000_legal_workflow_review.sql`](../supabase/migrations/20260714045000_legal_workflow_review.sql). `legal_requests` carries three **independent** status dimensions — every legal table is SELECT-only for clients, so all transitions are definer RPCs:

- `document_status`: `draft / finalized / reopened`
- `review_status`: the review pipeline below
- `fulfilment_status`: post-approval lifecycle (warrant: `unissued / issued / executed / returned / expired / revoked / closed`; subpoena: `served / compliance_pending / records_received / testimony_completed / non_compliance / return_recorded / closed`)

**Active pipeline (both warrants and subpoenas).** Approve terminates at
`review_status='approved'` and authorizes applying the warrant/subpoena in-city;
it does **not** auto-activate — issuance/execution is the separate CID fulfilment
step (`fulfilment_status` stays `unissued` until `issue_legal_request`):

```mermaid
stateDiagram-v2
    [*] --> not_submitted: create_legal_request() — any CID author
    not_submitted --> cid_supervisor_review: submit_legal_request_to_cid()
    cid_supervisor_review --> returned: review_legal_request_as_cid(return) — Bureau Lead+
    returned --> cid_supervisor_review: resubmit after edits
    cid_supervisor_review --> approved: review_legal_request_as_cid(approve) — Bureau Lead+ (private.is_command())
    cid_supervisor_review --> denied: review_legal_request_as_cid(deny) — Bureau Lead+
    approved --> [*]: fulfilment takes over (issue → execute/serve → return → close)
    denied --> [*]
```

Key rules (all server-enforced):

| Stage | Who / RPC |
| --- | --- |
| Draft + packet | creator (any CID author): `create_legal_request`, `update_legal_draft`, `add_legal_exhibit` / `remove_legal_exhibit` — reviewers later see **only** the selected exhibits, never the whole case |
| CID supervisor gate | `submit_legal_request_to_cid` → `review_legal_request_as_cid` (source report finalized, required fields, subject or search targets, valid responsible bureau via `private.legal_resolve_bureau`) |
| Legal approval | `review_legal_request_as_cid(approve\|deny\|return)` — a **Bureau Lead+** (`private.is_command()`) approves, denies, or returns. **Warrants and subpoenas both terminate at Lead+ approval** — there is **no** ADA/DA/AG/Judge step. Approve lands at `review_status='approved'` (in-city authorization; `fulfilment_status` stays `unissued`) |
| Fulfilment (CID side) | `issue_legal_request`, `record_warrant_execution`, `record_warrant_return`, `record_subpoena_service`, `record_subpoena_compliance`, `close_legal_request`, `withdraw_legal_request` (gated by `private.can_fulfil_legal`) |

<details>
<summary><strong>Legacy DOJ pipeline (retired 2026-07-22 — historical records only)</strong></summary>

The multi-stage pipeline below is **retired**. Its RPCs (`review_legal_request_as_ada` / `_as_da` / `_as_ag`, `assign_judge`, `decide_legal_request_as_judge`, `claim_legal_request_as_judge`, `submit_legal_request_to_doj`, routing/coverage helpers) are EXECUTE-revoked; historical requests may still display these stages read-only.

```mermaid
stateDiagram-v2
    [*] --> not_submitted: create_legal_request() — CID investigator
    not_submitted --> cid_supervisor_review: submit_legal_request_to_cid()
    cid_supervisor_review --> returned: review_legal_request_as_cid(return)
    returned --> cid_supervisor_review: resubmit after edits
    cid_supervisor_review --> submitted_to_doj: review_legal_request_as_cid(approve) → submit_legal_request_to_doj()
    submitted_to_doj --> ada_review: auto-routed to the bureau ADA (or parked unassigned)
    submitted_to_doj --> judicial_review: claim_legal_request_as_judge() — any active Judge (parallel lane)
    ada_review --> submitted_to_da: ADA forwards — DA route (subpoena)
    ada_review --> submitted_to_ag: ADA forwards — AG route (subpoena)
    ada_review --> submitted_to_judge: ADA forwards — judge route (all warrants)
    submitted_to_da --> approved: review_legal_request_as_da()
    submitted_to_ag --> approved: review_legal_request_as_ag()
    submitted_to_judge --> judicial_review: assign_judge() — or any Judge claims it
    judicial_review --> approved: decide_legal_request_as_judge()
    submitted_to_da --> denied
    submitted_to_ag --> denied
    judicial_review --> denied
    ada_review --> returned: returned_by_ada
    judicial_review --> returned: returned_by_judge
    approved --> [*]: fulfilment takes over (issue → execute/serve → return → close)
    denied --> [*]
```

Legacy key rules:

| Stage | Who / RPC |
| --- | --- |
| DOJ intake & routing | `submit_legal_request_to_doj`; auto-assign via `get_routing_ada_for_bureau` (active acting → active primary ADA; missing coverage parks the request — DA/AG/Owner assign via `reassign_legal_ada`) |
| Prosecutor review | `review_legal_request_as_ada` / `_as_da` / `_as_ag`; route per `private.legal_default_route` — **every warrant routed `judge`**; DA/AG/Owner could change a *subpoena's* route with a reason (`set_legal_approval_route`) |
| Judicial decision | `assign_judge` + `decide_legal_request_as_judge` — warrants were approved only by a Judge; conflict-of-role checks (`private.legal_is_prosecution_side`) kept prosecution and bench separate; signatures are version-bound |
| Parallel judiciary lane | `claim_legal_request_as_judge` ([`20260805010000`](../supabase/migrations/20260805010000_legal_parallel_judiciary.sql)) — any active Judge could take a judge-routed request straight into judicial review from `submitted_to_doj` or `submitted_to_judge` (no ADA hand-off); sealed requests excluded. A judge-returned request cleared its judge assignment on resubmission ([`20260807100000_legal_resubmit_clears_judge.sql`](../supabase/migrations/20260807100000_legal_resubmit_clears_judge.sql)) |

</details>

Every submission freezes an immutable `legal_request_versions` snapshot; reviewers act on the exact `current_version_id`. Classification `standard / restricted / classified / sealed` — warrants default `classified`; **sealed** requests are undiscoverable outside their participant set (SECURITY INVOKER search, generic notifications). Approved+issued **arrest** warrants project an MDT wanted row (`private.mdt_project`; search warrants never do) — except **sealed** arrest warrants, which stay off the MDT wanted list until executed ([`20260807080000_mdt_sealed_skip.sql`](../supabase/migrations/20260807080000_mdt_sealed_skip.sql)). Historical imports: owner-only `import_legal_warrant()` / `import_rollback_by_key()`.

## 6. Evidence custody

`custody_chain` ([`20260616090000_platform.sql`](../supabase/migrations/20260616090000_platform.sql), scoped by [`20260617140100_bureau_isolation_rls.sql`](../supabase/migrations/20260617140100_bureau_isolation_rls.sql)) is **append-only by construction**: SELECT and INSERT policies only (both requiring `private.can_access_case` on the parent evidence's case), no UPDATE or DELETE policy exists, and inserts are audit-logged. A custody transfer is a new row (`from_officer`, `to_officer`, `reason`, `transferred_by` defaulting to `auth.uid()`, timestamp); history is never edited. Executed warrants attach new evidence through this same system — the legal workflow never mutates originals.

## 7. Joint-case access

Migration [`20260713040000_joint_cases.sql`](../supabase/migrations/20260713040000_joint_cases.sql). A joint case keeps its **originating bureau** (`cases.bureau` never flips to JTF); the JTF designation is the `is_joint_case` display flag, and cross-bureau access flows only through temporary `case_assignments` rows (`assignment_source='joint_case'`).

| Step | Who | RPC |
| --- | --- | --- |
| Convert case → joint + add members | `private.can_manage_joint`: command, the case lead/creator, or an active JTF Case Lead / Co-Lead on the case | `convert_case_to_joint(case, members[])` |
| Add more members (joint role + optional `expires_at`) | same | `joint_case_add_members` |
| Remove a member (reason recorded, history kept via `removed_at/removed_by/removal_reason`) | same | `joint_case_remove_member` |
| End the joint case (closes every active grant, keeps history) | same | `joint_case_end` |

Access is exactly one case: `private.has_joint_access` requires an active, un-removed, **unexpired** joint assignment — expiry is server-enforced at read time, and removal revokes immediately. Direct client `case_assignments` writes are pinned to inert `assignment_source='standard'` rows, so nobody can mint joint access outside the RPCs.

## 8. Operations

`public.operations` groups cases (`cases.operation_id`) under a named operation with `status ∈ open / active / cold / closed` (`OP_STATUSES`, `src/lib/operations.ts`). No dedicated state RPC: standard intel-registry RLS — any active member creates/updates (`private.is_active()`), command deletes (`private.can_delete()`), with delete unlinking cases (`deleteWithUndo` sets `cases.operation_id` null). UI: `src/components/operations/OperationsView.tsx`.

## 9. Officer transfers (single-step since v1.40)

Migration [`20260718020000_officer_transfers.sql`](../supabase/migrations/20260718020000_officer_transfers.sql), widened to every department pair — **JTF is a valid source and destination** — by [`20260807020000_transfer_any_bureau.sql`](../supabase/migrations/20260807020000_transfer_any_bureau.sql), then collapsed to a **single-step move** by [`20260807040000_transfer_single_step.sql`](../supabase/migrations/20260807040000_transfer_single_step.sql): an authorized initiation applies the move immediately — no request/approval workflow, no pending states, and the source bureau has no veto. One open transfer per member (partial unique index); every write is a definer RPC — the table has no client write policies, and visibility is bureau-scoped (target, requester, the two involved bureaus' leads, DD+/Owner).

```mermaid
stateDiagram-v2
    [*] --> completed: request_transfer() — authorized initiator picks destination + reason; the move is applied in the same call
```

| Rule | Enforcement |
| --- | --- |
| Initiate = apply | `request_transfer(target, to_bureau, reason, to_role?)` — BL (rank-and-file members only, and only when one side of the move is their own bureau: outbound *or* inbound pull), or DD/Dir/Owner (anyone, anywhere). The row is stamped approved on both sides by the initiator and applied via `private.transfer_apply` in the same call — a lead **can** unilaterally pull a rank-and-file member from another bureau |
| Apply the move | `private.transfer_apply`: re-validates the member is still active, un-removed, login-allowed, and still in `from_bureau`; a riding role change needs matrix authority over the new role in the destination and fails stale if the live role moved; a plain transfer carries the member's **live** role. Writes `role_events` (source `transfer`) + audit + notifications |
| Guardrails | reason required; no self-transfer; owner accounts movable only by another owner; `from <> to`; one open transfer per member |
| Legacy open rows | `approve_transfer_source/_target`, `complete_transfer`, `reject_transfer`, `cancel_transfer` remain **only** to resolve pre-existing open rows (`private.can_decide_transfer_side(bureau)`: that side's BL, or DD+/Owner) — nothing creates pending rows anymore |

## 10. Account lifecycle (deactivation, login denial, permanent removal, permanent deletion)

Four escalating, reversible-by-design states on `profiles` (plus one irreversible owner-only exception path, below), each with its own RPC; privileged columns (`role/division/active/is_owner/removed_at`) are trigger-frozen against all direct client writes ([`20260718010000`](../supabase/migrations/20260718010000_unified_role_policy.sql)), and deny columns likewise ([`20260713090000_login_denial.sql`](../supabase/migrations/20260713090000_login_denial.sql)).

```mermaid
stateDiagram-v2
    active --> inactive: assign_member(target, false) — BL(own bureau, non-command)/DD/Dir/Owner
    inactive --> active: assign_member(target, true) — or re-approval via review_membership_request()
    active --> login_denied: deny_member_login(target, reason) — also sets active=false
    inactive --> login_denied: deny_member_login()
    login_denied --> inactive: restore_member_login() — stays inactive, re-enters the request flow
    active --> removed: admin_remove_member() — authority matrix (20260807070000)
    inactive --> removed: admin_remove_member()
    removed --> inactive: admin_restore_member() — Director/Owner only; must be re-approved
```

| State | What it means | RPC & authority |
| --- | --- | --- |
| **Deactivated** (`active=false`) | Loses every `private.is_active()`-gated capability; profile intact | `assign_member(target, set_active)` — since v1.16 activation/deactivation **only** (the legacy role/division arguments were dropped); BL scoped to own-bureau, non-command targets; Owner bypasses |
| **Login-denied** (`login_denied=true`, `active=false`) | Can still authenticate but the app shows an Access-denied screen with the recorded reason, and RLS + `membership_request_submit()` block filing or advancing a membership request — a removed/rejected person cannot simply re-apply | `deny_member_login(target, reason)` — BL (own bureau, non-command) / DD / Dir / Owner; the Owner account can never be denied. Reverse: `restore_member_login()` (clears the block only; member stays inactive) |
| **Removed** (`removed_at` set, `email` nulled) | Permanent removal without deleting rows: access blocked, sign-in email (PII) scrubbed, hidden from the roster, watchlist + case assignments cleared — **authored history and attribution preserved** (reports, evidence, audit rows keep their author) | `admin_remove_member(target)` — the unified authority matrix ([`20260807070000_member_removal_matrix.sql`](../supabase/migrations/20260807070000_member_removal_matrix.sql), originally command-wide in [`20260708150000`](../supabase/migrations/20260708150000_permanent_member_removal.sql)): BL removes own-bureau rank-and-file only; DD anyone below deputy; Dir anyone except an Owner account; Owner anyone. No self-removal; system accounts refused; the last active Director cannot be removed. Restore: `admin_restore_member()` — **Director/Owner only**; returns **inactive**, must be re-approved |
| **Permanently deleted** (profile + auth row erased; historical FKs repointed to the system tombstone) | The irreversible exception path when a member must be **erased**, not just deactivated — soft remove stays the default. Members referenced by immutable records (legal paper, sign-off history, tracker signatures, report authorship, custody transfers, evidence collection, justice identity, prosecutor assignments) are **hard-blocked** and can only be deactivated; active-work pointers must be reassigned first. An owner-only `deleted_member_ledger` row snapshots identity, reason, the full reference map, and the member's `role_events` history | `permanent_delete_preview()` → `permanent_delete_arm(target, reason)` → `permanent_delete_execute(token, confirm)` — Owner only, each step requiring a **fresh sign-in** (< 5-minute session), a 5-minute single-use token, and a typed `DELETE <display name>` confirmation ([`20260726010000`](../supabase/migrations/20260726010000_phase_b_permanent_deletion.sql); details in [AUTHORIZATION.md §4](AUTHORIZATION.md)) |

Every transition writes `role_events` and/or `audit_log` plus a notification to the affected member.

## Related workflows documented elsewhere

- **Announcements** — audience-targeted publish (`publish_announcement()` resolves recipients server-side; `all` is DD+/Owner-only, bureau audiences are that bureau's lead or DD+, `specific_members` mentions only): [`20260713050000`](../supabase/migrations/20260713050000_announcement_audiences.sql), [handbook ch. 4.5](handbook/04-features.md).
- **Prosecutor bureau coverage** — assignment lifecycle (`assign_ada_to_bureau`, `set_primary_ada`, `set_acting_ada`, `end_ada_bureau_assignment`; append-only, assignments end rather than delete): [DOJ-INTEGRATION.md](DOJ-INTEGRATION.md#bureau-aligned-ada-coverage).
- **Feedback triage, SOP versioning, shift reports** — [handbook ch. 4](handbook/04-features.md).

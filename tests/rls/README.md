# RLS / RPC security-wall tests

Integration tests that hit the **live Supabase project** as several dedicated,
low-privilege test accounts and assert that the security wall holds:

> **Fixture accounts are not currently provisioned.** The
> `rls-test-*@cidportal.test` accounts were removed from the live project on
> 2026-08-25 (owner request, alongside the bureau restructure). Re-provision
> the roster below (matching the divisions it lists) before running this
> suite; `owner_security_overview()` reports the expected fixture state.

> **These run against PRODUCTION.** That is safe only while every write stays
> inside the `rls-test-*@cidportal.test` namespace. Before adding a test:
>
> - never `.delete()` without an `.eq` / `.in` / `.match` filter;
> - never `TRUNCATE`, and never touch a case, report, member or record your
>   fixture did not create;
> - if your test needs a case, **create one** — do not borrow a real one;
> - anything attached to a real CID record will survive `rls_test_cleanup()`
>   and become live data. An `audience='cid'` SIU disclosure, for instance, is
>   visible division-wide.
>
> `rls_test_cleanup()` is `SECURITY DEFINER` and bypasses RLS, so it is
> confined to the fixture namespace by construction (migration
> `20260827120000`): it deletes only what a fixture owns *and* whose removal
> cannot alter someone else's record. Anything you author outside that
> namespace is **reported, not cleaned** — and fails the run post-suite. You
> will have to remove it by hand. See
> [`docs/TEST-ENVIRONMENT.md`](../../docs/TEST-ENVIRONMENT.md#safety-review-of-the-rls-suites-2026-08-17)
> before extending cleanup.

| Account | State | Used to prove |
| --- | --- | --- |
| `rls-test-lsb@cidportal.test` | detective, major_crimes, active | baseline member behavior |
| `rls-test-bcb@cidportal.test` | detective, street_crimes, active | bureau isolation (read/write/create) |
| `rls-test-inactive@cidportal.test` | inactive | deny-by-default |
| `rls-test-owner@cidportal.test` | detective, major_crimes, active, **is_owner** | owner-POSITIVE paths (triage writes, audit reads) |
| `rls-test-lead@cidportal.test` | **bureau_lead**, major_crimes, active | Command Center: bureau-lead scoping (own bureau only, no over-promotion) |
| `rls-test-director@cidportal.test` | **director**, major_crimes, active | Command Center: director keeps broad promote/transfer power |
| `rls-test-target@cidportal.test` | detective, major_crimes, active | throwaway target the scoping tests promote/transfer and restore |
| `rls-test-applicant@cidportal.test` | detective, major_crimes, **inactive** | disposable applicant for the membership approval-success path (activated by the test, deactivated + purged in teardown) |
| `rls-test-judge / -judge2@cidportal.test` | active **Judge** (`justice_memberships`: judiciary / judge), **no active CID profile** — not provisioned, issue #299 | judicial claim (atomic race), decisions incl. partial approval, the judge return fast lane; judge2 stays unassigned to prove isolation and cannot see a sealed assignment |
| `rls-test-ag@cidportal.test` | active **Attorney General** (`justice_memberships`: doj / attorney_general), no active CID profile — not provisioned, issue #299 | AG oversight of every judge-submitted request (sealed included), `assign_judge` for sealed requests, comment / observer authority, never a decision |
| `rls-test-justice@cidportal.test` | no membership at all | the first-login Gate (CID-only application form) in `tests/e2e/justice.spec.ts` |
| `rls-test-field@cidportal.test` | **field officer** (`field_officers` standing, `profiles.active=false`) — **optional**, not provisioned, issue #299 | the intelligence-only submitter's wall (`v188a` / `v188b`, `intel.spec.ts`): reads its own record and the thread, never a reviewer note; receives `intel_question` only; its reply fires `intel_reply`; sees a rejected record as "Closed" |

Retired with Portal Improvements P4-01 (the prosecutor stage is gone; Judge +
Attorney General are the only justice roles): `rls-test-prosecutor` /
`-prosecutor2` / `-ada-lsb` / `-ada-bcb` / `-ada-sab` / `-da` are **no longer
needed** — suites that still name them (`v121`, `v140`, `v174`) self-skip and
document historical surface. Provisioning contract for the three DOJ fixtures:
[`docs/TEST-ENVIRONMENT.md`](../../docs/TEST-ENVIRONMENT.md#doj-fixture-roster-phase-4)
and the header of `tests/rls/v163.test.ts`.

Covered: bureau isolation (read, update, insert, child rows), deny-by-default
for inactive accounts, the sign-off/finalize **lockdown triggers**, RPC caller
checks (`signoff_decide` as non-assignee), owner gates (`feedback_meta`,
`audit_log`), `is_owner` self-grant immunity, the `profiles.email`
column-grant, anonymous access, and the Command Center's `assign_member` bureau-lead scoping (own-bureau-only, no over-promotion; director stays broad).

Newer server surface (2026-07-13 migrations):

- **Membership requests** — `rls-test-inactive` plays the applicant: single
  draft per applicant (unique), major_crimes/street_crimes-only bureau CHECK, the
  `internal_decision_note` column revoke, trigger-frozen workflow columns,
  self-review rejection, detective denial of `admin_membership_requests()`,
  bureau-lead approve scoping (wrong bureau / command role), and the
  correction → resubmit → **reject** review flow (applicant stays inactive).
  `membership_request_submit()` suppresses its command fan-out for rls-test
  applicants (migration `20260713080000`), so submitting never pings real
  officers. `rls_test_cleanup()` purges the request (+history) in `afterAll`
  (migration `20260713070000`), so re-runs start fresh; if a crashed run left
  the row in a terminal status, the status-dependent tests self-skip — a
  clean re-run (or any `rls_test_cleanup` call as the applicant) clears it,
  no SQL-console step needed.
- **Membership approval (success path)** — the disposable
  `rls-test-applicant` account (never the shared inactive fixture) drafts,
  submits, and gets `approve_with_changes`d into street_crimes/senior_detective by the
  director (or owner): the block asserts the atomic result — decided columns
  + preserved requested values, profile `active/role/division` flipped in the
  same transaction, one `member_approved` notification, `internal_decision_note`
  still revoked, applicant-visible history only. Teardown deactivates the
  applicant via `assign_member` and purges the request via `rls_test_cleanup`
  (which only checks the caller is an rls-test account, not active).
- **Joint cases** — direct `case_assignments` inserts pinned to
  `assignment_source='standard'`, `convert_case_to_joint` caller check,
  bureau stays with the originating bureau (never flips to JTF), case-scoped
  read access for the joint member (case + reports, not other cases),
  immediate revocation on removal, server-enforced `expires_at`, and
  `joint_case_end` history preservation. Fixtures cascade via
  `rls_test_cleanup()`.
- **Announcements** — detectives can neither insert nor publish and are
  denied `announcement_recipient_count`; a bureau lead cannot publish to
  `all`. Broad audiences are proven **without notifying real members**:
  `announcement_recipient_count` (read-only) plus direct inserts — fan-out
  lives only in `publish_announcement`, so a lead's direct `major_crimes` insert
  (visible in-division, invisible cross-bureau) and a director's direct `all`
  insert create zero notifications. The single `publish_announcement` success
  uses the `specific_members` audience (renamed from `members`, migration
  `20260713060000`) mentioning **only** the two rls-test detectives: exactly
  2 recipients, one deduplicated notification each, visibility via the
  mentions clause. Created announcements carry a `[rls-test]` title marker
  and are deleted by their author in `afterAll`.

### Legal workflow, Phase 4 (`tests/rls/v186a` … `v186e`, `v163`, `legal.test.ts`)

Portal Improvements P4-01 … P4-12 (migrations `20261024120000_legal_tables` →
`20261027120000_legal_sweeps`) retired the prosecutor stage: a Bureau Lead
approve lands in `submitted_to_judge`. The CID fixtures alone (lsb / bcb /
lead / owner) prove the CID side; every judicial leg is `it.skipIf(!doj)` on
the judge / AG passwords (issue #299).

- **v186a** (P4-01 / P4-04): a warrant without `standard_of_proof` +
  `pc_statement` is refused; approve → `submitted_to_judge` with
  `submitted_to_judge_at` / `stage_entered_at` stamped and no decision; CID
  actors can neither claim nor assign a judge; `justice_appoint('prosecutor')`
  answers the retired-role message; the prosecutor RPCs are EXECUTE-revoked
  (42501). DOJ legs: judge return → change summary required → fast lane back
  to the judge (material change → CID gate); sealed = AG-assigned only, Owner
  fallback, judge cannot even read it.
- **v186b** (P4-03): `legal_set_charges` replaces the set with statute
  snapshots; another case's charge refused; frozen after submit; bcb reads 0
  rows; no client writes.
- **v186c** (P4-05): creator + approver-pool comments, replies, author-only
  edit with `legal_request_comment_versions`, delete blanks the body, sealed
  `legal_comment` payloads carry `{request_id, sealed:true}` only and the
  author is never paged; no client writes.
- **v186d** (P4-07): `legal_request_target_decisions` RPC-only and hidden
  from bcb; DOJ: all-denied refused, one denied target → `partially_approved`
  with rows + `_target_decisions` frozen into the judicial version +
  defaulted expiry; the creator issues; withdraw refused.
- **v186e** (P4-10): `legal_sweep_run()` Owner-only, jsonb counts, an
  immediate second run reports 0 new reminders; `legal_request_reminders` no
  client write; `legal_expiry_defaults` readable (arrest 30 / search 14 /
  subpoenas 14) and not writable; `stage_entered_at` trigger-maintained.
- **v163** is now the judge-only walkthrough (two judges + AG): atomic claim
  race, assigned-judge-only decision, judge / AG never issue, no direct
  writes, AG assigns and never decides, deactivation requeues, sealed never on
  the bench, prosecutor RPCs revoked for justice users, packet isolation.
  **v165** keeps stages / evidence designation / case brief and only the
  `justice_set_coverage` refusal. **legal.test.ts** asserts the queue hand-off
  and runs its fulfilment chains behind the judge fixture.

### Report builder, Phase 5 (`tests/rls/v187a` … `v187c`)

Portal Improvements P5-01 … P5-07 (migrations `20261028120000_report_templates`
→ `20261029120000_report_review`): templates are a server catalog, every
report pins the version it was written under, and a narrative report is
submitted by its author and sealed by a reviewer who is never the author.
CID fixtures only — lsb (author, MCB detective), lead (MCB Bureau Lead:
proposer / reviewer / reopener), director (publisher), bcb (SCB detective —
the outsider), owner (audit reads). Required keys are read from the seeded
version at test time, never assumed; templates for the flow legs are
`incident_followup` (review required) and `arrest_warrant` (self-seal).

- **v187a** (P5-01 / P5-02): the 14 seeded keys readable by any active
  member with one published version each (`required` / `advisory` arrays;
  `review_required` false only for `arrest_warrant` / `search_warrant` /
  `wiretap_warrant` / `subpoena`); no client writes on either table; a
  Detective is denied `report_template_save`; the lead proposes a draft on
  an existing key (a second save replaces it) but cannot publish or create
  a key; the director creates, publishes, re-publishes (previous version
  superseded, the earlier report keeps its pin) and retires; malformed
  schemas raise; discard is author-or-admin; `report_create` with an
  unknown key raises; a direct INSERT is pinned by the trigger.
  **Namespace note:** templates are not swept by `rls_test_cleanup` (only
  fixture-authored *draft* versions are), so the suite administers ONE
  fixed key, `rls_test_v187a`, re-activating it at the start and retiring
  it (`active=false`) in `afterAll`. Its published / superseded versions
  accumulate across runs by design; the seeded 14 are never modified.
- **v187b** (P5-03): missing required keys raise with their labels; the
  workflow columns are trigger-frozen; submit → `submitted` with the author
  signature and locked fields; review never by the author or another
  bureau; return needs a note; the author edits and resubmits; approve →
  `finalized` + `approved` with both signatures in `report_versions`;
  reopen needs a reason (Bureau Lead of the bureau) and logs the seal break;
  `report_finalize` refuses review-required templates; `arrest_warrant`
  self-seals on submit (and still on `report_finalize`); `case_closure`
  refuses submit while a task is open until `case_task_waive` (lead, reason
  required) or done; `report_submitted` reached the lead, `report_returned`
  / `report_finalized` / `report_reopened` reached the author (queried as
  the recipient — `notifications` is under RLS).
- **v187c** (P5-04 / P5-07): `report_entities_set` by the author (person,
  same-case charge, timeline_event); an unreadable case ref (bcb's case),
  a charge on another case, an unknown kind, a timeline_event with a ref
  all raise; bcb denied; source rows untouched; no client writes; reads
  follow the report ("mentioned in reports" = list by kind + ref_id); a
  case-writable editor may replace the set; locked once submitted.
  `report_record_export` pdf / md / docx receipts (10-char code, null
  version for a draft, the sealed number after approval); invalid format
  raises; bcb denied; `report_exports` reads follow the report; the Owner
  sees `REPORT_EXPORTED` / `REPORT_ENTITIES_SET` in `audit_log`. Cleanup
  runs as lsb AND bcb (each sweeps its own case); the person row is removed
  by the lead.

### Intel triage, Phase 6 (`tests/rls/v188a` … `v188c`)

Portal Improvements P6-01 … P6-07 (migrations `20261030120000_intel_triage` →
`20261031120000_intel_groups_convert`): a rejected status the submitter reads
as "Closed", one comment composer with two audiences, an explicit validation
mark, minimal notifications, a realtime shadow table behind the read wall,
groups, extended claim links and convert-with-provenance. CID fixtures —
lsb (the MCB detective who **authors** the test records as an investigator
and reviews), bcb (the other reviewer; the owner of an unreadable case),
lead (command: assign, restore-from-rejected, delete), director (command
with `director_oversight` SIB standing — never an agent), owner (the SIB
agent stand-in; audit reads), inactive; the field-officer fixture is
optional (`RLS_TEST_PASSWORD_FIELD`) and its legs `it.skipIf`. Records are
created by lsb with a `'[rls-test] v188x …'` summary in the city
jurisdiction (a draft first when claims are wanted — claim inserts are
draft-only — then `status: 'new'`); `rls_test_cleanup` sweeps
fixture-authored `field_submissions` and `intel_groups` (`20261030120000` /
`20261031120000`) and the lead hard-deletes best-effort in `afterAll`.
**Authority refusals raise SQLSTATE `P0403`** (`private.perm_raise`) — the
suites assert `error.code === 'P0403'` plus the message, never an audit row
(a `PERMISSION_DENIED` written before a raise rolls back).

- **v188a** (P6-01 / P6-02 / P6-05): reject needs a reason and sets
  `rejected_at / _by` + the note 'Rejected: …' and the audit reason (the
  reason is not a row column) with no notification to the submitter; decide / ask / a second reject are refused
  and validate says 'closed'; restore-from-rejected → P0403 for lsb and
  bcb, allowed for the lead (reviewing, columns cleared, 'Restored after
  rejection', `from_status`); the guard refuses every direct UPDATE of a
  sent record, a draft's review / SIB / grade columns and a forged INSERT; comment private → a
  reviewer note, visible → the thread with `from_reviewer`, blank refused,
  the notes INSERT 42501, a reviewer's direct message refused, the
  submitter's reply allowed only while `needs_info`; validate refused with
  '(0 of 2 claims decided, source ungraded)' → '(2 of 2 …, source
  ungraded)' → set after grading, 'already validated', withdrawn with a
  note, 'not validated'; `field_submission_counts.validated`. Officer legs:
  a private note never reaches the officer, a visible message does.
- **v188b** (P6-06 / P6-07): `intel_new` to the lead and the director with
  exactly `submission_id / submission_no / jurisdiction / actor_id /
  actor_name`; nothing for lsb, bcb, the inactive; `intel_assigned` to bcb
  only (`assigned_by`); `intel_question` to lsb only; an investigator
  author's reply is stamped `from_reviewer` and pings nobody (the officer
  fixture's reply → `intel_reply`); the shadow row's five columns readable
  by every reader, none for the inactive, 42501 on every client write, no
  shadow for a draft until it is sent; the lead is refused
  `field_submission_siu_sensitive` (SIB only — the contract's "flip as lead"
  is done through a `public_corruption` referral instead), after which bcb,
  the lead and the director read neither the record nor its shadow while
  lsb (referrer) and the Owner do; `intel_referred` to the Owner only;
  `siu_referred_submissions()` zero rows for the director / bcb / lsb and
  the nine keys for the Owner; no intel payload ever carries summary /
  details / reason.
- **v188c** (P6-03 / P6-04): suggest names G2 / G3 by number for G1 and
  the group for G3 afterwards; create with two members (bcb reads the group,
  the inactive does not; an inactive creator → P0403); add / duplicate /
  draft / no-reason / the lead refused; a removed member keeps its row and
  re-adding clears `removed_*`; summary counts 5 claims / 1 decided and
  names the linked case; `link_case` once, bcb's SCB case refused, unlink
  with a reason; 42501 on the three tables; `field_submission_delete`
  refuses a live member ('intel groups'); close → P0403 for bcb, the
  creator closes, a closed group refuses members, the lead reopens; the
  Owner sees the seven `INTEL_GROUP_*` audit rows; `field_claim_link` item →
  narcotic (`claim_item_id`), duplicate refused, person → narcotic refused,
  bcb's indicator refused, own indicator allowed, the inactive → P0403, the
  linked repeat signal; convert: the duplicate answer, then success with a
  reason (`source_submission_id`, `created_by`, the "Created despite a
  possible duplicate" note, the claim link, `FIELD_CLAIM_CONVERTED`), item →
  narcotic, missing / unknown keys, the wrong pair, a draft, the inactive
  denied. The registry rows are deleted by the lead in `afterAll`.

### Action Center + scheduler, Phase 7 (`tests/rls/v189a`, `v189b`)

Portal Improvements P7-01 / P7-03 / P7-04 / P7-07 (migration
`20261101120000_action_center`): a per-viewer queue memory
(`action_item_state`, RPC-only), notification read stamps and hydration,
task / blocker reassignment, and an hourly escalation ladder whose ledger
(`action_escalations`) is read with the case's own visibility. CID fixtures
only — lsb (the MCB detective who creates and LEADS the fixture case),
bcb (the SCB detective — the outsider until granted; the owner of the
invisible case), lead (MCB Bureau Lead — the granter, command, and the
escalation's recipient), owner (optional — audit reads, the rules, the
sweep), inactive (optional — deny-by-default). **Authority refusals raise
SQLSTATE `P0403`** (`private.perm_raise`) and are asserted as
`error.code === 'P0403'` plus the message; validation refusals are plain
raises; the Owner-only sweep functions answer jsonb `{ok:false,
code:'denied'}`. `rls_test_cleanup` is spliced to sweep the fixtures'
`action_item_state` rows (by user) and the fixture cases'
`action_escalations` rows (by case); v189a runs it as lsb AND bcb (each
owns a case).

- **v189a** (P7-01 / P7-04 / P7-07): `seen` upserts a row only lsb reads
  (bcb: zero rows for the same key); `snooze` needs a future `p_until`
  within 48 h ('snooze for up to 48 hours' — 49 h, the past and a missing
  value refused), `unsnooze` clears, an unknown op raises; `dismiss` is
  allowed for `notif:` and refused with P0403 for `task:` / `blocker:` /
  `case:…:signoff-decide` ('this item is a decision or assigned work —
  decide it, finish it or snooze it'); `_many` applies per key, skips and
  reports the non-dismissable keys, caps at 100; a decision snooze writes
  `ACTION_ITEM_SNOOZED` (single `{key, until}`, bulk ONE row `{keys,
  until}`; an informational snooze writes nothing — Owner reads); a key
  with spaces or without a lowercase prefix → the shape CHECK (SQLSTATE
  23514); no client INSERT / UPDATE / DELETE (42501 or zero rows); the
  inactive fixture → P0403 'your account is not active'; `notifications_mark_read`
  flips lsb's own unread `chat_mention` (emitted by the lead through
  `create_notification` about lsb's case), stamps `read_at`, returns 1,
  then 0, and bcb's call over the same ids counts 0; the client's column
  grant on `read` still works on an own row (the trigger follows) while a
  PATCH of `payload` is 42501; `notification_resolve`
  answers `visible=true` + the case number for lsb's case and
  `visible=false`, label null for bcb's SCB case (bcb's `chat_mention` to
  lsb about it), never another user's rows, the first 100 ids without
  raising; `action_reassign_task` to bcb
  → 'that member cannot see this case' until the lead inserts a
  `case_access_grants` row, then `assignee` flips, `TASK_REASSIGNED
  {case_id, from, to, reason}` and `task_assigned {case_id, case_number,
  task_id}` with no title / summary / reason; the same member → 'already
  assigned to that member'; bcb → P0403 'only the case lead or command can
  reassign a task' (also on the done task — authority is answered before
  the row's state); 'say why the task is being reassigned', 'that task is
  already closed', 'task not found'; the lead (command) reassigns back;
  `action_reassign_blocker` mirrors it (`owner_id`, `BLOCKER_REASSIGNED`,
  `blocker_assigned {case_id, case_number, blocker_id}`, 'that blocker is
  already resolved' after lsb resolves it).
- **v189b** (P7-03): `action_escalation_rules` zero rows (no error) for
  lsb / bcb / the lead; the Owner reads the four seeded kinds (`signoff`
  72, `access_request` 48, `task_overdue` 48, `legal` 120 **disabled** —
  a tuned production value is reported, not failed); `action_escalation_rule_set`
  and the dataset-wide `action_escalation_run()` by the lead and by lsb →
  `{ok:false, code:'denied', message}`; a direct UPDATE of the rules and
  INSERT into the ledger refused; the Owner may tune a rule **to its
  current value** (a no-op — the suite never changes a production rule) and
  gets `{ok:true}` + the row + `ACTION_ESCALATION_RULE_SET`; the sweep is
  driven through the fixture-scoped runner `rls_test_escalation_run(case)`
  as lsb (a fixture caller, a fixture-created case, ONE case — never the
  dataset; a random id → 'case is not fixture-owned'): a task due three
  days ago, **assigned to the case lead** (lsb) → one ledger row
  (`task_overdue`, the task, the case, `stage` null) readable by lsb and
  the lead, invisible to bcb, `notified = [lead]` (only recipients actually
  written; the case creator is a test member, so no real MCB lead is paged);
  `action_escalated {kind, source_id, case_id, case_number}` to the Bureau
  Lead fixture only, with no actor and no title / summary / reason (lsb —
  the assignee-lead — and bcb hear nothing); `ACTION_ESCALATED` (entity
  `case_tasks`, actor null, `notified` in the detail); a second run adds no
  row and re-notifies nobody; lsb marks the task done → the next run sets
  `resolved_at`, and reopening it re-opens the SAME row; `scheduled_job_runs`
  is the Owner's alone (the fixture runner writes no job row). Owner legs
  `it.skipIf` without `RLS_TEST_PASSWORD_OWNER`.

### The Trash, Phase 8 (`tests/rls/v190a`)

Portal Improvements P8-02 (migration `20261102120000_trash_list`, applied
live as `trash_list`): `public.trash_list(p_kind, p_limit)` — every
soft-deletable kind, one row per record the caller could restore
(`private.perm_dispatch('restore', kind, id)`: a detective their own case
material and the links they created; command every deleted row of the cases
they reach; the Owner everything), labelled through
`private.permanent_delete_record_label`, tied to its case, ≤ 500 newest
first — and `public.trash_count()`. CID fixtures only — lsb (the MCB
detective who creates and LEADS both fixture cases and authors every row),
bcb (the SCB detective — the outsider, creates nothing), lead (MCB Bureau
Lead — command; the only fixture that may soft-delete a CASE), owner
(optional — `permanently_deletable` and the preview), inactive (optional —
zero rows). Nothing new is spliced into `rls_test_cleanup`: a soft-deleted
row is the table's own row and the sweep of the fixture cases takes it
either way (the freeze trigger is BEFORE INSERT OR UPDATE only; the sweep
is a definer DELETE).

- **v190a**: lsb soft-deletes two tasks and a note on their own case →
  `trash_list()` for lsb carries them with `kind`, `label` (the title; the
  note has no label column → the id), `case_id`, `case_number`,
  `deleted_by` = lsb, `deleted_by_name`, `delete_batch`, `restorable` true,
  `permanently_deletable` **false**, newest first; the lead reads the same
  rows (not permanently deletable); bcb reads none of them; the inactive
  fixture reads zero rows and counts 0; `trash_list('case_task')` /
  `'  Case_Note '` filter to the kind, `p_limit` 1 → one row and 0 → still
  one, `'bogus'` raises 'unknown record kind'; `trash_count()` equals the
  list's length for lsb, bcb and the lead; `restore_record('case_task')`
  removes the row, lowers the count by one, the row reads live again, a
  second restore is refused and the row is in nobody's Trash; the lead
  soft-deletes lsb's second case with a reason → the case in the lead's
  Trash (`kind` case, `label` = the case number, the reason, `deleted_by` =
  the lead) with its cascaded child task in the same `delete_batch`,
  `trash_list('case')` filters to it, lsb's Trash carries the child (author)
  but NOT the case (a detective cannot restore a case), lsb's restore of the
  child → `{ok:false, code:'parent_deleted'}` 'restore the record this
  belongs to first', bcb sees neither, the lead's restore of the case brings
  the batch back and both rows leave the Trash; `permanent_delete_record_preview`
  for lsb, the lead and bcb → 'permanent deletion is restricted to the
  owner'; the Owner (`it.skipIf` without `RLS_TEST_PASSWORD_OWNER`) reads the
  still-deleted task and note as `permanently_deletable` true and previews
  the task `eligible` with `target.label` = its title, while the restored
  (live) task previews ineligible — 'the record is not in the Trash';
  `case_assignment_end` on a standard assignment lsb inserted on their own
  case: lsb → P0403 'only a Bureau Lead or above can remove an officer from a
  case', lsb's direct UPDATE of `removed_at` matches zero rows (or 42501),
  the lead ends it → `{ok, id, case_id, officer_id}`, the stamps when the
  row is still readable, 'already ended' on a repeat, `CASE_UNASSIGNED` for
  the Owner.

### Confidential Informants (`tests/rls/v191a` … `v191c`)

The CI compartment (migration `20261103120000_confidential_informants`,
applied live as `confidential_informants`): one rule everywhere —
**canAccessCI = hasFullCIAccess(user) || isAssignedHandler(user, ci)** — and
a caller who is not authorized gets NOTHING (null, zero rows), never a
placeholder, a lock, a count or a "no permission" text. Fourteen RPC-only
tables (SELECT policies only, no client write grant), every write a definer
RPC, audit in `ci_audit_events` (never `audit_log`), realtime through the
ids-only `ci_events` shadow, notifications `destination: 'portal'`. CID
fixtures only — **lsb** (the MCB detective — handler A, the one who
self-recruits), **bcb** (the SCB detective — the NORMAL detective; handler B
in one leg of v191a), **lead** (the MCB Bureau Lead — full access, the
reviewer), **director** (optional, `RLS_TEST_PASSWORD_DIRECTOR` — the second
full-access role), **owner** (optional — `audit_log` reads), **inactive**
(optional — deny-by-default). Authority refusals raise SQLSTATE `P0403`
(`private.perm_raise`) — asserted as `error.code === 'P0403'` (the wording
only where the contract fixes it); validation refusals are jsonb `{ok:false,
code, message}` and are asserted with the contract's exact strings; the
Owner-only sweep runner answers `{ok:false, code:'denied'}`. Persons and JTF
cases (readable by bcb — the "case ≠ CI" precondition) are inserted by lsb
with `[rls-test] v191x <tag>` titles; the CIs are designated by the lead (or
self-recruited by lsb). `rls_test_cleanup` is spliced (before the reports
anchor, ahead of the persons purge — `confidential_informants.person_id` is
`on delete restrict`) to sweep `ci_events`, `ci_releases`,
`case_intel_releases`, `ci_audit_events`, `ci_capacity_requests`,
`ci_handler_capacity` and every fixture-created CI (cascading handlers /
intelligence / contacts / links). The 35 security cases of the request map as
follows.

- **v191a** (cases 1–6, 13–21, 30–32, 35 — the access model): #1 bcb's
  `ci_context()` is exactly `{full_access:false, is_handler:false}`; #2 zero
  rows on all fourteen tables; #3 `ci_get` / `ci_person_status` /
  `ci_case_intel` null / empty; #4 immediate protection — the lead designates
  CI A with lsb primary and lsb reads exactly it (list, row, `1 / 6`), bcb
  still nothing; #5 the person stays a plain person (bcb reads the persons
  row, no CI column, no CI number in it); #6 the lead and the director read
  the CI, its handlers and `ci_stats()`, null for the handler; #13 bcb reads
  the JTF case and `ci_case_intel(case)` is still empty; #14 the handler's
  intelligence is in the case for lsb and the lead (`ci_number`, handler,
  corroboration, `release_count`); #15 `ci_case_counts([case])` empty for
  bcb, n > 0 for lsb / the lead; #16 handler B — bcb reads exactly CI B, lsb
  exactly CI A, the lead both, `ci_assigned` ids only; #17 INSERT into every
  table → 42501 for lsb and bcb, the handler's UPDATE / DELETE match nothing;
  #21 `ci_set_status` → P0403 for lsb and bcb, the lead needs a reason; #20
  retired → `active_count` 0 with `is_handler` true, `CI_STATUS_CHANGED
  {from, to}` in `ci_audit_list` for lsb, nothing for bcb; #18/#19 demotion
  through `rls_test_reset_member` — the lead (made secondary handler first)
  as detective keeps exactly CI A, `ci_get(CI B)` null, `ci_stats()` null,
  `ci_set_status` P0403, restored to `bureau_lead` in a `finally`; #30 a
  direct-id `ci_get` is null for the real CI and a random id alike,
  `ci_search` empty for bcb; #32 an unauthorized write and an unknown id
  raise the SAME P0403 wording, the handler's `ci_update` works while a
  bureau change is P0403; #31 `ci_audit_events` readable through the CI by
  its handler, immutable, invisible to bcb, and `audit_log` carries no CI
  entity / `CI_%` action (Owner); #35 the inactive fixture — the same
  `{false,false}`, zero rows everywhere.
- **v191b** (cases 7–12 — capacity): #7 six self-recruited active CIs →
  `ci_context()` `{active_count: 6, capacity: 6}`, the lead's `ci_stats()`
  roster agrees, a `candidate` does not count; #8 the seventh → `{ok:false,
  code:'capacity', message:'You are at capacity (6 / 6). Request additional
  capacity or an assignment.'}` for lsb, `'<name> is at capacity (6 / 6).
  Confirm the override with a reason.'` for the lead without a reason,
  nothing created; #9 `ci_capacity_request_submit('capacity', 8)` — bcb
  P0403 (not a handler), ≤ capacity and > 30 refused, one pending per kind,
  `current_count` 6, readable by lsb and the lead not bcb, `ci_capacity_request`
  to the lead with ids only, `CI_CAPACITY_REQUESTED` (`ci_id` null) readable
  by the requester; #10 decide is P0403 for lsb / bcb, a denial needs a note,
  approval → `ci_handler_capacity` (8, `request_id`), `CI_CAPACITY_CHANGED`,
  `ci_request_decided`, `capacity` 8; #11 CIs #7 and #8 → `active_count` 8,
  #9 refused with `(8 / 8)`; #12 the lead's `p_override_reason` at 8 / 8 →
  ok, `CI_CAPACITY_OVERRIDE` with the reason in `ci_audit_list(ci)` for the
  handler (nothing for bcb), limit 9; `ci_capacity_set` P0403 for lsb, null
  → back to 6; a direct INSERT into the override table 42501.
- **v191c** (cases 22–29, 33, 34 — the leak surfaces): #22 `search_all('CI-')`
  and `search_all(<ci number>)` name no CI for anyone (no CI kind); #23
  `search_all(<person name>)` still finds the PERSON for bcb and no hit
  carries the CI number / id / "informant" (the alias finds nothing); #24
  `entity_suggest('person')` finds the person and reveals no CI; #25
  `entity_crossref('person', id)` has no CI edge; #26 `case_audit_feed(case)`
  carries no `confidential_informants` / `ci_%` entity or `CI_%` action; #27
  bcb has no `ci_*` / `case_intel_released` notification, every `ci_*`
  payload is ids only, and the registry (`notificationTitles.json`) marks
  every `ci_*` kind `informants` + `destination: 'portal'` (the Discord edge
  function never DMs them) while `case_intel_released` has no portal
  destination; #28 `ci_events` zero rows for bcb, ids-only rows (`id, ci_id,
  user_id, kind, at`) for lsb, INSERT 42501; #29 `ci_export(ci)` for the
  handler (audited `CI_EXPORTED`), null for bcb, the roster only for full
  access; #33 `ci_release` P0403 for lsb / bcb, a body naming the CI number /
  the person / the alias → `{ok:false, code:'unsanitized', message:'The text
  names the source — remove the CI number, name, alias or handler.'}`, the
  clean release readable by bcb through the case as `case_intel_releases`
  (title, body, handling — no CI column) while `ci_releases` is zero rows for
  bcb and the link row for lsb, the intelligence untouched, `release_count`
  1, `CI_INTEL_RELEASED` in the compartment, revoke P0403 for lsb and the
  revoked row gone for bcb / kept for the lead; #34 `ci_case_counts([case,
  empty case, random])` → `[]` for bcb, exactly `[{case, n}]` for lsb and
  the lead.

### Platform upgrade (`tests/rls/v192a` … `v192c`)

The platform upgrade (migration `20261105120000_platform_upgrade`, applied
live as `platform_upgrade`; design in
[`docs/PLATFORM-UPGRADE.md`](../../docs/PLATFORM-UPGRADE.md), authority in
[`docs/AUTHORIZATION.md` §22](../../docs/AUTHORIZATION.md)): evidence
integrity + custody, background jobs, case packets + manifests, document
extraction / tools / search, external sources behind an SSRF policy, the
INVOKER investigation graph, search authorisation, feature flags and system
health. CID fixtures only — **lsb** (the MCB detective: uploader, requester,
submitter), **bcb** (the SCB detective — the other bureau, and THE PLAIN
DETECTIVE of the CI proof), **lead** (the MCB Bureau Lead — command,
inserts the restricted media row, designates the CI), **owner** (optional —
`audit_log`, every job, the Owner-only RPCs' positive path), **inactive**
(optional — deny-by-default). Cases, media rows (client-chosen ids so the
bucket path `case/<case>/<media>/<file>` can name them — **no object is ever
uploaded**; the runner's verify job failing on a missing object is the
runner's business), persons, gangs and sources are inserted by lsb with
`[rls-test] v192x <tag>` titles; `rls_test_cleanup` is spliced for
`background_jobs`, `evidence_custody_events`, `export_manifests`,
`case_packets`, `document_pages`, `document_extractions`,
`external_source_links`, `external_source_versions`, `external_sources`,
`semantic_chunks` and `search_index_queue`. Authority refusals are asserted
as `error.code === 'P0403'`; validation refusals as `{ok:false, code}`
(`bad_state`, `bad_url`, `bad_request`). Where the live runner may have
already claimed a job, a test accepts every status a row can legitimately
reach and never a grant denial.

- **v192a** (evidence): #1 `evidence_register` → `EV-000000` series number,
  COLLECTED → UPLOADED → REGISTERED with `prev_hash` chaining, an
  `evidence.verify` job, `EVIDENCE_REGISTERED` (Owner); #2 a second register
  is `bad_state`; #3 a legacy external-hosted row is `bad_state`, a non-hex
  hash refused; #4 a direct UPDATE of `sha256` / `integrity_status` /
  `evidence_number` / `current_custodian` / `sealed_at` / `parent_media_id`
  → P0403 with the row unchanged (an ordinary column still edits); #5
  custody events: UPDATE / DELETE → P0403, INSERT → 42501; #6
  `evidence_custody_transfer` custodian → the lead (TRANSFERRED with
  previous / new custodian, `evidence_custody_transfer` ids only), the other
  bureau's reader of the JTF item P0403, the uploader transfers back; #7
  `evidence_access_log` VIEWED deduped per actor within 10 min, DOWNLOADED
  always, an unknown action refused; #8 `evidence_chain_verify` ok; #9
  `evidence_seal` refused while unverified, `evidence_release` P0403 for a
  detective; #10 bcb reads no custody event of the MCB item, every RPC
  P0403 with the same wording for a hidden and a random id; #11
  `background_jobs` private to the creator (bcb and the lead read zero
  rows), `job_claim` / `_complete` / `_heartbeat` / `_fail` refused, direct
  writes refused, cancel by an outsider P0403, retry / stats P0403; the
  Owner reads every job + `background_jobs_stats`; #12 the inactive fixture.
- **v192b** (packets, documents): #1 `case_packet_request(doj)` → a queued
  packet with the preset sections, a `packet.render` job on `pdf`,
  `CASE_PACKET_REQUESTED`; unknown type / empty custom / unknown section
  refused; #2 the snapshot excludes the lead's RESTRICTED photo (path and
  title absent, `excluded.restricted_media ≥ 1`), carries the registered
  items by number, has no CI-shaped key; #3 bcb: request P0403, zero packet
  rows, access log P0403 (same wording as a random id), zero job rows; #4
  the requester and the lead log a download, `CASE_PACKET_DOWNLOADED`
  (Owner); #5 `manifest_verify` on an unknown id is `missing` or P0403,
  `export_manifests` INSERT 42501, bcb reads no manifest; #6
  `document_search` empty-safe for both, `document_pages` /
  `document_extractions` zero rows for bcb and INSERT 42501,
  `hybrid_search` empty-safe; #7 `document_tool_request`: unknown tool /
  another case's media / empty → `bad_request`, bcb P0403, `page_numbers`
  → a `pdf.tool` job with ids-only args, `DOCUMENT_TOOL_REQUESTED`; #8
  `document_extract_request` → `document.extract` + a `queued` extraction
  row, nothing for bcb; #9 `evidence_bundle_request`: another case's item /
  empty / the restricted item → `bad_request`, bcb P0403, the case's items →
  `bundle.build` on `exports`; #10 every new table refuses direct writes,
  `soft_delete('case_packet')` by the requester (refused for bcb) → gone for
  the lead, in `trash_list('case_packet')` with a label that names no
  restricted title, `restore_record` brings it back.
- **v192c** (sources, graph, search, the CI proof): #1
  `external_source_submit(https://example.org/…)` → `SRC-000000`, a
  `pending` row, a `source.fetch` job on `crawler`; a second source pinned
  to the MCB case; bcb refused for that case; #2 twenty-three blocked URLs
  (localhost, 127/8 incl. `127.1`, 10/8, 172.16/12, 192.168/16, link-local
  + `169.254.169.254`, CGNAT + `100.100.100.200`, 0/8,
  `metadata.google.internal`, `.internal`, `.local`, `::1`, `fe80::`,
  `fd00::`, `::ffff:127.0.0.1`, `file:`, `ftp:`, `data:`, `javascript:`,
  userinfo, no scheme) and a 2100-char URL → `bad_url` / `bad_request`,
  nothing inserted; #3 the pinned source invisible to bcb (zero rows, P0403
  with the same wording for a random id on verify / recrawl / update), the
  case-less source visible to everyone, edit is the submitter's or
  command's, moving it onto a hidden case refused; #4
  `external_source_verify` sets status + reliability (bad values
  `bad_request`); #5 `external_source_link`: a hidden target refused, an
  unknown id refused, kind `ci` `bad_*`, a person link reads back for the
  submitter, idempotent on repeat, a case link readable by bcb through both
  walls, INSERT 42501, unlink P0403 for bcb and ok for the submitter; #6
  versions and sources refuse every direct write, bcb reads no version of
  the pinned source; #7 `external_source_search` empty-safe, `crawler_policy`
  never client-writable; #8 `graph_expand('person')`: the root at depth 0,
  the case edge (`involved_in` / `suspect_in`), the gang edge (`member_of`),
  depth 9 → ≤ 3, limit 100000 → ≤ 500, `p_kinds` filters neighbours only,
  the MCB case absent for bcb, a hidden / random root → empty, a `ci` kind
  → empty or refused, the inactive fixture refused or empty; **#9 the CI
  proof** — the lead designates the person (linked to the JTF case both
  detectives read, member of a gang) via `ci_create` with the lead as
  primary; for bcb *and* lsb: `graph_expand` from the person and from the
  case has no `ci` node kind / no CI edge kind / no CI number / no CI id,
  `document_search` / `external_source_search` / `hybrid_search` of the CI
  number return nothing, `search_authorize` strips a forged `{kind:'ci'}`
  hit, `search_all` names no CI and the person hit carries no CI text,
  `case_packet_request(full)` produces a snapshot without the number or the
  id, `trash_list()` names no CI, `ci_get` is null, the `persons` row has no
  CI column; a source link to the person says nothing; then the lead retires
  the CI and every answer is unchanged, the graph edges still there; #10
  `system_health` / `feature_flag_set` / `crawler_policy_set` /
  `background_jobs_stats` → P0403 for the detectives and the lead; the ten
  `feature_flags` rows readable, never client-writable (UPDATE nothing /
  INSERT 42501); `service_health_events` / `search_index_queue` /
  `semantic_chunks` zero rows; the Owner reads `system_health`, re-sets
  `advanced_graph` to its current value (`FEATURE_FLAG_SET` audited, nothing
  changed), an unknown key refused, an unknown policy key refused.

### DOJ legal review (v1.13.0 — `tests/rls/legal.test.ts`; historical model)

37 assertions covering the DOJ Legal Review System (see
`docs/DOJ-INTEGRATION.md`): justice identity separation (CID/DOJ/Judge never
cross domains; hidden-field role smuggling rejected), the onboarding approval
matrix, ADA bureau assignments (one primary/acting per bureau, no Judge/JTF,
no self-assign), routing precedence (acting → primary; missing coverage parks
unassigned, never reroutes; DA/AG/Owner override needs a reason), drafting +
immutable versions, CID review, ADA review + **packet isolation** (an assigned
ADA sees the request and its packet but not the case, evidence, or roster),
conflict-of-role (prosecutor ≠ Judge on the same request), the DA and AG
subpoena approval routes, judicial approval signing the exact version, CID-side
fulfilment + the MDT expired-vs-wanted contract, sealed-request undiscoverability
(table/search/notifications), and hard-delete resistance. The suite purges
leftovers via `rls_test_cleanup()` at **both** start and teardown, so re-runs
are deterministic; a NULL-guard gap it caught became migration
`20260714070000_legal_null_guards`.

**Run-level cleanup guard (no production pollution).** Beyond each suite's own
`afterAll`, a vitest `globalSetup` (`tests/rls/globalSetup.ts`) calls
`rls_test_cleanup()` once **before** any suite starts and once **after** the
whole run finishes. An `afterAll` is skipped when a file throws in `beforeAll`
or times out — which is how test rows accumulated in the live project (24 SOP
docs / 4 narcotics / 1 place, removed by hand 2026-07-18). The run-level hook
plus the widened `rls_test_cleanup` (migration `20260807160000`, which now also
purges fixture-authored documents / narcotics / gangs / places / vehicles /
persons) means a crash can no longer leak into production. `v144` is the
regression pin.

The justice fixture passwords (`RLS_TEST_PASSWORD_JUDGE / _JUDGE2 / _AG`,
`_JUSTICE` for the Gate spec) enable the DOJ legs; without them they skip. `tests/rls/auth.ts` adds a sign-in backoff so
authenticating ~20 fixtures per run doesn't trip GoTrue's per-IP burst limit.

### Security dashboard reporter (v1.14 — `tests/rls/securityReporter.ts`)

A vitest reporter (registered in `vitest.rls.config.ts`) feeds the Owner
Portal's **Security Testing** section after every run: it signs in as the
`rls-test-lsb` fixture (anon key + password grant — the same credentials the
suite itself used) and posts per-file pass/fail/skip counts plus **sanitized**
failure summaries (test name + first assertion line only) through the
`security_test_report()` RPC, which is EXECUTE-limited to `rls-test-*`
accounts and re-sanitizes server-side. Reporting is strictly **best-effort**:
any error logs a warning and never affects the run, and it self-skips when the
anon key or `RLS_TEST_PASSWORD_LSB` is absent — so plain/secretless runs stay
offline. In CI it reports automatically (as `source: 'ci'`) whenever the
fixture-password secrets exist. No service key, no new secrets.

A `tests/rls/v114.test.ts` suite covers the v1.14 surface (report-version
immutability, `search_all` legal hits staying sealed-safe, and the
security-testing RPC gates).

### DOJ search warrants & owner import (v1.15 — `tests/rls/v115.test.ts`)

A `tests/rls/v115.test.ts` suite covers the v1.15 legal surface: the new
`search_warrant` behaviors (accepted as a warrant subtype; a subject **or** at
least one `form_data.search_targets` entry required — no mandatory
Persons-registry suspect; Judge-only approval inherited; classified default; no
MDT wanted-person projection), and the owner-only warrant import
(`import_legal_warrant` restricted to the owner and denied to non-owners;
**idempotency** on `import_key` — a repeat key yields no duplicate; provenance
columns recording the historical submitter/timestamp separately from the import
actor; landing at `submitted_to_doj`; and `import_rollback_by_key` reversal that
leaves `audit_log` intact). The suite has **not** been run yet — it documents
the intended coverage.

## Running

```bash
npm run test:rls
```

Credentials come from the environment (or a git-ignored `.env.rls.local`):

```
RLS_TEST_PASSWORD_LSB=…
RLS_TEST_PASSWORD_BCB=…
RLS_TEST_PASSWORD_INACTIVE=…
RLS_TEST_PASSWORD_OWNER=…   # optional — enables the owner-positive block
RLS_TEST_PASSWORD_LEAD=…    # optional — enables the Command Center scoping block
RLS_TEST_PASSWORD_DIRECTOR=…   # also enables the second full-access leg of v191a
RLS_TEST_PASSWORD_TARGET=…
RLS_TEST_PASSWORD_APPLICANT=… # optional — enables the approval-success block
RLS_TEST_PASSWORD_JUDGE=…     # optional — DOJ legs (judge); not provisioned, issue #299
RLS_TEST_PASSWORD_JUDGE2=…    # optional — the second judge (v163 race)
RLS_TEST_PASSWORD_AG=…        # optional — the Attorney General
RLS_TEST_PASSWORD_FIELD=…     # optional — the field-officer fixture (v188a/b officer legs, intel.spec); not provisioned, issue #299
# optional overrides: RLS_TEST_SUPABASE_URL, RLS_TEST_ANON_KEY
```

Without them the whole suite **skips**, so plain `npm test` stays offline.
CI's `security-suites` job runs this suite (and the E2E smoke) whenever the
passwords exist as repository secrets — add them under Settings → Secrets →
Actions to turn it on; forks and secretless clones stay green.

## Safety design

- The accounts sign in with the **anon key + password grant**; none holds a
  command role (the owner account carries only `is_owner`). Passwords live
  only in env/secret storage — rotate them any time in the Supabase
  dashboard (Auth → Users).
- The core suite asserts **denials**; the separate owner block asserts the
  owner's positive paths (triage metadata, audit reads). Neither drives the
  real sign-off chain, so tests can't route work or notifications to real
  officers. The owner account holds no command role — its blast radius is
  feedback triage + audit reads.
- Fixtures (one case + one report + one feedback row per run) are removed in
  `afterAll` by the `rls_test_cleanup()` RPC (migration `rls_test_cleanup_rpc`),
  which only the `rls-test-*` accounts may call and which deletes **only rows
  they authored**.
- The active accounts are visible in the roster as "RLS Test — …". If they
  bother you, deactivate them; the suite then fails its sanity check instead
  of silently passing.

## Track record

First run immediately caught a live bug: `private.is_owner()` was missing its
EXECUTE grant, which made **every** statement touching an `is_owner`-based
policy fail for all users — member feedback submission, the owner's triage
writes, and the owner's audit view. Fixed by migration
`grant_execute_is_owner` (2026-07-09).

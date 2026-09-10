# Handoff — Portal Improvements plan (written 2026-09-07 at shutdown; updated 2026-09-09 after Phases 7–8)

The Portal Improvements plan (`docs/PLAN-PORTAL-IMPROVEMENTS.md`) is delivered
through **Phase 8 of 8**: Phases 0–6 are merged into `main`; Phases 7 and 8
are on the branch `claude/portal-improvements-plan-ubkiho` as two commits behind
draft PR #372 (not merged — the Owner was away; nothing was merged on their
behalf). This file is the state of the work, how it was delivered, what is
live in the database, and what remains, so whoever picks it up can continue
without the session that built it. The last section lists what would make
the site less cluttered.

## 1. What is delivered (all merged into `main`)

| Phase | PR | Merge commit | Migrations (repo file → live name) |
|---|---|---|---|
| 0 hygiene | earlier PRs | — | `20261004…` (jurisdiction replay, pg_cron scheduler) |
| 1 foundations | #321 | `0c9bdc7` | `20261005120000_permission_module` … `20261013120000_permanent_delete_record` |
| 2 entity layer | #331 | `255e71e` | `20261014120000_entity_normalization` … `20261019120000_entity_crossref` |
| 3 unified workspace | #340 | `938d5e1` | `20261021120000_case_notes` … `20261023120000_archived_read_only` |
| 4 legal workflow | #353 | `26c2901` | `20261024120000_legal_tables` … `20261027120000_legal_sweeps` (+ `legal_reroute_v_rank_fix`, `legal_review_fixes` live) |
| 5 report builder | #361 | `3e42537` | `20261028120000_report_templates`, `20261029120000_report_review` (+ `report_review_entity_exists`, `report_review_fixes` live) |
| 6 intel triage | #371 | `8e7a326` | `20261030120000_intel_triage` (+ `intel_triage_perm_raise`, `intel_review_fixes`), `20261031120000_intel_groups_convert` (+ `intel_groups_convert_policy_grant`, `intel_review_fixes`) |
| 7 Action Center and scheduler | #372 (draft, commit "Phase 7: …") | — not merged | `20261101120000_action_center` (+ `action_center_review_fixes`, `action_center_review_fixes_surv_alert`) |
| 8 mobile, Trash, history UI, docs | #372 (draft, commit "Phase 8: …") | — not merged | `20261102120000_trash_list` |

Every migration listed is **applied to the live project `jhxuflzmqspidkvjckox`**
and the repo file is the reviewed state (follow-ups applied live under the
names in parentheses are folded into the same file — see the APPLICATION
NOTE at the top of each file and `supabase/MIGRATION-HISTORY.md`).
`supabase/schema-snapshot.sql` was rebuilt from a live dump after the last
apply (Phase 8) and `check:schema` / `check:freshness` / `check:realtime` pass.

Issues: P1 … P6 issue sets are closed; the Phase 7 issues #373–#380 and the
Phase 8 issues #381–#387 close when PR #372 merges. The tracking issues that
remain open are in §5.

**To finish:** review and merge PR #372 (two commits — Phase 7 then Phase 8 —
plus the handoff commit), then `supabase functions deploy discord-notify`
(the edge function gained `titles.json` and the per-category Discord opt-in;
until deployed DMs keep the old titles and ignore the opt-in), then the
restore drill in `docs/OPERATIONS.md` §5 (needs a scratch project).

## 2. What remains

Nothing of the plan's eight phases is undelivered. What each of the last two
phases delivered, and the small deviations, are in §5 and in
`supabase/MIGRATION-HISTORY.md` ("Portal Improvements — Phase 7 / Phase 8"),
`docs/AUTHORIZATION.md` §19–§20, `docs/WORKFLOWS.md` §12–§14 and the PR #372
body. The lists below are kept as the record of what the phases were asked to
do.

### Phase 7 — Action Center and scheduler (plan §21 "Phase 7", §5.9, §6.8, §8.7; decisions AC1–AC7, X3) — delivered
- **P7-01** `action_item_state` + `action_item_set_state` (dismiss refused for decision kinds; snooze ≤ 48 h; audit for command decisions); `notifications.read_at` + index; `markRead` batch via RPC. Tests `tests/rls/v189a.test.ts`.
- **P7-02** builder branches for every queue kind (restricted packet, MDT export, field access, claim verdicts, narcotic suggestions, gang duplicate reviews, tracker co-signs, SIB conflicts / watch reviews, Owner signals, justice applications, surveillance alerts, access expiring, legal comments / escalations, report review, the intel kinds) — each with a direct action and a deep link, bounded queries.
- **P7-03** `cases.priority` weight; `action_escalation_rules` + hourly `action_escalation_sweep()`; `escalated_at`; `action_escalated` notification; badge.
- **P7-04** `action_reassign_task`, `action_reassign_blocker`; bulk bar (read / snooze / dismiss only); reassign dialog; audit.
- **P7-05** `savedViews('action')`; presets per role from `my_permissions`.
- **P7-06** `useActionQueue` shared cache; `ActionSlice` in My Dashboard and Command Center; `ApprovalQueue` → preset; retire the Phase-1B switcher; remove legacy `command/` duplicates; `useNavBadges` from the queue.
- **P7-07** `notification_resolve(ids)`; new kinds store ids only; `notification_titles.json` shared with the Discord edge function; `user_prefs.notif_discord` opt-in per category.
- **P7-08** Action Center mobile (`useNarrow` cards, 44 px targets, keyboard bulk selection) and the a11y ratchet.

Dependencies already in place for Phase 7: P1 state/audit, P4 legal kinds,
P5 report review kinds (`report_submitted` / `report_returned` /
`report_finalized` / `report_reopened`), P6 intel kinds (`intel_new` /
`intel_assigned` / `intel_question` / `intel_reply` / `intel_referred`) and
the `field_submission_events` shadow table (the Action Center already
subscribes to it), P0-04 pg_cron.

### Phase 8 — Mobile, Trash, history UI, docs (plan §21 "Phase 8") — delivered
- **P8-01** `/m/cases/[id]` mobile case route; **P8-07** narrative-only mobile report editing (RB11).
- **P8-02** `public.trash_list`, `/trash`, "Deleted — Undo" through `restore_record`, retire `deleteWithUndo`.
- **P8-03** generalised armed permanent-delete dialog from the Trash (Owner).
- **P8-04** `RecordHistory` (compare / restore with reason) on dossiers, case overview, notes, report drafts, legal drafts, intel.
- **P8-05** documentation release (§14), CHANGELOG, version bump.
- **P8-06** backup restore drill and `OPERATIONS.md` §5 — the runbook is rewritten and the live audit chain verified; the drill into a scratch project itself is the Owner's (paid branch / project).

## 3. How each phase was delivered (repeat this)

1. Read the plan's phase section, the decisions (§2), the acceptance criteria (§17) and the existing surface (the live function bodies from `supabase/schema-snapshot.sql`, the policies, the client files).
2. Write a **server contract** (tables, RPC signatures and refusal wording, policies, notification kinds, labels, fixtures, test plan, docs list). The Phase 4–6 contracts lived in the session scratchpad and are gone; their substance is in the migration headers, `docs/AUTHORIZATION.md` §16–§18, `docs/WORKFLOWS.md` and `supabase/MIGRATION-HISTORY.md`.
3. Create one GitHub issue per plan item (labels `area:*`, `type:feature`, `phase:N`, `migration`, `security` as the plan lists them).
4. Hand-edit `src/lib/database.types.ts` up front for the new tables / columns / RPCs (never regenerate it wholesale — it is hand-maintained) and fix the mock row builders (`src/mocks/fixtures/rows.ts`) and test fixtures that spell out full rows.
5. Run three agents in parallel from the contract: client A (the primary screen), client B (secondary surfaces), tests + mocks + docs (RLS suites, MSW handlers, e2e spec, docs). Give each an exact file ownership list and the exact component props they exchange.
6. Write the migrations yourself: additive only, definer RPCs with `set search_path to ''`, RLS policies, grants/revokes, catalog rows, `perm_dispatch` arm (re-emit the whole function with every other arm byte-identical), `rls_test_cleanup` splice via `pg_get_functiondef` + anchor replace. Apply live with the Supabase MCP `apply_migration` (paste the full SQL). Verify in ONE `begin; … rollback;` `execute_sql` run impersonating live users with `set_config('request.jwt.claims', …, true)` + `set local role authenticated` (temp tables need `grant all … to authenticated`; DO blocks with EXCEPTION capture `sqlerrm`; note a caught exception rolls back the block's own writes, so audit rows written before a RAISE are never visible that way).
7. Read-only **security review** agent over the migrations and the client diff; fix everything HIGH / MEDIUM and the cheap LOWs; re-apply live as `<name>_review_fixes`, fold into the repo files, re-verify.
8. Rebuild the snapshot: run `scripts/schema-dump.sql` through `execute_sql` (the result is saved to a file — extract the JSON between `>\n[{` and `}]\n</untrusted-data-` with python, `json.loads(...)[0]['dump']` → `supabase/schema-dump.json`), then `node scripts/build-schema-snapshot.mjs`.
9. Gates: `npm run typecheck`, `npx eslint src tests --max-warnings 0`, `npx vitest run`, `npm run build`, `check:bundle`, `check:dead` (knip), `check:submit`, `check:schema`, `check:freshness`, `check:realtime`, `gen:permissions -- --check`, `gen:handbook`, `gen:guide`. Update `supabase/MIGRATION-HISTORY.md` (prose block + table rows).
10. One commit on `claude/portal-improvements-plan-ubkiho`, draft PR against `main` mirroring `.github/PULL_REQUEST_TEMPLATE.md`, subscribe, hourly check-in; on merge reset the branch onto `origin/main`.

## 4. Conventions and hard rules (from CLAUDE.md and the phases)

- RLS is the authority; every client check is a cosmetic mirror (`src/lib/permissions/mirrors.ts`, `usePermissions`, `can_record`). No `roles.ts` / `siu.ts` imports outside `src/lib/permissions` (ESLint rule).
- Migrations are additive; never rewrite audit / history tables; never commit a `service_role` key; `SYNC_SECRET` never in the repo.
- Refusal styles in use: the jsonb `{ok:false, code:'denied', message}` style (soft delete, entity layer, report templates / entities / exports, `field_submission_convert`) writes its `PERMISSION_DENIED` row; the RAISE style (report flow, legal, intel) must raise through `private.perm_raise` (SQLSTATE `P0403`, detail `{action, kind, id, reason}`) — a `perm_deny` before a RAISE rolls back. Since Phase 6 `src/lib/db.ts` acknowledges a P0403 automatically through `perm_denied_ack`, which records only refusals the server agrees with. Phases 4–5 still use `perm_deny` + `raise` in places; converting those to `perm_raise` is a small cleanup nobody has done.
- Non-definer guard triggers are the way to stop client writes (`current_user in ('authenticated','anon')`); a definer trigger cannot tell the caller.
- Realtime: publish a shadow table, never a table with text; a soft delete is an UPDATE of the shadow (a DELETE event bypasses RLS).
- Fixture emails `rls-test-*@cidportal.test` only; the fixtures are **not provisioned** (#299), so every RLS and e2e suite self-skips in CI — the v18x suites have never run against live fixtures.
- Live users used for verification: Owner/Director Tom Wood `25466146-c512-4497-8ee8-88cbf3b1d22d`, detective Gryphon Funk `a585124e-29e7-475b-a3a6-40068a662332`, director Oliver Ocho `de727b21-52a8-4802-8ab5-306fd3970d8b`, detective Tess Woods `5def7dbc-1c44-4dc1-8fd0-b9dfc4813675`, Lana Croft `1980aca4-8275-4149-b130-84f3ea9a557c`.

## 5. Known deviations and loose ends

- `reports.template_version_id` stays nullable (the v180 fixture's legacy `'initial'` insert); `report_submit` refuses such a report until a template is picked.
- Phase 6: the reject reason and validation note are NOT row columns (the author reads their own row); they live in the reviewer-private note and the audit row. An indicator is linked, not converted. `intel_group_suggest` returns the empty shape for an inactive caller.
- The Director's ex-officio SIB oversight standing sees no SIB intake and no referred origin records (by design).
- Open issues: **#299** provision the DOJ / RLS fixtures and CI secrets (owner-gated; unblocks every RLS and e2e suite — the v189 / v190 suites have never run live either), **#300** the a11y ratchet (the Action Center part landed in P7-08; the site-wide axe gate is not wired), **#194** deadlines and notifications (delivered in spirit by P7-03 / P7-07).
- Security advisors: the definer-executable WARN count is 319 after Phase 8 (the documented pattern); no table-level findings.
- `docs/PLAN-PORTAL-IMPROVEMENTS.md` §22 still says "nothing has been implemented" — historical; this file supersedes it for status.
- Phase 7: the escalation ledger `action_escalations` is a shared table readable with the case (the plan said "`escalated_at` on `action_item_state` for all viewers", which a per-viewer row cannot carry); the `legal` escalation rule is seeded disabled because `legal_sweep` already escalates legal requests; a restricted packet "export approval" item is the open one-hour window, not a request (the log records approvals only); `justice_application` items are informational, not decisions; `notification_resolve` labels a report by its `kind` (reports have no title). The read-only security reviews' findings are folded into the migration and the client (`action_center_review_fixes`, `action_center_review_fixes_surv_alert`; Discord DM bodies carry free text only for five kinds; the Discord-category read fails closed).
- Phase 8: `RecordHistory` is mounted on person / vehicle / gang dossiers, the case Overview, notes, report drafts, draft legal requests (compare only) and intel records; places, accounts, narcotics and evidence have no detail surface to mount it on. The restore drill was not performed (needs a scratch project); the runbook is rewritten and the live audit chain verified. The 'Deleted — Undo' toast links the Trash, and `deleteWithUndo` is gone (`deleteRecord`; `case_templates` and `commendations` are plain confirmed removes; a case assignment removal stamps `removed_at`).
- `discord-notify` is NOT redeployed by the branch; deploy it with the release.

## 6. Where to look first

`docs/PLAN-PORTAL-IMPROVEMENTS.md` (the plan), `docs/AUTHORIZATION.md` §6–§18
(what each phase enforces), `docs/WORKFLOWS.md` (the user-facing flows),
`supabase/MIGRATION-HISTORY.md` (what is live and what was verified),
`tests/rls/README.md` (the fixture roster and what each suite proves),
`docs/TEST-ENVIRONMENT.md` (how to provision the fixtures).

## 7. What would make the site less cluttered

Observations gathered while delivering the eight phases — none of these is in
the plan, each is a small, safe cleanup a follow-up PR could take. They are
ordered by how much noise they remove for a member on an ordinary day.

1. **Four "what is waiting on me" surfaces became one queue, but the pages are still four.** My Dashboard (`/inbox`), the Action Center (`/action`), the Command Center Overview and the legacy Division Overview (`/command`) all still exist as tabs. Make `/inbox` the Action Center with the personal preset applied (one route, one nav entry), keep the Command Center as the command home, and fold `/command`'s Division Overview panels (`components/command/*`: trackers, analytics tiles, raid comp, encouragement, activity feed) into the Command Center sections or into `/analytics`, then delete the `command/` folder.
2. **Two analytics screens.** `/analytics` (Division Analytics) and the Division Overview's analytics tiles show overlapping numbers; keep one.
3. **Navigation categories carry rarely used leaves.** Oversight now holds Calendar, Shifts, Audit and Trash; Owner-only leaves (Owner Console, Audit, Developer Handbook, Report Templates admin) sit in the main nav for everyone who can see them. Move Owner-only leaves under one "Owner" category shown only to the Owner, and the Handbook behind the Owner Console.
4. **Case workspace section strip is long.** `caseTabs.ts` lists 18+ sections; on most cases half are empty. Hide empty optional sections behind a "More…" chip (Graph, Charges, RICO, Legal, Surveillance, Extractions, Timeline when they have no rows) — the counts are already fetched for the pills.
5. **The Command Center's Approval Queue duplicates the Action Center's command preset** (it now embeds the same slice plus the membership review). Rename it "Membership review" and drop the embedded slice, or drop the section and let membership items open from the Action Center only.
6. **Notification bell + Action Center both list unread notifications** (`notif:*` items). Either the bell shows only what the queue does not (mentions, announcements), or the bell becomes a link to the Action Center's Activity lane.
7. **Legacy routes kept alive as redirects** (the 14 Intelligence tool routes, `/reports`, `/tools`) each add a prerendered page; once bookmarks have aged, remove the redirect leaves from `PAGE_META` and `generateStaticParams`.
8. **Three delete idioms remain**: `deleteRecord` (soft, undo, Trash), plain `remove()` (case templates, commendations, hard tables) and the member permanent-delete protocol. Document the rule once in the design system ("everything a member can create soft-deletes") and make the remaining hard tables soft-deletable when they next change.
9. **Saved views exist for cases, BOLO, legal, persons and the Action Center, each with its own menu component.** One `ViewsMenu` (the Action Center's) could serve all five.
10. **Dead or near-dead docs**: `docs/CID-FUTURE-STATE-SPEC.md`, `docs/CTO-REVIEW.md`, `docs/RECORDS-REQUESTS-*.md`, `docs/HARDENING.md`, `docs/SECURITY-REVIEW.md` and the `docs/archive/` folder predate the plan; `CHANGELOG.md` carries four `[Unreleased]` blocks. Archive the superseded documents under `docs/archive/` and collapse the changelog's history under the 1.18.0 release.
11. **Two title maps became one (`notificationTitles.json`), but `OPTIONAL_NOTIF_CATEGORIES` (in-app mutes) and `DISCORD_CATEGORIES` are still two lists.** Derive both from the JSON's `category` field.
12. **The Owner Console** mixes project intelligence, feedback triage, client errors, permanent deletion and engineering operations on one page; the Action Center's Owner signals now cover the alerting part. Split it into "Operations" (jobs, audit chain, errors) and "Data" (permanent deletion, fixtures) or move the alert tiles out.

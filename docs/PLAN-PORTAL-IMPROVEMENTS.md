# CID Portal — Portal Improvements Implementation Plan

Prepared 2026-09-05 against `main` @ `d96db87` (branch `claude/portal-improvements-plan-ubkiho`). Nothing in the repository, database, GitHub issues or configuration was modified while preparing this plan.

The plan covers eight improvements: Unified Case Workspace, Smart Entity Autofill, Improved Legal Workflow, Universal Action Center, Report Builder, Intel Triage System, Central Permission Module, and Version History and Recovery. It is organised into the twenty sections you asked for, followed by the GitHub issue breakdown.

---

## 1. Current-state findings

### 1.1 Platform shape
- Next.js 16 single-page app, one dynamic route `src/app/(app)/[tab]/page.tsx` driven by `PAGE_META` / `NAV_CATEGORIES` in `src/lib/nav.ts`. One component folder per screen, shared logic in `src/lib/`, data access only through `src/lib/db.ts`.
- Supabase Postgres where RLS is the authority: 174 tables, all with RLS enabled; 388 live policies; 216 `private.*` helper functions defined across 242 migrations; ~12 tables sealed with zero policies (`app_secrets`, `deletion_tokens`, `external_*`, `field_submission_*` claim tables, `field_submission_sources`).
- Every privileged transition runs through `SECURITY DEFINER` RPCs with pinned empty `search_path`; freeze triggers are non-definer; `can_access_case` / `can_access_case_row` are a pair that must move together; read supersets (`can_read_case`) are used only in SELECT policies.
- The City 2.0 reset (`20261003120000` + `20261003130000`) wiped all operational data and the 1.0 audit log. Profiles, SIB memberships, field officers, penal code, case templates, SOPs and configuration were kept. **There is no historical data to backfill.**
- A scheduler already exists in the live project: `pg_cron` + `pg_net` fire `sops-sync` every 15 minutes, configured from the dashboard, not from a migration.

### 1.2 Case workspace
- Cases open one at a time via `/cases?case=<id>&tab=<section>` (`CasesView.tsx:302-306`); `CaseDetail.tsx` keeps visited tabs mounted with per-tab scroll memory (`:195-229`) and switches sections with `window.history.replaceState` because query-only router navigation reverts in some serving environments (`:142-146`).
- 14 sections exist in `src/components/cases/caseTabs.ts`: overview, graph, media, intel (links + `cases.notes`), surveillance, extractions, charges, rico (conditional), reports, tasks, legal (read-only, renders only RLS-returned rows), signoff, chat, timeline (`public.case_timeline(p_case)` definer read model).
- The Investigative Tools workspace (`src/components/tools/ToolsView.tsx`, `ToolTabBar.tsx`, `ToolsWorkspaceContext.tsx`, `useToolNav.ts`, `src/lib/toolsModel.ts`) is the prior art for persistent tabs: ids-only persistence in `sessionStorage` (`cid-tools-workspace:<uid>`), RLS-scoped title re-fetch on restore with silent close of invisible records, URL mirroring with a self-write guard, dirty-tab guard, mobile collapse to active tab + dropdown, no tab limit.
- Drafts: `src/lib/userDrafts.ts` over `public.user_drafts` (PK `user_id,key`, 64 KiB cap, owner-only RLS, 1.5 s debounce, per-user localStorage mirror, newer-wins). `src/lib/drafts.ts` is the older non-per-user localStorage layer still used by `LegalCreateWizard.tsx`, `justice/dossier/RequestSection.tsx` and `LegalRequestDetail.tsx`.
- Entity linking: `case_intel_links(case_id, kind, ref_id, role, note)` with kinds `person | gang | place | narcotic | account`. **Vehicles cannot be linked to a case.** No `case_links` table exists for related cases.
- Notes are three things: `cases.notes`, `case_messages` chat, and per-link notes. No per-case activity feed exists; `audit_log` is Owner-only.
- Realtime: one channel per table, whole-table version counters; `CaseDetail` subscribes to 14 tables with no case-scoped filter.
- States: skeletons (`ui/Skeleton`), `EmptyState` / `ErrorNotice` (`ui/Notice`), "not found" vs "access ended" as bare paragraphs, archived banner, legal-hold banner, restricted-media grants, SIB read-only narrowing (`siu.caseReadOnly`). `case_access_requests` exist but no request affordance on the case screen.
- `cases.archived_at` appears in **zero** RLS predicates: an archived case is fully writable under RLS.

### 1.3 Entity search and merge
- `src/lib/entitySearch.ts` is the canonical suggestion registry (11 kinds), consumed by `RecordSearchPicker` (32 consumers). `autofill.ts` provides never-overwrite fill logic but is wired only to `LinkedPersonPanel` for five person fields.
- Database search: `search_all` (INVOKER, trgm `<%` hardened), `search_persons` (six union arms), `search_narcotics`, `siu_registry_search`, `field_submission_search`, `field_claim_matches` (INVOKER, raises for non-active callers). Only `pg_trgm` fuzzy matching exists. Missing indexes: `gangs.aliases`, `indicators.value` trgm. No SQL phone normalizer (`normPhone` is client-only).
- Merges: `person_merge` (BL+), `merge_narcotics` (registry manager), `account_merge` (command). None reversible; no merge ledger; no merge for vehicles, gangs, places, indicators. Client `findDuplicatePersons` / `planPersonMerge` exist only for persons.
- ~20 hand-rolled `ilikeAny` loaders and 4 bespoke duplicate hints bypass `entitySearch` (`LegalCreateWizard`, `MdtExports`, `AccountsView`, `gangModals`, `ProfileRelations`, `ProfileAssets`, `gangLinkPanels`, `PersonModal`, `VehiclesView`).
- `VehiclesView` cross-case matching loads every visible report's `fields` JSON unbounded (largest performance liability).
- SIB compartmentation (`private.siu_hidden()` conjunct on `persons/vehicles/gangs/places`) makes hidden records invisible to suggestions and duplicate warnings; `vehicles_plate_key` (UNIQUE `upper(plate)`) returns "already registered" for a hidden plate — an existence oracle.
- `mdt_wanted_projections.person_id` has no ON DELETE clause (NO ACTION) and `mdt_exports.person_id` is CASCADE: a merge that deletes a victim either errors or silently drops live BOLOs.

### 1.4 Legal workflow
- One state machine (`legal_requests.review_status`, 26-value CHECK) with three lanes: CID (`not_submitted → cid_supervisor_review → prosecutor_queue → prosecutor_review → submitted_to_judge → judicial_review → approved | denied | returned_*`), SIB (`siu_command_review → ag_review → …`, **stalled** because `review_legal_request_as_ag` is EXECUTE-revoked and no UI lists `ag_review`), and the retired ADA/DA lane.
- **The prosecutor stage is live and load-bearing**: `review_legal_request_as_cid('approve')` routes only to `prosecutor_queue`; `claim_legal_request_as_judge` and `assign_judge` accept only `submitted_to_judge`, reachable only through `review_legal_request_as_prosecutor('approve')`.
- Justice identity: `justice_memberships` (effective roles `prosecutor | attorney_general | judge` via `private.justice_role_effective`), `prosecutor_coverage`, appointment via `justice_appoint`. Sealed requests are claimable by nobody and assignable only by the AG.
- Content: `narrative` holds probable cause; `charges` is a free-text field on arrest warrants, disconnected from `case_charges`; exhibits come only from existing case material; no comments table; versions frozen per submission with `change_summary` / `returned_from`; signatures typed and version-bound; `legal_admin_cancel` and `legal_mark_superseded` have no UI; `withdraw_legal_request` terminal check omits `declined | cancelled | superseded`; `legal_internal_notes()` omits `assigned_prosecutor_id`.
- No server-side reminders, no default expiry, no PDF/DOCX export of an instrument (`CourtPacketPrint` is browser print).
- Dead / stale: `OwnerView.tsx:682-730` and `AssignModal.tsx:334-335` still grant ADA/DA; `legalWorkflow.ts:261,491,512,652` render live ADA wording.
- RLS coverage: `tests/rls/legal.test.ts` covers CID gate; `v163` / `v165` skip because DOJ fixture accounts were never provisioned.

### 1.5 Action Center and notifications
- `src/lib/actionItems.ts` (`buildActionItems`, pure, 80+ tests) produces 22 item kinds with `dedupeKey`, ranking, deep links and inline actions; `useActionItems.ts` fans out ~24 queries with 22 realtime subscriptions; consumed by `/action`, My Dashboard (`InboxView`) and Command Center Overview.
- Missing kinds: restricted packet approvals, MDT export approvals, field access requests, field claim verdicts, narcotic suggestions, gang duplicate reviews, tracker co-signs, SIB conflicts/watch reviews, Owner signals, justice applications, surveillance alerts.
- `notifications(id, user_id, type, payload, read, created_at)`: no `read_at`, no snooze/dismiss, no `(user_id, read)` index; payload snapshots titles and never re-checks standing (a prior SIB fan-out leaked request titles to CID command). `create_notification` has a 10-type allow-list; server fan-outs bypass it.
- No scheduler for reminders; stale-case reminders fire from the client. `cases.priority` is ignored by ranking. `savedViews` (server-backed, per-user) are unused on the Action Center. Four queue surfaces coexist plus an unfinished Phase-1B dashboard switcher (`knip.jsonc:19-22`).
- Discord DMs use a title map duplicated in `supabase/functions/discord-notify/index.ts`.

### 1.6 Reports
- `reports(template text, kind, seq, parent_id [dead], author_id, fields jsonb, finalized bool, signature jsonb)`; `report_versions` written only by `report_finalize`; `block_direct_report_finalize` locks sealed content; `report_reopen` (BL own bureau / DD / Dir); `warrant_set_status` tracks warrant-report lifecycle.
- 8 templates hardcoded in `src/lib/forms.ts` (`FORM_SCHEMAS`); `warrant_return` is created server-side with no client schema and renders raw JSON. Changing a schema re-renders every historical sealed report.
- No review step; any case member seals; `reportFinalizeGaps` is advisory; narrative fields are plain textareas (Tiptap `RichEditor` exists for Intel notes and SOPs); no entity mentions; inserted data is denormalised strings; `report_finalized` notification type exists but never fires; single-report export is `.md` only.
- Template administration precedent: `case_templates` inline editor in `CaseModal.tsx:315-361`; versioned publish/rollback precedent: `PenalAdminPanel` / `penalAdmin.ts`.

### 1.7 Intelligence intake
- `field_submissions` is already the single intelligence entity (tips merged in `20260922120000`, dropped in `20260926120000`, zero rows migrated). Lifecycle `draft → new → reviewing → needs_info → reviewed | actionable → archived`; `rejected` folded into `archived` in `20260923120000`.
- RPCs exist for claim/release/assign/decide/ask/grade/archive/restore/delete/undelete/search/repeats/create_case/link_case/unlink_case/create_observation/link_observation/set_source/source_reveal. Per-claim verdicts (`field_claim_decide`), claim links to persons/vehicles/gangs/places (`field_claim_link`), append-only assignment history, reviewer-private notes and officer thread tables.
- Submitters are `profiles.active = false` with `field_officers` standing; identity snapshotted and frozen; blind receipt (`siu_my_referrals`-style stripping); no auto-JTF (`20260920120000:44-62`).
- Missing: standalone comment, reject, grouping, narcotics/account/indicator link kinds, convert-to-entity, notifications, realtime publication.
- Drift: `private.field_jurisdiction_visible_for` is redefined by `20260825120000_bureau_restructure.sql` (everyone sees everything) but later-sorting `20260917120000` / `20260924120000` re-emit the division-based version with retired bureau names; live is correct, a clean rebuild is not.
- `siu_referrals` is a separate SIB intake whose oversight-invisibility rule is load-bearing.

### 1.8 Permissions
- Client authority hubs: `roles.ts`, `capabilities.ts`, `siu.ts` / `useSiu.ts`, `legalWorkflow.ts`, plus `components/justice/legalShared.tsx` (a fourth hub in `components/` because `lib/` may not import `components/`). 1166 role-literal matches across 128 files; four `COMMAND_ROLES` definitions (one includes the retired `command` enum value); three `effectiveJusticeRole` copies with separate caches; sign-off authority computed three different ways; `viewerOwnsAction` omits case access; `auth.canDelete` is rank-only while the server requires case reach.
- Temporary access: every mechanism is clock-evaluated in its predicate except `case_access_grants`, which never expires.
- No permission-denied logging; RLS denials are silent; definer RPCs raise without audit.
- `supabase/schema-snapshot.sql` carries full bodies for only 48 of 216 `private.*` functions; `can_access_case` in the snapshot is four generations stale; the realtime block enumerates 69 tables versus 74 live.

### 1.9 Version history and deletion
- Versions: `report_versions` (seal only), `documents_versions` (per save, restore-as-new-version with reason — the reference implementation), `legal_request_versions` (per submission, immutable UPDATE+DELETE). Registries keep no field history; `vehicles` has no `updated_at` touch trigger.
- Audit: `private.audit()` writes action only; `audit_detail()` (old/new) on 6 link tables; Owner-only read; immutability asserted in docs but not SQL (no blocking trigger, stale UPDATE/DELETE grants); no retention.
- Deletion: cases archive (command) and permanently delete (Owner, preview + reason, refuses with legal requests or holds); intelligence soft-deletes with dependency refusal and Owner undelete; members use the armed protocol (`permanent_delete_preview/arm/execute`, fresh session, token, typed confirmation, ledger); everything else hard-deletes with a 6-second delete-then-reinsert Undo (`db.ts:216-289`).
- Deleting a case CASCADEs reports, evidence, tasks, messages, charges, RICO, intel links and 12 SIB tables; SET NULLs media, documents, places, gang members, trackers, tickets, narcotic source refs, SIB watchlist; only `legal_requests` and `field_submissions.siu_case_id` block; `case_files.case_number` is text with no FK.
- Attachments: case media are FiveManage URLs (row delete orphans the file); one private bucket `field-evidence`; `case_files` are Drive links.

### 1.10 Hygiene
- Duplicate migration timestamps `20260825120000` and `20260921120000`.
- Stale docs: `AUTHORIZATION.md:118` and `TEST-ENVIRONMENT.md:75` reference the dropped `intelligence_tips`; `DEFERRED.md` references `index.html` and a vanilla-JS cache that no longer exist.
- User-facing legacy strings: `docRelations.ts:66` label `SIU`; `PortalAssistant.tsx:84` `SAB-` placeholder; `SecurityTestingSection.tsx:19-20` ADA/DA rows; `WorkflowTimeline.stories.tsx` ADA fixture.
- CI: bundle budget is blocking at 142 KB although its header says re-baseline first; the a11y ratchet baseline is empty and has never run against the redesign; visual baselines are not committed; the dedicated test project does not exist.

---

## 2. Confirmed decisions

Global: fresh-start dataset, no historical backfill (G1); `pg_cron` jobs declared in migrations (G2); one PR per issue (G3); provision DOJ RLS fixtures and CI secrets, no new Supabase project (G4).

Case workspace: one unified workspace strip for cases, records and tools (CW1); 8 open cases, only the active one mounted, others suspended with state kept, 9th prompts to close one (CW2); server-side per-user persistence in `user_prefs`, ids only, RLS re-check on restore (CW3); People / Vehicles / Gangs / Locations as first-class sections with a `vehicle` link kind (CW4); threaded `case_notes` table, `cases.notes` migrated into the first note, chat stays separate (CW5); field-level audit feed to case members through a definer RPC scoped by the caller's predicates (CW6); request-access affordance for ordinary CID cases, plain not-found for SIB / sealed / compartmented (CW7); archived cases read-only at RLS (CW8); dirty dot on tabs, drafts kept on close, no close prompt (CW9); URL encodes active case + section + row only (CW10); a separate simplified mobile case route with read + quick actions (CW11); all sections render for any case member, actions gated by the permission module (CW12).

Entity autofill: exact normalized key = strong warning with compare / link / merge, `word_similarity ≥ 0.6` = soft notice, never hard-block (EA1); merge = Bureau Lead+ for every entity, reason required (EA2); `entity_merges` ledger with 30-day unmerge (EA3); SIB-hidden collisions create silently for CID, flagged to an SIB-only reconcile queue, plate UNIQUE relaxed to a partial index (EA4); conflicting values live on the case link / report field with provenance, master untouched, promotion is a reviewed action (EA5); fill-the-gaps master updates direct with confirm for SrDet+, detectives' proposals queue for SrDet+ (EA6); `private.norm_phone()` + generated normalized columns, no phone entity (EA7); field submitters stay blind (EA8); phase-one kinds person, vehicle/plate, phone, gang, place, narcotic, case, indicator, account (EA9); link is the default action on a strong match (EA10); missing indexes + one INVOKER `entity_suggest` RPC + bounded server cross-ref (EA11).

Legal: prosecutor stage removed, CID approval routes to the judicial queue, prosecutor becomes an optional observer participant (L1); Bureau Lead gate kept (L2); SIB lane X-1 → judge directly, AG notified (L3); AG assigns sealed requests, Owner fallback, judges never self-claim sealed (L4); internal status names kept, `partially_approved` added, labels changed (L5); partial approval = per-target scope decisions frozen into the judicial version (L6); new `legal_request_comments` table (L7); new evidence uploads create case media/evidence and attach in one step (L8); 48 h nudge, 5-day escalation, 7-day unissued reminder (L9); per-subtype expiry defaults with judge override, cron marks expired, extension = amending request (L10); locked after submit, structured revision requests, change summary captured everywhere (L11); typed version-bound signatures plus verification code on exports (L12); amend / supersede with UI, never edit approved in place (L13); charges selected from `case_charges` via the penal picker into `legal_request_charges` (L14); PDF + DOCX via existing engines, audited (L15); active justice roles = Judge + Attorney General only, ADA/DA removed from grant menus (L16).

Action Center: fold in all missing queues (AC1); SIB and Owner items included, gated by standing (AC2); `action_item_state` with snooze ≤ 48 h, dismiss only for informational items, completion derived from source (AC3); `cases.priority` feeds the score and a cron escalation ladder (AC4); reassign tasks / blockers / intel, bulk only for non-decision state (AC5); personal saved views + built-in role presets (AC6); Action Center is the queue, dashboards embed slices, ApprovalQueue becomes a preset (AC7); minimal notification payloads with render-time RLS resolution (AC8); in-app first, Discord opt-in per category with one shared title map (X3).

Report builder: DB-backed versioned templates with admin UI, reports pin their template version (RB1); draft → submitted → returned | approved → sealed with SrDet+/Bureau Lead review, templates may mark review optional (RB2); five new narrative templates plus a real `warrant_return`, warrant-request templates kept as legal drafting forms (RB3); required fields hard-block submit/seal server-side (RB4); Tiptap markdown narrative with entity mention tokens (RB5); `report_entities` + snapshot in fields, edits marked "differs from record" (RB6); `case_links` table (RB7); typed signatures, reopen requires reason and notifies the author (RB8); PDF + DOCX + MD per report, audited (RB9); no additional report types in phase one (RB10); narrative-only mobile editing (RB11).

Intel triage: `rejected` terminal status reintroduced (IT1); command soft-delete + Owner undelete unchanged (IT2); blind receipt, notify submitter only on a question (IT3); no anonymous intake (IT4); record-level validated derived from claims plus explicit mark (IT5); persistent `intel_groups` with suggestions (IT6); reviewer notifications and realtime with row filtering (IT7); any reviewer converts via the shared entity creator, link kinds extended (IT8); `siu_referrals` stay separate with cross-links (IT9).

Permissions: authority model as documented, **plus** the Director of CID gains read-only SIB oversight like the AG — standard classification only, no appoint/remove/release/open/assign (P1, P1b); `case_access_grants.expires_at` default 30 days, max 90, renewable (P2); `PERMISSION_DENIED` rows from definer RPC refusals, `ACCESS_*` rows on grant/revoke/expiry, sensitive views logged (P3); `my_permissions()` RPC + per-record `can_*` RPCs + typed client mirrors with parity tests (P4); soft delete / restore = Bureau Lead+, permanent = Owner, own drafts by author (P5); canonical `deleted_at` / `archived_at` on new tables and a `private.is_live()` convention (P6); submit-only stays `active = false`, `access_class` exposed (P7).

Version history: generic `record_versions` trigger with 5-minute same-actor coalescing (VH1); view = read access, restore = edit authority + reason as a new version (VH2); versions pruned after 2 years except the latest 5 per record and anything held or on an open case, audit never pruned (VH3); soft delete everywhere + Trash view (VH4); permanent case deletion refuses while dependents exist, soft delete cascades only exclusive children, `case_files` gets a real FK (VH5); full armed protocol generalised (VH6); audit trigger + revoke + sha256 hash chain verified by cron (VH7); soft delete keeps attachment pointers, permanent delete enumerates and warns (VH8).

Closing: Phase 0 hygiene first (X1); phase order accepted (X2).

---

## 3. Conflicts and outdated behaviour found

| # | Conflict | Resolution in this plan |
|---|---|---|
| C1 | Live prosecutor stage vs. "no prosecutor stage" | Migration re-routes CID and SIB approvals to `submitted_to_judge`; judge claim/assign predicates unchanged; prosecutor branches removed from `can_view_legal_request`; `prosecutor` becomes an observer participant role (issue P4-01) |
| C2 | SIB legal lane stalls at `ag_review` | Stage retired; X-1 approval routes to the judicial queue; AG notified (P4-01) |
| C3 | Retired ADA/DA still grantable and rendered live | Grant menus pruned, banner strings replaced, `JusticeGrantPanel` removed (P0-05) |
| C4 | `rejected` intentionally folded into `archived` | Reintroduced as a terminal status with reason; transition table and client mirror updated (P6-01) |
| C5 | "No scheduler" in docs vs. live `pg_cron` for SOP sync | `pg_cron` adopted and declared in migrations; the SOP job is re-declared there too so the repo is authoritative (P7-01) |
| C6 | `field_jurisdiction_visible_for` conflicting redefinitions | Re-emitted once in a Phase 0 migration with the current bureau names (P0-02) |
| C7 | Duplicate migration timestamps | Renamed with a new-file re-emit (Postgres records applied names; the fix is a no-op migration with the corrected suffix) (P0-01) |
| C8 | Stale `schema-snapshot.sql` function bodies and realtime block | Snapshot regenerated from the live catalog; a `check:realtime` gate added (P0-03) |
| C9 | Archived cases writable under RLS | Read-only at RLS (P3-05) |
| C10 | `case_access_grants` never expire | Expiry column + predicate + reminder (P1-06) |
| C11 | Vehicle plate UNIQUE leaks hidden plates | Partial unique index excluding SIB-hidden and soft-deleted rows; SIB reconcile queue (P2-03) |
| C12 | `mdt_wanted_projections.person_id` NO ACTION / `mdt_exports.person_id` CASCADE on merge | Merge RPC repoints both before tombstoning; `mdt_exports` FK changed to NO ACTION with explicit repoint (P2-04) |
| C13 | Director of CID SIB authority removed by `20260902120000` vs. your decision for read-only oversight | New `director_oversight` standing that is a strict read subset of `oversight` and is excluded from appoint/remove/referral/release/export (P1-04) |
| C14 | Four queue surfaces + unfinished Phase-1B switcher | Action Center becomes the single queue; dashboards embed slices; Phase-1B switcher retired (P7-06) |
| C15 | `drafts.ts` still used by the legal wizard | Migrated to `userDrafts` (P0-06) |
| C16 | `document_versions` deletable by Bureau Lead+ and insertable by clients | Aligned with the new immutability convention (P1-03) |
| C17 | Audit immutability documentation-only | Trigger + revoke + hash chain (P1-02) |
| C18 | Docs reference dropped tables and a vanilla-JS architecture | Corrected in Phase 0 (P0-07) |

---

## 4. Features already available for reuse

| Area | Reuse as-is | Extend |
|---|---|---|
| Workspace | `ToolsView` tab model, `ToolTabBar`, `ToolsWorkspaceContext`, `useToolNav`, `CaseDetail` keep-alive + scroll memory, `caseTabs.ts` registry, `caseLinks.ts` deep links, `SectionTabs`, `CaseSectionSwitcher`, `useNarrow`, `StickyActionBar`, `Skeleton`, `Notice`, `SaveState`, `MetricStrip`, `recents`, `pins` | Generalise the tab model to `tool | record | case`; move persistence to `user_prefs` |
| Drafts | `userDrafts.ts` + `user_drafts` + `useDraftState` | Add a per-tab dirty aggregate |
| Timeline/activity | `public.case_timeline`, `case_stage_history`, `siu_audit_feed` pattern | Add `case_audit_feed` |
| Search | `entitySearch.ts`, `RecordSearchPicker`, `RelatedRecordPicker`, `DuplicateMatchNotice`, `RecordPeek`, `entityPreview.ts`, `autofill.ts`, `personCompletion.ts`, `planPersonMerge`, `PersonMergeModal`, `private.norm_plate`, `private.norm_org`, `field_claim_matches`, trgm indexes | Add `entity_suggest`, `entity_duplicates`, `norm_phone`, generic merge |
| Legal | `legalWorkflow.ts` model, `legal_freeze_version`, `legal_notify`, `legal_audit`, `legal_is_conflicted`, `legal_request_case_brief`, participants, signatures, `legal_seized_items`, `CourtPacketPrint`, `WorkflowTimeline`, `DeadlineChip`, `RecusalBanner`, `DojWorkspace` lanes | Re-route stages, add comments, charges, target decisions, exports |
| Action Center | `buildActionItems`, `ActionItem` contract, `useActionItems`, `semanticKey` dedupe, `savedViews`, `deadlines.ts`, `notifications.ts`, `notifText.ts`, `AccessDecisionModal` | Add state table, kinds, escalation, presets |
| Reports | `FORM_SCHEMAS` engine, `FormEditor`/`ReportView`, `PersonField`, `report_finalize`/`report_reopen`/`block_direct_report_finalize`, `report_versions`, `SignatureViewer`, `VersionViewer`, `RichEditor`, `mediaRefs`, `pdf.tsx`, `docx.ts`, `WarrantPrint`, `case_templates` admin, `penalAdmin` publish model, `case_charges`, `caseCharges.ts`, `profiles.ts` | Move templates to DB, add review, entities, exports |
| Intel | `field_submissions` + children, all `field_submission_*` RPCs, `field_claim_*`, `field_assignments`, `field_submission_cases`, `field_submission_sources`, `field-evidence` bucket, `FieldReviewView`, `IntelActions`, `EvidencePanel` | Add reject, comment, groups, links, notifications |
| Permissions | 216 `private.*` helpers, 388 policies, `roles.ts` matrix, `capabilities.ts` (`capsFrom`), `siu.ts`, `siu_department_context()`, `tests/rls/*` harness, `securityReporter.ts` | Wrap into `my_permissions()` and `lib/permissions` |
| Versions/deletion | `document_save` / `document_restore_version`, `case_delete_preview` catalog walk, `permanent_delete_preview/arm/execute`, `deletion_tokens`, `DeleteCaseModal`, `field_submission_dependencies`, tombstones + `snap_*` columns, `block_legal_immutable`, `docDiff.tsx`, `DocHistory.tsx`, `VersionViewer` | Generalise to `record_versions`, `soft_delete`, `permanent_delete_record_*` |
| Scheduler | Live `pg_cron` + `pg_net` (SOP sync) | Declare jobs in migrations |
| Exports | `lib/pdf.tsx` (`PdfDocSpec`), `lib/docx.ts`, `packet.ts` | Add instrument and report specs |

---

## 5. Proposed architecture

### 5.1 Layering (unchanged principles)
- **Database is the authority.** Every new capability is an RLS policy, a non-definer freeze trigger, or a self-authorising `SECURITY DEFINER` RPC with `search_path = ''`, `revoke all from public`, `grant execute to authenticated, service_role`, `auth.uid()` loaded first, `for update` on decision rows, `P0001` on conflict.
- **Client gates are cosmetic.** `src/lib/permissions/` is the only place client predicates live; components import from it, never from `roles.ts`/`siu.ts` directly (those become internal to the module).
- **Data access** stays in `src/lib/db.ts`; new write paths are RPC wrappers in `src/lib/services/*` (the shared-service convention from `20261002130000`), so the future FiveM lane inherits them.

### 5.2 Central permission module
```
supabase                                  src/lib/permissions/
├─ private.perm_*  (thin aliases over      ├─ index.ts        typed Permission enum + can()
│   existing predicates; no rewrites)      ├─ mirrors.ts      pure mirrors of private.perm_*
├─ public.my_permissions()  → jsonb        ├─ usePermissions.ts (server-first, NO_ACCESS default)
├─ public.can_record(action, kind, id)     ├─ matrix.ts       generated PERMISSIONS_MATRIX
└─ public.perm_audit(...)  denied/grant    └─ parity.test.ts  mirrors vs live fixtures
```
- `my_permissions()` returns `{ access_class, rank, bureau, is_owner, sib_standing, doj_role, command_scope, expiries: {...}, flags: {...} }` in one definer call; `usePermissions()` replaces `useCapabilities` + `useSiu` + `useMyJusticeRole` and exposes `can(Permission, ctx?)`.
- `can_record(action, kind, id)` answers per-record questions (`case.edit`, `case.archive`, `report.reopen`, `legal.decide`, `entity.merge`, `record.restore`, `record.permanent_delete`, …) by delegating to the existing predicate; used by the workspace, Action Center and Trash instead of guessing.
- Every definer RPC that refuses authorization calls `private.perm_deny(action, kind, id, reason_code)` before raising, which writes `PERMISSION_DENIED` to `audit_log`.
- New standing `director_oversight` in `private.siu_standing()`; `siu_case_read()` gains a branch identical to the AG's oversight read; `siu_can_appoint`, `siu_remove`, `siu_referrals_sel`, disclosure release, export and watchlist explicitly test `standing in ('special_agent_in_charge','oversight','owner')` and never `director_oversight`.
- `PERMISSIONS_MATRIX` becomes generated from a single `permission_catalog` table (action, kind, rule text, enforcing object, test id) so `permissionsMatrix.ts` and the handbook table cannot drift.

### 5.3 Soft delete, versions, Trash, permanent deletion
- Columns `deleted_at, deleted_by, delete_reason` added to every deletable table; `private.is_live(deleted_at, archived_at)`; SELECT policies exclude deleted rows for non-owners; DELETE policies revoked for clients on those tables; `public.soft_delete(kind, id, reason)` / `public.restore_record(kind, id, reason)` definer RPCs gated by `can_record`.
- `record_versions(id, table_name, record_id, version_no, actor_id, old jsonb, new jsonb, changed_fields text[], reason, source, created_at)` with UNIQUE `(table_name, record_id, version_no)`; `private.version_row()` AFTER UPDATE trigger with 5-minute same-actor coalescing (updates the last version's `new` and `changed_fields` instead of inserting); `public.record_history(kind, id)` INVOKER read; `public.restore_version(kind, id, version_no, reason)` writes the historical values as a new UPDATE (so it versions itself).
- `permanent_delete_record_preview/arm/execute(kind, id, …)` generalises the member protocol using the catalog walk from `case_delete_preview`; ledger table `deleted_record_ledger`.
- Trash: `public.trash_list(kind?)` INVOKER read over soft-deleted rows the caller may restore; UI at `/trash` plus a "Deleted — Undo" toast that calls `restore_record`.
- `audit_log`: `BEFORE UPDATE OR DELETE` trigger raising unless `current_setting('cid.audit_maintenance', true) = 'on'` (set only inside the reset tool); grants revoked; `prev_hash`, `row_hash` columns; `private.audit_chain_verify()` run nightly by cron.

### 5.4 Entity layer
- `public.entity_suggest(kind, q, limit)` SECURITY INVOKER: per-kind arms with normalized-key fast paths (plate, phone, handle) and trgm fallback; returns `{id, kind, label, sublabel, score, exact}`; degrades to empty for non-active callers.
- `public.entity_duplicates(kind, payload jsonb)` SECURITY INVOKER: exact and fuzzy candidates for a not-yet-saved record; returns candidates the caller may already read.
- `public.entity_merge(kind, survivor, victims[], reason)` and `public.entity_unmerge(merge_id, reason)`: per-kind repoint maps in `private.entity_merge_plan(kind)` derived from `pg_constraint` (the `case_delete_preview` technique) with explicit handling for `mdt_wanted_projections`, `mdt_exports`, UNIQUE collisions and holds; `entity_merges(id, kind, survivor_id, victim_ids[], manifest jsonb, victim_snapshots jsonb, actor_id, reason, created_at, reversed_at, reversed_by, reverse_reason)`.
- `siu_reconcile_queue(kind, cid_record_id, hidden_record_id, signal, created_at, resolved_*)` populated by an AFTER INSERT trigger that compares normalized keys against SIB-hidden rows under a definer context; readable by SIB standing only.
- `src/lib/entity/`: `useEntitySuggest`, `EntityPicker` (thin wrapper over `RecordSearchPicker`), `EntityCreateSheet` (shared create form per kind with `DuplicatePanel`, `ComparePanel`, autofill), `MergeDialog`, `mergeHistory`.
- All `ilikeAny` loaders and bespoke duplicate hints are replaced by these.

### 5.5 Unified workspace
- `src/components/workspace/`: `WorkspaceProvider` (tabs of kind `tool | record | case`, active key, per-tab `{section, scroll, dirty}`), `WorkspaceTabBar`, `WorkspaceRouter`; `ToolsView` and `CaseDetail` become tab renderers. Persistence key `user_prefs.workspace` = `{tabs:[{kind,id,section}], active}`; ids only; restore re-resolves titles through RLS and closes silently.
- Only the active case tab is mounted; suspended tabs retain their slice of provider state. Cap 8 case tabs.
- Case sections registry extended: people, vehicles, gangs, locations, notes (new), activity (new); `evidence` is the label for the media/evidence section; `caseTabs.ts` remains the single registry.
- Deep-link contract stays `/cases?case=&tab=&…` and redirects into the workspace; `caseLink()` unchanged.
- Mobile: `/m/cases/[id]` route rendering `MobileCaseView` with read + quick actions; the workspace shell redirects narrow viewports there.

### 5.6 Legal
- Stage graph after P4-01 (see §8 for labels):
```
not_submitted → cid_supervisor_review ─approve→ submitted_to_judge → judicial_review → approved | partially_approved | denied | returned_by_judge
                       └─return→ returned_by_cid ─resubmit→ cid_supervisor_review
                       └─deny→ denied
draft (SIB) → siu_command_review ─approve→ submitted_to_judge   (AG notified)
                       └─return→ returned_by_siu_command
returned_by_judge ─resubmit→ submitted_to_judge   (material change ⇒ cid_supervisor_review / siu_command_review)
any pre-decision → withdrawn (creator) | cancelled (command, reason)
approved/issued → superseded (command) ; amend = new request with amends_request_id
```
- New tables: `legal_request_comments`, `legal_request_charges`, `legal_request_target_decisions`, `legal_expiry_defaults`; new RPCs: `legal_comment`, `legal_set_charges`, `decide_legal_request_as_judge` extended with per-target decisions, `legal_amend`, `legal_reminder_sweep`, `legal_expiry_sweep`.

### 5.7 Reports
- `report_templates`, `report_template_versions(schema jsonb, required jsonb, review_required bool, status)`; `reports.template_version_id`, `reports.review_status` (`draft | submitted | returned | approved`) alongside the existing `finalized`; `report_entities`; RPCs `report_submit`, `report_review(approve|return, note)`, `report_finalize` extended to enforce required fields and review state.
- `FORM_SCHEMAS` seeds the first published versions; `warrant_return` gets a schema; `ReportsTab` renders from the pinned version.

### 5.8 Intel
- `rejected` status, `field_submission_reject`, `field_submission_comment`, `intel_groups` + `intel_group_members`, link kinds `narcotic | account | indicator` on `field_claim_links`, `field_submission_convert` (calls the shared entity create path server-side and links), notifications via `private.intel_notify`, realtime publication with minimal payload trigger.

### 5.9 Action Center and scheduler
- `action_item_state`, new item kinds, `action_reassign_task`, `action_reassign_blocker`, `action_escalation_sweep()`, `notification_resolve(ids)` INVOKER read that hydrates minimal payloads; one `useActionQueue` hook with a shared cache used by `/action`, My Dashboard and Command Center.
- `cron` migration declares: `legal_reminder_sweep` (hourly), `legal_expiry_sweep` (hourly), `action_escalation_sweep` (hourly), `access_grant_expiry_sweep` (hourly), `record_versions_prune` (daily), `audit_chain_verify` (daily), `siu_reconcile_scan` (every 15 min), `sops-sync` (re-declared). All jobs call definer RPCs that run as the `cron` role with `set role` guards and write `scheduled_job_runs`.

---

## 6. Database and storage changes

All migrations are additive, timestamped after `20261003130000`, carry the repo's SQL header (Purpose / Caller / Authorization / Side effects / Audit behaviour / Security notes), update `src/lib/database.types.ts` and `supabase/schema-snapshot.sql` in the same PR, add FK indexes, and join `rls_test_cleanup()` where fixtures are created.

### 6.1 Phase 0
| Object | Change |
|---|---|
| `20260825120000_siu_phase3.sql`, `20260921120000_permanent_delete_refresh.sql` | Add no-op re-emit migrations with unique suffixes; document in `MIGRATION-HISTORY.md` (applied names are unchanged on live) |
| `private.field_jurisdiction_visible_for`, `field_submission_create_case` | Re-emitted once with `major_crimes/street_crimes/JTF` and the everyone-sees rule |
| `schema-snapshot.sql` | Regenerated from live catalog; realtime block enumerated; `scripts/check-realtime.mjs` gate |
| `pg_cron` | `create extension if not exists pg_cron; pg_net`; `sops-sync` job re-declared |

### 6.2 Phase 1 — permission module, soft delete, versions, audit
| Object | Change |
|---|---|
| `private.perm_*` | Thin aliases: `perm_is_command`, `perm_case_access(id)`, `perm_case_read(id)`, `perm_can_delete_child(id)`, `perm_legal_view(id)`, `perm_siu_standing()`, … (call existing helpers; no logic moves) |
| `public.my_permissions()` | Definer, returns jsonb; grants to `authenticated` |
| `public.can_record(p_action text, p_kind text, p_id uuid)` | Definer, dispatch table in `private.perm_dispatch` |
| `private.perm_deny(...)` | Writes `PERMISSION_DENIED` audit row; called by every refusing RPC touched in this plan |
| `permission_catalog` | Table (action, kind, rule, enforcing_object, test_id); seed |
| `private.siu_standing()` | New return value `director_oversight` (active `role='director'`, not fixture, not otherwise standing); `siu_case_read()` gains the AG-equivalent read branch guarded on `director_oversight`; every write/appoint/remove/referral/release/export predicate re-emitted to enumerate allowed standings explicitly |
| `case_access_grants` | `expires_at timestamptz not null default now() + interval '30 days'`, CHECK ≤ 90 days from `granted_at`; `can_access_case`/`_row` re-emitted together to test `expires_at > now()`; `case_access_renew` RPC |
| `deleted_at, deleted_by, delete_reason` | Added to: cases, persons, vehicles, gangs, places, accounts, indicators, narcotics, operations, reports, media, evidence (frozen table — soft delete only via RPC), case_tasks, case_messages, case_notes (new), case_intel_links, case_blockers, rico_cases, predicate_acts, gang_members, gang_turf, person_*, account_links, bolos, trackers, documents (align), field_submissions (already has) |
| `private.is_live(deleted_at, archived_at)` | STABLE helper; SELECT policies on the above re-emitted with `is_live(...) or private.is_owner()` |
| DELETE policies | Revoked for clients on the tables above; `soft_delete` / `restore_record` definer RPCs; `deleteWithUndo` call sites migrate to them (Phase 8 for UI) |
| `record_versions` | Table + `private.version_row()` trigger attached to cases, persons, vehicles, gangs, places, accounts, narcotics, evidence, reports, legal_requests (draft columns only), field_submissions, case_notes; `vehicles` gains a `touch` trigger |
| `public.record_history(kind, id)` | INVOKER read joined to the parent's SELECT policy |
| `public.restore_version(kind, id, version_no, reason)` | Definer; requires `can_record('edit', kind, id)`; reason NOT NULL; writes an UPDATE (versioned) + `RECORD_RESTORED` audit |
| `documents_versions` | UPDATE/DELETE-blocking trigger; client INSERT policy removed (writes only via `document_save`) |
| `audit_log` | `prev_hash bytea`, `row_hash bytea`; BEFORE INSERT trigger computes `sha256(prev_hash || row)`; BEFORE UPDATE/DELETE trigger raises unless maintenance GUC; grants revoked from `authenticated/anon`; `private.audit_chain_verify()` |
| `deleted_record_ledger`, `permanent_delete_record_preview/arm/execute` | Generalised armed protocol; reuses `deletion_tokens` |
| `scheduled_job_runs` | Table (job, started_at, finished_at, status, detail); `cron.schedule` for `access_grant_expiry_sweep`, `record_versions_prune`, `audit_chain_verify` |

### 6.2b Rollout note for soft delete
Adding `deleted_at` and re-emitting SELECT policies touches ~30 tables; each table is its own migration file inside one PR per registry group (registries / case children / documents) so a failing policy can be reverted per table.

### 6.3 Phase 2 — entity layer
| Object | Change |
|---|---|
| `private.norm_phone(text)` | IMMUTABLE; `persons.phone_normalized`, `indicators.value_normalized`, `field_submission_persons.phone_normalized` generated columns + btree indexes |
| Indexes | trgm on `gangs.aliases`, `indicators.value`; btree `persons(lower(name), dob)`; `places(lower(name), lower(area))` |
| `vehicles_plate_key` | Dropped; replaced by partial unique index `upper(plate) where deleted_at is null and not private.siu_hidden('vehicle', id)`… — note `siu_hidden` is not IMMUTABLE, so the index is `(upper(plate)) where deleted_at is null and siu_hidden_flag = false` using a maintained boolean column `siu_hidden_flag` kept in sync by the `siu_visibility` triggers |
| `public.entity_suggest`, `public.entity_duplicates` | SECURITY INVOKER; min 2 chars; bounded; `set pg_trgm.word_similarity_threshold` locally |
| `entity_merges` | Ledger table; `public.entity_merge(kind, survivor, victims[], reason)` / `public.entity_unmerge(merge_id, reason)`; `person_merge`, `merge_narcotics`, `account_merge` become wrappers that write the ledger |
| `mdt_exports.person_id` | FK changed to NO ACTION; merge plan repoints `mdt_exports`, `mdt_wanted_projections` and refreshes `person_name_snapshot` |
| `siu_reconcile_queue` | Table + AFTER INSERT triggers on persons/vehicles/gangs/places (definer function comparing normalized keys against hidden rows); RLS: `siu_operates()` only; `siu_reconcile_resolve` RPC |
| `case_intel_links.kind` | CHECK extended with `vehicle`; index `(kind, ref_id)` |
| `entity_field_observations` | (case-scoped conflicting values) `(id, kind, ref_id, case_id, field, value, source_kind, source_id, recorded_by, created_at, promoted_at, promoted_by)`; RLS via case access |
| `entity_update_suggestions` | Detective proposals for master updates; SrDet+ accept/decline RPCs |
| `public.entity_crossref(kind, id)` | Bounded server replacement for the client vehicle/indicator cross-ref |

### 6.4 Phase 3 — workspace
| Object | Change |
|---|---|
| `case_notes` | `(id, case_id, author_id, body_md, pinned, restricted_to_command, deleted_at…, created_at, updated_at)`; RLS: select `can_read_case` (restricted rows: command or author), insert/update `can_access_case` + author; version trigger; audit; realtime |
| `cases.notes` backfill | One-time migration copies non-empty `cases.notes` into a `case_notes` row authored by the case lead (or creator) with `source='legacy'`; column kept read-only for one release then dropped in a later cleanup |
| `case_links` | `(case_id, related_case_id, kind, note, created_by, created_at, deleted_at)`; RLS: select when both cases readable; insert/delete `can_access_case(case_id)` |
| `public.case_audit_feed(p_case, p_limit, p_before)` | Definer; filters `audit_log` rows whose `entity` is the case or a child of it, then re-checks each row's entity with the caller's predicate (`can_read_case`, `can_view_legal_request`, restricted-media, SIB) before returning; never returns note bodies or sealed titles |
| Archived read-only | `private.case_writable(case_id)` = `can_access_case and archived_at is null`; INSERT/UPDATE/DELETE policies on cases and all case children re-emitted to use it (SELECT unchanged); `case_restore` unaffected; holds unchanged |
| `user_prefs.workspace` | No schema change (jsonb) |
| `case_access_requests` | No change; the affordance uses existing RLS |

### 6.5 Phase 4 — legal
| Object | Change |
|---|---|
| `review_legal_request_as_cid` | `approve` → `submitted_to_judge` (CID) / `submitted_to_judge` (SIB, AG notified); fan-out to judges via `legal_notify`; `LEGAL_SUBMITTED_TO_JUDGE` audit |
| `claim_legal_request_as_judge`, `assign_judge` | Unchanged predicates; `assign_judge` restricted to AG/Owner; sealed refusal message updated |
| `private.can_view_legal_request` | Prosecutor lanes removed; `observer` participant branch; AG branch keyed on `submitted_to_judge_at` |
| `review_status` CHECK | `partially_approved` added; retired values retained |
| `legal_request_target_decisions` | `(request_id, version_id, exhibit_id, decision approved|denied, reasoning, decided_by, decided_at)`; `decide_legal_request_as_judge` gains `p_target_decisions jsonb` |
| `legal_request_comments` | `(id, request_id, author_id, body, parent_id, created_at, edited_at, deleted_at)` + `legal_request_comment_versions`; RLS select `can_view_legal_request`; writes via `legal_comment` RPC; sealed-safe notify |
| `legal_request_charges` | `(request_id, case_charge_id, snap_code, snap_title, snap_class, counts)`; `legal_set_charges` RPC while editable |
| `legal_expiry_defaults` | `(subtype, days)` seed; `decide_legal_request_as_judge` sets `expires_at` when null |
| `legal_reminder_sweep()`, `legal_expiry_sweep()` | Cron RPCs; write `LEGAL_REMINDED`, `LEGAL_ESCALATED`, `LEGAL_EXPIRED`; reminder state in `legal_request_reminders` to avoid repeats |
| `withdraw_legal_request` | Terminal set corrected |
| `legal_internal_notes` | Authorization list re-emitted (judge, AG, Owner, request creator for public notes) |
| `legal_amend(p_request)` | Definer; clones draft columns, sets `amends_request_id`; `legal_mark_superseded` gets UI |
| Exhibits from new uploads | `legal_add_evidence_and_exhibit` wraps existing media insert + `add_legal_exhibit` |
| `justice_appoint` | Refuses `prosecutor`, `assistant_district_attorney`, `district_attorney` as new roles |

### 6.6 Phase 5 — reports
| Object | Change |
|---|---|
| `report_templates`, `report_template_versions` | Tables; RLS select any active; writes via `report_template_save` (Director/Owner publish; Bureau Lead proposes `draft`) |
| `reports` | `template_version_id` (NOT NULL after backfill from seeded versions), `review_status`, `reviewed_by`, `reviewed_at`, `review_note`, `submitted_at`; `parent_id` wired for supplemental/follow-up |
| `report_entities` | `(report_id, kind, ref_id, role, snapshot jsonb, edited bool, inserted_by, created_at)`; RLS via case access; index `(kind, ref_id)` |
| `report_submit`, `report_review`, `report_finalize` | Required-field enforcement from the pinned version; review gate; author + reviewer signatures |
| `report_reopen` | `p_reason` required; author notification |
| `report_exports` | Audit rows `REPORT_EXPORTED` |

### 6.7 Phase 6 — intel
| Object | Change |
|---|---|
| `field_submissions.status` | CHECK + transition table gain `rejected`; `field_submission_reject(id, reason)`; restore from rejected = command |
| `field_submission_comment(id, body, visible_to_officer bool)` | Writes reviewer note or officer-thread message; `field_submission_reviews_ins` tightened to RPC-only |
| `intel_groups`, `intel_group_members` | Tables + RPCs `intel_group_create/add/remove/link_case`; suggestions via `field_submission_repeats` |
| `field_claim_links` | Target kinds `narcotic`, `account`, `indicator` |
| `field_submission_convert(kind, claim_id, payload)` | Definer; calls the shared insert path with provenance `source_submission_id`; links the claim |
| `field_submissions.validated_at/validated_by` | Explicit mark; derived flag exposed by `field_submission_counts` |
| `private.intel_notify(...)` | New notification kinds `intel_new`, `intel_assigned`, `intel_question`, `intel_reply`, `intel_referred`; jurisdiction- and sensitivity-aware |
| Realtime | `field_submissions` added to the publication with a `replica identity` limited to `id, status, assigned_to, updated_at` via a trigger-maintained shadow table `field_submission_events` (so no summary text reaches clients) |

### 6.8 Phase 7 — action center
| Object | Change |
|---|---|
| `action_item_state` | `(user_id, dedupe_key, seen_at, snoozed_until, dismissed_at, updated_at)`; owner-only RLS; `action_item_set_state` RPC refusing dismiss for decision kinds; snooze of command decisions audited |
| `notifications` | `read_at` (backfilled from `read`), index `(user_id, read)`; `payload` minimal for new types; `notification_resolve(ids)` INVOKER hydration |
| `action_reassign_task`, `action_reassign_blocker` | Definer; case lead or command |
| `action_escalation_sweep()` | Cron; thresholds table `action_escalation_rules`; notifies next authority; sets `escalated_at` on `action_item_state` for all viewers |
| `cases.priority` | No change; read by the builder |
| `notification_titles` | Shared JSON source consumed by `notifText.ts` and the Discord edge function build |

### 6.9 Storage
- No new buckets. `field-evidence` unchanged. Legal "new evidence" uses the existing media path (FiveManage URL) or the `field-evidence` bucket when the source is a field submission. `case_files.case_id uuid` FK added (backfilled by case number) with `case_number` retained.

---

## 7. Permission and RLS changes

### 7.1 Permission matrix (actions introduced or changed by this plan)

| Action | Detective | Senior Detective | Bureau Lead | DD / Director | Owner | SIB field | X-1 | AG | Director-oversight | Judge | Field officer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Open case tab / read sections | case access | case access | bureau / global | global | all | own SIB + CID read | SIB | standard SIB read | standard SIB read + CID | none | none |
| Edit case (non-archived) | case access | case access | bureau | global | all | SIB case access | SIB | no | no | no | no |
| Add / unlink entity to case | case access | case access | " | " | " | " | " | no | no | no | no |
| Case note create / edit own | case access | " | " | " | " | " | " | no | no | no | no |
| Case note restricted-to-command read | no | no | yes | yes | yes | SIB command on SIB case | yes | no | no | no | no |
| View activity feed | case access (filtered) | " | " | " | " | " | " | " | " | no | no |
| Request case access | active CID | " | n/a | n/a | n/a | n/a | n/a | no | no | no | no |
| Grant / renew case access | lead of case | lead | yes | yes | yes | — | — | no | no | no | no |
| Archive / restore case | no | no | yes | yes | yes | SIB command | yes | no | no | no | no |
| Soft delete / restore record | own drafts | own drafts | yes + reason | yes | yes | SIB command (SIB records) | yes | no | no | no | own draft submission |
| Permanent delete | no | no | no | no | yes (armed) | no | no | no | no | no | no |
| View record history | read access | " | " | " | " | " | " | " | " | own requests | own submissions |
| Restore version | edit access + reason | " | " | " | " | " | " | no | no | no | no |
| Entity suggest / duplicates | yes | yes | yes | yes | yes | yes | yes | no | yes | no | no |
| Master fill-the-gaps update | proposes | direct + confirm | direct | direct | direct | direct | direct | no | no | no | no |
| Merge / unmerge entity | no | no | yes + reason | yes | yes | no | SIB command (SIB-hidden pairs) | no | no | no | no |
| SIB reconcile queue | no | no | no | no | yes | yes | yes | no | no | no | no |
| Create legal request | case access | " | " | " | " | SIB case | " | no | no | no | no |
| CID gate decide | no | no | responsible bureau (JTF any) | fallback, audited | fallback | no | SIB command | no | no | no | no |
| Claim / decide judicial | no | no | no | no | no | no | no | assign only | no | yes (not sealed self-claim) | no |
| Assign sealed to judge | no | no | no | no | fallback | no | no | yes | no | no | no |
| Comment on legal request | participant | participant | participant | participant | yes | participant | participant | sealed/AG-visible | no | participant | no |
| Withdraw / cancel / amend / supersede | creator withdraw + amend | " | cancel + supersede | " | " | creator | SIB command | no | no | no | no |
| Report submit | author | author | author | author | author | author | author | no | no | no | no |
| Report review (approve/return) | no | on case | yes | yes | yes | SIB SrSA+ | yes | no | no | no | no |
| Report reopen | no | no | own bureau + reason | yes + reason | yes | no | SIB command | no | no | no | no |
| Template propose / publish | no | no | propose | Director publish | publish | no | no | no | no | no | no |
| Intel claim / decide / archive / reject | reviewer | reviewer | reviewer | reviewer | yes | SIB agent (sensitive) | yes | no | no | no | no |
| Intel assign / reassign / delete | no | no | yes | yes | yes | no | X-1 (SIB) | no | no | no | no |
| Intel undelete | no | no | no | no | yes | no | no | no | no | no | no |
| Intel convert / group / link | reviewer | reviewer | yes | yes | yes | SIB agent | yes | no | no | no | no |
| Action Center: snooze decision | own items ≤ 48 h, audited | " | " | " | " | " | " | " | " | " | no |
| Action Center: dismiss informational | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | no |
| Reassign task / blocker | case lead | case lead | yes | yes | yes | SIB lead agent | yes | no | no | no | no |
| Read permission-denied audit | no | no | no | no | yes | no | no | no | no | no | no |

### 7.2 RLS conventions applied to every new object
- SELECT policies on soft-deletable tables: `private.is_live(deleted_at, archived_at) or private.is_owner()` conjunct.
- No client DELETE policy on soft-deletable tables; no client INSERT on version, ledger, comment-version, state or queue tables (RPC-only).
- Case-child write policies use `private.case_writable(case_id)`; read policies keep `can_read_case`.
- Any new delete RPC on a case-scoped table pairs rank with reach (`can_delete_case_child`), never bare `can_delete()`.
- SIB: every new predicate enumerates standings; `director_oversight` is never listed in a write, appoint, remove, referral, release or export predicate; `siu_recused()` remains first.
- Sealed side channels checked per feature: counts (none), search (`entity_suggest` and `legal_search` INVOKER), realtime (minimal event tables), notifications (minimal payloads).
- Every new definer RPC: `set search_path = ''`, `revoke all … from public`, `grant execute … to authenticated, service_role`; policy-referenced helpers get explicit `grant execute … to authenticated`.

### 7.3 Client
- `src/lib/permissions/` is the only importer of `roles.ts`, `siu.ts`, `capabilities.ts`; components migrate to `usePermissions().can(...)`. Removed duplicates: `actionItems.ts` `COMMAND_ROLES` / `CID_TRANSFER_DECIDERS`, `surveillanceModel.ts` `COMMAND_ROLES`, `CasesView.tsx:708` set, `useNavBadges.ts` sign-off routing, `SignoffTab.tsx` rules, the three `effectiveJusticeRole` copies, `viewerOwnsAction` case-access gap.
- Safe defaults: `usePermissions` returns `NO_ACCESS` until `my_permissions()` resolves; an RPC error keeps `NO_ACCESS` and surfaces a retry notice (no fallback to pure mirrors).

---

## 8. User-interface changes

### 8.1 Workspace shell
- `WorkspaceTabBar` replaces `ToolTabBar`; tab kinds carry an icon (case number in mono for cases); dirty dot; close / close others / close all; drag reorder; 8-case cap prompt.
- `/cases` list stays the case board; opening a case adds a tab and routes to `/workspace?case=`, with `/cases?case=` redirecting.
- Case tab header: `CaseCommandHeader` unchanged; section strip from `caseTabs.ts` with new sections People, Vehicles, Gangs, Locations, Notes, Activity; `Evidence` label for media.
- State surfaces: `DetailSkeleton` on first load; `EmptyState` per section; `ErrorNotice` with retry; restricted view (`AccessRequestPanel`) for ordinary CID cases; archived banner + disabled editors; legal-hold banner; SIB-assumed banner; deleted view ("This case is in the Trash" with restore for command).
- Notes section: `NotesPanel` (RichEditor, pin, restrict-to-command toggle for command, history via `VersionViewer`).
- Activity section: `ActivityFeed` (audit rows with field chips, filters by actor/kind/date, load older).
- Entity sections: `EntitySection(kind)` with `EntityPicker` add, role/note edit via `LinkEditPopover`, `RecordPeek`, unlink (soft), "differs from record" markers.

### 8.2 Mobile route
- `/m/cases/[id]` with a bottom section switcher, cards instead of tables, 44 px targets, quick actions (task done/add, note add, entity add via picker), links to desktop for editing.

### 8.3 Entity layer
- `EntityPicker` everywhere a registry record is chosen; `EntityCreateSheet` with live `DuplicatePanel` (strong / soft), `ComparePanel` (side-by-side fields, peek), `Use existing` primary; `MergeDialog` with manifest preview; `MergeHistory` on dossiers with Unmerge (command, 30 days); "Suggested updates" inbox on dossiers for SrDet+.

### 8.4 Legal
- Wizard steps: Type → Case & target → Charges (from case charges) → Evidence (attach / add new) → Narrative (standard-of-proof selector: probable cause / reasonable suspicion; PC section) → Review & submit.
- Dossier: comments thread, revision checklist, per-target decision panel for judges, Amend / Supersede / Cancel actions, export PDF/DOCX, status labels per L5, SLA chips (nudged / escalated / expires).
- DOJ workspace lanes: Judicial queue, Mine, Sealed (AG assignment), Returned, Decided; prosecutor lanes removed; AG admin keeps coverage/appointment for judges only.

### 8.5 Reports
- Builder: template picker (published versions), structured sections, narrative RichEditor with `@` mentions, "Insert from case" drawer (people, vehicles, gangs, locations, evidence, officers, charges, legal requests, related cases, timeline events), required-field checklist, Submit → Review → Seal flow, version history, exports.
- Template admin (`/admin/report-templates`): list, draft editor (sections, fields, required, review_required), publish/supersede, preview.

### 8.6 Intel
- Review screen gains Reject, Comment, Group (suggested + confirm), Convert, extended link kinds, Validated badge, notifications; realtime refresh.

### 8.7 Action Center
- Sections by preset; snooze / dismiss controls; bulk bar for read/snooze/dismiss; reassign dialog; escalated badge; saved views; mobile card layout via `useNarrow`; My Dashboard and Command Center embed `ActionSlice` components.

### 8.8 Trash
- `/trash` list grouped by kind with restore and (Owner) permanent delete via the armed dialog; "Deleted — Undo" toast.

---

## 9. Notifications and real-time behaviour

| Event | Recipients | Type | Discord |
|---|---|---|---|
| Case note mention | mentioned members with case access | `note_mention` | opt-in |
| Access request / decision / expiry-soon | lead + command / requester | existing `access_*`, new `access_expiring` | opt-in |
| Legal: submitted to judge, claimed, decision, returned, comment, reminder, escalation, expiry | participants per `legal_notify` (sealed-safe) | `legal_*` (+`legal_comment`, `legal_reminder`, `legal_escalated`, `legal_expired`) | opt-in |
| Report submitted / returned / approved / reopened | reviewers on case / author | `report_submitted`, `report_returned`, `report_finalized` (now fires), `report_reopened` | opt-in |
| Intel new / assigned / question / reply / referred | bureau reviewers / assignee / submitter (question only) | `intel_*` | opt-in |
| Merge performed / suggested update pending | record watchers / SrDet+ of bureau | `entity_merged`, `entity_update_suggested` | no |
| Action Center escalation | next authority | `action_escalated` | opt-in |
| SIB reconcile collision | SIB agents | `siu_reconcile` (SIB only, never CID) | no |

- Payloads carry ids and type only for every new kind; `notification_resolve` hydrates titles under RLS; a row whose subject the viewer can no longer see renders "An item you no longer have access to".
- Dedupe: server 1-hour window keyed on `(user_id, type, entity id)`; client `semanticKey` extended for the new kinds.
- Realtime: `case_notes`, `case_links`, `entity_merges` (SIB-hidden merges excluded via a shadow table), `action_item_state`, `field_submission_events`, `legal_request_comments` (sealed excluded via shadow) join the publication; versions, ledgers and queues stay unpublished.
- Discord: single `notification_titles.json` consumed by `notifText.ts` and bundled into `discord-notify` at deploy; per-category opt-in stored in `user_prefs.notif_discord`.

---

## 10. Data migration and backfill strategy

Because the live dataset is a fresh start, backfills are schema-level and idempotent:
1. `reports.template_version_id`: seed published versions from `FORM_SCHEMAS`; backfill existing rows by `template` name; then set NOT NULL.
2. `cases.notes` → `case_notes` (author = lead or creator, `source='legacy'`).
3. `notifications.read_at` from `read`.
4. `case_access_grants.expires_at` default applied to existing rows.
5. `case_files.case_id` resolved from `case_number`; rows that do not resolve are left with NULL and listed in the migration notice.
6. `audit_log` hash chain: existing rows hashed in order once; the chain starts at the first row after the reset.
7. `persons.phone_normalized` etc. are generated columns (no backfill).
8. Retired legal statuses stay valid for read; no row rewrites.
Every backfill runs inside the migration with `set local statement_timeout`, and each PR states the expected row count (zero or small).

---

## 11. Testing strategy

- **Unit (vitest)**: `permissions/parity.test.ts`; `entity` normalizers, ranking, duplicate scoring; `workspace` reducer (cap, suspend, restore, dirty); `legalWorkflow` stage graph after removal; `actionItems` new kinds, state, escalation scoring; `reportTemplates` validation; `intel` transitions incl. `rejected`; `versions` coalescing logic (pure helper).
- **msw**: `EntityPicker` + `DuplicatePanel` render → debounce → RPC chain; `usePermissions` NO_ACCESS default; `notification_resolve` hydration.
- **Live RLS (`tests/rls/v179+`)**, one file per sensitive area, positive and negative:
  - v179 permission module (`my_permissions`, `can_record`, `PERMISSION_DENIED` rows, `director_oversight` reads standard SIB only and cannot appoint/remove/read referrals/release/export).
  - v180 soft delete (non-owner cannot see deleted rows; client DELETE refused; restore authority; permanent armed protocol).
  - v181 record_versions (trigger fires, coalescing, history visibility follows read policy, restore requires edit + reason, sealed/legal versions display-only).
  - v182 audit immutability (UPDATE/DELETE refused for every role; chain verify detects a tampered row under maintenance GUC).
  - v183 case access expiry (expired grant denies; renew).
  - v184 entity suggest/duplicates (INVOKER: SIB-hidden never returned; field officer gets nothing; sealed never surfaces), merge/unmerge authority + MDT repoint + hold refusal, reconcile queue SIB-only.
  - v185 workspace tables (`case_notes` restricted read, `case_links` both-readable rule, `case_audit_feed` filtering of sealed/SIB rows, archived read-only).
  - v186 legal re-route (CID approve → judge; sealed assignment AG/Owner only; prosecutor rows read-only; comments sealed-safe; partial decisions frozen; reminder/expiry sweeps idempotent; DOJ fixture accounts provisioned).
  - v187 reports (template pinning, required-field refusal, review gate, reopen reason, `report_entities` never writes source).
  - v188 intel (`rejected` transitions, comment RPC-only, groups, convert provenance, notifications never reach submitter except question, realtime shadow carries no text, `siu_sensitive` unchanged).
  - v189 action center (state table owner-only, dismiss refused for decisions, snooze audit, reassign authority, escalation sweep).
  - v190 cron jobs (run as intended role, write `scheduled_job_runs`, no client EXECUTE).
- **E2E (Playwright)**: workspace open/switch/restore/cap; entity create with duplicate → use existing; legal end-to-end (draft → gate → judge → partial approval → export); report submit/review/seal; intel reject/group/convert; action center snooze/dismiss/reassign; trash restore; mobile route smoke; a11y ratchet re-run after each UI phase.
- **Gates** unchanged: `typecheck`, `lint`, `test`, `build`, `check:schema`, `check:freshness`, new `check:realtime`, `check:bundle` (re-baselined in Phase 0 per its header).

---

## 12. Security and audit requirements

- No client-side permission check is security; every new write is an RPC or a policy-checked write.
- New audit actions (all via existing `private.audit`/`legal_audit`/`siu_audit` writers): `PERMISSION_DENIED`, `ACCESS_GRANTED/RENEWED/EXPIRED/REVOKED`, `RECORD_SOFT_DELETED/RESTORED/PERMANENT_DELETE_ARMED/EXECUTED`, `RECORD_VERSION_RESTORED`, `ENTITY_MERGED/UNMERGED`, `ENTITY_UPDATE_SUGGESTED/ACCEPTED/DECLINED`, `SIU_RECONCILE_FLAGGED/RESOLVED`, `CASE_NOTE_*`, `CASE_LINKED/UNLINKED`, `LEGAL_SUBMITTED_TO_JUDGE`, `LEGAL_PARTIALLY_APPROVED`, `LEGAL_COMMENTED`, `LEGAL_REMINDED/ESCALATED/EXPIRED/AMENDED`, `LEGAL_EXPORTED`, `REPORT_SUBMITTED/RETURNED/APPROVED/EXPORTED`, `TEMPLATE_PUBLISHED/SUPERSEDED`, `FIELD_SUBMISSION_REJECTED/COMMENTED/GROUPED/CONVERTED`, `ACTION_SNOOZED/DISMISSED/REASSIGNED/ESCALATED`, `JOB_RUN`.
- Sealed / SIB / restricted material never enters: suggestion results, notification payloads, realtime events, activity feeds, exports, Discord.
- Exports are audited and exclude restricted media unless separately approved (existing rule).
- FiveM dormancy preserved: no grant on `mdt_patrol_feed`, `bridge_ingest_event`, `mdt_bridge_ack` changes; `private.mdt_project` call sites unchanged; merge RPCs repoint projections explicitly; `v157` / `v178` stay green.
- Cron RPCs are not executable by `authenticated`; they run as the job owner and self-check the invoking role.
- `service_role` remains the deployment-boundary trust; the audit hash chain makes tampering detectable, not impossible.

---

## 13. Rollback and recovery strategy

- Migrations are additive; each PR ships a commented rollback block (the repo convention) that drops only objects it created and re-emits the previous policy/function bodies verbatim.
- Feature flags in `app_secrets`-style config are **not** used for permissions; instead each phase's UI is behind a nav entry that is added in the last PR of the phase, so backend objects can land dark.
- Re-routing legal stages (P4-01) is reversible by re-emitting the prior RPC bodies; requests already in `submitted_to_judge` remain valid in both graphs.
- Soft-delete SELECT policy re-emits are per table; a bad policy is reverted per table.
- `record_versions` and `entity_merges` are the recovery data for the features themselves; the plan adds a restore-drill issue (P8-06) so the documented DR path is exercised once.
- Vercel instant rollback covers the UI; a UI rollback never leaves data unreadable because new columns are nullable or defaulted.

---

## 14. Documentation updates

Each phase's last PR updates: `CHANGELOG.md` (Unreleased → theme sections), `docs/AUTHORIZATION.md` (permission matrix from `permission_catalog`, Director-oversight standing, access expiry, soft delete/permanent delete), `docs/RLS.md` (is_live, case_writable, standings enumeration rule), `docs/WORKFLOWS.md` (legal graph, report review, intel statuses), `docs/DOJ-INTEGRATION.md` (prosecutor stage retired), `docs/ARCHITECTURE.md` (workspace, permission module, versions, scheduler), `docs/REVIEW-MAP.md` (feature → code → tests rows), `docs/TESTING.md` / `TEST-ENVIRONMENT.md` (DOJ fixtures, secrets), `docs/OPERATIONS.md` / `RUNBOOK.md` (cron jobs, audit chain verify, restore drill), `docs/DESIGN-SYSTEM.md` (workspace tabs, Trash, mobile route), `docs/USER-GUIDE.md` + `npm run gen:guide`, `docs/handbook/*` + `scripts/generate-handbook.mjs` section map + `npm run gen:handbook` (new chapters: Workspace, Permissions module, Versions & Trash), `supabase/README.md` (RPC reference), `supabase/MIGRATION-HISTORY.md`, `src/components/owner/ownerData.ts`, `docs/DEFERRED.md` rewritten.

---

## 15. Ordered implementation phases

| Phase | Theme | Outcome | Issues |
|---|---|---|---|
| 0 | Hygiene and test readiness | Replayable migrations, trustworthy snapshot, cron in repo, retired roles gone from UI, DOJ fixtures in CI, wizard on per-user drafts | P0-01 … P0-09 |
| 1 | Foundations: permission module, soft delete, versions, audit | One permission interface (server + client), soft delete everywhere (dark), field-level history, tamper-evident audit, access expiry, Director oversight standing, generalized permanent deletion | P1-01 … P1-09 |
| 2 | Entity layer | Unified suggest/duplicate RPCs, normalized phones, merge ledger with unmerge, SIB reconcile queue, shared picker/create/compare/merge UI replacing all ad-hoc loaders | P2-01 … P2-09 |
| 3 | Unified workspace | One tab strip for cases, records and tools; server-persisted tabs; entity, notes and activity sections; archived read-only; request-access state | P3-01 … P3-08 |
| 4 | Legal workflow | Detective → Bureau Lead → Judge; SIB X-1 → Judge; comments, charges, partial approval, evidence add, amend/supersede/cancel, reminders/escalation/expiry, exports | P4-01 … P4-12 |
| 5 | Report builder | DB templates with admin, review flow, entity insertion, rich narrative, six templates, exports | P5-01 … P5-07 |
| 6 | Intel triage | Reject, comment, group, convert, extended links, validation, notifications, realtime, referral cross-links | P6-01 … P6-08 |
| 7 | Action Center and scheduler | Per-user item state, all queues, priority/escalation, reassign/bulk, presets, surface consolidation, minimal notifications | P7-01 … P7-08 |
| 8 | Mobile, Trash, history UI, docs | Mobile case route, Trash + permanent-delete UI, history/diff surfaces, restore drill, documentation release | P8-01 … P8-07 |

Each phase ends with its RLS suite green in CI, docs regenerated, and a CHANGELOG entry.

---

## 16. Dependencies between phases

```
P0 ──► P1 ──► P2 ──► P3 ──► P4 ──► P5 ──► P6 ──► P7 ──► P8
        │      │      │      │      │      │      │
        │      │      │      │      │      │      └─ P7 needs P1 (state/audit), P4 (legal kinds), P5 (report review kinds), P6 (intel kinds), P0-04 (cron)
        │      │      │      │      │      └─ P6 needs P2 (convert via entity layer), P1 (soft delete columns already on field_submissions)
        │      │      │      │      └─ P5 needs P2 (entity insertion), P3 (case_links), P1 (versions for drafts)
        │      │      │      └─ P4 needs P1 (permission module, comments versioning), P2 (charges via penal picker uses EntityPicker), P0-08 (DOJ fixtures)
        │      │      └─ P3 needs P1 (permissions, soft delete, versions for notes), P2 (EntityPicker for sections)
        │      └─ P2 needs P1 (can_record for merge, soft delete for tombstones, is_live in suggest)
        └─ P1 needs P0-03 (fresh snapshot) and P0-04 (cron for sweeps)
```
Cross-phase hard edges: P3-05 (archived RLS) before P8-02 (Trash) so "archived" and "deleted" are distinct states; P2-04 before any registry merge UI; P4-01 before P7-02 legal kinds; P1-05 before P8-04.

---

## 17. Acceptance criteria per feature

**Unified Case Workspace**
- Up to 8 cases open as tabs alongside record and tool tabs; the 9th prompts to close one; only the active case is mounted; switching restores section and scroll.
- Tabs persist across refresh, logout/login and devices; a case the viewer can no longer see is closed silently on restore; no title or number of such a case is rendered.
- `/cases?case=X&tab=Y[&report|task|evidence]` opens case X at section Y in the workspace; sharing that URL never reveals other open tabs.
- Sections: Overview, People, Vehicles, Gangs, Locations, Evidence, Reports, Charges, Legal, Tasks, Notes, Timeline, Activity (plus existing graph, surveillance, extractions, RICO, sign-off, chat).
- A vehicle can be linked to a case; each entity section supports add, role/note, peek, unlink (soft).
- Notes are authored, versioned, pinnable; command-restricted notes are invisible to non-command.
- Activity shows field-level audit entries the viewer is allowed to see; sealed/SIB/restricted entries are absent, not placeholders.
- Loading, empty, error, restricted (with request-access for ordinary CID cases), archived (read-only at RLS), sealed (no placeholders), deleted (Trash notice) states each render distinctly and are e2e-covered.
- Drafts survive tab switches and closes; a dirty tab shows a dot; `beforeunload` fires only with a pending flush.
- Mobile: narrow viewports render the simplified route with read + quick actions; desktop parity actions link to desktop.

**Smart Entity Autofill**
- Typing in any entity field shows suggestions within 300 ms for the nine phase-one kinds, RLS-scoped, never for field officers.
- Selecting an entity fills known fields, leaves missing fields editable, and never overwrites typed values.
- Exact normalized matches show a strong warning with Compare / Use existing / Merge; fuzzy ≥ 0.6 shows a soft notice; saving is never blocked except by data validation.
- A conflicting typed value is stored as a case-scoped observation with provenance and marked "differs from record"; the master is unchanged.
- SrDet+ fill-the-gaps updates require confirm and re-fetch; detective proposals appear in the SrDet+ suggestions inbox.
- Merge (Bureau Lead+, reason) repoints every dependent including MDT projections and writes an `entity_merges` row; Unmerge within 30 days restores the victim and repoints back; both audited.
- SIB-hidden collisions never surface to CID; a hidden plate no longer errors; the collision appears in the SIB reconcile queue only.
- `entity_suggest` and `entity_duplicates` return nothing for sealed/hidden/deleted rows under every fixture in v184.

**Improved Legal Workflow**
- A detective's submitted request reaches the judicial queue immediately after Bureau Lead approval; no prosecutor stage exists in the UI or the transition table; historical prosecutor rows render read-only.
- SIB requests go X-1 → judicial queue with the AG notified.
- Sealed requests are assignable only by the AG (Owner fallback) and never self-claimable.
- Wizard captures standard of proof, probable-cause section, charges from `case_charges`, existing evidence, and new evidence added to the case in one step.
- Comments thread works for participants, sealed-safe; reviewers return with a structured checklist; resubmission requires a change summary everywhere.
- Judges can approve, partially approve (per target), deny with reason, or return; decisions freeze into the judicial version.
- Withdraw (creator, pre-decision), Cancel (command, reason), Amend, Supersede all have UI and audit.
- Reminders at 48 h, escalation at 5 days, unissued reminder at 7 days, expiry per subtype with judge override, all via cron and idempotent.
- Approved instruments export to PDF and DOCX with signatures and a verification code; exports are audited and exclude restricted media unless approved.
- Every request links back to its case and appears in the case's Legal section.

**Universal Action Center**
- Every listed item kind (existing 22 plus restricted packet, MDT export, field access, claim verdicts, narcotic suggestions, gang duplicate reviews, tracker co-signs, SIB conflicts/watch reviews, Owner signals) appears with a direct action.
- Items carry priority (incl. `cases.priority`), due date, escalation badge; filters and saved views persist; role presets ship.
- Snooze ≤ 48 h on any item; dismiss only on informational kinds; completion derived from the source row; bulk actions only for read/snooze/dismiss.
- Reassign tasks, blockers and intel from the queue with server authority.
- Real-time updates within 5 s of a source change; duplicates collapse; My Dashboard and Command Center show the same items.
- Notifications for new kinds carry no titles; a lost-standing item renders generically.
- Mobile card layout with 44 px targets; audit rows for snooze/dismiss/reassign/escalation.

**Report Builder**
- Templates are DB records with versions; each report pins a version; editing a template never changes an existing report's rendering.
- Six templates exist alongside the existing ones; `warrant_return` renders properly.
- Builder inserts people, vehicles, gangs, locations, evidence, dates/times, officers, charges, legal requests and related cases as `report_entities` with snapshots; edits never write to source records and are marked.
- Drafts autosave; required fields block submit/seal; review flow submitted → returned/approved → sealed with two signatures; templates may skip review.
- Reopen requires reason, notifies the author, and re-seal creates a new version.
- PDF/DOCX/MD export per report, audited.
- Mobile: narrative-only editing of existing drafts.

**Intel Triage System**
- Reviewers can validate (derived + explicit), reject (reason), claim, assign, reassign, comment, archive, restore, soft-delete (command), undelete (Owner), convert to entity, create case, link case, link to people/vehicles/gangs/locations/narcotics/accounts/indicators, and group similar submissions.
- Submitter identity and snapshots remain frozen; submit-only accounts see only their own work and receive only "question for you" notifications; no auto-JTF.
- `siu_sensitive` and SIB referral rules unchanged; `siu_referrals` cross-link but stay separate.
- Reviewer notifications and realtime updates work without any summary text leaving RLS.

**Central Permission Module**
- `my_permissions()` and `can_record()` are the only sources of client gates; parity tests pass against live fixtures.
- Permission matrix generated from `permission_catalog` matches the documentation table.
- Director-oversight reads standard SIB cases and reports only; every write/appoint/remove/referral/release/export test denies it.
- Access grants expire (default 30, max 90 days) and can be renewed; expiry sweep notifies.
- `PERMISSION_DENIED` rows are written by every refusing RPC in scope; sensitive views logged.
- No duplicate role sets remain in `src/`; ESLint rule forbids importing `roles.ts`/`siu.ts` outside `lib/permissions`.

**Version History and Recovery**
- Editing any covered record produces a version with changed fields; same-actor edits within 5 minutes coalesce.
- History is visible to anyone who can read the record, with field-level diffs; restore requires edit authority and a reason and lands as a new version.
- Soft delete replaces hard delete everywhere; Trash lists restorable rows; "Deleted — Undo" works after the toast expires.
- Permanent deletion is Owner-only via preview → arm → execute with dependency warnings, fresh session and typed confirmation; refused while dependents exist; ledger row written.
- Deleting a case never deletes or orphans evidence, reports, legal requests or shared entities.
- Audit log rejects UPDATE/DELETE for every client role; hash chain verifies nightly.
- Retention: versions pruned after 2 years except latest 5 and held/open-case records; audit never pruned.

---

## 18. Risks and mitigation

| Risk | Mitigation |
|---|---|
| Re-emitting ~30 SELECT policies for soft delete regresses reach or performance | One migration file per table; each guarded by an RLS test; `is_live` is a STABLE SQL function inlined by the planner; indexes on `deleted_at` where filtered |
| `can_access_case`/`_row` drift when adding expiry and `case_writable` | Both re-emitted in the same migration with a test asserting agreement on a matrix of fixtures |
| Legal re-route breaks in-flight requests | Fresh dataset; still, the migration maps any row in `prosecutor_queue|prosecutor_review` to `submitted_to_judge` with an audit row |
| Removing the prosecutor lane strands sealed assignment | AG assignment retained; Owner fallback with `LEGAL_AG_UNCOVERED` audit |
| Director oversight becomes a write path by accident | New standing enumerated only in read branches; dedicated negative tests for appoint, remove, referral, release, export, watchlist, compartments |
| Suggestion RPC becomes an enumeration oracle | SECURITY INVOKER only; min 2 chars; bounded; tested with field-officer, SIB-hidden, sealed fixtures |
| Merge repoint misses a dependent table | Plan derived from `pg_constraint` at call time plus explicit overrides; dry-run preview shown; unmerge as a safety net |
| Workspace memory/query cost | Only the active case mounted; suspended tabs keep state only; case-scoped realtime filters (P3-08) |
| Realtime leaks for new tables | Shadow event tables carry ids and status only; sealed/SIB rows excluded at trigger time |
| Notification volume from reminders/escalation | Reminder state table prevents repeats; per-category mute/opt-in; Discord opt-in only |
| Template migration re-renders sealed reports | Pinned `template_version_id`; seed versions are byte-identical to `FORM_SCHEMAS` |
| Client refactor of permission checks regresses UI gates | Parity suite + msw tests; migrate hub by hub with the ESLint import rule enforced only after the last consumer moves |
| Cron jobs run with wrong role or double-fire | Jobs call idempotent RPCs that lock a `scheduled_job_runs` row; RPCs check `current_user` |
| a11y ratchet surfaces many violations after the redesign | Budgeted in P0-09; failures fixed rather than re-baselined away |
| Snapshot regeneration diverges from live | Regenerated from the live catalog with `pg_dump --schema-only` equivalent via MCP, then diffed; `check:freshness` + `check:realtime` gates |
| Mobile route duplicates logic | Reuses section components in card mode; no separate data layer |

---

## 19. Explicitly out of scope

- Activating the FiveM/MDT lanes or changing any `service_role`-only grant; `integration-package/` untouched.
- Server-side pagination of the case list (DEFERRED #2) beyond the bounded cross-ref RPC.
- Anonymous or public intake forms.
- Drawn/image signatures.
- Absorbing `siu_referrals` into `field_submissions`.
- Shared/bureau-published saved views.
- Mirroring FiveManage media into Supabase storage.
- A dedicated test Supabase project or visual-regression baselines (recorded as a separate decision in `TEST-ENVIRONMENT.md`).
- Discord slash commands or approvals via Discord.
- Renaming `siu_*` identifiers or dropping retired enum values.
- A full-parity mobile editor for reports and legal drafting.
- Full-text section indexing of reports (documents-only `document_sections` stays as-is).

---

## 20. Remaining unanswered questions

None. Every decision required for implementation is recorded in §2. Two implementation-time details are noted as engineer discretion, not product questions: the exact `word_similarity` operator form used inside `entity_suggest` for each kind, and the coalescing window implementation (trigger-side comparison of `actor_id` and `created_at`).

---

## 21. GitHub issue breakdown

Recommended order is the numeric order below. Labels use the repo's conventions: `area:*`, `type:*`, `phase:*`, `security`, `migration`, `docs`. Every issue implicitly requires: the four gates green, `check:schema` + `check:freshness` (+ `check:realtime` after P0-03), positive and negative RLS tests for any policy/RPC, `CHANGELOG.md` Unreleased entry, and the PR template sections filled.

### Phase 0 — Hygiene and test readiness

**P0-01 Resolve duplicate migration timestamps**
- Purpose: make filename-order replay deterministic.
- Scope: `20260825120000_siu_phase3.sql`, `20260921120000_permanent_delete_refresh.sql`.
- Dependencies: none.
- Tasks: add `20261004100000_replay_order_siu_phase3.sql` and `..._permanent_delete_refresh.sql` that re-emit the affected functions verbatim; mark the originals as superseded in `MIGRATION-HISTORY.md`; document why the originals are not renamed (applied names are recorded live).
- Acceptance: `supabase db reset` on a scratch project replays cleanly; live `schema_migrations` unchanged except the two new rows.
- Tests: `check:freshness`; RLS suite unchanged.
- Migration/rollback: no-op bodies; rollback = drop nothing.
- Labels: `area:db`, `type:chore`, `phase:0`, `migration`.

**P0-02 Re-emit field jurisdiction and case-create functions with current bureaus**
- Purpose: remove the conflicting redefinitions of `private.field_jurisdiction_visible_for` and `public.field_submission_create_case` that still use `LSB|BCB|SAB`.
- Dependencies: P0-01.
- Tasks: one migration re-emitting both with `major_crimes|street_crimes|JTF` and the everyone-sees rule; update `docs/USER-GUIDE.md` wording if needed.
- Acceptance: a clean replay produces the same function bodies as live.
- Tests: add `tests/rls/v179-prep.test.ts` asserting jurisdiction visibility for MCB/SCB fixtures.
- Rollback: re-emit previous body.
- Labels: `area:intel`, `type:bug`, `phase:0`, `migration`.

**P0-03 Regenerate schema snapshot; add realtime gate; re-baseline bundle budget**
- Purpose: make `schema-snapshot.sql` trustworthy for every later phase.
- Dependencies: none.
- Tasks: regenerate the snapshot from the live catalog (all `private.*` bodies, policies, publication list); write `scripts/check-realtime.mjs` comparing the publication block to a JSON manifest; wire into `ci.yml`; re-measure `check:bundle` baseline and update the header.
- Acceptance: `check:schema`, `check:freshness`, `check:realtime` pass; snapshot `can_access_case` and `search_all` match live.
- Tests: script unit tests.
- Rollback: n/a (docs/tooling).
- Labels: `area:tooling`, `type:chore`, `phase:0`.

**P0-04 Adopt pg_cron in migrations**
- Purpose: version the scheduler.
- Dependencies: P0-03.
- Tasks: migration enabling `pg_cron`/`pg_net` (idempotent), `scheduled_job_runs` table (RLS: Owner read), `private.job_begin/job_end` helpers, re-declare `sops-sync` schedule; `docs/OPERATIONS.md` update.
- Acceptance: `cron.job` lists `sops-sync`; runs write `scheduled_job_runs`.
- Tests: RLS test that `authenticated` cannot read `cron.*` or execute job RPCs.
- Rollback: `cron.unschedule`; drop table.
- Labels: `area:db`, `type:feature`, `phase:0`, `migration`.

**P0-05 Retire ADA/DA and legacy strings from the UI**
- Purpose: stop minting retired roles; fix user-facing legacy wording.
- Dependencies: none.
- Tasks: remove ADA/DA from `AssignModal.tsx:334-335` and `OwnerView.tsx:685-686`; delete `JusticeGrantPanel` (revoked RPC); replace ADA strings in `legalWorkflow.ts:261,491,512,652` with history-only rendering; `docRelations.ts:66` → `SIB`; `PortalAssistant.tsx:84` placeholder → `MCB-4000001`; `SecurityTestingSection.tsx:19-20` rows → judge/AG; `WorkflowTimeline.stories.tsx` fixture.
- Acceptance: grep for `assistant_district_attorney`/`district_attorney` in `src/components` returns only history renderers; no bare `SIU` label.
- Tests: `legalWorkflow.test.ts` updated; storybook build.
- Rollback: revert PR.
- Labels: `area:legal`, `type:chore`, `phase:0`.

**P0-06 Move legal wizard and dossier drafts to userDrafts**
- Purpose: close the shared-terminal draft leak on the most sensitive form.
- Dependencies: none.
- Tasks: replace `Drafts` usage in `LegalCreateWizard.tsx`, `RequestSection.tsx`, `LegalRequestDetail.tsx` with `userDrafts` keys `legal:new:<kind>` / `legal:edit:<id>`; one-time migration of local keys on load; delete unused `drafts.ts` exports (keep the mirror primitive).
- Acceptance: drafts survive device change; no `cid-draft:` keys written by legal surfaces.
- Tests: vitest for key migration; msw for autosave chain.
- Rollback: revert.
- Labels: `area:legal`, `type:bug`, `phase:0`, `security`.

**P0-07 Documentation corrections**
- Purpose: remove references to dropped objects and dead architecture.
- Dependencies: none.
- Tasks: `AUTHORIZATION.md:118`, `TEST-ENVIRONMENT.md:75`, `DEFERRED.md` rewrite, `supabase/README.md` DOJ section marked historical, `docs/WORKFLOWS.md` scheduler note; `gen:handbook` + `gen:guide`.
- Acceptance: CI drift checks pass.
- Labels: `docs`, `phase:0`.

**P0-08 Provision DOJ RLS fixtures and CI secrets**
- Purpose: give the judge/AG lanes live RLS coverage.
- Dependencies: none (requires Owner action in the live project).
- Tasks: create `rls-test-judge`, `rls-test-ag`, `rls-test-judge2` fixture accounts (per `tests/rls/README.md` namespace), extend `rls_test_cleanup()` coverage, add `RLS_TEST_PASSWORD_*` secrets, un-skip `v163`/`v165` (adjusted in P4-12), record in `TEST-ENVIRONMENT.md`.
- Acceptance: `security-suites` job runs live and is green.
- Tests: the live suite itself.
- Labels: `area:testing`, `type:chore`, `phase:0`, `security`.

**P0-09 Run the a11y ratchet and fix violations**
- Purpose: establish a real baseline after the redesign.
- Dependencies: P0-08.
- Tasks: run `tests/e2e/a11y.spec.ts`; fix serious/critical violations; commit the baseline only for accepted minor rules.
- Acceptance: a11y spec green in CI.
- Labels: `area:ui`, `type:bug`, `phase:0`, `a11y`.

### Phase 1 — Foundations

**P1-01 Permission catalog, perm aliases, my_permissions, can_record**
- Purpose: one server interface for every permission question.
- Dependencies: P0-03.
- Tasks: `permission_catalog` table + seed; `private.perm_*` aliases; `public.my_permissions()`; `public.can_record(action, kind, id)` with `private.perm_dispatch`; `private.perm_deny()`; wire `perm_deny` into the RPCs touched later (each later issue adds its own); `PERMISSIONS_MATRIX` generated by `scripts/gen-permissions-matrix.mjs`.
- Acceptance: `my_permissions()` returns correct shape for detective, SrDet, BL, DD, Dir, Owner, SIB agent, X-1, AG, judge, field officer, inactive; `can_record` agrees with the underlying predicate on a fixture matrix.
- Tests: `tests/rls/v179.test.ts`; vitest for the generator.
- Rollback: drop functions/table.
- Labels: `area:permissions`, `type:feature`, `phase:1`, `migration`, `security`.

**P1-02 Audit log immutability and hash chain**
- Purpose: enforce append-only in SQL; detect tampering.
- Dependencies: P0-04.
- Tasks: columns `prev_hash`, `row_hash`; BEFORE INSERT hash trigger; BEFORE UPDATE/DELETE raise trigger with maintenance GUC; revoke UPDATE/DELETE grants; one-time chain seed; `private.audit_chain_verify()` + daily cron + Owner notification on mismatch; `city2_reset` sets the GUC.
- Acceptance: UPDATE/DELETE refused for `authenticated`, `anon`; verify job green.
- Tests: `tests/rls/v182.test.ts`.
- Rollback: drop triggers/columns (chain restarts).
- Labels: `area:audit`, `type:feature`, `phase:1`, `migration`, `security`.

**P1-03a Soft delete: registries**
- Purpose: replace hard delete with `deleted_at` on persons, vehicles, gangs, places, accounts, indicators, narcotics, operations, bolos, trackers, gang_members, gang_turf, person_*, account_links.
- Dependencies: P1-01.
- Tasks: columns; `private.is_live()`; SELECT policies re-emitted; client DELETE policies dropped; `public.soft_delete(kind,id,reason)` / `public.restore_record(kind,id,reason)` (gated by `can_record`, hold-aware); audit actions; `database.types.ts`.
- Acceptance: deleted rows invisible to non-owners; DELETE from client refused; restore works for BL+; own-draft rule for author-owned kinds.
- Tests: `tests/rls/v180a.test.ts`.
- Rollback: per-table policy re-emit.
- Labels: `area:db`, `type:feature`, `phase:1`, `migration`, `security`.

**P1-03b Soft delete: cases and case children**
- Scope: cases, reports, media, evidence (RPC-only), case_tasks, case_messages, case_intel_links, case_blockers, rico_cases, predicate_acts.
- Same structure as P1-03a; case-child rules use `can_delete_case_child`; hold blocks; `private.case_writable` prepared for P3-05 (not yet applied).
- Tests: `tests/rls/v180b.test.ts`.
- Labels: as above.

**P1-03c Version-table immutability alignment**
- Purpose: bring `documents_versions` to the legal-versions bar.
- Tasks: UPDATE/DELETE-blocking trigger; drop client INSERT policy (writes via `document_save`); confirm `report_versions` UPDATE block, keep CASCADE (parent is soft-deleted now, so CASCADE never fires for clients).
- Tests: extend `v131`.
- Labels: `area:documents`, `security`, `phase:1`, `migration`.

**P1-04 Director read-only SIB oversight standing**
- Purpose: implement the confirmed Director decision safely.
- Dependencies: P1-01.
- Tasks: `private.siu_standing()` returns `director_oversight`; `siu_case_read()` branch (standard classification, not inquiry); `siu_oversight_report`/`siu_oversight_supplement` admit it; re-emit `siu_can_appoint`, `siu_remove`, `siu_referrals_sel`, disclosure release, `siu_export_case`, watchlist, compartments, `siu_grant_temp_access`, `siu_review_referral`, `siu_resolve_conflict` to enumerate standings explicitly; `siu_department_context()` exposes it; client `siu.ts` mirror; docs `AUTHORIZATION.md` §4f amendment.
- Acceptance: Director reads a standard SIB case and its reports; zero rows from notes/targets/sources/watchlist/referrals; every write/appoint/remove/release/export denied.
- Tests: `tests/rls/v179b.test.ts` (positive read, 12 negative writes).
- Rollback: re-emit prior bodies (the `20260902120000` state).
- Labels: `area:sib`, `type:feature`, `phase:1`, `migration`, `security`.

**P1-05 record_versions and restore**
- Purpose: field-level history for the covered tables.
- Dependencies: P1-03a/b.
- Tasks: table; `private.version_row()` with coalescing; attach triggers; `vehicles` touch trigger; `public.record_history`; `public.restore_version`; prune RPC + daily cron honoring holds/open cases; retention doc.
- Acceptance: history visible per read policy; restore = edit + reason; sealed reports/legal versions excluded from restore; prune keeps latest 5.
- Tests: `tests/rls/v181.test.ts`; vitest for coalescing helper.
- Rollback: drop triggers/table.
- Labels: `area:db`, `type:feature`, `phase:1`, `migration`.

**P1-06 Case access grant expiry**
- Tasks: `expires_at` + CHECK; `can_access_case`/`_row` re-emitted together; `case_access_renew`; hourly `access_grant_expiry_sweep` notifying grantee + lead 3 days before and on expiry; Action Center kind `access_expiring`; `ACCESS_*` audit.
- Tests: `tests/rls/v183.test.ts`.
- Labels: `area:permissions`, `phase:1`, `migration`, `security`.

**P1-07 Generalized permanent deletion**
- Tasks: `deleted_record_ledger`; `permanent_delete_record_preview/arm/execute(kind, id, …)` reusing `deletion_tokens`, `assert_fresh_session`, catalog walk; refuse while dependents exist; storage object deletion for `field-evidence`; `case_permanent_delete` becomes a wrapper.
- Tests: extend `v125` pattern → `tests/rls/v180c.test.ts`.
- Labels: `area:db`, `phase:1`, `migration`, `security`.

**P1-08 Client permission module**
- Tasks: `src/lib/permissions/{index,mirrors,usePermissions,matrix,parity.test}.ts`; `usePermissions()` server-first with `NO_ACCESS`; migrate `useCapabilities`, `useSiu`, `useMyJusticeRole` consumers; ESLint `no-restricted-imports` rule (activated in P1-09).
- Acceptance: all gates pass; parity suite green against fixtures.
- Tests: vitest + msw.
- Labels: `area:permissions`, `type:refactor`, `phase:1`.

**P1-09 Remove duplicated client checks**
- Tasks: replace `COMMAND_ROLES` copies, `CID_TRANSFER_DECIDERS`, `CasesView.tsx:708`, `useNavBadges` sign-off routing (call `can_record('case.signoff_decide')` results cached), `SignoffTab` rules, three `effectiveJusticeRole` copies, `viewerOwnsAction` case-access gap, `CaseDetail.tsx:374`; enable the ESLint rule.
- Acceptance: `grep` for role literals outside `lib/permissions` returns only labels.
- Labels: `area:permissions`, `type:refactor`, `phase:1`.

### Phase 2 — Entity layer

**P2-01 Phone normalization and missing indexes**
- Tasks: `private.norm_phone`; generated columns on `persons`, `indicators`, `field_submission_persons`; indexes (phone, `gangs.aliases` trgm, `indicators.value` trgm, `persons(lower(name),dob)`, `places(lower(name),lower(area))`); client `normPhone` parity test.
- Tests: vitest parity; explain-plan check documented.
- Labels: `area:db`, `phase:2`, `migration`.

**P2-02 entity_suggest and entity_duplicates RPCs**
- Tasks: SECURITY INVOKER RPCs with per-kind arms (person, vehicle, phone, gang, place, narcotic, case, indicator, account), normalized fast paths, trgm fallback, bounded; `exact` flag; `src/lib/entity/api.ts`; `entitySearch.ts` delegates to the RPC.
- Acceptance: p95 < 150 ms on seeded data; nothing returned for field officers, SIB-hidden, sealed, deleted.
- Tests: `tests/rls/v184a.test.ts`; vitest ranking.
- Labels: `area:search`, `phase:2`, `migration`, `security`.

**P2-03 SIB reconcile queue and plate uniqueness**
- Tasks: `siu_hidden_flag` maintained by `siu_visibility` triggers; drop `vehicles_plate_key`, add partial unique index; `siu_reconcile_queue` + AFTER INSERT triggers (definer compare) + 15-min scan job for late restrictions; `siu_reconcile_resolve(link|merge|dismiss)`; SIB UI panel.
- Acceptance: creating a hidden plate succeeds for CID; queue row visible to SIB only.
- Tests: `tests/rls/v184b.test.ts`.
- Labels: `area:sib`, `phase:2`, `migration`, `security`.

**P2-04 entity_merges ledger, generic merge/unmerge**
- Tasks: table; `private.entity_merge_plan(kind)`; `entity_merge`/`entity_unmerge`; explicit MDT repoint (`mdt_wanted_projections`, `mdt_exports` FK → NO ACTION); `person_merge`/`merge_narcotics`/`account_merge` wrappers; hold refusal; audit; `v157`/`v178` still green.
- Tests: `tests/rls/v184c.test.ts` (authority, MDT repoint, unmerge window, hold).
- Labels: `area:db`, `phase:2`, `migration`, `security`.

**P2-05 Case-scoped observations and update suggestions**
- Tasks: `entity_field_observations`, `entity_update_suggestions` + accept/decline RPCs (SrDet+); `promote_observation` RPC; audit.
- Tests: `tests/rls/v184d.test.ts`.
- Labels: `area:db`, `phase:2`, `migration`.

**P2-06 Vehicle link kind and bounded cross-ref**
- Tasks: `case_intel_links` CHECK + index; `public.entity_crossref(kind, id, limit)`; `VehiclesView` and `IndicatorsView` use it; remove unbounded client scan.
- Tests: RLS scoping of crossref; vitest.
- Labels: `area:search`, `phase:2`, `migration`, `performance`.

**P2-07 Shared entity UI**
- Tasks: `EntityPicker`, `EntityCreateSheet` (per-kind fields, autofill, `DuplicatePanel`, `ComparePanel`, Use-existing default), `MergeDialog` (manifest preview), `MergeHistory` + Unmerge, `SuggestedUpdates` inbox; storybook stories; a11y.
- Tests: msw render/debounce/RPC; e2e create-with-duplicate.
- Labels: `area:ui`, `phase:2`.

**P2-08 Replace ad-hoc loaders and duplicate hints**
- Tasks: migrate `PersonModal`, `VehiclesView`, `gangModals`, `PlacesView`, `NarcoticsView`, `AccountsView`, `IndicatorsView`, `CaseModal`, `LegalCreateWizard`, `MdtExports`, `ProfileRelations`, `ProfileAssets`, `gangLinkPanels`, `ReportsTab.PersonField` (name+id pair kept) to the shared layer; fix `forms.ts:340` `person:true` on a plate field; delete dead loaders (knip).
- Acceptance: `grep ilikeAny(` outside `lib/` returns nothing.
- Labels: `area:ui`, `type:refactor`, `phase:2`.

**P2-09 Reviewer-side matching uses the entity layer**
- Tasks: `IntelActions` link/convert uses `EntityPicker` + `EntityCreateSheet`; `field_claim_matches` results feed `DuplicatePanel`.
- Labels: `area:intel`, `phase:2`.

### Phase 3 — Unified workspace

**P3-01 Generic workspace provider and tab bar**
- Tasks: `src/components/workspace/*`; tab kinds `tool | record`; `user_prefs.workspace` persistence (ids only), restore with RLS re-resolve and silent close, URL mirroring with self-write guard, dirty aggregate from `useDraftState`, mobile collapse; `ToolsView` becomes a renderer; `useToolNav` delegates.
- Tests: vitest reducer; e2e `tools-redirect` updated.
- Labels: `area:ui`, `type:refactor`, `phase:3`.

**P3-02 Case tabs in the workspace**
- Tasks: `case` tab kind; cap 8 + prompt; suspend/mount policy; `CaseDetail` split into `CaseWorkspaceTab` + sections; `/cases?case=` redirect; `caseLink` unchanged; `RicoView` import preserved; recents/pins seeds.
- Tests: e2e open/switch/restore/cap; `caseTabs.test`.
- Labels: `area:cases`, `type:feature`, `phase:3`.

**P3-03 case_notes**
- Tasks: table, RLS, version trigger, audit, realtime; backfill from `cases.notes`; `NotesPanel`; mentions notify; Drafts key `note:<caseId>`.
- Tests: `tests/rls/v185a.test.ts`.
- Labels: `area:cases`, `phase:3`, `migration`.

**P3-04 case_links and case_audit_feed**
- Tasks: `case_links` table + RLS; `public.case_audit_feed` with per-row predicate re-check; `ActivityFeed` section; related-cases panel in Overview.
- Tests: `tests/rls/v185b.test.ts` (sealed/SIB/restricted rows absent).
- Labels: `area:cases`, `phase:3`, `migration`, `security`.

**P3-05 Archived cases read-only at RLS**
- Tasks: `private.case_writable`; re-emit INSERT/UPDATE/DELETE policies for cases + children; RPC guards (`report_finalize`, `signoff_*`, `create_legal_request` refuse archived); UI disables editors; `case_restore` path verified.
- Tests: `tests/rls/v185c.test.ts` (archived write refused for BL; restore then write succeeds).
- Labels: `area:cases`, `phase:3`, `migration`, `security`.

**P3-06 Entity sections**
- Tasks: `EntitySection(kind)` for people, vehicles, gangs, locations; role/note edit; soft unlink; "differs from record" markers from `entity_field_observations`; Intel & Notes keeps narcotics/accounts.
- Tests: e2e; msw.
- Labels: `area:cases`, `phase:3`.

**P3-07 Workspace states and request-access**
- Tasks: `AccessRequestPanel` (ordinary CID cases only; SIB/sealed/compartmented keep not-found), archived/held/SIB/deleted banners, `EmptyState`/`ErrorNotice` per section, dirty dot, `beforeunload` rule.
- Tests: e2e per state.
- Labels: `area:cases`, `phase:3`.

**P3-08 Case-scoped realtime**
- Tasks: `realtime.ts` filtered channels (`case_id=eq.<id>`) for case-child tables; fallback to table-wide when filter unsupported; measure query counts.
- Tests: vitest; manual perf note.
- Labels: `area:performance`, `phase:3`.

### Phase 4 — Legal workflow

**P4-01 Re-route legal stages: remove prosecutor stage, SIB → judge, sealed assignment**
- Purpose: implement L1–L4 server-side.
- Dependencies: P1-01, P0-08.
- Tasks: migration re-emitting `review_legal_request_as_cid` (approve → `submitted_to_judge` for CID and SIB; judge fan-out; AG notification for SIB), `submit_legal_request_to_cid` (returned_by_judge → `submitted_to_judge`, material change → gate), `assign_judge` (AG/Owner only; sealed message), `private.can_view_legal_request` (prosecutor lanes removed; `observer` participant), `withdraw_legal_request` terminal set, `legal_internal_notes` list, `justice_appoint` refusing prosecutor/ADA/DA, `review_status` CHECK + `partially_approved`; map any in-flight prosecutor rows; `LEGAL_SUBMITTED_TO_JUDGE`; `perm_deny` wiring.
- Acceptance: BL approve lands in judge queue; judge claims; SIB X-1 approve lands in judge queue with AG notified; sealed claim refused, AG assign works, Owner fallback works.
- Tests: `tests/rls/v186a.test.ts`; `legal.test.ts` updated.
- Rollback: re-emit prior bodies.
- Labels: `area:legal`, `type:feature`, `phase:4`, `migration`, `security`.

**P4-02 Client legal model and DOJ workspace lanes**
- Tasks: `legalWorkflow.ts` stage graph, labels (L5), `responsibleRole`, `dispositionFor`, `routingExplanation`; `DojWorkspace` lanes (Judicial queue, Mine, Sealed assignment for AG, Returned, Decided); `DojAdmin` judges/AG only; `LegalStageTracker`; `justice.ts` labels.
- Tests: `legalWorkflow.test.ts` (rewrite affected cases); e2e `justice.spec`.
- Labels: `area:legal`, `phase:4`.

**P4-03 Charges on legal requests**
- Tasks: `legal_request_charges` + `legal_set_charges`; wizard Charges step with `EntityPicker(charge)` that creates the `case_charge` when missing; dossier and exports render charges.
- Tests: `tests/rls/v186b.test.ts`; vitest.
- Labels: `area:legal`, `phase:4`, `migration`.

**P4-04 Standard of proof and probable-cause section**
- Tasks: `form_data.standard_of_proof` (`probable_cause | reasonable_suspicion`), `form_data.pc_statement` (required for warrants); server validation in `submit_legal_request_to_cid`; wizard Narrative step; `SubmitPreview` checks.
- Tests: RLS submit refusal; vitest.
- Labels: `area:legal`, `phase:4`, `migration`.

**P4-05 Comments thread**
- Tasks: `legal_request_comments` + versions; `legal_comment` RPC; sealed-safe `legal_notify('legal_comment')`; realtime shadow; dossier `CommentsThread`.
- Tests: `tests/rls/v186c.test.ts` (participant-only, sealed never in payload).
- Labels: `area:legal`, `phase:4`, `migration`, `security`.

**P4-06 Structured revision requests and change summaries**
- Tasks: `legal_request_revision_items(request_id, action_id, field, note, resolved_at)`; return actions accept a checklist; dossier inline editor captures `change_summary`; resubmit shows unresolved items.
- Tests: RLS; e2e return → edit → resubmit.
- Labels: `area:legal`, `phase:4`, `migration`.

**P4-07 Partial approval**
- Tasks: `legal_request_target_decisions`; `decide_legal_request_as_judge(p_decision, p_reasoning, p_conditions, p_expires_at, p_target_decisions)`; `partially_approved` handling in fulfilment RPCs (only approved targets executable); judge `TargetDecisionPanel`; `LEGAL_PARTIALLY_APPROVED`.
- Tests: `tests/rls/v186d.test.ts`.
- Labels: `area:legal`, `phase:4`, `migration`, `security`.

**P4-08 Add new evidence inside a request**
- Tasks: `legal_add_evidence_and_exhibit` (media insert via existing path + `add_legal_exhibit`); wizard Evidence step "Add new"; custody preserved.
- Tests: RLS; e2e.
- Labels: `area:legal`, `phase:4`, `migration`.

**P4-09 Withdraw, cancel, amend, supersede UI**
- Tasks: `legal_amend` RPC; UI for `withdraw_legal_request`, `legal_admin_cancel`, `legal_amend`, `legal_mark_superseded`; clone-denied-to-draft; audit.
- Tests: RLS authority per action; e2e.
- Labels: `area:legal`, `phase:4`, `migration`.

**P4-10 Reminders, escalation, expiry**
- Tasks: `legal_expiry_defaults` seed; `legal_request_reminders` state; `legal_reminder_sweep()` (48 h nudge, 5 d escalate, 7 d unissued), `legal_expiry_sweep()`; hourly cron; notification kinds; Action Center nudges; dossier SLA chips.
- Tests: `tests/rls/v186e.test.ts` (idempotent sweeps, sealed-safe payloads).
- Labels: `area:legal`, `phase:4`, `migration`.

**P4-11 Instrument and packet exports**
- Tasks: `pdf.tsx` / `docx.ts` specs for approved instruments (charges, scope, conditions, signatures, verification code = short hash of version id); `legal_export_log` audit; restricted-media rule; `CourtPacketPrint` reuses the spec.
- Tests: vitest spec builders; e2e download.
- Labels: `area:legal`, `phase:4`.

**P4-12 Legal RLS suite consolidation**
- Tasks: retire/adjust `v163`/`v165` to the new graph; ensure DOJ fixtures used; `docs/WORKFLOWS.md`, `DOJ-INTEGRATION.md`, `AUTHORIZATION.md` updated.
- Labels: `area:testing`, `docs`, `phase:4`.

### Phase 5 — Report builder

**P5-01 Report templates in the database**
- Tasks: `report_templates`, `report_template_versions`; seed from `FORM_SCHEMAS` (+ `warrant_return` schema); `reports.template_version_id` backfill + NOT NULL; `ReportsTab` renders from the pinned version; `forms.ts` becomes the seed source only.
- Tests: `tests/rls/v187a.test.ts`; vitest schema validator.
- Labels: `area:reports`, `phase:5`, `migration`.

**P5-02 Template administration UI**
- Tasks: `/admin/report-templates` (Director/Owner publish; BL propose); draft editor for sections/fields/required/review_required; publish/supersede with reason; preview; audit.
- Tests: RLS write authority; e2e.
- Labels: `area:reports`, `phase:5`.

**P5-03 Report review flow and required fields**
- Tasks: `reports.review_status` etc.; `report_submit`, `report_review`, `report_finalize` (required-field and review enforcement, two signatures), `report_reopen(p_reason)` + notify; `report_submitted/returned/finalized/reopened` notifications; `ReportsTab` flow UI; `block_direct_report_finalize` widened to the new columns.
- Tests: `tests/rls/v187b.test.ts`.
- Labels: `area:reports`, `phase:5`, `migration`, `security`.

**P5-04 report_entities and Insert-from-case**
- Tasks: table + RLS; `InsertFromCaseDrawer` (people, vehicles, gangs, locations, evidence, officers, charges, legal requests, related cases, timeline events); edited markers; "which reports mention this record" on dossiers.
- Tests: RLS (never writes source); msw; e2e.
- Labels: `area:reports`, `phase:5`, `migration`.

**P5-05 Rich narrative with mentions**
- Tasks: `RichEditor` mention extension using `EntityPicker`; token format `[kind:id]`; read-only render with `EntityLink`; sealed-safe rendering of unreadable tokens ("Restricted record").
- Tests: vitest markdown round-trip; msw.
- Labels: `area:reports`, `phase:5`.

**P5-06 Six templates**
- Tasks: publish `incident_followup`, `interview`, `arrest_report`, `search_report`, `case_closure` (closure requires tasks done/waived), `warrant_return`; keep `surveillance_report` (observations opt-in only).
- Tests: vitest required-field maps; e2e create each.
- Labels: `area:reports`, `phase:5`.

**P5-07 Report exports**
- Tasks: PDF/DOCX/MD per report with letterhead, signatures, template version; sealed exports sealed version; `REPORT_EXPORTED` audit; restricted-media rule.
- Tests: vitest spec builders; e2e.
- Labels: `area:reports`, `phase:5`.

### Phase 6 — Intel triage

**P6-01 Rejected status**
- Tasks: CHECK + transition table; `field_submission_reject(id, reason)`; restore from rejected = command; client mirrors; submitter receipt shows "closed".
- Tests: `tests/rls/v188a.test.ts`.
- Labels: `area:intel`, `phase:6`, `migration`.

**P6-02 Comments**
- Tasks: `field_submission_comment(id, body, visible_to_officer)`; `field_submission_reviews_ins` → RPC-only; UI thread.
- Tests: RLS.
- Labels: `area:intel`, `phase:6`, `migration`, `security`.

**P6-03 Groups**
- Tasks: `intel_groups`, `intel_group_members`, RPCs, suggestion from `field_submission_repeats`, group → case link; UI.
- Tests: RLS; e2e.
- Labels: `area:intel`, `phase:6`, `migration`.

**P6-04 Extended links and convert**
- Tasks: `field_claim_links` target kinds `narcotic | account | indicator`; `field_submission_convert` with provenance; UI via `EntityCreateSheet`.
- Tests: RLS (provenance recorded; duplicates surfaced).
- Labels: `area:intel`, `phase:6`, `migration`.

**P6-05 Validation mark**
- Tasks: `validated_at/by`, derived flag in `field_submission_counts`; `field_submission_validate(id, note)`; badge.
- Tests: vitest + RLS.
- Labels: `area:intel`, `phase:6`, `migration`.

**P6-06 Notifications and realtime**
- Tasks: `private.intel_notify`; kinds; `field_submission_events` shadow table in the publication; `useActionItems` subscribes; submitter receives `intel_question` only.
- Tests: `tests/rls/v188b.test.ts` (no summary text in events; sensitivity respected).
- Labels: `area:intel`, `phase:6`, `migration`, `security`.

**P6-07 SIB referral cross-links**
- Tasks: "referred to SIB" state on submission (existing `siu_state`), SIB intake shows origin submission when `siu_is_agent`; no shared table.
- Tests: RLS (oversight sees nothing).
- Labels: `area:intel`, `area:sib`, `phase:6`.

**P6-08 Intel RLS suite**
- Tasks: consolidate v188 with jurisdiction, `siu_sensitive`, officer wall, delete dependencies (previously untested).
- Labels: `area:testing`, `phase:6`.

### Phase 7 — Action Center and scheduler

**P7-01 Item state and notification columns**
- Tasks: `action_item_state` + `action_item_set_state` (dismiss refused for decision kinds; snooze ≤ 48 h; audit for command decisions); `notifications.read_at` + index; `markRead` batch via RPC.
- Tests: `tests/rls/v189a.test.ts`.
- Labels: `area:action-center`, `phase:7`, `migration`.

**P7-02 All queue kinds**
- Tasks: builder branches for restricted packet, MDT export, field access, claim verdicts, narcotic suggestions, gang duplicate reviews, tracker co-signs, SIB conflicts/watch reviews, Owner signals, justice applications, surveillance alerts, access expiring, legal comments/escalations, report review, intel kinds; each with a direct action and deep link; bounded queries.
- Tests: `actionItems.test.ts` per kind; RLS for any new read RPC.
- Labels: `area:action-center`, `phase:7`.

**P7-03 Priority and escalation**
- Tasks: `cases.priority` weight; `action_escalation_rules` + `action_escalation_sweep()` hourly; `escalated_at`; `action_escalated` notification; badge.
- Tests: RLS sweep idempotency; vitest scoring.
- Labels: `area:action-center`, `phase:7`, `migration`.

**P7-04 Reassign and bulk**
- Tasks: `action_reassign_task`, `action_reassign_blocker`; bulk bar (read/snooze/dismiss only); reassign dialog; audit.
- Tests: RLS authority; e2e.
- Labels: `area:action-center`, `phase:7`, `migration`.

**P7-05 Saved views and presets**
- Tasks: `savedViews('action')`; presets per role from `my_permissions`.
- Tests: vitest.
- Labels: `area:action-center`, `phase:7`.

**P7-06 Surface consolidation**
- Tasks: `useActionQueue` shared cache; `ActionSlice` in My Dashboard and Command Center; `ApprovalQueue` → preset; retire Phase-1B switcher (or finish as chrome); remove legacy `command/` duplicates; `useNavBadges` derives from the queue.
- Tests: e2e smoke; knip.
- Labels: `area:action-center`, `type:refactor`, `phase:7`.

**P7-07 Minimal notifications and Discord opt-in**
- Tasks: `notification_resolve(ids)`; new kinds store ids only; `notification_titles.json` shared; Discord edge function build imports it; `user_prefs.notif_discord` opt-in per category; `discord-notify` honours it.
- Tests: RLS hydration under lost standing; vitest title map parity; edge function unit test.
- Labels: `area:notifications`, `phase:7`, `security`.

**P7-08 Action Center mobile and a11y**
- Tasks: `useNarrow` card layout, 44 px targets, keyboard bulk selection; a11y ratchet.
- Labels: `area:ui`, `phase:7`, `a11y`.

### Phase 8 — Mobile, Trash, history UI, docs

**P8-01 Mobile case route**
- Tasks: `/m/cases/[id]`; section sheet; cards; quick actions (task add/done, note add, entity add); desktop links; redirect from workspace on narrow viewports; e2e smoke.
- Labels: `area:mobile`, `phase:8`.

**P8-02 Trash view and undo migration**
- Tasks: `public.trash_list`; `/trash`; "Deleted — Undo" toast calling `restore_record`; replace every `deleteWithUndo` call site; remove `deleteWithUndo`.
- Tests: e2e restore; vitest.
- Labels: `area:ui`, `phase:8`.

**P8-03 Permanent-delete UI**
- Tasks: generalized armed dialog (preview, dependency warnings, reason, fresh-session prompt, typed confirm) for cases and registries from Trash; Owner console link.
- Tests: e2e (Owner), negative for command.
- Labels: `area:ui`, `phase:8`, `security`.

**P8-04 History and diff surfaces**
- Tasks: generalize `VersionViewer` + `docDiff` into `RecordHistory` (compare, restore with reason) on dossiers, case overview, notes, reports (drafts), legal drafts, intel.
- Tests: msw; e2e restore.
- Labels: `area:ui`, `phase:8`.

**P8-05 Documentation release**
- Tasks: all items in §14; handbook chapters; user guide; CHANGELOG release; `package.json` version bump.
- Labels: `docs`, `phase:8`.

**P8-06 Restore drill and runbook**
- Tasks: perform and record a backup restore drill on a scratch project; verify audit chain after restore; update `OPERATIONS.md` §5.
- Labels: `area:ops`, `phase:8`.

**P8-07 Mobile narrative report editing**
- Tasks: narrative-only editor on the mobile route with autosave; submit/seal disabled.
- Labels: `area:mobile`, `area:reports`, `phase:8`.

---

## 22. Approval

This plan is complete for implementation once approved. Nothing has been implemented, committed, opened as an issue, deployed, or changed in the database. On approval the first action will be Phase 0, issue P0-01, on a feature branch with one PR per issue.

---

## 23. Design-resource evaluation (post-approval addendum)

Four external resources were reviewed after approval. Verdicts:

| Resource | Verdict | What is adopted |
|---|---|---|
| Vercel `web-design-guidelines` (fetches `web-interface-guidelines/command.md`) | **Adopt** | Vendored as a project skill `.claude/skills/ui-review/` with the rule list checked into the repo (no network dependency in CI/web sessions). Every UI PR from Phase 3 onward runs it against changed `src/components/**` files. A repo probe found concrete gaps the rules catch: 48 files use `outline-none` (each needs a `focus-visible` replacement check), no `<meta name="theme-color">`, no skip-to-content link, no `touch-action` / `overscroll-behavior` on overlays, and zero `Intl.DateTimeFormat` / `Intl.NumberFormat` usage. |
| `awesome-design-md` (DESIGN.md convention from Google Stitch) | **Adopt the convention** | A root `DESIGN.md` distilled from `docs/DESIGN-SYSTEM.md` in the collection's format (Overview → Colors → Typography → Layout → Elevation → Shapes → Components → Do/Don't → Responsive), so any agent working on UI phases reads one file. No visual changes. |
| `taste-skill` (anti-slop landing-page skill) and `image-to-code-skill` | **Not adopted** | Both declare themselves out of scope for dashboards, dense product UI, data tables and multi-step forms (taste-skill §13), which is exactly what the portal is. The image-first pipeline targets marketing pages. |
| `redesign-skill` (from the same repo) | **Partial** | Its audit checklist items already encoded by `docs/DESIGN-SYSTEM.md` (off-black canvas, one accent, one gray family, tabular numerals, hairlines) are kept as-is. Four items join the `ui-review` checklist: skip link, a z-index scale, loading/empty/error state coverage, and a way back from every screen. Its "upgrade techniques" (grain overlays, glassmorphism, parallax, spring motion, gradients) contradict the portal's design rules and are excluded. |

New issues from this evaluation:

**P0-10 UI guideline baseline**
- Purpose: vendor the review skill and fix the cross-cutting gaps once.
- Tasks: add `.claude/skills/ui-review/SKILL.md` + `rules.md`; add a skip-to-content link in `AppShell`; `<meta name="theme-color">` matching `canvas`; confirm `color-scheme: dark` on `<html>`; `overscroll-behavior: contain` on `Modal`/sheet/drawer and `touch-action: manipulation` on `Button`; audit the 48 `outline-none` sites and replace any without a `focus-visible` ring with the shared focus utility; define a z-index scale in `globals.css` and replace ad-hoc values.
- Acceptance: a11y spec green; every interactive primitive shows a focus ring on keyboard focus; no `outline-none` without `focus-visible`.
- Tests: a11y ratchet; storybook a11y for primitives.
- Labels: `area:ui`, `phase:0`, `a11y`.

**P0-07 (extended)**: also add the root `DESIGN.md`.

**P8-08 Intl formatting sweep**
- Purpose: replace hand-rolled date/number formatting with `Intl.*` through `src/lib/format.ts`.
- Tasks: route every date/time and count render through `format.ts` helpers built on `Intl.DateTimeFormat` / `Intl.NumberFormat`; hydration-safe rendering for timestamps; `translate="no"` on identifiers (case numbers, plates, request numbers).
- Acceptance: no ad-hoc `toLocaleDateString` / manual padding outside `format.ts`.
- Labels: `area:ui`, `phase:8`.

Issue count after addendum: 81.

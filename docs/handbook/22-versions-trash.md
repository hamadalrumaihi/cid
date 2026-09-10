# Chapter 22 — Versions, Trash and the scheduler

[← Handbook index](README.md)

Three mechanisms the Portal Improvements plan (Phases 0–8, release 1.18.0)
added underneath every screen: **nothing a browser session does destroys a
row** (soft delete + the Trash), **every covered edit leaves a version**
(record history + restore), and **the database runs its own maintenance on a
clock** (pg_cron). This chapter is the developer's map; the authority rules
are in [`docs/AUTHORIZATION.md`](../AUTHORIZATION.md) §8–§12 and §20, the
member's view in [`docs/WORKFLOWS.md`](../WORKFLOWS.md) §13–§14.

## 22.1 Soft delete — the vocabulary

Twenty-seven **kinds**, each a table: the 15 registries (`person`, `vehicle`,
`gang`, `place`, `account`, `indicator`, `narcotic`, `operation`, `tracker`,
`gang_member`, `gang_turf`, `person_place`, `person_vehicle`,
`person_relationship`, `account_link`), the 10 case tables (`case`, `report`,
`media`, `evidence`, `case_task`, `case_message`, `case_intel_link`,
`case_blocker`, `rico_case`, `predicate_act`) and the Phase 3 pair
(`case_note`, `case_link`). The server's map is
`private.soft_delete_table(kind)`; the client's is `SOFT_DELETE_KIND` in
`src/lib/db.ts` (table → kind) — `tests/msw/permission-semantics.test.ts` and
`src/mocks/handlers/trash.test.ts` pin the two in sync.

Each table carries `deleted_at / deleted_by / delete_reason / delete_batch`.
The `SELECT` and `UPDATE` policies were re-emitted with
`(private.is_live(deleted_at) or private.is_owner())` prepended — a deleted
row exists only for the Owner and for the definer RPCs; the `DELETE` policy
is dropped and the privilege **revoked** (a client DELETE is `42501`); a
non-definer `BEFORE INSERT OR UPDATE` trigger (`private.block_direct_soft_delete`)
refuses any client write to the four columns. So there are exactly two
paths:

| RPC | What | Authority |
|---|---|---|
| `soft_delete(kind, id, reason)` | marks the row and cascades to its **exclusive** children (a case: reports, media, evidence, tasks, messages, intel links, blockers, RICO material, notes, links; a person: its link rows; …) under one `delete_batch`. A reason is required for the parent kinds (`REASON_REQUIRED` in db.ts). Refuses under an active legal hold (`held`). Returns `{ok:false, code}` — never raises — so the `PERMISSION_DENIED` row commits. | `can_record('soft_delete', kind, id)` = the former `*_del` predicate, verbatim (`private.perm_registry_delete`) |
| `restore_record(kind, id, reason)` | brings the row back; a parent kind brings its batch; a child comes back only under a live parent (`parent_deleted`). | the same delete authority, or the Owner |

Client: `list()` / `countRows()` filter these tables to live rows
(`includeDeleted` opts in); `remove()` routes to `soft_delete`;
`src/lib/deleteRecord.ts` is the **one delete helper** — confirm → reason
prompt when required → `soft_delete` per row → the toast "<Label> deleted ·
In Trash" with **Undo** (`restore_record`) and an "Open Trash" link. The
former `deleteWithUndo` and its snapshot-and-reinsert branch are gone; only
`case_templates` and `commendations` (a plain confirmed `remove()`) and
`case_assignments` (an unassignment through `case_assignment_end` — Bureau
Lead+, stamps `removed_at` / `removed_by`, `CASE_UNASSIGNED`; the client can no
longer set `removed_at`) do not soft-delete. A task's delete does not cascade
to its sub-tasks.

## 22.2 The Trash

`public.trash_list(p_kind default null, p_limit default 300)` (SECURITY
DEFINER, `20261102120000`) walks every kind — or the one asked for — with one
`execute format(...)` per table over `deleted_at is not null` and **keeps a
row only when `private.perm_dispatch('restore', kind, id)` holds for the
caller**. That single rule is the whole access model of the Trash: a
detective sees the case material they authored on cases they reach, the
links they created and any account link; command sees every deleted row of
the cases they reach and the registry rows; narcotics are the Owner's; the
Owner sees everything; an inactive caller sees nothing. Each row is
projected — `kind, id, label, case_id, case_number, deleted_at, deleted_by,
deleted_by_name, delete_reason, delete_batch, restorable, permanently_deletable`
— never the record itself: `label` is `private.permanent_delete_record_label`
(case_number → name → plate → title → label → item_code → value → code →
the id), `case_id` comes from `private.trash_case_expr` (the case, the row's
`case_id`, the RICO parent's case), `permanently_deletable` is
`private.is_owner()`. `p_limit` is clamped 1–500 across all kinds, newest
first; an unknown kind raises `unknown record kind`. The security review
added two walls: a case child is listed only while the caller can still
**read** the case (`private.can_read_case`), and a restricted media row only
for the Owner. `trash_count()` counts to 100 — the Sidebar badge (99+
beyond). The catalog row is `('list','trash')`
and the `perm_dispatch` arm `trash · list = private.is_active()`.

Client (`src/lib/trash.ts`, `src/components/trash/TrashView.tsx`, route
`/trash` in the Oversight category next to Audit): `fetchTrash(kind?)`,
`TRASH_GROUPS` (Cases / Case material / Registry / Links), `trashRowLabel`,
`trashHref` (the deep link to where the row lives once restored),
`restoreFromTrash` → `restoreRecord` (translating `parent_deleted` into
"Restore the record this belongs to first"), the badge store
(`useTrashCountStore`, `bumpTrash()` after a delete / undo / restore). The
view refreshes on focus, after an action and every 60 s — twenty-seven tables
is too broad for `useTableVersion`. The Owner's **Permanently delete…** runs
inline from the row (`shared/RecordPermanentDelete.tsx`, the generalised
armed protocol: preview → arm with a fresh session and a reason → the typed
`DELETE <label>` typed into a real confirmation field and passed verbatim to
`_execute`, every server error verbatim); everyone else never
sees the button and RLS refuses anyway.

## 22.3 Record history and restore

`record_versions` (`20261011120000`): a definer `AFTER UPDATE` trigger
(`private.version_row`) writes `old`, `new`, `changed_fields`, `actor_id`,
`reason`, `source` for cases, persons, vehicles, gangs, places, accounts,
narcotics, evidence, reports (unsealed only), legal requests (draft columns),
field submissions and case notes; same-actor bursts inside five minutes
coalesce into one version; noise columns (`updated_at`, the lifecycle
columns, generated keys) never version. The table's policy is
`private.version_visible` — **SECURITY INVOKER**, "can you see the parent
row?" under the caller's own RLS — and there is no client write.

| RPC | What | Authority |
|---|---|---|
| `record_history(kind, id)` | the versions, newest first | as the parent row |
| `restore_version(kind, id, version_no, reason)` | writes the version's `changed_fields` back as an ordinary UPDATE (minus RPC-governed columns), so it lands as a **new** version with `source='restore'`; `RECORD_VERSION_RESTORED` | `can_record('restore_version', kind, id)` = the edit authority, and a reason |

Client: `src/lib/recordHistory.ts` (`historyRows`, `versionChanges`,
`compareVersions`, `VERSION_KINDS`) and `shared/RecordHistory.tsx` — field
changes per version (jsonb / long text through `DiffView`), **Compare** any
two, **Restore this version** only when `canRestore` (the caller passes the
`can_record` answer or the local edit mirror). Mounted on the person /
vehicle / gang dossiers, the case Overview ("History" disclosure), notes,
report drafts (sealed reports keep the read-only viewer), draft legal
requests (compare only) and intel records; `VersionViewer` stays for SOP
document versions. Retention: `private.record_versions_prune()` — older than
two years, never the latest five per record, never a record on an open case
or under a legal hold — runs daily.

## 22.4 Permanent deletion

The Owner's armed protocol is the only way a row leaves the database
(`20261013120000`, generalising Phase B's member protocol): the record must
already be in the Trash (a case may also be archived); `permanent_delete_record_preview`
walks every foreign key pointing at it (**blockers** — live dependants and
an active hold; **destroyed** — the batch and cascade keys; **unlinked** —
SET NULL keys; storage paths), `_arm` needs `private.assert_fresh_session()`
and a reason and mints a 5-minute single-use `deletion_tokens` row, `_execute`
needs the token and the exact `DELETE <label>` and writes
`deleted_record_ledger` (Owner-readable) before deleting leaf-first. The
database cannot delete storage objects — they are enumerated for the client.
`case_permanent_delete` is a wrapper over the same apply.

## 22.5 The scheduler

`20261004130000_scheduler_pg_cron` declares `pg_cron` + `pg_net` in the repo
(pg_net had been missing since the 2026-09-01 restore) with the
`scheduled_job_runs` ledger and `private.job_begin(name)` /
`job_end(run, status, detail)` around every job. Each job is a thin
`private.*_job()` around an idempotent `private.*_sweep()` so a manual re-run
after a gap is safe, and each notifies through the same test-actor-suppressing
notifier its RPC family uses.

| Job | Schedule | Does |
|---|---|---|
| `sops-sync` | every 15 min | Drive → SOPs through pg_net (secret from `app_secrets`) |
| `audit-chain-verify` | 03:15 daily | walks the `audit_log` hash chain; `audit_chain_mismatch` to the Owner on the first bad row; `audit_chain_status()` reads the result |
| `record-versions-prune` | 03:45 daily | `private.record_versions_prune()` (22.3) |
| `access-grant-expiry-sweep` | :20 hourly | `access_expiring` three days out, `ACCESS_EXPIRED` + removal on lapse |
| `siu-reconcile-scan` | every 15 min | late collisions between CID-visible and SIB-hidden records → `siu_reconcile_queue` |
| `legal-sweep` | :35 hourly | nudge / escalate / unissued / expiring reminders, warrant expiry → MDT `expired` |
| `action-escalation-sweep` | :50 hourly | the enabled `action_escalation_rules` → one `action_escalations` row per source, `action_escalated` on (re)open |

Manual runners for the Owner: `legal_sweep_run()`, `action_escalation_run()`
(both `{ok:false, code:'denied'}` for anyone else); the RLS suite drives the
escalation ladder through the fixture-scoped `rls_test_escalation_run(case)`.
The operations view — what to check, how to re-run — is
[`docs/OPERATIONS.md`](../OPERATIONS.md) §6 "Scheduled jobs".

## 22.6 Tests

`tests/rls/v180a` / `v180b` (soft delete + restore), `v183` (versions), `v185`
(the protocol), `v190a` (the Trash); MSW `src/mocks/handlers/trash.ts`
(`trash_list` / `trash_count` over the mock store with the restore-authority
rule) and `rpc.ts` (`soft_delete` / `restore_record`), `caseWorkspace.ts`
(`record_history`); unit `src/lib/trash.test.ts`, `deleteRecord.test.ts`,
`recordHistory.test.ts`; e2e `tests/e2e/trash.spec.ts` (delete → Undo →
`/trash` → Restore).

## 22.7 Traps

- **Never `.delete()` a soft-deletable table from the client** — the
  privilege is revoked; use `deleteRecord` / `remove()` and let the RPC decide.
- **Never write the lifecycle columns** — the freeze trigger refuses even the
  Owner (`P0403`); a restore is `restore_record`.
- **Do not filter the Trash on the client** — the server already returned
  exactly the restorable rows; a client filter can only hide something the
  member is allowed to restore.
- **A deleted case's children are listed** and their restore answers
  `parent_deleted` — restore the case, not the child.
- **A version is a projection of the parent's policy** — if a screen shows a
  version of a row the viewer cannot read, the bug is upstream, in the read.
- **Cron jobs must stay idempotent** — a job that notifies on every run pages
  people on every cron gap recovery.

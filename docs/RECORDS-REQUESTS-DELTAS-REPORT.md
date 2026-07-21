# Records & Requests Domain — Delta Implementation Report

**Branch:** `claude/continue-previous-7pqwjg` · **PR:** [#193](https://github.com/hamadalrumaihi/cid/pull/193) (draft, open)
**Date:** 2026-07-21 · **Spec:** `docs/RECORDS-REQUESTS-SPEC.md`
**Status:** 6 of 7 deltas shipped, applied to the live `cid` Supabase project, and RLS-verified.

---

## 1. What this was

A requirements Q&A (Batches 8–14) defined the "records & requests" domain. Rather than
build blind, we first **grounded every requirement against the real codebase** and wrote a
decision log + gap analysis (`docs/RECORDS-REQUESTS-SPEC.md`). That analysis found the
majority of the domain already existed (legal requests, MDT projections, person/vehicle/media
registries, global search, indicators, notifications, tombstone deletion) and isolated the work
into **seven net-new deltas, D1–D7**.

We then shipped them one at a time, each end-to-end: **migration → RLS policy/RPC → snapshot +
types mirror → RLS test suite → offline gates → apply to live Supabase → live RLS verification →
UI**. Security-sensitive changes were reviewed by the security-reviewer agent before apply.

---

## 2. Position now — delta scoreboard

| Delta | Feature | Migration | RLS suite (live) | UI | Status |
|-------|---------|-----------|------------------|----|--------|
| **D7** | Legal hold blocks permanent deletion (Owner can't override) | `20260807190000` | `v147` 8/8 | Hold banner, place/lift, delete guard | ✅ Shipped |
| **D3** | Warrant execution outcome + seized-items inventory | `20260807200000` | `v148` 10/10 | Outcome buttons, seized-items panel | ✅ Shipped |
| **D4** | MDT export controls (propose→approve→clear) | `20260807210000` | `v149` 9/9 | Exports panel on BOLO board | ✅ Shipped |
| **D1** | Account registry (handles, links, confidence) | `20260807220000` | `v150` 8/8 | Registry view, person section, graph nodes | ✅ Shipped |
| **D2** | Accounts in global search (dup-check) | `20260807230000` | (search executes clean live) | Search palette + section | ✅ Shipped |
| **D6** | Restricted-media view-audit + break-glass | `20260807240000` | `v151` 9/9 | Break-glass banner, view-audit | ✅ Shipped |
| **D5** | High-priority Discord + daily digest notifications | — | — | — | ⏸ Deferred (infra) |

**Six migrations applied to the live `cid` project; five dedicated RLS suites pass live
(v147–v151); D2's search branch executes clean live.** Latest Vercel preview deploy is **Ready**.

---

## 3. What each delta delivers

### D7 — Legal hold
A command-placed (`is_command`) hold on a case that **blocks `case_permanent_delete` even for the
Owner** — the one deletion path that otherwise overrides everything. `legal_holds` table +
`legal_hold_place` / `legal_hold_lift` RPCs; `case_delete_preview` surfaces `active_hold` so the UI
warns before the modal. UI: a hold banner on the case header with place/lift affordances and a
delete guard.

### D3 — Warrant execution outcome + seized items
`legal_requests.execution_result` typed as `full | partial | unable`. `record_warrant_execution` was
reworked (dropped + recreated with a new `p_result` argument; `'unable'` keeps the warrant issued
rather than marking it executed). New `legal_seized_items` table with add/remove RPCs for a
structured inventory. UI: outcome buttons in the decision panel + a seized-items panel in the
request dossier.

### D4 — MDT export controls
A Lead+-gated **propose → approve → clear** outbox (`mdt_exports`) for pushing BOLOs / caution flags
to the MDT. Case existence stays hidden from patrol — the gate is on the export row, not the case.
FKs are `ON DELETE CASCADE` so deleting a BOLO'd person/vehicle cleans up its export rows (a design
fix caught in review: `SET NULL` would have violated the target-not-null CHECK and poisoned
cleanup). UI: an exports panel on the BOLO board.

### D1 — Account registry
Social/online accounts as **first-class, person-linked intel**: `accounts` (with a generated
`handle_normalized`), `account_handles` (username history via an insert trigger), and `account_links`
(person↔account with a `suspected → probable → confirmed` confidence ladder + a confirm-stamp
trigger). UI: a full Account Registry view (Intelligence → Registries → Accounts), a linked-accounts
section on the person profile, and accounts rendered as nodes in the network graph.

### D2 — Cross-registry dup-check
The accounts registry is surfaced in **global search** — `search_all` gained one `'account'` branch
(re-emitted verbatim + the new branch, never hand-reconstructed), and the frontend
`SEARCH_KINDS` / command palette route account hits to `/accounts`. A returned handle now spots
existing accounts before a duplicate is created.

### D6 — Restricted-media hardening
Restricted media was previously visible only to narcotics command. This adds **accountability
without a wall**:
- `restricted_access_log` — append-only audit of every view + break-glass event (command-readable).
- `restricted_access_grants` — case-scoped, **24-hour**, read-only emergency grants.
- `has_media_break_glass()` (SECURITY DEFINER) widens `media_sel` by **one clause** — view only;
  `media_upd` is untouched.
- RPCs: `log_restricted_view` (de-duped per viewer/hour), `restricted_media_count` (gated on
  `can_access_case`, so the UI can offer break-glass without leaking the rows),
  `restricted_media_break_glass` (requires case access + a mandatory reason → grant + audit +
  notifies active command).
- UI: a break-glass banner on the case Media tab that appears **only when restricted items are
  actually hidden** from the viewer (server count minus rows they can load); a mandatory-reason
  modal; and `log_restricted_view` fired when a restricted item's lightbox opens.

Security review of D6 came back **CLEAN**. Break-glass is bounded: the caller must already have
case access, it's time-boxed, read-only, reasoned, notified, and audited — accountability, not
prevention, is the control (the owner's explicit decision, with a 24h TTL they chose).

---

## 4. How it was verified

- **Offline gates, green throughout:** `check:freshness`, `check:schema`, `npm run typecheck`,
  `npm run lint`, `npm run build`.
- **Live RLS suites** run against the real `cid` project after each apply:
  `v147` 8/8 · `v148` 10/10 · `v149` 9/9 · `v150` 8/8 · `v151` 9/9.
- Each migration was **mirrored** into `supabase/schema-snapshot.sql` and
  `src/lib/database.types.ts` before commit (freshness + schema gates enforce this).
- Vercel preview deploy on the latest commit: **Ready**.

**Screenshots were intentionally not captured** — a live UI walkthrough would create and delete
real records in the production database. The UI is thin and wired to already-live-verified RPCs.

---

## 5. Notable decisions & fixes along the way

- **Apply exact file content, never hand-reconstruct.** A D2 live apply failed
  (`column r.title does not exist`) when a large function was reconstructed from a partial grep.
  Fix: apply the migration file's verbatim contents. Internalized as a rule.
- **D4 FK design fix (review-caught):** `SET NULL` on export FKs would violate the target-not-null
  CHECK and abort deletes / poison RLS cleanup → changed to `CASCADE`.
- **D3 signature change:** couldn't `CREATE OR REPLACE` with new params → `drop` + recreate with the
  new `p_result` argument.
- **CI discipline:** migration-only checkpoint commits red-lighted the freshness gate → we now hold
  the migration until its mirror lands and commit them together.

---

## 6. Deferred follow-ups (documented in the PR)

- **D5 — notifications:** Discord-for-high-priority + daily digest need a Discord edge-function
  redeploy + scheduled-job infra (no `pg_cron` / `pg_net` in this project). Code-only parts
  (per-type default deadlines, deadline-clock pause) also remain.
- **D2 automation:** auto-parse return content → Intelligence-Review items; return-driven
  account-ownership auto-confirm hook. The confidence ladder + confirm-stamp trigger already exist;
  this overlaps the Indicators registry and warrants its own design pass.
- **D6 optional tightening:** break-glass currently reaches any member with case access
  (bureau/JTF-wide, by design). Could be narrowed to case assignees/leads if preferred. The
  packet-approval workflow is not built (it depends on the D2 return-extraction model).

---

## 7. Bottom line

The records & requests domain is **substantially complete**. Six of seven deltas are live,
tested, and on a green preview; the seventh (D5) is blocked only on scheduling/notification
infrastructure, not on application logic. PR #193 is ready for review — the remaining items are
scoped, documented, and independent.

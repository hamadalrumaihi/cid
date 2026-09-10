# Chapter 23 — Confidential Informants

[← Handbook index](README.md)

The Confidential Informant compartment (migration
`20261103120000_confidential_informants`) is the first feature in the portal
whose *absence* is part of its contract: a member who is neither a handler
nor CI command must not be able to tell that it exists. This chapter is the
developer's map. The authority rules are in
[`docs/AUTHORIZATION.md` §21](../AUTHORIZATION.md), the member's view in
[`docs/WORKFLOWS.md` §15](../WORKFLOWS.md) and
[`docs/USER-GUIDE.md` §K](../USER-GUIDE.md).

## 23.1 The one rule

```
canAccessCI(user, ci) = hasFullCIAccess(user) OR isAssignedHandler(user, ci)
```

- `private.has_full_ci_access(p_user)` — active, unremoved, and (Owner, or
  role ∈ bureau_lead / deputy_director / director, or an active
  **non-oversight** SIB member — `private.siu_membership_role(uid)` is not
  null). `director_oversight` standing alone is *not* full access.
- `private.ci_is_active_handler(p_ci, p_user)` — a `ci_handlers` row with
  `ended_at is null` for an active profile.
- `private.can_access_ci(p_ci, p_user)` — the disjunction; a soft-deleted CI
  only for full access.

Every SELECT policy on the fourteen CI tables and every `ci_*` RPC's read and
write gate is this predicate. **There is no second wall.** If you find
yourself writing a new CI predicate, stop — extend the existing one.

The discipline that goes with it: an unauthorized caller gets **nothing**.
`ci_get` → `null`, `ci_stats` → `null`, `ci_person_status` → `null`, the
table RPCs → zero rows, `ci_context()` → exactly
`{full_access:false, is_handler:false}`. Never a `{ok:false, code:'denied'}`
on a read, never a lock, never a count. Writes raise `P0403`
(`private.perm_raise`) — and an unauthorized write against a real CI and a
write against a random id raise the **same** message, so a refused caller
learns nothing about the row's existence.

## 23.2 Tables

Fourteen tables, all with `enable row level security`, **SELECT policies
only** — no client INSERT / UPDATE / DELETE policy or grant (a client write is
`42501`). Every write is a `security definer` RPC.

| Table | Policy | Notes |
|---|---|---|
| `confidential_informants` | `can_access_ci(id)` | `ci_number` `'CI-0001'` from `private.ci_number_seq`; `person_id` **unique where live**, `on delete restrict`; status / motive / reliability / risk vocabularies as CHECKs; soft-delete columns |
| `ci_handlers` | `can_access_ci(ci_id)` | `role` primary / secondary, one live row per role and per user; `counts_toward_capacity`; `ended_*` |
| `ci_handler_capacity` | own row or full | `limit_override` 1–30, `expires_at`, `request_id` — the only stored capacity fact |
| `ci_capacity_requests` | requester or full | `kind` capacity / assignment; `current_count`; `status` pending → approved / denied / returned / withdrawn; `created_ci_id` |
| `ci_intelligence` | `can_access_ci(ci_id)` | `handler_id`, `case_id`, reliability + **corroboration** (separate), sensitivity, follow-up; soft-delete |
| `ci_intelligence_links` | through the intel's CI | `kind` person / vehicle / gang / place / narcotic / evidence / media |
| `ci_contacts` | `can_access_ci(ci_id)` | method, summary, `next_contact_at`, `restricted_notes`; soft-delete |
| `ci_assessments` | `can_access_ci(ci_id)` | reliability / credibility / access / risk / compromise_likelihood / usefulness |
| `ci_payments` | `can_access_ci(ci_id)` | recordkeeping; `approved_by`; soft-delete |
| `ci_case_links` | `can_access_ci(ci_id)` | one live link per (ci, case); `unlinked_*` |
| `case_intel_releases` | `can_read_case(case_id) and (revoked_at is null or full)` | **the visible, sanitized record** — title, body, handling; carries **no** CI or intel column |
| `ci_releases` | `can_access_ci(ci_id)` | the restricted link intel → release |
| `ci_audit_events` | through the CI; else full / the actor / the request's requester | the compartment's ledger — **never `audit_log`**; immutable (BEFORE UPDATE OR DELETE trigger raises) |
| `ci_events` | through the CI; else own `user_id` / full | the realtime shadow — `id, ci_id, user_id, kind, at` only; in `supabase_realtime` |

`persons` gets **no column**. The one existing public label
`persons.classification = 'informant'` is legacy: it is removed from
`PERSON_CLASSIFICATIONS` (no new row can carry it) and kept rendering for the
one existing row until cleaned by hand.

Capacity is **derived**: `private.ci_capacity(user)` = 6 unless a live
override; `private.ci_active_count(user)` = live handler rows on active,
non-deleted CIs that count. Leaving `active` frees capacity — nothing is
written.

## 23.3 RPCs

Thirty-five public functions plus the fixture runner, all
`security definer set search_path to ''`, granted to `authenticated`, revoked
from `public` / `anon`. The full table with every authority and refusal is
[AUTHORIZATION §21](../AUTHORIZATION.md); the shape to remember:

- **Reads** — `ci_context`, `ci_list`, `ci_get`, `ci_stats`, `ci_case_intel`,
  `ci_case_counts`, `ci_search`, `ci_person_status`, `ci_audit_list`,
  `ci_export`: filtered or null, never a raise.
- **Handler writes** — `ci_create` (self as primary, no secondary),
  `ci_update` (not bureau / supervising lead), `ci_contact_log/_update/_delete`,
  `ci_assess`, `ci_intel_create/_update/_set_corroboration/_links_set/_delete`,
  `ci_case_link/_unlink`, `ci_payment_record`, `ci_capacity_request_submit`
  (`capacity` needs to be a handler), `_withdraw`.
- **Full-only writes** (`P0403` otherwise) — `ci_create` for another
  handler, `ci_set_status`, `ci_handler_set`, `ci_handler_remove`,
  `ci_capacity_request_decide`, `ci_capacity_set`, `ci_release`,
  `ci_release_revoke`, `ci_payment_approve`, the roster `ci_export`.
- **Owner** — `ci_sweep_run()` (`{ok:false, code:'denied'}` style).
- **Fixture** — `rls_test_ci_sweep(p_ci)`.

Validation refusals are jsonb `{ok:false, code, message}`. The ones with a
fixed wording (the client shows them verbatim):

| code | message |
|---|---|
| `unavailable` | `This person cannot be designated right now.` — one wording for a taken, merged, deleted or invisible person, for every caller |
| `capacity` (non-full caller) | `You are at capacity (n / c). Request additional capacity or an assignment.` |
| `capacity` (full caller, no reason) | `<name> is at capacity (n / c). Confirm the override with a reason.` |
| `primary_required` | `Assign a new primary handler first` |
| `unsanitized` | `The text names the source — remove the CI number, name, alias or handler.` |

**Capacity override.** With `p_override_reason`, `ci_create` /
`ci_handler_set` proceed at capacity, write `CI_CAPACITY_OVERRIDE` (the reason
in `detail`) to `ci_audit_events` and raise the handler's `limit_override` to
the new count. An approved **assignment** request does the same with
`'Approved assignment request <id>'` as the reason.

**Sanitize / release.** `ci_release` (full only) runs
`private.ci_sanitized(ci, title || body)` — false when the text contains the
CI number, the person's name or alias, the CI alias or a handler's display
name — then inserts `case_intel_releases` (visible) + `ci_releases`
(restricted), audits `CI_INTEL_RELEASED` and notifies the case lead with
`case_intel_released {case_id, release_id}` — a kind that names no CI. The
original intelligence row is untouched. The client's `sanitizeCheck` is a
cosmetic preview of the server rule, never the gate.

## 23.4 The leak surfaces

Each of these is a place the portal already shows shared data; each is closed
in SQL, and `tests/rls/v191c.test.ts` pins every one.

| Surface | Why it could leak | How it is closed |
|---|---|---|
| `audit_log` → `case_audit_feed` | any row with `detail->>'case_id'` = the case is shown to every case reader | CI RPCs write `ci_audit_events` and **never** `audit_log`; `case_audit_feed` additionally excludes `entity = 'confidential_informants'` / `like 'ci\_%'` |
| `search_all` | a CI arm would confirm a number | no CI arm; the palette calls `ci_search` only for an involved caller; the person is an ordinary hit |
| `entity_suggest` / `entity_crossref` | an edge person → CI | there is no such edge; `persons` has no CI column |
| `notifications` | a title or payload could name a source | ids only (`action_notify` strips text keys); recipients are handlers / reviewers alone; `notification_resolve` labels by `ci_number` only when `can_access_ci` |
| Discord DMs | the edge function relays notifications | every `ci_*` kind is `"destination": "portal"` (category `informants`) in `src/lib/notificationTitles.json`; the edge function returns `skipped: portal-only` first; the category is never in the opt-in list |
| Realtime | a shadow row is a fact | `ci_events` carries ids only and is read behind `can_access_ci`; a handler change moves the row's visibility with it |
| The Trash | a label could be a name | `trash_list` labels a CI by number; the child kinds carry an explicit `can_access_ci(x.ci_id)` conjunct |
| The case tab | a locked tab is a count of one | the `ci` tab exists only when `ci_case_counts` > 0 — never rendered with a 0 / null count, never in More… |
| The dossier | a card is a fact | `PersonCiPanel` renders nothing on a null `ci_person_status` |
| `record_versions` | a version row is a fact | not attached to CI tables; the history is `ci_audit_events` |

## 23.5 Client map

- `src/lib/ci.ts` — the ONE CI module: vocabularies + labels,
  `CI_DEFAULT_CAPACITY = 6`, `capacityLabel(active, capacity)` →
  `"2 / 6 Informants"`, `useCiContext()` (module-level store, one
  `rpc('ci_context')` per session, refetched on `useTableVersion('ci_events')`
  and auth change, any error → `NO_CI`), `ciInvolved(ctx)`, `getCiContext()`
  (non-hook getter for the queue), the typed RPC wrappers, `ciHref(id, s?)`.
- `src/lib/ciModel.ts` — pure helpers with unit tests (`isAtCapacity`,
  `contactState`, `groupHandlers`, `sanitizeCheck`, `motiveSummary`).
- `src/components/informants/**` — `InformantsView` (`/informants`; not
  involved → the "Nothing here." surface, no mention of informants),
  `CiProfile` (`?ci=`, sections via `?s=`), `AddCiWizard` (the capacity
  warning step with **Assign with authorization**), `ReassignHandlerDialog`,
  `RemoveHandlerDialog`, `StatusDialog`, `ContactLogDialog`, `IntelDialog`,
  `AssessmentDialog`, `PaymentDialog`, `CapacityRequestDialog`,
  `AssignmentRequestDialog`, `CiRequestsPanel`, `SanitizeReleaseDialog`.
- `src/components/cases/tabs/CiIntelligenceTab.tsx` (+ `useCiCaseCount`),
  `cases/sections/CaseReleasedIntel.tsx` (the `ReleasedIntelligence` idiom —
  renders nothing when empty), `persons/PersonCiPanel.tsx`.
- Nav: `PAGE_META.informants`, `TAB_LABEL.informants = 'Informants'`,
  Investigations category; Sidebar / Subtabs / BottomNav render the leaf only
  when `ciInvolved`. Visits are never pushed to recents or pins.
- Action Center: `ci_contact_due` / `ci_capacity_request` / `ci_intel_followup`
  sources, fetched only when involved; `ci_request:` keys are decisions.

## 23.6 The sweep

`private.ci_sweep()` — cron `ci-contact-sweep` at `40 * * * *` inside
`job_begin` / `job_end`: active CIs with `next_contact_at < now()` and no
`ci_contact_overdue` in 24 h → the active handlers; active CIs silent for 30
days → handlers + supervising lead (`detail: 'silent_30d'`); `ci_event('overdue')`.
Owner re-run: `ci_sweep_run()`. See [OPERATIONS.md](../OPERATIONS.md).

## 23.7 Tests

| Suite | Proves |
|---|---|
| `tests/rls/v191a.test.ts` | the access model — cases 1–6, 13–21, 30–32, 35 |
| `tests/rls/v191b.test.ts` | capacity 6, the two `capacity` wordings, request → approve → override — cases 7–12 |
| `tests/rls/v191c.test.ts` | the leak surfaces, export, sanitize / release, `ci_case_counts` — cases 22–29, 33, 34 |
| `src/mocks/handlers/ci.ts` + `ci.test.ts` | the offline contract: every RPC over the in-memory store, `visibleCiRows` for the fourteen tables, 42501 on every write |
| `tests/e2e/informants.spec.ts` | the normal detective sees no nav item and nothing at `/informants`; the lead the roster; the handler *My Informants: 1 / 6* |

Fixture hygiene: `rls_test_cleanup()` is spliced before the reports anchor —
ahead of the persons purge, because `person_id` is `on delete restrict`.

## 23.8 Common mistakes

- **Answering "denied" on a read.** A CI read that is not permitted returns
  `null` / zero rows. A `{ok:false}` on `ci_get` tells the caller the row exists.
- **Writing to `audit_log`.** It surfaces through `case_audit_feed`. Use
  `private.ci_audit`.
- **A tab with a lock.** The `ci` case tab is present with a count or absent.
- **A second predicate.** New CI surface → `private.can_access_ci`. Nothing
  else.
- **Free text in a notification payload.** `action_notify` strips it, but do
  not rely on that — pass ids.
- **Confusing `siu_sources` with the compartment.** SIB's tradecraft table is
  SIB's own, surfaced on the dossier as codename + status. The CI compartment is
  the department programme; SIB members have full CI access by standing, CID
  command has no access to `siu_sources`.

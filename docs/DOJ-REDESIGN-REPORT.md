# DOJ / Justice Portal Operational Redesign — Completion Report

Branch `claude/continue-previous-7pqwjg`, PR #178, base `main` @ 1fff1e4 (PR #177).
Companion to the pre-implementation audit in `docs/DOJ-REDESIGN-AUDIT.md`.
Fictional GTA-RP portal; interface/workflow-clarity work only — no real-world
legal content, no change to any real-world rule.

## 1. What shipped, per phase

| Phase | Commits | Delivered |
|---|---|---|
| 1 — Foundation | f94e579 | `src/lib/legalWorkflow.ts` pure deterministic model (stages, disposition, urgency, deadlines, routing explanation, claim eligibility, approval matrix, grouping) + `LegalStageTracker` + `LegalRequestCard` + card registry on the investigator landing. 34 unit tests. |
| 1b — Backend gaps | b485090 | Migration `20260806010000_legal_structured_targets`: exhibit kinds `vehicle`/`place`/`prior_legal_request`, per-target `rationale`, version `change_summary` + server-derived `returned_from`; three definer RPCs extended with defaulted params (all legacy call shapes unchanged). Applied to prod. |
| 2 — Unified dossier | 49e4570 | `LegalRequestDetail` rebuilt (1011→450 lines + `justice/dossier/*`): breadcrumbs → command header with stage tracker → metric strip → deep-linkable `?section=` tabs (Summary/Request/Supporting/Review/Decision/Service & Return/Activity) → role decision panel replacing the button-wall → court-packet print export. One shared component for CID + every Justice seat. |
| 3 — Investigator landing | 6f7103f | `/legal` Overview (metrics, urgency-ranked needs-attention, activity rail) / Requests (card registry + filters); guided create wizard (type cards → case & target → details → narrative → review) with structured search-warrant targets + change-summary on resubmission; bounded debounced case/person/vehicle/place/prior-request pickers replacing load-all registries. |
| 4 — Justice portal | 0c8fe9a | `JusticePortalView` on `?view=` sub-views: Overview, Requests, Assigned-to-me (judge docket + distinct parallel-lane "Available to claim" group), Issued / Service & Returns event cards, Roster & Coverage cards (routing-gap warnings), Applications review drawer. `prosecutorBureaus` wired → the bureau-awareness lane ("notified, not a gate") is live and never counts as action items. |
| 5 — Cross-cuts | d54b5ff | Vehicle/place Legal sections from structured targets (RLS-trimmed, rationale shown); prior-request chips + "Referenced by" in the dossier; Action Center legal branch folded through `dispositionFor` (awareness/claimable excluded from urgent work); search legal sublabels model-driven. Notifications verified already correct. |
| 6 — Verification | 9effbe1, d174ca7, dc9117d, this commit | E2E suite rewrite + 16 new flows + fixture pipeline + screenshot harness; security-review fixes; two product-bug fixes (below); RLS v137. |

## 2. Backend changes (the complete list — everything else is UI)

1. `20260806010000_legal_structured_targets` — additive schema + three RPC
   signature extensions (defaulted params; legacy shapes verified live).
2. `20260806040000_legal_cid_reviewer_visibility` — one narrowly-scoped
   predicate branch fixing a **pre-existing stall found by verification**:
   warrants default to `classified`, but `can_view_legal_request` gave CID
   case-members only a `standard` branch, so the supervisor whom the workflow
   notifies (and whom `review_legal_request_as_cid` accepts) selected zero
   rows — a mandatory reviewer who could not see the request. Fix: view
   follows review authority **only** while `review_status =
   'cid_supervisor_review'`, reusing `can_review_as_cid` verbatim. Sealed
   keeps its explicit-assignment audience at every other stage.

Preserved verbatim (spec §preserve): all review/assignment/service RPCs and
their authority checks, RPC-only writes, sealed audience rules, conflict
guards, justice membership matrix, routing (warrants→judge, coverage-gap
parking), the parallel judiciary lane (PR #177), deadlines, notifications,
audit/versioning.

## 3. The deterministic model (spec §16)

Every surface — investigator landing, Justice portal, dossier, Action Center,
search labels, entity sections — reads stage/disposition/urgency/next-action
from `legalWorkflow.ts` alone. No component hand-rolls status strings.
The model is pure (no I/O, no React) and never decides access; RLS does.

## 4. Action vs awareness

`dispositionFor` assigns every request exactly one group; awareness-only rows
(`isBureauAwareness`) render in quiet "For your awareness" lanes, are excluded
from action metrics, needs-attention lists, and the Action Center, and the
dossier shows them a note instead of action styling. Judge-claimable parked
requests are a separate, visually distinct lane ("any judge may claim").

## 5. Verification results

- **Unit**: `npx vitest run` — 21 files, **376 passed** (was 319 pre-redesign).
- **Live RLS**: full sweep — **24 files, 364 passed, 1 env-gated skip**, zero
  fixture leftovers; plus new **v136 (11)** structured-targets suite and
  **v137** reviewer-visibility suite (results in `tests/rls/`).
- **E2E**: `npx playwright test` — **90 passed, 0 failed** (16 new redesign
  flows incl. a live judge claim through the real RPC path; 12 documented
  env-gated skips). Fixtures built through the same definer RPCs as the RLS
  suites; the pipeline refuses DOJ-stage fixtures when real bureau coverage
  exists.
- **Gates**: tsc 0 errors · eslint 0 warnings · knip clean · build 40/40
  routes · bundle 128.9 / 142 KB gzip budget · check:schema 91 tables ·
  check:freshness green.
- **Security review** (independent, full diff): no sealed leaks, no authority
  predicate drift (dossier predicates character-identical to the old file),
  no injection sinks (`ilikeAny` strips filter metacharacters), migration
  definer hygiene correct. Two findings, both fixed in d174ca7: sealed prior
  titles now number-only in the wizard's create-mode mirror; judicial expiry
  input parses safely.
- **Screenshots**: 30 PNGs (10 surfaces × desktop/tablet/mobile) in
  `.artifacts/doj-redesign/` (gitignored); rerun with
  `DOJ_SHOTS=1 … npx playwright test tests/e2e/doj-screenshots.spec.ts`.

## 6. Bugs found by verification (and their fates)

1. **Fixed (dc9117d + migration 2)**: pending CID reviewer blind to
   classified/restricted submissions — see §2.2.
2. **Fixed (dc9117d)**: both legal landings stay mounted behind the dossier
   and refreshed only via realtime; they now refetch when the dossier closes.
3. **Reported, not fixed (pre-existing test infra)**: `narcotics.spec.ts`
   place teardown silently no-ops (PostgREST delete under RLS returns 2xx with
   zero rows); leaked fixtures were removed manually. Suggest deleting as the
   director fixture or asserting deleted-row count.
4. **Noted for spec authors**: every page renders its title as topbar `h2` +
   `PageHeader` `h1`; Playwright heading queries need `level: 1`.

## 7. Known deferrals (all small, none blocking)

- Classification chip on global-search result rows (needs a `search_all`
  payload change — RPC untouched by design this round).
- `issuedStateFor` maps `non_compliance` onto the active board bucket; the
  event card's badge disambiguates (pre-existing model semantics).
- The dossier's own draft editor submits without a change summary; the wizard
  edit path is the capture surface.
- Playwright config still allows multi-worker runs while spec files call
  `rls_test_cleanup()` (pre-existing hazard; suites are run `--workers=1`).

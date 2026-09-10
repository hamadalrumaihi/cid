# Deferred / Parked Work — CID Portal

> Items intentionally **not** done yet, each with the trigger that should bring it
> back. Keep in sync with the improvement roadmap in the Developer Handbook
> ([Ch. 19](handbook/19-improvements.md)) and with the Portal Improvements plan
> ([`archive/PLAN-PORTAL-IMPROVEMENTS.md`](archive/PLAN-PORTAL-IMPROVEMENTS.md), §19
> "Explicitly out of scope").

---

## 1. Server-side filtering + pagination (case list)
- **Now:** the Cases list and the Division Overview filter the in-memory cases
  cache client-side (the app loads every case the viewer can see, then filters
  in JS). The cache is load-bearing: Command KPIs, bureau scorecards, the
  heatmap, every case dropdown and id → case-number lookups read it.
- **Why deferred:** full pagination is a high-risk refactor against that
  architecture with little payoff at current data volume (the City 2.0 reset
  restarted every registry from zero).
- **Unblocks when:** case volume grows enough that the client-side filter feels
  slow, or Free-tier egress becomes a concern.
- **How (sketch):** keep a slim-projection cache for the cross-cutting
  consumers; serve the list view from paginated server queries
  (`.eq`/`.ilike`/`.order`/`.range`, 50/page); add lean indexes verified
  against the actual queries. The bounded server cross-ref RPC introduced by
  the Portal Improvements plan (P2-06) is the first step in that direction.

## 2. Supabase Pro-gated items
- **Daily backups + optional PITR** — durability for live case records.
- **No 7-day auto-pause** — the project stays up during quiet weeks.
- **Database branching** — test migrations on a throwaway branch before prod.
- **Custom SMTP + higher auth email limits** — reliable sign-up delivery.
- **More compute** — headroom for heavier server-side aggregations.
- **Unindexed-FK advisor INFO lints** — revisit alongside #1's query-verified
  index pass (index only what queries use).

## 3. Vercel Pro (optional — not needed now)
- The app is a static site, so Hobby is sufficient. Pro would add Deployment
  Protection (password/SSO on previews), Web Analytics + Speed Insights,
  WAF/firewall controls, more bandwidth, team seats.
- **Unblocks when:** private preview deployments are wanted, the bandwidth
  ceiling is hit, team members are added, or the project is ever monetized.

## 4. Dedicated test Supabase project + visual-regression baselines
- **Now:** not provisioned (see [`TEST-ENVIRONMENT.md`](TEST-ENVIRONMENT.md)).
  The live RLS suite runs against the production project with namespaced
  fixtures; the seeded destructive E2E suite and the visual suite have no
  target.
- **Why deferred:** a deliberate decision, not a gap — the seeded suite
  truncates tables and needs a throwaway project.
- **Unblocks when:** the team wants deterministic visual regression or seeded
  E2E in CI.

## 5. Items parked by the Portal Improvements plan

Phases 0–8 of [`archive/PLAN-PORTAL-IMPROVEMENTS.md`](archive/PLAN-PORTAL-IMPROVEMENTS.md) are
delivered (release 1.18.0; the record is
[`HANDOFF-PORTAL-IMPROVEMENTS.md`](HANDOFF-PORTAL-IMPROVEMENTS.md)). What the
plan explicitly left out (§19) and what the phases left open:

**Out of scope by decision (plan §19)** — activating the FiveM / MDT lanes or
touching any `service_role` grant (`integration-package/` untouched);
server-side pagination of the case list (§1 above) beyond the bounded
cross-reference RPC; anonymous or public intake forms; drawn / image
signatures; absorbing `siu_referrals` into `field_submissions`; shared or
bureau-published saved views; mirroring FiveManage media into Supabase
storage; Discord slash commands or approvals via Discord; renaming `siu_*`
identifiers or dropping retired enum values; a full-parity mobile editor for
reports and legal drafting (Phase 8 ships **narrative-only** mobile report
editing — RB11); full-text section indexing of reports (`document_sections`
stays documents-only).

**Left open by Phases 0–8**

- **#299 — provision the RLS / e2e fixtures and the CI secrets.** Every
  `tests/rls/v18x` / `v190a` suite and every live e2e spec self-skips until the
  `rls-test-*@cidportal.test` roster exists again and `RLS_TEST_PASSWORD_*`
  reach CI; the v18x and v190a suites have never run against live fixtures.
  Owner-gated.
- **#300 — the site-wide a11y ratchet.** P7-08 delivered the Action Center's
  part (44 px targets, keyboard bulk selection, the axe pass on `/action`);
  the site-wide axe ratchet in CI is not wired.
- **`discord-notify` redeploy** — the edge function must be redeployed with
  the shared `notification_titles.json` and the per-category opt-in
  (`user_prefs.notif_discord`) before the Phase 7 DM categories reach Discord.
- **The restore drill itself** — [`OPERATIONS.md` §5](OPERATIONS.md) is now a
  numbered runbook, but a real restore into a scratch project needs a paid
  branch / project; the log row records "not performed".
- **`perm_deny` + `raise` → `perm_raise`** in the Phase 4–5 RPCs (legal,
  report flow): a `perm_deny` row written before a RAISE rolls back with the
  statement, so those refusals are not yet in the denial ledger. Phases 6–8
  raise through `perm_raise` (P0403).
- **History mounts without a detail surface** — `RecordHistory` is mounted
  where one exists (person / vehicle / gang dossiers, the case Overview
  "History" disclosure, notes, report drafts, draft legal requests — compare
  only — and intel records). **Not mounted**: `place`, `account`, `narcotic`
  and `evidence` — the versions are written and `record_history` answers for
  them, but there is no dossier to hang the viewer on until those registries
  gain one.
- **Plan §20 open questions** — unchanged.

---

_Last reviewed: 2026-09-09._

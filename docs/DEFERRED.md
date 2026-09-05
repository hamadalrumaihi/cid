# Deferred / Parked Work — CID Portal

> Items intentionally **not** done yet, each with the trigger that should bring it
> back. Keep in sync with the improvement roadmap in the Developer Handbook
> ([Ch. 19](handbook/19-improvements.md)) and with the Portal Improvements plan
> ([`PLAN-PORTAL-IMPROVEMENTS.md`](PLAN-PORTAL-IMPROVEMENTS.md), §19
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
See [`PLAN-PORTAL-IMPROVEMENTS.md` §19](PLAN-PORTAL-IMPROVEMENTS.md): FiveM
lane activation, anonymous intake, drawn signatures, absorbing `siu_referrals`
into `field_submissions`, shared saved views, mirroring external media into
Supabase storage, Discord approvals, renaming `siu_*` identifiers, a
full-parity mobile editor, section-level indexing of reports.

---

_Last reviewed: 2026-09-05._

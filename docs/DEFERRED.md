# Deferred / Parked Work — CID Portal

> Items intentionally **not** done yet, each with the trigger that should bring it
> back. Most are gated on a **Supabase/Vercel Pro upgrade**, an **environment/network
> change**, or **data scale** — not on effort. Revisit this list whenever you change
> plans or the app grows. Keep in sync with the Owner Portal's improvement
> roadmap (`src/components/owner/ownerData.ts`).

---

## 1. SheetJS — true self-host (vendor the file into the repo)
- **Now:** version-pinned CDN reference — `cdn.sheetjs.com/xlsx-0.20.3/...` in `index.html`. The security CVEs (CVE-2023-30533 + ReDoS) are **already resolved** by the 0.20.3 bump, so this is hardening, not urgent.
- **Why deferred / blocked:** this environment's network policy blocks `cdn.sheetjs.com` (and jsDelivr/unpkg/git.sheetjs.com); GitHub's mirror is frozen at the vulnerable 0.18.12, so the file can't be fetched here.
- **Unblocks when:** `cdn.sheetjs.com` is allow-listed in the development environment's network policy (this is a network-policy change, *not* a Pro upgrade).
- **How:** `curl` `xlsx-0.20.3/package/dist/xlsx.full.min.js` → `vendor/xlsx.full.min.js`; verify embedded version ≥ 0.20.2 + `node --check`; repoint the `<script>` in `index.html` to the local copy; commit. Removes the external runtime dependency entirely.

## 2. Server-side filtering + pagination (case list)
- **Now:** the Cases list and Command dashboard filter the in-memory `casesCache` client-side (loads all cases the viewer can see, filters in JS).
- **Why deferred:** `casesCache` is **load-bearing** — Command KPIs, bureau load/scorecards, heatmap, Drive folders, every case dropdown, and id→case_number lookups all read it. Full pagination would be a high-risk refactor that fights that architecture, with little payoff at current data volume.
- **Unblocks when:** case volume grows enough that the client-side filter feels slow, or Free-tier egress becomes a concern.
- **How (sketch):** keep a **slim-projection** `casesCache` (id, case_number, title, bureau, status, area, lead_detective_id, created_at, updated_at, signoff_*) for the cross-cutting consumers; serve the **list view** from paginated server queries (`.eq`/`.ilike`/`.order`/`.range`, 50/page); add **lean indexes** (bureau, status, lead_detective_id, signoff_status, created_at, updated_at, signoff_submitted_at) verified against the actual queries. Supabase Pro helps here via more compute + **branching** to test the index migration safely.

## 3. Supabase Pro-gated items (when you upgrade to Pro)
- **Daily backups (7-day) + optional PITR** — durability for live case records (Free has **no backups**). Highest-value reason to upgrade.
- **No 7-day auto-pause** — the project stays up during quiet weeks (Free pauses after inactivity).
- **Database branching** — test migrations on a throwaway branch DB before prod (pairs with #2).
- **Custom SMTP + higher auth email limits** — reliable sign-up/magic-link delivery as the community grows (Free throttles hard).
- **More compute** — headroom for heavier server-side queries/aggregations (pairs with #2).
- **63 unindexed-FK advisor INFO lints** — revisit alongside #2's query-verified index pass (don't blanket-add on Free; index only what queries use).

## 4. Vercel Pro (optional — not needed now)
- The app is a static site, so Hobby is sufficient. Pro would add: **Deployment Protection** (password/SSO on previews), **Web Analytics + Speed Insights**, **WAF/firewall** controls, 1 TB bandwidth, team seats, and a commercial-use license.
- **Unblocks when:** you want private preview deployments, hit the 100 GB bandwidth ceiling, add team members, or ever monetize.

---

_Last reviewed: 2026-06-20._

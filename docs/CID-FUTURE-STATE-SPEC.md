# CID Portal — Confirmed Future‑State Specification & Roadmap

**Status:** discovery in progress (Batches 1–8 resolved; D5 + website‑wide open).
**Do not implement** until an approval option (below) is explicitly selected.
**Source‑of‑truth order:** live schema → PR #193 branch → main → migrations/snapshot → types → tests → spec → this doc → older docs.

---

## Repository & deployment state (verified this session)

- **Live DB:** all 8 delta tables present; all delta RPCs present; `media_sel` widened with `has_media_break_glass`; `legal_requests.execution_result` exists; `search_all` has the account branch. **No live‑vs‑branch drift.**
- **Branch `claude/continue-previous-7pqwjg`:** 19 commits ahead of `main`, contains all of `main` (clean fast‑forward). Each delta's SQL added once; no in‑place rewrite of applied SQL.
- **Tests:** RLS suites `v147`–`v151`; all pass live.
- **CI/preview:** Vercel green on head `e12f622`. PR **#193 open, draft, not merged.**

## PR #193 disposition (Batch 1 — CONFIRMED)

- **Merge after a UI walkthrough** of the six flows, then take out of draft.
- **Safe reversible fixtures in production are permitted** for the walkthrough (append‑only audit rows persist by design).
- **Keep as one domain PR** (no split).
- **D5 → its own GitHub issue** (removed from active PR scope).

---

## Records & Requests domain — confirmed target behavior

> Legend: **[live]** already shipped · **[Δmig]** needs a migration · **[new]** net‑new build

### Legal holds (D7)
- Place/lift authority: **command‑only, both** **[live]**.
- Hold is a **full preservation lock** — blocks permanent deletion **+ case archive + media/report deletion + person/entity merge + related‑record deletion** **[Δmig]**.
- **Indefinite** until manually lifted **[live]**.
- **Reason visible to all case members** **[live/UI]**.
- Surfaces in **Case Timeline, Global search, Action Center** (not packet export) **[Δmig + UI]**.

### Warrant execution (D3)
- Execution record **requires** date/time, incident number, executing officers, result note **[Δmig]**.
- Automation: **'unable' → follow‑up task**, **execution → report draft**, **generate warrant‑return doc** for command acceptance **[new]**.

### Seized items (D3)
- **Requires** category + quantity, evidence bag/storage location, linked media/report, disposition **[Δmig]**.
- **Removal is a soft correction/history event** (chain of custody preserved) **[Δmig]**.

### MDT exports (D4)
- Export types: BOLO, caution flag, **arrest warrants, person, vehicle** (patrol) + **accounts (CID‑only lane)**; search warrants never patrol‑visible **[Δmig]**.
- **Self‑approval prohibited** — proposer ≠ approver **[Δmig]**.
- Delivery model **stays simple** (approved → cleared) **[live]**.
- **Optional expiry reminder** (no auto‑removal) **[Δmig]**.
- **Explicit per‑type patrol field allowlist** **[Δmig/config]**.

### Accounts (D1)
- **Categories:** person/shared/gang/business, unknown operator, impersonation, compromised **[Δmig]**.
- **Direct links** beyond persons: gangs, businesses, cases, vehicles/places **[Δmig]**.
- **Content/state:** public posts as linked Media; volunteered DMs as Restricted media; suspended/deleted state; immutable platform ID + normalized URL **[Δmig]**.
- **Merge:** Lead+ with a preview; confirmed ownership updates the Person dossier **[new]**.
- **Confirming a link to `confirmed` requires Lead+** (suspected/probable open to all) **[Δmig]**.

### Account search (D2)
- Globally searchable **[live]**; refinements (ranking, historical‑handle matches, restricted stubs) deferred to implementation.

### Restricted media / break‑glass (D6)
- **Now a Lead+‑granted flow** (was self‑service) **[Δmig + UI rework]** — supersedes the self‑service RPC/banner shipped this session.
- **24h fixed, whole‑case scope** **[live/Δmig]**.
- **Logging** on lightbox open **and** download/original‑link; events in **case Timeline** **[Δmig]**.
- **Command can revoke** a live grant; **case lead notified** too; grantee **sees remaining time** **[Δmig]**.
- **Exporting** restricted media into a packet needs **separate Lead+ approval** **[new]**.

### Returned‑record extraction (net‑new)
- **Manual structured entry + import a known city format. No runtime AI.** **[new]**
- Facts: account identifiers, contact identifiers (email/phone), ownership + property.
- **Auto‑link, never auto‑confirm** (ownership needs Lead+).
- Guardrails: retain source location per fact; route identifiers through the **Indicators registry**.

### Deferred notifications (D5) — default‑settled
- **In‑app deadline reminders first**; Discord DMs + digest later.
- **Discord governance:** minimal‑summary + portal‑link DMs (no restricted names), read‑only slash commands, **no approvals via Discord**, opt‑in digest.
- **Scheduler chosen at implementation** (in‑app path needs none).
- Tracked in its **own GitHub issue** (out of PR #193 scope).

---

## Investigation‑centered legal workflow (confirmed direction)

- **No active AG / Judge / ADA / prosecutor‑management / judicial‑docket / Justice‑only workflow.**
- New request approval → **Bureau Lead+**.
- **Historical DOJ/AG/ADA/Judge/signature/decision/court‑packet records are preserved** — never erased; moved to read‑only/legacy metadata; never rewritten to imply Lead+ made past judicial decisions.

### DOJ/Judicial retirement reconciliation — default direction
- **Convert active legal review to Bureau Lead+**; keep AG/Judge/ADA/decision/signature/court‑packet records as **read‑only legacy metadata** (no deletes).
- **Fold legal/records tools into the CID investigation + intelligence navigation**; drop the separate Justice framing.
- Per‑feature classification (remove/rename/redirect/read‑only/Lead+‑review/preserve) to be finalized as the first task of Phase 1 against the live surface list.

---

## Lead+ authority matrix (confirmed so far)

| Action | Authority |
|---|---|
| Place / lift legal hold | Command only (bureau_lead+) |
| Approve MDT export | Lead+, **not the proposer** |
| Confirm account ownership (`confirmed`) | Lead+ |
| Grant restricted break‑glass | Lead+ (on request) |
| Revoke a live break‑glass grant | Command/Lead+ |
| Merge accounts | Lead+ |
| Export restricted media to packet | Lead+ (separate approval) |

---

## Proposed Implementation Roadmap

Each phase: objective · baseline · migrations · permissions · user impact · risk · rollback · tests · acceptance. (Detailed per‑phase specs to be expanded on approval.)

- **Phase 0 — Merge & verify PR #193.** UI walkthrough with safe fixtures → screenshots → out of draft → merge to main. Open the D5 issue. *No schema change.*
- **Phase 1 — Retire active DOJ/Judge workflow.** Reconcile per the classification table; convert to Lead+ review + historical read‑only; **preserve all historical rows**. *Migration: status/label remaps only, no deletes.*
- **Phase 2 — Legal‑hold hardening.** Extend the purge guard to archive/media/report/merge/related deletion; add Timeline + search + Action Center surfacing. *Δmig + UI.*
- **Phase 3 — Warrant execution & custody completion.** Structured execution record; custody‑grade seized inventory (soft‑delete); return doc + automation (task/report draft). *Δmig + new RPCs + UI.*
- **Phase 4 — Accounts & extraction expansion.** Categories, polymorphic links, content/state, merge (Lead+), Lead+ confirm; structured + city‑format extraction routed through Indicators. *Δmig + new + UI.*
- **Phase 5 — MDT & FiveM bridge.** Self‑approval guard; new export types; per‑type field allowlist; expiry reminder. *Δmig + bridge contract.*
- **Phase 6 — Break‑glass rework + D5.** Convert break‑glass to Lead+‑granted with revoke/remaining‑time/lead‑notify + packet‑export approval; then in‑app deadlines (Discord later). *Δmig + UI + (infra for D5).*
- **Phase 7 — Case‑workspace improvements** (website‑wide, pending Batch 10).
- **Phase 8 — Shared design‑system + mobile pass.**
- **Phase 9 — Security, reliability, operational hardening** (staging/seed env, E2E, visual regression for new flows).
- **Phase 10 — Historical‑data cleanup & documentation.**

*Sequence may reorder if repository findings indicate a safer order (e.g. Phase 6 break‑glass rework could pair with Phase 2 since both touch case‑scoped RLS).* 

---

## Website‑wide defaults (Batch 10 — default‑settled, revisit per phase)

- **DOJ/Justice surfaces:** convert to Lead+ review + historical read‑only (above).
- **Navigation:** fold legal/records/accounts into CID investigation + intelligence nav.
- **Top build priority after merge:** Phase 1 — DOJ retirement + Lead+ legal review (square the workflow before layering features).
- **Testing strategy:** stand up a **seeded staging/local Supabase** and add **Playwright E2E + visual regression** for the new flows before merge — replacing "RPC tests only." Prod fixtures remain the fallback for the immediate #193 walkthrough.
- Remaining page‑level polish (My Desk, Cases tabs, registries, mobile, a11y, motion, performance, backups) carried into Phases 7–10 and decided per phase against the live surface.

## Notes on process
Batches 1–8 were answered explicitly; D5 (9) and website‑wide (10) were settled with the recommended defaults above after the question rounds were closed out. Any of these defaults can be overridden per phase before that phase is built.

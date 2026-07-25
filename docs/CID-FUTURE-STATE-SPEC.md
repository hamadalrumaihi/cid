# CID Portal — Confirmed Future‑State Specification & Roadmap

> **Executed.** This roadmap was carried out in full through **Phase 9**, all merged to `main`
> (Phase 10 — the cleanup + documentation pass — is the branch you are on). It is retained as the
> **historical planning record**: the discovery, the confirmed decisions, and the phase plan as they
> stood before the build. For what actually shipped and when, see [`CHANGELOG.md`](../CHANGELOG.md)
> and the per‑phase PRs cited in the roadmap below.

**Status:** delivered (Phases 0–9 merged; Phase 10 in progress). Historical planning record.
**Source‑of‑truth order:** live schema → main → migrations/snapshot → types → tests → this doc → older docs.
(The original order placed the then‑unmerged PR #193 branch ahead of `main`; #193 merged long ago, so `main` is now authoritative.)

---

## Repository & deployment state (historical snapshot — superseded)

> *Point‑in‑time snapshot from the discovery session, kept for the record. It described the
> then‑open PR #193 branch. #193 has since merged, along with every phase that followed — the
> live schema and `main` are the current truth. See the shipped roadmap below and `CHANGELOG.md`.*

- **Live DB:** all 8 delta tables present; all delta RPCs present; `media_sel` widened with `has_media_break_glass`; `legal_requests.execution_result` exists; `search_all` has the account branch. **No live‑vs‑branch drift.**
- **Branch `claude/continue-previous-7pqwjg`:** 19 commits ahead of `main`, contains all of `main` (clean fast‑forward). Each delta's SQL added once; no in‑place rewrite of applied SQL.
- **Tests:** RLS suites `v147`–`v151`; all pass live.
- **CI/preview:** Vercel green on head `e12f622`. PR **#193 open, draft, not merged.**

## PR #193 disposition (historical — resolved)

> *This was the plan for landing #193. It has since merged as the Records & Requests foundation
> (D1–D7), and D5 shipped later as in‑app reminders in Phase 6 (PR #205). Kept for the record.*

- **Merge after a UI walkthrough** of the six flows, then take out of draft.
- **Safe reversible fixtures in production are permitted** for the walkthrough (append‑only audit rows persist by design).
- **Keep as one domain PR** (no split).
- **D5 → its own GitHub issue** (removed from active PR scope).

---

## Records & Requests domain — target behavior (delivered)

> **All of the below shipped.** The foundation (D1–D7) landed as PR #193; hardening and the
> remaining deltas followed across Phases 2–6 (D5 in‑app reminders in Phase 6, PR #205). The
> legend records each item's state *at planning time* — it is not the current state; everything
> here is now live on `main`.
>
> Legend (planning‑time): **[live]** already shipped · **[Δmig]** needed a migration · **[new]** was net‑new build

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

## Investigation‑centered legal workflow (shipped — Phase 1, PR #197)

- **No active AG / Judge / ADA / prosecutor‑management / judicial‑docket / Justice‑only workflow.** The Justice Portal was removed from `src/lib/nav.ts` (zero DOJ/Justice nav entries remain).
- New request approval → **Bureau Lead+**.
- **Historical DOJ/AG/ADA/Judge/signature/decision/court‑packet records are preserved** — never erased; moved to read‑only/legacy metadata; never rewritten to imply Lead+ made past judicial decisions.

### DOJ/Judicial retirement reconciliation — delivered
- **Active legal review converted to Bureau Lead+**; AG/Judge/ADA/decision/signature/court‑packet records kept as **read‑only legacy metadata** (no deletes).
- **Legal/records tools folded into the CID investigation + intelligence navigation**; the separate Justice framing was dropped.
- Backend + frontend + RLS suite reworked to the Bureau Lead+ model in Phase 1 (PR #197).

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

## Implementation Roadmap — SHIPPED

Delivered in order and merged to `main`. Each phase's PR is cited below (confirm against
`git log origin/main` / `CHANGELOG.md`). Phase 4 landed as two PRs (4a/4b); the media‑follows‑case
access change (PR #204) shipped alongside Phase 5.

- ☑ **Phase 0 — Records & Requests foundation (D1–D7).** The six‑flow domain build, merged as **PR #193** (D5 deferred to its own track). *Delivered.*
- ☑ **Phase 1 — Retire active DOJ/Judge workflow — PR #197.** Converted to Bureau Lead+ review + historical read‑only; all historical rows preserved; Justice Portal removed from nav; backend + frontend + RLS suite reworked. *Delivered.*
- ☑ **Phase 2 — Legal‑hold hardening — PR #198.** Preservation lock extended across archive/media/report/merge/related deletion; Timeline + search + Action Center surfacing. *Delivered.*
- ☑ **Phase 3 — Warrant execution & custody completion — PR #199.** Structured execution record; custody‑grade seized inventory (soft‑delete); return doc + automation. *Delivered.*
- ☑ **Phase 4 — Accounts & extraction expansion — PR #200 (4a) + PR #201 (4b).** Categories, polymorphic links, content/state, merge (Lead+), Lead+ confirm (4a); returned‑record extraction routed through Indicators (4b). *Delivered.*
- ☑ **Phase 5 — MDT & FiveM bridge (dormant) — PR #203.** Self‑approval guard; new export types; per‑type field allowlist; expiry reminder. Media‑follows‑case access shipped alongside as **PR #204**. *Delivered.*
- ☑ **Phase 6 — Break‑glass rework + D5 — PR #205.** Lead+‑granted break‑glass with revoke/remaining‑time/lead‑notify; **D5 in‑app deadline reminders** landed here (Discord/digest still deferred to infra). *Delivered.*
- ☑ **Phase 7 — Case‑workspace polish — PR #206.** *Delivered.*
- ☑ **Phase 8 — Shared design‑system consistency + mobile pass — PR #207.** *Delivered.*
- ◧ **Phase 9 — Security, reliability, operational hardening — PR #208 (security track only).** Advisor hardening shipped: anon‑revoke drift, `search_path` pin, insert‑policy tightening, FK indexes — the live baseline is now zero anon‑executable `public` functions. *The reliability/operational track (staging/seed Supabase project, live‑verifying CI secrets, Playwright E2E + visual‑regression baselines) is **deferred** — it needs test infrastructure only the owner can provision.*
- ◧ **Phase 10 — Historical‑data cleanup & documentation.** *In progress on the current branch (not yet merged).*

---

## Website‑wide defaults (Batch 10 — delivered)

- **DOJ/Justice surfaces:** converted to Lead+ review + historical read‑only (Phase 1, PR #197).
- **Navigation:** legal/records/accounts folded into CID investigation + intelligence nav.
- **Build priority after merge:** Phase 1 (DOJ retirement + Lead+ legal review) was taken first, squaring the workflow before layering features — as planned.
- **Testing strategy:** RLS security suites (v152–v160) cover the new flows; the seeded staging Supabase project and Playwright E2E + visual‑regression baselines remain **deferred** (Phase 9 reliability track — pending owner‑provisioned test infrastructure). Note: the CI `security-suites` job currently self‑skips the live RLS suites because the fixture‑password secrets are unset — verification has been by direct live catalog queries per phase.
- Remaining page‑level polish (My Desk, Cases tabs, registries, mobile, a11y, motion, performance, backups) shipped across Phases 7–9.

## Notes on process
Batches 1–8 were answered explicitly; D5 (9) and website‑wide (10) were settled with the recommended defaults above after the question rounds were closed out. Any of these defaults can be overridden per phase before that phase is built.

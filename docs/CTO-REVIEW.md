# CTO Review — Roadmap & Long-Term Evolution

**Date:** 2026-07-09 · **Reviewed at:** v1.1.1 (post PRs #124/#126/#127) ·
**Scope:** the complete platform — code, database, security, process, docs.

This is a *recommendations* document: nothing in it is implemented. Rankings
use **Impact** (what it buys) / **Effort** (S ≤ half a day, M ≤ 2 days,
L = a week+) / **Risk** (chance of breaking something that works today).

> Note on version numbers: the original plan called the phases v1.1 → v2.0.
> v1.1 *shipped today* (v1.1.0 + v1.1.1), so the phases below are
> **v1.2 → v1.3 → v1.5 → v2.0**.

---

## 1. Where the project actually stands

| Dimension | State |
| --- | --- |
| Application | 35 screens (31 tabs), Next.js 16 + React 19, TS strict, statically prerendered |
| Database | 48 tables, 100% RLS, 168 policies, 38 functions, 56 triggers, 78 live migrations |
| Security model | Deny-by-default, bureau isolation, server-authoritative workflows, owner role, audit trail |
| Tests | 17 offline unit tests + 17 live RLS/RPC tests + 2 E2E smoke (opt-in) |
| Process | 4 CI gates + semgrep + Dependabot, SemVer + CHANGELOG, PR checklist, CONTRIBUTING |
| Docs | 25-file handbook (+ in-app portal), user guide, setup, schema snapshot, migration history |
| Track record | The test suites found two real production bugs within hours of existing |

The honest headline: **this is a well-run small-team production app** with an
unusually strong security posture for its size — and the classic weak points
of a one-maintainer project: bus factor, no staging, monitoring that stops at
"CI is green".

---

## 2. Technical debt register (ranked)

| # | Debt | Why it matters | Impact | Effort | Risk |
| --- | --- | --- | --- | --- | --- |
| D1 | **Migrations folder ≠ live schema** (24 of 78 migrations live-only; snapshot is reference-only, not replayable) | `supabase db reset` cannot rebuild prod; local dev + disaster recovery both depend on a hand-maintained snapshot | High | M | Low |
| D2 | **Registry skeleton duplicated ~10×** (fetch + version + filter + modal + undo) | Every new registry re-implements the same 150 lines; bugs fix 10 times | High | M | Med |
| D3 | **Whole-table refetch on every realtime tick** (94 `useTableVersion` call sites) | Fine at division scale; the ceiling arrives silently as data grows | High (later) | L | Med |
| D4 | **`guideContent.ts` regeneration is ad-hoc** (handbook has `gen:handbook` + CI drift check; the guide does not) | Guide edits can silently drift from `docs/USER-GUIDE.md` | Med | S | Low |
| D5 | **`GangsView.tsx` (~690 lines)** — the last monolith now that CaseDetail is split | Same edit-risk argument that justified the CaseDetail split | Med | M | Low |
| D6 | **`drafts.ts` wired only into case chat** | Report editors lose work on refresh; the library already exists | Med | S | Low |
| D7 | **jsonShapes covers 4 columns** — other jsonb (template `tasks`, notification `payload`, announcement `links`) still cast | Same shape-drift class of bug | Low | S | Low |
| D8 | **No error tracking** — a production exception is invisible unless a user files feedback | You learn about crashes days late | High | S–M | Low |
| D9 | Test accounts visible in prod roster | Cosmetic; documented and reversible | Low | — | — |

---

## 3. Recommendations by area

### 3.1 Security (baseline is strong; these are the next layer)

| Rec | What | Impact | Effort | Risk |
| --- | --- | --- | --- | --- |
| S1 | **Close the M1–M5 dashboard items** (branch protection, OTP 1800s, leaked-password protection, backup confirmation, Vercel env exposure) — still the cheapest risk reduction available | High | S | None |
| S2 | **MFA for command roles** — Supabase supports TOTP enrolment; enforce via a policy check (`aal2`) on command-only actions | High | M | Med |
| S3 | **Nonce-based CSP** (drop `unsafe-inline` for scripts) — deferred item #14; has Next.js quirks | Med | M | Med |
| S4 | **Owner-positive RLS tests** — today's suite proves denials; a fourth (owner) test account would prove the owner paths keep working (the `is_owner` grant bug would have been caught *before* shipping) | High | S | Low |
| S5 | **Backup restore drill** — a backup that has never been restored is a hypothesis, not a backup | High | S | None |
| S6 | **Re-auth ("sudo mode") for destructive command actions** — member removal, case delete | Med | M | Low |
| S7 | Run the RLS suite in CI (add the 3 secrets) so the wall is checked on every PR, not on demand | High | S | None |

### 3.2 Performance & scalability (no current fire; trigger-based)

| Rec | What | Trigger | Impact | Effort |
| --- | --- | --- | --- | --- |
| P1 | Server-side pagination for cases/audit/records (deferred #12) | ~10× current data volume | High | L |
| P2 | Selective realtime payloads — patch stores from event rows instead of refetching (deferred #13) | pairs with P1 | High | L |
| P3 | Lighthouse budget in CI (fail on regressions > threshold) | now (cheap) | Med | S |
| P4 | Analytics/heatmap: memoize aggregations; they recompute per render on full tables | when analytics feel slow | Med | S |

### 3.3 UX

| Rec | What | Impact | Effort |
| --- | --- | --- | --- |
| U1 | **Accessibility pass** — run axe on all 31 tabs, fix findings; v1.1.0 started this (board keyboard path, heatmap labels) | High | M |
| U2 | **Mobile/tablet polish** — the shell is desktop-first; officers on phones during sessions is a real RP use-case | High | M–L |
| U3 | **Notification digest** — per-shift Discord/inbox summary instead of one ping per event | Med | M |
| U4 | Bulk actions on the case board (multi-select → assign/close) | Med | M |
| U5 | Loading-skeleton consistency sweep (some tabs flash empty states) | Low | S |

### 3.4 Developer experience

| Rec | What | Impact | Effort |
| --- | --- | --- | --- |
| X1 | **`useRegistry` hook** (deferred #11) — pilot on one view, diff behavior, then roll onward | High | M |
| X2 | **`gen:guide` script + CI drift check** (mirror of `gen:handbook`) | Med | S |
| X3 | **Consolidated baseline migration** (fixes D1): squash the live schema into a new `..._baseline.sql`, archive the old lineage, keep additive from there — makes `supabase db reset` real again | High | M |
| X4 | Typegen automation — script + CI check that `database.types.ts` matches the live schema | Med | S |
| X5 | Pre-push hook running typecheck+lint (fast subset of the gates) | Low | S |

### 3.5 New features (recommend only — none started)

Ranked by fit with what the division actually does in-game:

1. **Warrant lifecycle v2** — statuses, expiry, judge sign-off link to the packet export (High impact, M).
2. **Confidential-informant module** — a registry with *stricter-than-bureau* RLS (handler + command only); the platform's isolation machinery already supports it (High, M–L).
3. **Court/session calendar integration** — subpoenas and hearing dates feeding My Desk (Med, M).
4. **Shift handover notes** — structured "pass-down" between shift reports (Med, S–M).
5. **Case merge/split** — real investigations converge; today that's manual re-linking (Med, M).
6. **Evidence QR/blockchain-style custody hash** — RP flavor + tamper story for court scenes (Med, M).
7. **Training/certification tracker** for personnel (Low–Med, S–M).
8. **AI assists** (case-summary drafting, similar-case detection via embeddings) — genuinely useful but adds API keys, cost, and a new failure surface; prototype only after v1.5 (Med, L).

---

## 4. Top 25 improvements (single ranked list)

Ordering = impact ÷ (effort × risk), i.e. what I would green-light first.

1. S1 — Close M1–M5 dashboard items *(owner, 15 minutes)*
2. S7 — RLS suite in CI via repo secrets
3. S4 — Owner-positive test account + tests
4. S5 — Backup restore drill (document the runbook as you do it)
5. D8 — Error tracking (Sentry free tier or Vercel log drains + alert)
6. X3/D1 — Consolidated baseline migration (replayable schema)
7. X2/D4 — `gen:guide` script + drift check
8. D6 — Wire drafts into report editors
9. X4 — Typegen drift check in CI
10. X1/D2 — `useRegistry` pilot (one view)
11. U1 — Accessibility (axe) pass
12. D5 — Split `GangsView`
13. P3 — Lighthouse budget in CI
14. U5 — Skeleton consistency sweep
15. D7 — Extend jsonShapes to remaining jsonb columns
16. S2 — MFA for command roles
17. U3 — Notification digest
18. F1 — Warrant lifecycle v2
19. F2 — Confidential-informant module
20. U2 — Mobile/tablet polish
21. X1 rollout — `useRegistry` across remaining registries
22. S6 — Re-auth for destructive actions
23. U4 — Board bulk actions
24. S3 — Nonce-based CSP
25. P1+P2 — Pagination + selective realtime *(hold until the data-volume trigger)*

---

## 5. Phased roadmap

### v1.2 — "Close the loop" (2–3 weeks)
Process/safety consolidation, no features: items 1–9 above.
Exit criteria: security suites run in CI; schema is replayable from the repo;
a restore has been performed once; a crash in prod pages *you* rather than
waiting for feedback.

### v1.3 — "Polish & pattern" (4–6 weeks)
Items 10–15 (+16 if appetite): useRegistry pilot→rollout begins, a11y pass,
GangsView split, Lighthouse budget, skeletons, jsonShapes completion.
Exit criteria: no view over ~450 lines; axe clean on the top-10 screens.

### v1.5 — "First real feature release since 1.0" (Q4 2026)
Pick **two** of: warrant lifecycle v2, CI-informant module, notification
digest, mobile polish. Plus MFA for command. Feature choice should follow
what the division actually asks for via the feedback inbox — you now have
triage data; use it.

### v2.0 — trigger-based, not date-based (2027)
Only justified by one of: 10× data (→ P1/P2 land here), a second community
wanting the platform (→ multi-tenancy — a *major* RLS redesign, treat with
respect), or a platform jump (Next/React/Supabase major). Also the natural
home for data-retention/archival policy and an offline-capable PWA. If none
of the triggers fire, **v2.0 not happening in 2027 is success, not failure.**

### 12-month calendar view

| When | Release | Theme |
| --- | --- | --- |
| Jul 2026 | v1.2 | Safety loop: CI security tests, baseline migration, restore drill, error tracking |
| Aug–Sep 2026 | v1.3 | Patterns & polish: useRegistry, a11y, splits, budgets |
| Oct–Dec 2026 | v1.5 | Two features (feedback-driven) + MFA |
| Jan–Mar 2027 | v1.6 | Feature #3/#4 + useRegistry rollout completion + AI-assist prototype *if* wanted |
| Apr–Jun 2027 | v2.0 *(conditional)* | Scale pack / tenancy / platform jump — only if a trigger fired |

---

## 6. Honest maturity assessment

| Dimension | Score | Honest note |
| --- | --- | --- |
| Stability | 9/10 | Three releases today, zero regressions; gates + drift checks catch the mechanical stuff |
| Security | 8.5/10 | Best-in-class model for the size; loses points for pending M1–M5, no MFA, denial-only test coverage |
| Testing | 7/10 | Went from 0 → 36 meaningful tests this week; but suites are opt-in, not in CI, and unit coverage is thin outside lib/ |
| Maintainability | 8.5/10 | CaseDetail split, docs current, patterns documented; registry duplication and GangsView remain |
| Documentation | 9.5/10 | Genuinely unusual for a project this size; keep the drift checks honest |
| Operations | 5/10 | **The weak leg.** No error tracking, no alerting, no staging, restore never drilled, bus factor = 1 |
| Product process | 8/10 | Feedback inbox + triage + suggestion tracking exist and are used |

**Overall: a mature v1 — strong build/security/docs, under-invested operations.**
The next unit of effort buys more in *operations* than anywhere else.

## 7. Production readiness report

| Area | Status | Blocking? | Note |
| --- | --- | --- | --- |
| Code quality gates | 🟢 | — | 4 gates + semgrep + Dependabot on every PR |
| Functional testing | 🟢 | — | unit + RLS + E2E; opt-in suites verified today |
| Security enforcement | 🟢 | — | RLS authority verified by tests against prod |
| Dashboard hardening (M1–M5) | 🟡 | No | Owner action pending — 15 minutes |
| Monitoring & alerting | 🔴 | No, but first to fix | Nothing pages anyone; feedback inbox is the de-facto alert channel |
| Backups / DR | 🟡 | No | Enabled per plan; **never restored** — drill it |
| Staging environment | 🟡 | No | Vercel previews cover the front-end; DB changes rehearse in prod |
| Bus factor | 🔴 | No | One maintainer + docs. The handbook mitigates; a second trusted admin would resolve |
| **Verdict** | **Production-ready for its mission** | | Ship features confidently; spend v1.2 on the two red rows |

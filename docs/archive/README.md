# Archived docs — historical records

Historical documents kept **for reference only** — dated build notes,
handoffs, audits, and completion reports. Nothing in here describes the
current application, and nothing should link to them as live guidance.

| File | What it was |
| --- | --- |
| `HANDOFF.md` | Session-memory handoff for the **vanilla JS** portal (pre-rebuild). |
| `PHASE2-HANDOFF.md` | Mid-rebuild handoff for the `react-rebuild` branch. |
| `ROADMAP.md` | Wave-by-wave build spec for the vanilla portal's feature waves. |
| `REACT-PARITY.md` | The parity checklist that gated the React cutover — all boxes checked. |
| `BACKLOG.md` | Vanilla-era feature backlog — everything shipped or superseded. |
| `AUDIT-REPORT.md` | Deep security/correctness audit of the vanilla SPA (2026-07-02; 45 confirmed findings — all fixed). |
| `AUDIT-VERIFY.md` | Verification pass over those fixes (2026-07-02 → 2026-07-05; 7 further defects found and closed). |
| `RELEASE-READINESS.md` | The v1.0.0 (2026-07-09) release verification report and readiness scores. |
| `DOJ-INTEGRATION-DRAFT.md` | The original DOJ workflow proposal — superseded by `docs/DOJ-INTEGRATION.md` (shipped v1.13.0). |
| `DOJ-REDESIGN-AUDIT.md` | Pre-implementation current-state audit for the DOJ/Justice Portal operational redesign. |
| `DOJ-REDESIGN-REPORT.md` | Completion/verification report for that redesign (PR #178) — durable facts folded into `docs/DOJ-INTEGRATION.md`. |
| `leafos-ditch-witch-sales-screenshots.md` | One-off media-import evidence manifest (LeafOS screenshot series). |
| `superpowers/` | Working plans/specs from the June 2026 case-files build. |
| `HANDBOOK.md` | The single-file developer handbook's redirect stub — the handbook is `docs/handbook/`. |
| `RUNBOOK.md` | The operations runbook's redirect stub — split into `docs/DEPLOYMENT.md` and `docs/OPERATIONS.md`. |
| `HARDENING.md` | The 2026-07 security-hardening checklist and its completion status; the live rules are `docs/SECURITY-REVIEW.md`, `docs/RLS.md` and handbook ch. 18. |
| `CTO-REVIEW.md` | Point-in-time engineering review (July 2026) — the findings shipped or moved to `docs/DEFERRED.md`. |
| `CID-FUTURE-STATE-SPEC.md` | The pre-plan future-state specification — superseded by the Portal Improvements plan. |
| `RECORDS-REQUESTS-SPEC.md` | Decision log + gap analysis for the Records & Requests domain (delivered PR #193 → #209). |
| `RECORDS-REQUESTS-DELTAS-REPORT.md` | Delivery report for the Records & Requests deltas (Phases 1–10). |
| `MDT-BRIDGE-CONTRACT.md` | The dormant patrol-lane (MDT) bridge contract — no consumer is deployed; `docs/integration/CID-INTEGRATION-API.md` is the integration lane that stays documented. |
| `PLAN-PORTAL-IMPROVEMENTS.md` | The ten-phase Portal Improvements plan — delivered as release 1.18.0; status lives in `docs/HANDOFF-PORTAL-IMPROVEMENTS.md`. |

Current documentation lives one level up: `docs/handbook/` (developer
handbook), `docs/USER-GUIDE.md` (member guide), `docs/SECURITY-REVIEW.md`
(the reviewer's security checklist), `docs/OPERATIONS.md` / `docs/DEPLOYMENT.md`
(running and shipping the live project), `docs/DEFERRED.md` (parked work with
triggers), and the Owner Portal's in-app improvement roadmap
(`src/components/owner/ownerData.ts`).

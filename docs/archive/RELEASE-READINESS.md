# Release Readiness Report — v1.0.0 (2026-07-09)

Stabilization review after the feature waves of June–July 2026 (PRs
#103–#122). Everything below was verified against the repository at the
v1.0.0 commit and the live Supabase catalog — where something could not be
verified from here, it says so.

## 1. Verification results (all run on the release commit)

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ pass |
| `eslint src --max-warnings 0` | ✅ pass |
| `vitest` | ✅ 10/10 (3 files) |
| `next build` | ✅ 35/35 static pages (31 tab routes + root/errors/icon) |
| Handbook drift check | ✅ generated content matches `docs/handbook/` |
| Secrets scan | ✅ no `service_role` outside documentation text; committed keys are the public anon + FiveManage values (by design) |
| Hard-coded owner IDs | ✅ zero in `src/` (migrated to `profiles.is_owner`) |
| Supabase security advisors | ✅ only accepted findings (see §3) |
| Live DB owner state | ✅ 2 owner profiles flagged; `audit_sel`/`feedback_owner_manage` policies use `private.is_owner()`; `feedback_meta` owner-only; `is_owner` column-grant in place |

**Verified by code review, not runtime**: sign-in on all three providers,
every screen's manual QA, mobile devices. These have been exercised
continuously on previews during development but there is no automated
E2E coverage (see §6).

## 2. Honest implementation report

**Complete and verified**
- 29 member screens + 2 owner screens (Developer Handbook, Owner Portal),
  all live-updating, all RLS-scoped
- Owner role modeled end-to-end (flag + helper + policies + guard trigger +
  `useAuth().isOwner`); hard-coded UUIDs fully retired
- Feedback owner inbox with separate `feedback_meta` catalog (internal
  notes cannot reach submitters), audit-logged triage
- Court packet/dossier exports (PDF/DOCX/MD), ⌘K palette, watchlist,
  sign-off chain (server-authoritative), deconfliction (3 systems)
- CI (4 gates + drift check), Dependabot, unit tests for the
  security-critical pure functions, custom error screens
- Documentation platform: 25-file handbook (repo + in-app, sync-checked),
  README/SETUP accuracy audit, visual user guide

**Partial / known limitations**
- Owner Portal health page: build commit/branch show "Unavailable" unless
  Vercel system-env exposure is enabled (manual config, §7); FiveManage is
  config-checked, not pinged; no uptime/error-rate metrics (needs external
  monitoring)
- Change-impact data is curated inference from the July 2026 analysis —
  labeled as such in the UI; it will drift if not maintained
- Feedback spam/rate-limiting relies on Supabase platform defaults + the
  title-required check; no app-level throttle (acceptable at division scale)
- `docs/handbook` file-level docs cover the load-bearing 44 nodes
  interactively; per-file prose lives in the handbook, not the portal

**Known issues**
- None open at release. The `is_owner` column-grant incident (profile fetch
  would have failed on the new bundle) was caught and fixed pre-merge
  (`grant_is_owner_select` migration).

**Technical debt (tracked in the Owner Portal → Suggestions)**
- No schema dump/migration log in-repo for post-folder changes (live DB is
  the only source of truth) — top priority
- Three unused npm dependencies; `lib/drafts.ts` unwired
- `CaseDetail.tsx` size (~840 lines); the ~10× duplicated registry skeleton
- Zero RLS/RPC/E2E automated coverage (§6)
- `bootstrap_command`/`bootstrap_director` RPCs still exist (no app
  callers; not anon-callable; drop when convenient)

## 3. Security review

**Model**: public anon key → RLS on all 48 tables → SECURITY DEFINER RPCs
with internal checks → guard triggers on protected columns. Verified this
release: owner-only routes gated in UI *and* by RLS (feedback_meta/audit
return zero rows to non-owners even via direct REST calls); `is_owner` is
client-immutable (trigger); authorship unforgeable (stamp triggers + RPC);
XSS surfaces (`safeUrl`, markdown renderers, CSV export) unit-tested or
hard-ruled; CSP allow-lists exact; anonymous EXECUTE revoked on all RPCs.

**Accepted advisor findings** (reviewed, intentional):
`app_secrets` deny-all (INFO — by design); 12 SECURITY DEFINER RPCs
callable by `authenticated` (they ARE the app's API; each checks the
caller internally — treat any edit as a security review); leaked-password
protection (dashboard toggle, §7).

**Residual risks**: RPC internals are the escalation surface; UI mirrors
of server rules (`useNavBadges`) can drift (mislead, not breach); the
committed FiveManage key allows uploads by anyone with the bundle
(referrer-bound; accepted).

## 4. Release engineering (now in place — repository changes)

- **SemVer adopted** at v1.0.0 (`package.json`, `CHANGELOG.md` rewritten
  with the release model + PR-linked history; vanilla-era log preserved)
- **Merge checklist** as `.github/PULL_REQUEST_TEMPLATE.md` (gates,
  preview verification, permissions, DB ritual, docs sync, secrets)
- **Contributor workflow** as `CONTRIBUTING.md`, mirrored in handbook
  Ch. 14 and the Owner Portal Workflow section
- **The isolation rule**: all future development on branches, verified on
  the PR preview before merge — stated in CONTRIBUTING, the PR template,
  the handbook, and the Owner Portal (with an honest note that branch
  protection itself is a GitHub setting, §7)
- Existing and verified: CI on every push/PR (typecheck, lint, tests,
  build, handbook drift), Vercel preview per PR, instant rollback,
  Dependabot weekly

## 5. Database migration safety

Rules in force: **additive-only**; `database.types.ts` in the same PR;
RLS before exposure; realtime publication + FK indexes for new tables;
advisors re-run after every migration (done for all five 1.0 migrations).
Why additive-only matters here: deployed bundles and open tabs keep
querying the old shape, and Vercel rollbacks don't roll back schema.
Gap: post-folder migrations exist only in Supabase's history — commit a
schema dump + migration log (top debt item).

## 6. Recommended next (in order)

1. **Manual config** (§7) — 15 minutes, biggest risk reduction.
2. Schema dump + migration log in-repo.
3. RLS/RPC test suite (two test users), then an E2E smoke test
   (sign-in → case → sign-off) against previews.
4. Quick wins: drop unused deps, wire/delete drafts.ts, drop bootstrap RPCs.

## 7. Manual configuration required (CANNOT be done from this repository)

These are external settings. **None of them have been changed by this
release** — they require the owner in the respective dashboards:

| Where | Setting | Why |
|---|---|---|
| GitHub → Settings → Branches | Protect `main`: require PR + the `CI / verify` check, disallow force-push | Makes the isolation rule enforced instead of disciplined |
| Supabase → Auth → Sign In/Up → Email | OTP expiry → 1800s; enable leaked-password protection | HARDENING.md items 2; advisor warning |
| Supabase → Database → Backups | Confirm daily backups on the plan (or request a scheduled export) | HARDENING.md item 14 |
| Vercel → Project → Settings → Environment Variables | Enable "Automatically expose System Environment Variables" | Owner Portal health page shows commit/branch |

## 8. Readiness scores

| Dimension | Score | Basis |
|---|---|---|
| **Stability** | **8.5 / 10** | All gates green; uniform patterns; silent-failure classes fixed; deducted for zero E2E/RLS automation |
| **Security** | **8.5 / 10** | RLS-authoritative model verified layer by layer; deducted for untested-by-machine policies and the two dashboard toggles pending |
| **Maintainability** | **8 / 10** | Strong conventions + handbook; deducted for CaseDetail size, duplicated skeleton, schema not in repo |
| **Documentation** | **9.5 / 10** | Handbook (repo + in-app + drift-checked), user guide, owner portal, accurate READMEs, this report |
| **Deployment readiness** | **8 / 10** | CI + previews + instant rollback + additive-migration rule; deducted because branch protection and backup verification are pending manual config |

**Verdict: production-ready as v1.0.0.** The remaining risk is
concentrated in §7 (fifteen minutes of dashboard work) and the absence of
automated security tests — both tracked, neither blocking for a
single-team internal tool.

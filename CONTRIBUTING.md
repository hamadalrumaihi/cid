# Contributing to the CID Portal

The full engineering reference is the developer handbook
([`docs/handbook/`](docs/handbook/README.md), or in-app under
Reference → Developer Handbook). This file is the short version.

## The one rule

**All development happens on an isolated branch and is verified on its
preview deployment before it reaches production.** Production tracks
`main`; a broken merge deploys immediately. Never push to `main` directly.

> Note: GitHub branch protection is a repository *setting*, not code — see
> "Manual configuration" in [`docs/RELEASE-READINESS.md`](docs/RELEASE-READINESS.md).
> Until it is enabled, this rule is enforced by discipline.

## Workflow

1. **Branch** off `main`.
2. **Develop** following the conventions in
   [handbook Ch. 15](docs/handbook/15-conventions.md) — copy the nearest
   existing pattern; all data access through `src/lib/db.ts`; surface every
   write failure.
3. **Gate** before pushing:
   `npm run typecheck && npm run lint && npm test && npm run build`
   (Two further suites are **opt-in** because they talk to the live project
   with dedicated test accounts: `npm run test:rls` — the RLS/RPC
   security-wall tests — and `npm run test:e2e` — the Playwright smoke test.
   See `tests/rls/README.md`.)
4. **PR** — the template's merge checklist is the definition of done.
   CI runs the same gates plus the handbook drift check.
5. **Verify the preview** (the Vercel bot comments the URL): sign in,
   exercise the change, use two browsers for realtime, test as a
   non-privileged account when permissions are involved.
6. **Merge** → production deploys automatically.
   **Rollback**: Vercel → Deployments → Instant Rollback.

## Database changes

Additive-only migrations, applied to the live project (the live schema is
the source of truth). Same PR must update `src/lib/database.types.ts`.
New tables need RLS policies (no policies = invisible), the realtime
publication (if the screen should be live), and FK indexes. Re-run the
Supabase advisors after. Details: [handbook Ch. 14](docs/handbook/14-development-workflow.md).

## Versioning & changelog

[SemVer](https://semver.org) as of v1.0.0. Feature releases bump MINOR,
fixes bump PATCH, breaking platform changes bump MAJOR — update
`package.json` and add a `CHANGELOG.md` entry (listing the PRs) in the
release PR. Not every merge is a release; group related merges into one
versioned entry when they ship together.

## Documentation is part of the change

- Contract changes → `docs/handbook/` + `npm run gen:handbook`
  (CI fails on drift).
- Member-facing changes → `docs/USER-GUIDE.md` + regenerate
  `src/components/guide/guideContent.ts`.
- Owner-facing operational changes → `src/components/owner/ownerData.ts`.

## What every change must include

1. **Explain the user-facing purpose** — the PR's "What & why" says what a
   member/reviewer gains, not just what the code does.
2. **Identify the affected roles** — who can now see or do something they
   couldn't (or no longer can).
3. **Identify the affected tables and policies** — name them in the PR.
4. **Add migrations rather than editing production manually** — every schema
   change is a timestamped file in `supabase/migrations/`, applied to the
   live project; never a dashboard-only edit.
5. **Update the schema snapshot and generated types** —
   `supabase/schema-snapshot.sql` + `src/lib/database.types.ts`
   (`npm run check:schema` enforces sync).
6. **Add positive AND negative permission tests** — every new permission
   needs an allow test and a deny test in the live RLS suite
   (`tests/rls/`); see [`docs/TESTING.md`](docs/TESTING.md).
7. **Run all required checks** (see the gate in Workflow step 3 and the PR
   checklist below).
8. **Update the relevant documentation** — handbook/user guide plus the
   reviewer docs (`docs/ARCHITECTURE.md`, `AUTHORIZATION.md`, `RLS.md`,
   `WORKFLOWS.md`, `REVIEW-MAP.md`) when contracts, permissions, or
   workflows change.
9. **No secrets or production identifiers** — the anon and FiveManage keys
   are the only committable keys; never a service-role key, fixture
   password, or real member's personal data.
10. **Preserve audit and historical attribution** — never rewrite
    `audit_log`, history tables, versions, custody chains, or Git history;
    corrections append, they don't erase.

## Comment and SQL documentation conventions

Comment the *why*, not the *what*: security decisions, authorization
boundaries, deliberate exclusions, workarounds, and restricted state
transitions deserve comments; obvious lines don't. Exported helpers and
complex components get concise JSDoc (purpose, inputs, return,
authorization assumptions, side effects). Every new or modified SQL
function carries a header comment covering **Purpose / Caller /
Authorization / Side effects / Audit behavior / Security notes**; SECURITY
DEFINER functions additionally justify definer privileges and pin
`search_path` (see [`docs/RLS.md`](docs/RLS.md)).

## Development statement

The project's requirements, workflows, security model, and final
implementation decisions are human-directed and human-reviewed. Development
tools may assist with drafting or implementation, but no tool independently
defines policy, approves changes, or operates investigative and legal
decisions. The portal itself contains no runtime AI — describe
deterministic features as rule-based, database-driven, or workflow-based.

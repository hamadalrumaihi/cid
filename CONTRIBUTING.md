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

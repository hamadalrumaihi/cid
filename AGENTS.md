# AGENTS.md — CID Portal repository orientation

> Development tooling only. This file orients development tools and human
> contributors working in the repo; it is not a runtime dependency of the
> CID Portal.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## What this repo is

A **Next.js 16** single-page app (React 19, TypeScript strict, Tailwind v4)
statically prerendered and served from Vercel, backed by a **Supabase**
Postgres project where **Row-Level Security is the authority**. One dynamic
route — `src/app/(app)/[tab]/page.tsx` — renders every screen from
`PAGE_META` in `src/lib/nav.ts`; one component folder per screen under
`src/components/`, shared logic in `src/lib/`, backend migrations in
`supabase/migrations/`.

## Ground rules

- **The database is the authority; the UI is a convenience.** Client-side
  permission checks only hide buttons — RLS policies, guard triggers, and
  `SECURITY DEFINER` RPCs do the real enforcement. Never treat a UI gate as
  security.
- **All data access goes through `src/lib/db.ts`**; surface every write
  failure (writes return `{error}` — check it and toast).
- **Migrations are additive-only** and applied to the live project (the live
  schema is the source of truth). The same PR must update
  `src/lib/database.types.ts` and `supabase/schema-snapshot.sql`
  (`npm run check:schema` enforces sync). New tables need RLS policies,
  realtime publication (if the screen is live), and FK indexes.
- **Gates before pushing**:
  `npm run typecheck && npm run lint && npm test && npm run build`.
  Opt-in live suites (dedicated test accounts): `npm run test:rls`,
  `npm run test:e2e` — see `docs/TESTING.md`.
- **Docs are part of the change**: `docs/handbook/` + `npm run gen:handbook`
  for contract changes; `docs/USER-GUIDE.md` + `npm run gen:guide` for
  member-facing changes. CI fails on generated-content drift.
- **Never** commit a `service_role` key, rewrite audit/history tables, or
  push to `main` directly.

## Where to read more

| Topic | Doc |
|---|---|
| Contributor workflow & definition of done | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Full developer handbook (architecture → every file) | [`docs/handbook/`](docs/handbook/README.md) |
| System architecture | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Who may do what (authorization model) | [`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md) |
| RLS mechanics & SQL conventions | [`docs/RLS.md`](docs/RLS.md) |
| State machines & workflow RPCs | [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) |
| Feature → code → tests index | [`docs/REVIEW-MAP.md`](docs/REVIEW-MAP.md) |
| Test suites & release gates | [`docs/TESTING.md`](docs/TESTING.md) |
| Backend schema & RPC reference | [`supabase/README.md`](supabase/README.md) |
| Development tooling / MCP governance | [`docs/DEV-TOOLING.md`](docs/DEV-TOOLING.md) |

# Chapter 14 — Development Workflow

[← Handbook index](README.md)

## Local setup

```bash
git clone https://github.com/hamadalrumaihi/cid.git
cd cid
cp .env.example .env.local     # public keys, pre-wired to the live project
npm install
npm run dev                    # http://localhost:3000
```

Node 22+ and npm are the only prerequisites. `.env.local` values are
public-by-design ([Ch. 18](18-security.md)); note that local dev talks to
the LIVE database — RLS still applies to your account, but treat writes as
real.

## The gates (run before every commit)

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src --max-warnings 0
npm test            # vitest (security-critical pure functions)
npm run build       # next build — all routes must prerender
```

CI (`.github/workflows/ci.yml`) runs the same four on every push/PR;
Dependabot opens weekly dependency PRs gated by the same.

## Shipping

Branch from `main` → PR → the Vercel bot posts a preview URL (check your
change there) → merge → production tracks `main` (atomic alias flip;
instant rollback available in the Vercel dashboard).

## Creating a new feature (the recipe)

1. **Screen**: create `src/components/<feature>/<Feature>View.tsx` —
   start by copying a registry view (VehiclesView is the cleanest
   template) and keep its idioms.
2. **Route**: add the tab to `lib/nav.ts` (PAGE_META + a category's tabs +
   TAB_LABEL) and the switch in `app/(app)/[tab]/page.tsx`.
3. **Data**: if a new table is needed — additive migration on the live
   project, RLS policies (copy the closest pattern in [Ch. 8](08-database.md)),
   realtime publication, FK indexes, then hand-add to
   `database.types.ts`.
4. **Docs**: update `docs/USER-GUIDE.md` (+ regenerate
   `src/components/guide/guideContent.ts`) and this handbook if contracts
   changed.
5. Gates → PR → preview-test the live behavior (two browsers to see
   realtime) → merge.

## Fixing a bug

Reproduce → find the layer ([Ch. 13](13-debugging.md)) → smallest fix →
add/extend a unit test if the bug was in a pure function → gates → PR
with the failure mode described in the commit message.

## Updating dependencies

Dependabot PRs: read the changelog, let CI pass, spot-check the preview
(especially after `next`/`@supabase` bumps — CSP and auth flows are the
sensitive spots). Majors: update deliberately, one at a time.

## Database changes — the ritual

Additive SQL → apply to the live project → verify with the Supabase
security/performance advisors → mirror in `database.types.ts` (same PR) →
note it in `supabase/README.md`'s lineage if it's structural.

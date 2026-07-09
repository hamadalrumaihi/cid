# CID Portal — Criminal Investigation Division

A private, real-time case-management portal for a **State of San Andreas**
roleplay Criminal Investigation Division. The front-end is a **Next.js
single-page app** (React 19, TypeScript, Tailwind CSS v4) served as static
pages from Vercel; all data lives in a **Supabase** Postgres backend behind
Row-Level Security. Every screen is live — when one detective updates a
case, everyone else's screen follows within seconds.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | [Next.js 16](https://nextjs.org) (App Router, static pre-rendering) + React 19 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 (custom dark "investigative" theme, user-selectable accents) |
| Backend | [Supabase](https://supabase.com) — Postgres, Auth, auto-generated REST API, Realtime |
| State | React context + [zustand](https://github.com/pmndrs/zustand) stores (toasts, caches) |
| Graphs | [React Flow](https://reactflow.dev) (case investigation graph) |
| Exports | [@react-pdf/renderer](https://react-pdf.org) (court packets), custom dependency-free `.docx` writer |
| Rich text | [Tiptap](https://tiptap.dev) v3 (WYSIWYG editing, Markdown storage) |
| Media hosting | [FiveManage](https://fivemanage.com) (uploads store URLs only) |
| Testing / CI | vitest + GitHub Actions (typecheck, lint, tests, build on every push/PR) |

## Quick start

Requires Node 22+ and npm.

```bash
git clone https://github.com/hamadalrumaihi/cid.git
cd cid
cp .env.example .env.local   # publishable keys only — see Environment below
npm install
npm run dev                  # http://localhost:3000
```

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development server |
| `npm run build` | Production build (pre-renders all routes) |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (`--max-warnings 0` in CI) |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |

## Environment

All variables are **client-side public values** (the `NEXT_PUBLIC_` prefix
inlines them into the browser bundle). `.env.example` carries working
defaults for the live project.

| Variable | Purpose | Required |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project API URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable client key | Yes |
| `NEXT_PUBLIC_FIVEMANAGE_API_KEY` | Media upload key (referrer-bound) | No — uploads disabled without it |
| `NEXT_PUBLIC_FIVEMANAGE_BASE_URL` | FiveManage API host | No |

> ⚠️ The Supabase **anon / publishable** key is public by design and safe to
> commit — RLS protects the data. **Never** commit the `service_role` key.

## What's inside

Twenty-nine screens in five sections:

| Area | Purpose |
| --- | --- |
| **Command** | Dashboard (KPIs, tickets, activity feed, bureau load, GPS trackers, raid-compensation calculator), division analytics charts, announcements, crime heatmap, roster & commendations |
| **Cases** | Case board + full case detail (evidence & custody chain, template-driven reports with finalize/e-sign, tasks, penal-code charges, case chat with @mentions, investigation graph, zoomable timeline, RICO tracking, sign-off workflow, court-packet export to PDF/DOCX/Markdown), operations/task forces, file attachments |
| **Intelligence** | Persons (with dossier export), BOLO board, gangs (ranks/members/turf), places, vehicle registry with cross-case matching, indicators registry with automatic deconfliction, network graph, narcotics, ballistics, M.O. detector, media vault, records |
| **Reference** | S.A. Penal Code, SOPs & document library (with version history), in-app user guide |
| **Oversight** | My Desk (everything waiting on you), division calendar, weekly shift reports, audit log |

Plus cross-cutting tools: global typo-tolerant search + command palette
(`/` or `Ctrl-K`), notifications (in-app + optional Discord DM), a
follow/watchlist for any record, and undo on every delete.

A few surfaces are **local-only previews** (computed client-side, not
persisted) and are labelled "*local preview — not saved*" — e.g. the
raid-compensation calculator.

## Roles & bureaus (RBAC)

Enforced in the database via RLS, off the signed-in user's `profiles` row.
Roles and bureaus have one canonical definition in `src/lib/roles.ts`.

- **Roles** (`profiles.role`): `detective` → `senior_detective` →
  `bureau_lead` → `deputy_director` → `director`. **Command staff =
  bureau_lead, deputy_director, director** (director is supreme).
- **Bureaus** (`profiles.division`): `LSB` (Los Santos), `BCB` (Blaine
  County), `SAB` (State), `JTF` (Joint Task Force).

Access rules:

- **Deny-by-default:** new sign-ins are inactive and see only their own
  profile until a command user activates them and assigns a role/bureau.
- **Bureau isolation:** a member sees, edits, **and creates** cases only
  within their own bureau; JTF and command staff work across bureaus.
- **Server-authoritative workflows:** the case **sign-off chain**
  (Detective → Bureau Lead → Deputy Director → Director) and **report
  finalize/e-sign** run through SECURITY DEFINER RPCs. The client calls
  the RPCs; it never writes those columns directly, and database triggers
  reject any attempt to.
- **Delete:** command staff only (every delete offers a 6-second Undo).

## Repository layout

```
src/
├── app/          # Next.js routes: one dynamic [tab] route serves all screens
├── components/   # one folder per screen + shell/ (chrome) + ui/ (primitives)
└── lib/          # shared logic: data layer, auth, realtime, exports, domain
supabase/         # backend: schema migrations, RLS, RPCs, edge functions
docs/             # developer handbook, user guide, hardening status
public/           # static assets
```

Start with [`docs/HANDBOOK.md`](docs/HANDBOOK.md) — the full developer
handbook covering architecture, the database, every file, and a
recommended learning order. End users get the in-app guide
(Reference → User Guide, canonical copy in
[`docs/USER-GUIDE.md`](docs/USER-GUIDE.md)).

## Backend

See [`supabase/README.md`](supabase/README.md) for the schema, RBAC
helpers, and workflow RPCs, and [`SETUP.md`](SETUP.md) to stand up a new
project. Migrations live in `supabase/migrations/` (replayed in filename
order by `supabase db reset`); the live project is the deployed source of
truth.

## Deployment

The site deploys from the **`main`** branch to Vercel; every pull request
gets its own preview URL, and GitHub Actions runs typecheck, lint, unit
tests, and a production build on every push. Rollbacks use Vercel's
instant-rollback (deployments are immutable). For a new host, set the
Supabase **Site URL** and **Redirect URLs** to your deployed origin (see
`SETUP.md`).

## Screenshots

*Screenshots are not yet included. The in-app User Guide
(Reference → User Guide) contains illustrated walkthroughs of every
screen.*

## Contributing

- Branch from `main`; keep database migrations **additive**.
- Before opening a PR, run the same gates CI enforces:
  `npm run typecheck && npm run lint && npm test && npm run build`.
- Schema changes must update `src/lib/database.types.ts` in the same PR.

## License

No license file is currently included; this is a private project for the
division's own use.

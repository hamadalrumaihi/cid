# CID Portal — Criminal Investigation Division

A web portal for a **State of San Andreas** roleplay Criminal Investigation
Division. The front-end is a **multi-file vanilla-JS single-page app** (precompiled
Tailwind, **no build step**) served as static files; all data is stored in a
**Supabase** Postgres backend behind Row-Level Security.

## Quick start

Static files — just serve the folder:

```bash
python -m http.server 8000   # then visit http://localhost:8000
```

No bundler or Node required. The app loads `index.html`, which pulls in the
feature scripts in a fixed order (they share one global scope — order matters):

```
supabase.js   # Supabase client + thin data layer (window.CIDDB)
roles.js      # shared role/bureau vocabulary (window.CIDRoles)
core.js       # utilities, navigation, shared constants
casefiles.js command.js narcotics.js ballistics.js personnel.js modus.js
drive.js persons.js gangs.js places.js reports.js rico.js docx.js records.js
signoff.js collab.js heatmap.js shifts.js fivemanage.js
app.js auth.js
```

## What's inside

| Area | Purpose |
| --- | --- |
| **Central Command** | KPIs, tickets, activity feed, bureau load, trackers, raid-compensation calculator |
| **Case Files** | Cases, attachments, the Drive (bureau → case → fillable forms), sign-off workflow |
| **Narcotics / Ballistics / Gangs / Criminal Places** | Domain registries |
| **Personnel** | Officer roster, commendations, evidence/media vault |
| **M.O.** | Modus-operandi profiler |
| **Reports** | Template-driven reports + finalize/e-sign |
| **RICO** | Predicate tracking + `.docx` export |
| **Heatmap / Shifts / Collaboration** | Area analytics, shift reports, chat & announcements |

A few surfaces are **local-only previews** (computed client-side, not persisted) and
are labelled "*local preview — not saved*" — e.g. the raid-compensation calculator
and the sample CI risk matrix.

## Roles & bureaus (RBAC)

Enforced in the database via RLS, off the signed-in user's `profiles` row. Roles
and bureaus have one canonical definition in `roles.js` (`window.CIDRoles`).

- **Roles** (`profiles.role`): `detective` → `senior_detective` → `bureau_lead`
  → `deputy_director` → `director`. **Command staff = bureau_lead, deputy_director,
  director** (director is supreme).
- **Bureaus** (`profiles.division`): `LSB` (Los Santos), `BCB` (Blaine County),
  `SAB` (State), `JTF` (Joint Task Force).

Access rules:

- **Deny-by-default:** new sign-ins are inactive and see only their own profile
  until a command user activates them and assigns a role/bureau.
- **Bureau isolation:** a member sees, edits, **and creates** cases only within
  their own bureau; JTF and command staff work across bureaus.
- **Server-authoritative workflows:** the case **sign-off chain** (Detective →
  Bureau Lead → Deputy Director → Director) and **report finalize/e-sign** run
  through SECURITY DEFINER RPCs. The client calls the RPCs; it never writes those
  columns directly, and database triggers reject any attempt to.
- **Delete:** command staff only.

> ⚠️ The Supabase **anon / publishable** key in `index.html` is public by design and
> safe to commit — RLS protects the data. **Never** commit the `service_role` key.

## Backend

See [`supabase/README.md`](supabase/README.md) for the schema, RBAC helpers, and
workflow RPCs, and [`SETUP.md`](SETUP.md) to stand up a project. Migrations live in
`supabase/migrations/` (replayed in filename order by `supabase db reset`).

## Deployment

The site deploys from the **`main`** branch to its static host (Vercel). For a new
host, set the Supabase **Site URL** and **Redirect URLs** to your deployed origin
(see `SETUP.md`).

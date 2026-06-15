# CID Portal — Criminal Investigation Division

A single-file, offline-capable web portal for a **State of San Andreas** roleplay
Criminal Investigation Division. The entire UI ships as one static `index.html`
(precompiled Tailwind, no build step) and runs straight off GitHub Pages or any
static host. An optional Supabase backend powers a **live, two-way records** tab.

## Quick start

It's a static page — just open it:

```bash
# any static server works; here's one with Python
python -m http.server 8000
# then visit http://localhost:8000
```

Or open `index.html` directly in a browser. No install, bundler, or Node required.

## What's inside

The portal is a client-side SPA with these tabs (all state persists to
`localStorage` unless noted):

| Tab | Purpose |
| --- | --- |
| **Central Command** | KPIs, tickets, activity feed, bureau load, case trackers, raid compensation calculator |
| **Narcotics** | Drug registry |
| **Ballistics** | Test benches + ballistic comparison log |
| **Personnel** | Officer roster, commendations, evidence/media vault |
| **M.O.** | Modus-operandi profiler |
| **Gangs** | Gang/affiliation tracker |
| **Criminal Places** | Labs, stash houses, production sites |
| **Reports** | Report templates + warrant/affidavit chains |
| **RICO** | Predicate tracking + `.docx` export |
| **Drive** | Folder/file organizer |
| **CID Records** | **Live shared records via Supabase** (see below) — degrades gracefully when unconfigured |

## Live CID Records (optional Supabase backend)

The **CID Records** tab is the only feature that talks to a server. It uses
`@supabase/supabase-js` (from CDN) for public reads, Discord / email-magic-link
auth, and realtime sync across all open clients.

- **Unconfigured (default):** the tab shows a setup notice; the rest of the
  portal is fully functional. The placeholder key in the `window.CID_SUPABASE`
  block means nothing live happens until you wire it up.
- **To enable it:** follow [`supabase/CID_RECORDS_SETUP.md`](supabase/CID_RECORDS_SETUP.md)
  — run the migrations, configure auth, and paste your **anon / publishable**
  key into the `window.CID_SUPABASE` block in `index.html`.

### Access model (RLS)

- **Read:** public (logged-out visitors see records on load).
- **Create:** any signed-in user; the new row is stamped with their id.
- **Edit:** a signed-in user may edit **only the records they created**.
- **Delete:** blocked (no policy).

> ⚠️ The **anon / publishable** key is public by design and safe to commit.
> **Never** commit the `service_role` key.

## Project layout

```text
index.html                  # the entire app (UI + logic + inlined Tailwind)
README.md                   # this file
supabase/
  CID_RECORDS_SETUP.md      # step-by-step setup for the live records tab
  README.md                 # backend / RBAC design notes
  migrations/               # SQL migrations (authored; apply via SQL Editor or CLI)
```

## Deployment

Push to a GitHub Pages branch (or any static host) and serve `index.html`. If
you've enabled live records, set the Supabase **Site URL** and **Redirect URLs**
to your deployed origin (see the setup guide).

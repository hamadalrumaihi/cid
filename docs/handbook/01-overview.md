# Chapter 1 — Project Overview

[← Handbook index](README.md)

## What the application is

The **CID Portal** is a private, real-time case-management website for the
Criminal Investigation Division of a Grand Theft Auto V roleplay community
("State of San Andreas"). Detectives sign in, open investigation cases, log
evidence and suspects, chat inside a case, link people/gangs/vehicles/places
together, route finished cases up a chain of command for sign-off, and
export court-ready PDF packets. Everything is **live**: when one detective
changes something, every other signed-in screen updates within seconds,
without refreshing.

## Target users

Division members in four effective tiers (§[Ch. 9](09-auth.md) has the
full model): regular members (`detective`, `senior_detective`), bureau
leads, deputy directors, and command (`director`). Members also belong to a
**bureau** — `LSB`, `BCB`, `SAB`, or `JTF` — and case visibility is
bureau-scoped.

## Main workflows

1. **Run a case**: create → log evidence/reports/tasks/charges → link intel
   → submit for sign-off → export the court packet ([Ch. 4.1](04-features.md)).
2. **Build intelligence**: registries for persons, gangs, vehicles, places,
   indicators — cross-referenced automatically (deconfliction alerts).
3. **Command oversight**: dashboard KPIs, analytics, heatmap, roster
   approval, announcements, GPS-tracker co-signing.
4. **Personal desk**: My Desk (everything waiting on *you*), watchlist,
   calendar, weekly shift reports, notifications.

## The 30-second architecture

There are only two moving parts (plus a file host):

```
┌───────────────────────────┐         ┌──────────────────────────────┐
│  The web app (this repo)  │  HTTPS  │  Supabase (hosted backend)   │
│  Next.js + React + TS     │ ──────► │  Postgres DB + Auth +        │
│  runs in the browser,     │ ◄────── │  auto-REST API + Realtime    │
│  hosted on Vercel         │  wss    │  websockets                  │
└───────────────────────────┘         └──────────────────────────────┘
                                             ▲
                     ┌───────────────────────┘
                     │ file uploads only
              ┌──────┴───────┐
              │  FiveManage  │  (external image/video host)
              └──────────────┘
```

- **This repository** is only the front-end: a Next.js app compiled to
  static HTML + JavaScript, served by Vercel. There is **no custom server**
  — no `/api` folder, no serverless functions.
- **Supabase** bundles the Postgres database, sign-in ("Auth"), an
  automatic HTTP API over the tables ("PostgREST"), and live change
  notifications ("Realtime"). Every security rule that matters lives
  *inside the database* as SQL policies, functions and triggers.
- **FiveManage** hosts uploaded media; the database stores only URLs.

## Technologies (and why)

| Technology | Why this project uses it |
|---|---|
| **Next.js 16** (App Router) | One dynamic `[tab]` route renders every screen; everything pre-renders to static HTML for instant loads; zero-config Vercel deploys. |
| **React 19** | Highly interactive dashboard; state → UI model fits exactly. |
| **TypeScript (strict)** | `src/lib/database.types.ts` types every table — a column typo is a build error. |
| **Tailwind CSS v4** | One dark "investigative" design system as theme tokens; no per-component CSS files. |
| **Supabase** | Replaces an entire custom backend; Row Level Security makes a public client key safe. |
| **zustand** | Tiny global stores (toasts, caches) where React context would be overkill — and non-React code (the data layer) must push toasts. |
| **React Flow** | The case investigation graph. |
| **@react-pdf/renderer** | Court-styled PDF packets rendered in the browser. |
| **Tiptap v3** | WYSIWYG editing that *stores plain Markdown*, so exports and other views are untouched. |
| **vitest + GitHub Actions** | Unit tests for the security-critical pure functions; four CI gates on every push. |

## External services

Supabase (data/auth/realtime), FiveManage (media), Discord (OAuth provider
+ optional DM notifications via a Supabase edge function), Vercel
(hosting/previews/rollback), GitHub Actions (CI). Details:
[Ch. 7](07-api.md) and [Quick Reference](appendix-quick-reference.md).

## The one rule

> **The database is the authority. The UI is a convenience.**
> `canEdit`/`canDelete` in React only hide buttons. Postgres RLS refuses
> rows the signed-in user may not touch, no matter what the JavaScript
> asks. The client is intentionally "dumb" — that's the design, not an
> accident.

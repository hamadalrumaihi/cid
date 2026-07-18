# Chapter 13 — Debugging Guide

[← Handbook index](README.md)

## Where to look, in order

1. **Browser DevTools console** — the app logs nothing routinely, so any
   console error is signal. Network tab: filter `rest/v1` to see every
   query/RPC and its response (RLS denials come back as HTTP errors or
   empty arrays).
2. **The toast** — every surfaced failure passes `humanizeError`. "You
   don't have permission…" = RLS; "already exists" = unique violation.
3. **Supabase Dashboard → Logs** — API, Postgres and Auth logs; the place
   to see the *server's* reason for a refusal.
4. **`audit_log`** (owner account, Oversight → Audit) — every mutation on
   the audited tables with actor + payload. Great for "who changed this?".
5. **Vercel deployment logs** — build failures only (no runtime server).

## Common bugs and their usual causes

| Symptom | Likely cause | Check |
|---|---|---|
| Button click "does nothing" | A mutation's `{error}` is being discarded, or RLS blocked an UPDATE (zero rows, no error) | Network tab for the PATCH; does the caller check `res.error` AND empty `data`? (`RecordsView.save` is the reference pattern) |
| Screen never updates until reload | Table missing from the realtime publication, or the view lacks `useTableVersion` in its effect deps | [Ch. 8.6](08-database.md); grep the view for `useTableVersion` |
| A screen shows nothing but no error | RLS scope — you're signed in as the wrong bureau/role, or the profile is inactive | Try a command account; check `profiles.active` |
| "Could not load: …" notice | The read threw (network, or RLS on a *joined* table) | Network tab; reads are allowed to fail loudly by design |
| New tab/screen 404s or redirects to /command | The nav three-way contract is incomplete | PAGE_META + category tabs + TAB_LABEL + the `[tab]` switch |
| Modal loses focus / re-mounts mid-edit | Someone changed Modal's effect deps or removed the ref-routing | `ui/Modal.tsx` header comment — deps must stay `[open]` |
| Types say a column exists but runtime is `undefined` | `database.types.ts` drifted from the live schema, or a `select` projection omits the column | Compare with the live table; grep the projection strings |
| PDF export dies with a WASM/CSP error | CSP `script-src` lost `wasm-unsafe-eval` | `next.config.ts` |
| Sign-in loops or lands signed-out | `/` redirected before the token was consumed | `app/page.tsx` must wait for the auth event — don't "simplify" it |
| Duplicate toasts / double realtime | A second channel was opened outside `subscribeTable` | `lib/realtime.ts` registry |
| Wrong colors (blue renders amber) | Not a bug — the accent remap in `globals.css` rewrites blue-* utilities | [Ch. 15](15-conventions.md) |

## Safe debugging workflow

1. Reproduce against a **preview deployment** or `npm run dev` — never
   experiment against production data with a command account you don't
   need.
2. Read the failing request in the Network tab FIRST (URL, payload,
   response) — it usually names the table/policy at fault.
3. If it smells like RLS, test the same query in the Supabase SQL editor
   with `set role authenticated; set request.jwt.claims …` or simply
   compare two accounts of different roles.
4. Fix with the smallest change, then run the four gates
   (`npm run typecheck && npm run lint && npm test && npm run build`).
5. If the fix touches the database: **additive migration**, update
   `database.types.ts`, re-check the security advisors.

## Debugging don'ts

- Don't add the `service_role` key ANYWHERE client-side to "see past" RLS.
- Don't auto-retry mutations while diagnosing (double-writes).
- Don't strip a sequence guard because "it works without it" — it works
  until requests overlap.

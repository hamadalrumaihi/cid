# Chapter 11 — Dependency Map

[← Handbook index](README.md)

## Runtime layers

```
        ┌────────────────────────── Browser ──────────────────────────┐
        │  app/(app)/[tab]/page.tsx ── 29 feature views                │
        │        │                        │                            │
        │   shell/* (chrome)          ui/* (Modal, DataTable, …)       │
        │        └────────┬───────────────┘                            │
        │                 ▼                                            │
        │   lib/auth ── lib/profiles ── lib/nav ── lib/toast           │
        │       │                                                      │
        │   lib/db  ◄── lib/{watchlist,operations,search,notify,…}     │
        │       │            lib/realtime (wss)                        │
        │       ▼                 │                                    │
        │  lib/supabase ──────────┘                                    │
        └────────┼──────────────────────────────────────┼─────────────┘
                 ▼ HTTPS (REST + RPC)                    ▼ multipart
        ┌─────────────────────────┐             ┌─────────────┐
        │ Supabase                │             │ FiveManage  │
        │  Auth ─ profile trigger │             └─────────────┘
        │  PostgREST ─ RLS ─ 47 t │
        │  RPCs ─ private.* fns   │──► edge fn ──► Discord DM
        │  Realtime publication   │
        └─────────────────────────┘
```

## One interaction, end to end

```
User clicks "Save" in a modal
  ↓ component save() builds a payload
  ↓ lib/db.insert('vehicles', payload)          ← the only DB path
  ↓ lib/supabase client attaches the JWT
  ↓ PostgREST INSERT … RLS: private.is_active()
  ↓ triggers: touch / audit
  ↓ {data} back → toast('registered') → modal closes
  ↓ realtime: postgres_changes event on rt_vehicles (all browsers)
  ↓ lib/realtime bumps versions.vehicles
  ↓ every view with useTableVersion('vehicles') refetches
  ↓ UI shows the new row — including for OTHER signed-in users
```

## The load-bearing import edges

- `lib/db` ← ~44 components + 6 libs (the fattest edge)
- `lib/auth` ← ~40 files · `lib/profiles` ← ~24 · `lib/format` ← ~25
- `persons/IntelProfile` ← persons, bolo, gangs, network
- `cases/CaseDetail` ← CasesView AND RicoView (internal `RicoTab` import)
- `lib/forms` ← CaseDetail, BoloView, CaseGraphTab, dossier, packet
- `guideContent.ts` ← **generated from** `docs/USER-GUIDE.md`

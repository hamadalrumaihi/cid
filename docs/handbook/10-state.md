# Chapter 10 — State Management

[← Handbook index](README.md)

The app deliberately has **no general data cache**. Layers, narrowest to
widest:

| Layer | What lives there | Where |
|---|---|---|
| Component state (`useState`) | Screen-local rows, filters, modal state, form fields (modals mount fresh per open) | every view |
| Derived state (`useMemo`) | Filtering, grouping, chart buckets, graph building | big views |
| React Context | Two: `AuthProvider` (session/profile/capabilities) and `ToolsWorkspaceContext` (the Investigative Tools workspace — open tabs, active key, open/close/dirty ops; `useToolsWorkspace()` returns null outside `/tools` so hosted views no-op) | `lib/auth.tsx`, `components/tools/ToolsWorkspaceContext.tsx` |
| zustand stores | Toasts, dialogs, realtime versions, profiles cache, operations cache, watchlist, pins, draft save-state — singletons that non-React code must reach | `lib/*`, `ui/dialog` |
| localStorage (`Store`) | Device preferences + legacy-app continuity, ONE JSON blob (`cid-portal-v3`); includes the ids-only recents trail (`lib/recents.ts`) | `lib/store.ts` |
| localStorage (`Drafts`) | Draft mirror keys (`cid-draft:…`) — `lib/userDrafts` mirrors per-user (`u:<uid>:<key>`) before every server save; legacy shared keys survive for the legal stash | `lib/drafts.ts` |
| sessionStorage | Investigative Tools open tabs, per signed-in user, **ids only** (`cid-tools-workspace:<uid>`) — titles are re-fetched RLS-scoped on restore, invisible rows close silently | `components/tools/ToolsView.tsx` |
| **Per-user DB state** | Cross-device personal state, owner-only RLS, never shared data: `user_pins` (pinned records, ids only — `lib/pins.ts`), `user_drafts` (autosaved drafts, 64 KiB cap — `lib/userDrafts.ts`), `user_prefs` (small keyed jsonb: saved views `views:<section>` — `lib/savedViews.ts`; notification mutes `notif_muted` — `lib/notifications.ts`) | Supabase |
| The database | ALL shared data — every screen refetches on mount and on realtime bumps | Supabase |

**Personalization rule**: anything per-user that should follow the member
across devices goes in one of the three `user_*` tables above (owner-only
RLS, no audit triggers, no realtime, size-capped jsonb); anything genuinely
device-local goes in the `Store` blob. Ids only for anything referencing
records — consumers re-resolve titles through the viewer's RLS at render, so
lost access hides entries instead of leaking stale labels. Don't invent a
fourth mechanism.

## The refresh idiom (memorize — it's in ~30 files)

```tsx
const version = useTableVersion('cases')            // realtime counter
const refresh = useCallback(async () => { … }, [state])
useEffect(() => {
  const t = setTimeout(() => { void refresh() }, 0) // deferred: lint-clean,
  return () => clearTimeout(t)                      // deterministic prerender
}, [refresh, version])
```

**How data moves**: user action → `db.ts` write → Postgres → realtime
event → channel handler bumps `versions[table]` → every subscribed view's
effect refires → refetch → UI updates. Other users' browsers get the same
websocket event, so everyone converges. Simple — no cache invalidation —
at the cost of whole-table refetches ([Ch. 17](17-performance.md)).

## Async races

Sequence guards (`seq` counters in SearchPalette/IntelProfile, `cancelled`
flags in the vehicles scanner) ensure only the newest request's result
lands. If you add a fetch that can overlap itself, copy that pattern.

## Realtime lifecycle

`subscribeTable` opens ONE channel per table per session (module-level
Set); sign-out removes all channels (`auth.tsx`) and resets the registry.
`useTableVersion` is the only consumer API — never open channels directly.

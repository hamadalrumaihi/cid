# Chapter 10 — State Management

[← Handbook index](README.md)

The app deliberately has **no general data cache**. Layers, narrowest to
widest:

| Layer | What lives there | Where |
|---|---|---|
| Component state (`useState`) | Screen-local rows, filters, modal state, form fields (modals mount fresh per open) | every view |
| Derived state (`useMemo`) | Filtering, grouping, chart buckets, graph building | big views |
| React Context | Two: `AuthProvider` (session/profile/capabilities) and `ToolsWorkspaceContext` (the Investigative Tools workspace — open tabs, active key, open/close/dirty ops; `useToolsWorkspace()` returns null outside `/tools` so hosted views no-op) | `lib/auth.tsx`, `components/tools/ToolsWorkspaceContext.tsx` |
| zustand stores | Toasts, dialogs, realtime versions, profiles cache, operations cache, watchlist — singletons that non-React code must reach | `lib/*`, `ui/dialog` |
| localStorage (`Store`) | Device preferences + legacy-app continuity, ONE JSON blob (`cid-portal-v3`) | `lib/store.ts` |
| sessionStorage | Investigative Tools open tabs, per signed-in user, **ids only** (`cid-tools-workspace:<uid>`) — titles are re-fetched RLS-scoped on restore, invisible rows close silently | `components/tools/ToolsView.tsx` |
| The database | ALL shared data — every screen refetches on mount and on realtime bumps | Supabase |

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

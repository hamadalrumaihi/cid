# Chapter 15 — Coding Conventions

[← Handbook index](README.md)

These are the patterns the repository **actually uses** — follow them so
your code reads like the code around it.

## Naming & files

- One folder per screen under `src/components/`; the main component is
  `<Feature>View.tsx`; helpers live beside it (`caseUtils.ts`,
  `announceUtils.ts`). Shared logic goes in `src/lib/` (camelCase files).
- Components and types are PascalCase; helpers camelCase; constants
  SCREAMING_SNAKE (`PAGE_META`, `FORM_SCHEMAS`, `CASE_STATUSES`).
- Imports use the `@/` alias (`@/lib/db`), never relative `../../`.

## Component structure (the registry-view skeleton)

```tsx
'use client'
export function FeatureView() {
  const { state, canEdit, canDelete } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const version = useTableVersion('table')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    setLoading(true); setErr(null)
    try { setRows(await withRetry(() => list('table', { order: 'updated_at', ascending: false }))) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [state])

  useEffect(() => {                                   // the deferred-effect pattern
    const t = setTimeout(() => { void refresh() }, 0) // (or queueMicrotask)
    return () => clearTimeout(t)
  }, [refresh, version])
  …
}
```

## Data access

- ONLY through `lib/db.ts`. Reads: try/catch (they throw). Writes: check
  `res.error` and toast it; for updates where RLS might silently match
  nothing, also check for empty `data` (RecordsView is the reference).
- `withRetry` for initial loads of important screens; never for writes.
- Privileged/multi-step flows: `rpc()` only — never re-implement
  client-side.
- Deletes: `uiConfirm` (or `deleteWithUndo`'s built-in confirm) + Undo;
  configure `children`/`setNullRefs` to match the FK schema.

## Effects & async

- State-setting effects defer via `setTimeout(0)`/`queueMicrotask`
  (lint-clean, deterministic prerender).
- Overlapping fetches get a sequence guard (`seq` counter) or `cancelled`
  flag.
- No `Date.now()`/randomness during render — stamp a `loadedAt` in the
  fetch and derive from state (analytics/heatmap do this).

## Modals & forms

- Modals mount fresh per open; field state seeds from props (no reset
  effects). Provide `dirty()` so Modal can guard discards.
- Validate lightly (required fields → warn toast); let the database
  enforce real constraints and `humanizeError` translate them.
- Busy-guard submit buttons (`disabled={busy}`) — double-submit was a
  real bug class.

## Security idioms

- `safeUrl()` on EVERY DB-sourced href/src. No `dangerouslySetInnerHTML`
  (one sanctioned static exception in `app/layout.tsx`).
- Never select `profiles.email` outside command paths (`PROFILE_COLS`).
- FK-preservation: when an edit form's select options may not include the
  currently-linked row (stale cache/restricted), render a synthetic
  "(current … — loading…)" option so saving can't null the link.

## Styling

- Tailwind utilities inline; theme tokens from `globals.css` (`ink-*`,
  `badge-500`). **Blue utilities are accent-remapped** — `text-blue-300`
  renders in the user's chosen accent; that's intended.
- Notices/empty states: the themed ALL-CAPS "// " style; loading and
  error notices use the shared card look.

## Comments & commits

- Comments state constraints the code can't show ("email is command-only
  — updateNoSelect required"), often citing the vanilla origin. No
  narration.
- Commits: `type(scope): summary` (`feat(indicators): …`,
  `chore(hardening): …`) with a body explaining behavior, not diffs.

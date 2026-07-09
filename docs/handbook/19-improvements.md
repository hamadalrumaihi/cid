# Chapter 19 — Improvement Ideas

[← Handbook index](README.md)

Recommendations only — nothing here is implemented. Effort: S < 1d,
M = days, L = week+.

## Quick wins (S)

| Idea | Why / benefit | Risk |
|---|---|---|
| Drop unused deps (`react-hook-form`, `zod`*, `@tanstack/react-query`) | Zero imports; smaller install/audit surface | none |
| Drop/verify `bootstrap_*` RPCs | Close a setup-era privileged path | none (verify first) |
| Wire or delete `lib/drafts.ts` | It's good never-lose-work code with zero importers | none |
| Script + CI check for `guideContent.ts` generation | Kills a proven drift class | none |
| Fix the guide's hardcoded case-tab illustration | Already drifted from the real tabs | none |
| Fold `chargeByCode` into `penalByCode`; migrate off deprecated `roles.isCommand` | Naming hygiene | trivial |

*or keep zod and use it — see below.

## Medium improvements (M)

| Idea | Why / benefit | Risk |
|---|---|---|
| **Commit the SQL schema** (`schema.sql` dump + migration log for post-folder changes) | Today the live DB is the only source of truth — no reviewable history | none |
| **Split `CaseDetail.tsx`** into per-tab files (keep the `RicoTab` export) | The hottest, biggest file becomes reviewable | low (gates cover it) |
| **Type the JSON columns** (`reports.fields`, `media.tags`, `cases.charges`, announcement mentions/links) with zod at the read boundary | Today's casts hide shape drift | low |
| Extract a `useRegistry` hook from the ~10× repeated registry skeleton | Hundreds of duplicated lines; new registries in minutes | medium — migrate incrementally |
| Nonce-based CSP (drop `unsafe-inline` scripts) | Defense in depth | medium (Next runtime quirks) |
| Accessibility pass on color-only heat tints; keyboard path for board moves | A11y gaps found in review | low |

## Long-term (L)

| Idea | Why / benefit | Risk |
|---|---|---|
| **RLS/RPC test suite** (pgTAP or vitest against a Supabase branch with two test users) | The security wall has zero automated coverage — highest-value testing investment | low |
| Server-side pagination/filtering for cases & audit (from DEFERRED.md) | Removes the whole-table-refetch ceiling | medium — touches the refresh idiom |
| Component/E2E smoke tests (sign-in → create case → sign-off) | Catches integration regressions CI can't | low |

## By theme

- **Technical debt**: schema-in-repo, CaseDetail split, unused deps,
  drafts.ts, registry-hook extraction.
- **Performance**: pagination (when data grows), scanner bounds.
- **Security**: RLS tests, bootstrap RPC removal, nonce CSP, dashboard
  checklist completion (`HARDENING.md`).
- **DX**: guide generation script, JSON typing, more unit tests around
  pure domain logic (penal totals, matchKey).
- **UX/A11y**: heat-tint labels, keyboard board moves, notification
  mute preferences, mark-all in the bell.
- **Scalability**: pagination + selective realtime payloads (use the
  event's row data instead of refetching) — a natural pair.

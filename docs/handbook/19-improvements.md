# Chapter 19 — Improvement Ideas

[← Handbook index](README.md)

Recommendations from the July 2026 review; rows marked **done** have since
shipped. Effort: S < 1d, M = days, L = week+.

## Quick wins (S)

| Idea | Why / benefit | Risk |
|---|---|---|
| ~~Drop unused deps (`react-hook-form`, `@tanstack/react-query`)~~ **done** — dropped; zod kept and adopted (`src/lib/schemas.ts`) | Zero imports; smaller install/audit surface | none |
| Drop/verify `bootstrap_*` RPCs | Close a setup-era privileged path | none (verify first) |
| ~~Wire or delete `lib/drafts.ts`~~ **done** — wired into the report/chat/legal editors | Never-lose-work code | none |
| ~~Script + CI check for `guideContent.ts` generation~~ **done** — `npm run gen:guide` + drift check | Kills a proven drift class | none |
| ~~Fix the guide's hardcoded case-tab illustration~~ **done** — the guide regenerates from `docs/USER-GUIDE.md` | Was drifting from the real tabs | none |
| Fold `chargeByCode` into `penalByCode`; migrate off deprecated `roles.isCommand` | Naming hygiene | trivial |


## Medium improvements (M)

| Idea | Why / benefit | Risk |
|---|---|---|
| **Commit the SQL schema** (`schema.sql` dump + migration log for post-folder changes) | Today the live DB is the only source of truth — no reviewable history | none |
| ~~**Split `CaseDetail.tsx`** into per-tab files (keep the `RicoTab` export)~~ **done v1.1.0** — tabs live in `cases/tabs/` | The hottest, biggest file becomes reviewable | low (gates cover it) |
| **Type the JSON columns** (`reports.fields`, `media.tags`, `cases.charges`, announcement mentions/links) with zod at the read boundary | Today's casts hide shape drift | low |
| Extract a `useRegistry` hook from the ~10× repeated registry skeleton | Hundreds of duplicated lines; new registries in minutes | medium — migrate incrementally |
| Nonce-based CSP (drop `unsafe-inline` scripts) | Defense in depth | medium (Next runtime quirks) |
| Accessibility pass on color-only heat tints; keyboard path for board moves | A11y gaps found in review | low |

## Long-term (L)

| Idea | Why / benefit | Risk |
|---|---|---|
| ~~**RLS/RPC test suite**~~ **done** — the live `tests/rls/` suite | Highest-value testing investment | low |
| Server-side pagination/filtering for cases & audit (from DEFERRED.md) | Removes the whole-table-refetch ceiling | medium — touches the refresh idiom |
| ~~Component/E2E smoke tests~~ **done** — `tests/e2e/` (smoke + per-domain specs) | Catches integration regressions CI can't | low |

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

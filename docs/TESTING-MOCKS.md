# MSW Mock Layer (offline integration tests)

Phase 1 of the integration program: a Mock Service Worker layer that lets component and data-layer tests run the **real** supabase-js client — through the **real** `src/lib/db.ts` contract — against an in-memory PostgREST emulation, fully offline. It complements the live suites in [`docs/TESTING.md`](TESTING.md); it never replaces them (the RLS suite remains the only proof that the *actual* security wall holds).

## How it works

`src/lib/supabase.ts` creates supabase-js **without a custom fetch**, so all PostgREST / GoTrue / edge-function traffic goes through `globalThis.fetch` — exactly what MSW's node server intercepts. `src/lib/fivemanage.ts` uses a bare `fetch` too. Nothing in the app changes; the mock layer sits entirely underneath it.

| Piece | Path | Role |
| --- | --- | --- |
| Handlers | `src/mocks/handlers/` | PostgREST tables (catch-all + filter engine), RPC (typed, representative set), GoTrue password-grant auth, FiveManage uploads, edge functions |
| Store | `src/mocks/store.ts` | in-memory rows + scenario switches; reset between tests |
| Fixtures | `src/mocks/fixtures/` | row builders returning **complete `Tables<'…'>` Rows** + `roleSession()` + case bundles |
| Scenarios | `src/mocks/scenarios.ts` | one-import surface: data builders + network/permission shaping |
| Node server | `src/mocks/server.ts` | vitest entry (started by `tests/msw/setup.ts`) |
| Browser worker | `src/mocks/browser.ts` | reserved for the Storybook phase — inert, see below |
| Suite | `tests/msw/` | the `msw` vitest project (happy-dom), part of plain `npm test` |

Run it with `npm test` (both projects) or `npx vitest run --project msw`. The suite is fully offline and needs no secrets — forks and `main` stay green.

## What the handlers emulate (and what db.ts observes)

The mock reproduces the **wire contract** `src/lib/db.ts` documents, not the whole of PostgREST:

- reads → JSON arrays (object shape under `Accept: vnd.pgrst.object+json`); `Prefer: count=exact` → `Content-Range` for `countRows()`;
- `insert()` → `Prefer: return=representation` echo (201);
- **zero-row update = RLS-blocked** — an UPDATE/DELETE the policy filters matches nothing: success status, empty representation, **no error**. `data.length === 0` is the only blocked-write signal, and `updateNoSelect()` (`return=minimal`, 204) cannot see it — both faithfully mocked;
- RLS INSERT is the loud exception (403 / `42501` row-level-security violation); revoked grants are loud on every verb (403 / `42501`);
- filter surface: `eq` / `is` / `in` / `or=(…ilike…)` (what `ilikeAny()` emits) / `order(.nullsfirst)` / `limit` / `select` projection. A query shape beyond that means the parser in `src/mocks/handlers/postgrest.ts` needs extending — it will fail loudly, never silently.

Server-authoritative RPCs (finalize, sign-off, roster) are **deliberately not re-implemented** — pin an outcome with `rpcResult(fn, value)`; unknown RPCs answer PostgREST's real 404 `PGRST202` so a spec that needs a new handler fails loudly.

## What it cannot mock: realtime

Supabase realtime is a WebSocket protocol — outside MSW's HTTP reach, and the app degrades gracefully without it. Live-update behavior is driven by the exported version store instead:

```ts
import { useRealtimeStore } from '@/lib/realtime'
useRealtimeStore.getState().bump('cases') // subscribed views refetch
```

Do not try to mock the realtime socket; bump the store.

## Fixtures and scenarios

Every row builder returns a **complete Row typed from `src/lib/database.types.ts`** — schema drift breaks `tsc --noEmit` in the fixtures instead of letting the mock layer fork into a parallel domain model. Compose, don't hardcode:

| Builder | Arranges |
| --- | --- |
| `roleSession(role, { division, active })` | seeded profile + GoTrue password-grant credentials for every role: `applicant` (inactive, JTF default), `detective` → `director`, `owner` (`is_owner` flag on a plain rank, like the live owner fixture) |
| `emptyCase()` / `populatedCase()` | fresh case / case with lead, reports, tasks, media, person, notification |
| `archivedCase()` | closed + `archived_at` set (invisible to the app's `is: { archived_at: null }` filter) |
| `legalHoldCase()` | active `legal_holds` row tied to a pending `legal_requests` DOJ submission |
| `restrictedMediaCase()` | public + `restricted` + archived media on one case |
| `slowNetwork(ms)` / `offline()` | latency on every response / network failure (note: postgrest-js retries network errors ~3×, ≈7 s, before surfacing) |
| `failedUpload(msg)` | FiveManage → HTTP 500 |
| `permissionDenied(table)` | revoked grant: every verb 403 / `42501` |
| `rlsRestricted(table)` | the silent wall: reads `[]`, UPDATE/DELETE zero-row, INSERT 403 |
| `rpcResult(fn, value)` | pin a (typed) RPC result |

Everything resets between tests (`resetMockStore()` in `tests/msw/setup.ts`): rows, denials, sessions, latency, RPC overrides, deterministic ids.

**Adding a handler/fixture:** new table → usually nothing (the PostgREST catch-all serves any seeded table); new query shape → extend the parser in `handlers/postgrest.ts`; new read-RPC → add a typed case in `handlers/rpc.ts`; new domain rows → add a builder in `fixtures/rows.ts` returning a full `Tables<'…'>` Row and, if it's a recurring arrangement, a bundle in `fixtures/cases.ts` re-exported through `scenarios.ts`.

## Production-exclusion guarantees

The mock layer is dev/test-only by construction, and `tests/msw/production-exclusion.test.ts` proves it on every run:

1. **Static import graph** — no module under `src/app`, `src/components`, or `src/lib` imports `src/mocks` (scanned, not assumed). Only tests and the mock layer itself may.
2. **Build output sentinel** — every mocks module carries the `MSW_BUNDLE_SENTINEL` literal (`src/mocks/env.ts`); when a `.next/` build exists, every emitted JS chunk (and specifically the shared first-load set the bundle budget gates) is scanned for the sentinel and MSW's own markers. Self-skips without a build so offline runs stay green.
3. **No worker in `public/`** — `public/mockServiceWorker.js` is deliberately **not generated** (anything in `public/` ships verbatim). Browser mode is deferred to the Storybook phase, which must generate the worker into Storybook's own static dir — the test pins `public/` clean until then. `src/mocks/browser.ts` exists but is inert.
4. **Containment in tests** — the MSW server runs with `onUnhandledRequest: 'error'` and supabase-js is pointed at an unresolvable `.test` host (`tests/msw/env.ts`), so the suite can never reach a live project even if a handler is missing.

`npm run build` + `npm run check:bundle` stayed at the pre-MSW baseline (128.9 KB gzip shared first-load) — the layer adds zero bytes to production.

## Scenario coverage vs the program list

| Program scenario | Covered by |
| --- | --- |
| per-role sessions (applicant→owner, bureau, active flag) | `roleSession()` + `tests/msw/scenarios.test.ts` |
| empty / populated / archived / legal-hold / restricted-media case | case bundles + `tests/msw/scenarios.test.ts`, `schema-fidelity.test.ts` |
| gated writes (zero-row RLS block, 403 grant denial, RLS insert violation, CAS race) | `tests/msw/permission-semantics.test.ts` |
| degraded network (slow / offline) & failed upload | `tests/msw/scenarios.test.ts` |
| search / coverage reads (`search_all`, `doj_bureau_coverage`) | `handlers/rpc.ts` + `schema-fidelity.test.ts` |
| live updates | **not MSW** — `useRealtimeStore` bump (documented above) |
| component-through-mock smoke | `tests/msw/record-search-picker.test.tsx` (provider-light by design; auth-entangled views are Phase 2 harness work) |

What "green" here means: the app's data layer behaves correctly against a faithful wire contract. What it does **not** mean: the real policies enforce that contract — that is the live RLS suite's job, always.

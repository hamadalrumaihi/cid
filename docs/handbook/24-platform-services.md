# Chapter 24 — Platform services

[← Handbook index](README.md)

The platform upgrade (migration `20261105120000_platform_upgrade`, one PR)
added a services tier the portal does not depend on: evidence integrity and
custody, background jobs with an in-Supabase runner and an optional worker,
server-rendered case packets with manifests, document extraction / tools /
search, crawled external sources, one RLS-scoped graph RPC, three search
tiers, feature flags and system health. This chapter is the developer's map.
The design and the decisions are in [`docs/PLATFORM-UPGRADE.md`](../PLATFORM-UPGRADE.md),
the authority rules in [`docs/AUTHORIZATION.md` §22](../AUTHORIZATION.md),
the member's view in [`docs/WORKFLOWS.md` §16–§18](../WORKFLOWS.md) and
[`docs/USER-GUIDE.md`](../USER-GUIDE.md), operations in
[`docs/OPERATIONS.md` §11](../OPERATIONS.md).

## 24.1 The one rule, restated

**Nothing here invents an authority, and nothing here runs in the request
path.** Every new table has RLS on with SELECT-only client policies built
from the existing chokepoints (`perm_registry_visible`, `can_read_case`,
`case_writable`, `is_owner`, the new `external_source_visible` /
`semantic_chunk_visible`); every write is a `security definer` RPC or the
service role; every long operation is a `background_jobs` row whose result
arrives as a notification. The CI rule is not re-implemented anywhere — no
new code joins `confidential_informants` or `ci_*`, and `persons` still has
no CI column. Restricted media, SIU-blocked sections, sealed legal and
restricted intelligence are excluded **server-side before** a document,
packet, index, chunk, graph node or notification is built.

## 24.2 The map

| Area | Server | Client | Tests |
|---|---|---|---|
| Evidence | `media` (+22 columns), `evidence_custody_events`, `evidence_*` RPCs, `media_protect_integrity`, `custody_chain_*`, bucket `case-evidence` | `cases/tabs/MediaTab.tsx`, `cases/tabs/evidence/*`, `src/lib/evidence.ts`, `hash.ts`, `evidenceQueue.ts` | `tests/rls/v192a`, e2e `evidence`, `hash.test`, `evidence.test` |
| Jobs | `background_jobs`, `private.job_enqueue` / `jobs_kick` / `job_reap`, `job_*` (service), `background_job_cancel` / `_retry` / `_stats`, cron kick + reap | `src/lib/jobsModel.ts`, `services/queues/jobs.ts`, `cases/tabs/documents/JobsTray.tsx` | `v192a` #11, `jobsModel.test` |
| Packets, manifests, bundles | `case_packets`, `export_manifests`, `case_packet_*`, `manifest_verify`, `evidence_bundle_*`, buckets `case-packets` / `exports` | `src/lib/packets.ts`, `manifest.ts`, `services/pdf`, `cases/tabs/documents/{GeneratePacketDialog,CasePacketsSection,VerifyPackageDialog}.tsx`, `scripts/verify-bundle.mjs` | `v192b`, e2e `packets`, `packets.test`, `manifest.test` |
| Documents | `document_pages`, `document_extractions`, `document_tool_request`, `document_extract_*`, `document_search`, bucket `case-documents` | `src/lib/documents.ts`, `services/documents`, `cases/tabs/DocumentsTab.tsx` + `documents/*` | `v192b`, `documents.test` |
| External sources | `external_sources` / `_versions` / `_links`, `crawler_policy`, `external_source_*`, `crawler_policy_set`, `private.url_static_check`, bucket `external-source-snapshots` | `src/lib/externalSources.ts`, `urlPolicy.ts`, `services/crawler`, `field/ExternalSourcesPanel.tsx` + dialogs | `v192c` #1–#7, e2e `sources`, `urlPolicy.test`, `externalSources.test` |
| Graph | `graph_expand` (INVOKER; optional `graph_path`) | `graph/InvestigationGraph.tsx`, `graph/GraphCanvas.tsx`, `src/lib/graphModel.ts`, `network/NetworkView.tsx`, `cases/CaseGraphTab.tsx` | `v192c` #8–#9, e2e `graph`, `ci-visibility`, `graphModel.test` |
| Search | `document_search`, `external_source_search`, `search_authorize`, `semantic_chunks` + `semantic_search`, `hybrid_search`, `search_index_queue`; functions `search-query`, `semantic-query` | `services/search/search-service.ts`, `shell/SearchPalette.tsx` | `v192c` #9, `search-service.test` |
| Flags, health, telemetry | `feature_flags` + `feature_flag_set`, `service_health_events` + `system_health`, cron `health-probe` | `src/lib/flags.ts`, `owner/OwnerView.tsx` (System Health), `src/lib/errorReport.ts` + `services/telemetry`, `src/instrumentation.ts` | `v192c` #10, `flags.test`, `scrub.test` |
| Runner and worker | `supabase/functions/jobs-runner`, `_shared/*` | `workers/` (BullMQ), `docker-compose.yml` | `workers/test`, the three-copy identity in `urlPolicy.test` |
| Offline contract | — | `src/mocks/handlers/platform.ts`, `src/mocks/fixtures/rows.ts` builders for the fourteen tables | `tests/msw/*` |

## 24.3 Jobs — how work moves

```
request RPC ──► private.job_enqueue(queue, kind, key, args, case, subject)   -- idempotent on (kind, key)
                    │ insert … on conflict do update; perform private.jobs_kick()
                    ▼
      pg_net POST /functions/v1/jobs-runner  (x-jobs-secret = app_secrets.JOBS_SECRET)   + cron every 2 min
                    ▼
      jobs-runner: job_claim(worker, queues, kinds, 5) → for update skip locked, lease 5 min, attempts+1
                    │ run (50 s budget) → job_heartbeat(progress) … → job_complete(result) | job_fail(error, retryable)
                    │        retry: run_after = now() + least(1 h, 5 s · 2^attempts) while attempts < max_attempts
                    │        else: failed + private.job_failed_notify → background_job_failed (Owner)
                    ▼
      *_result RPC (service role) writes the outcome, appends custody, notifies the requester with ids + a deep link
      cron every 5 min: private.job_reap() — a lapsed lease goes back to queued
```

The worker (`workers/src/index.ts`) does exactly the same through the same
four RPCs; when `REDIS_URL` is set the claimed row is mirrored into a BullMQ
queue for concurrency / rate limiting — Redis holds nothing durable. The
runner never claims a kind it cannot run, so a worker-only job simply waits
(visible as `oldest_queued_seconds` in `system_health()`).

**Adding a job kind.** (1) Add the kind + queue to the `background_jobs`
CHECK and to `src/lib/jobsModel.ts` `JOB_KINDS`; (2) a request RPC that
validates authority with the existing chokepoints and calls
`private.job_enqueue` with **ids only** in `args`; (3) the processor in
`supabase/functions/_shared/jobCore.ts` (copied byte-for-byte to
`workers/src/jobCore.ts`) or, for a provider-backed kind, in
`workers/src/jobs/`; (4) a `*_result` service RPC that writes the outcome
under the service GUC and notifies through `private.action_notify`; (5) the
notification kind in `src/lib/notificationTitles.json` + `sync:notif-titles`;
(6) the mock in `src/mocks/handlers/platform.ts`; (7) an allow + deny test.

## 24.4 Evidence — the columns the client may never write

`sha256`, `byte_size` (after registration), `mime` (after registration),
`evidence_number`, `integrity_status`, `last_integrity_check`,
`current_custodian`, `parent_media_id`, `derivative_type`,
`derivative_service`, `derivative_service_version`, `parent_sha256`,
`sealed_at`, `sealed_by` — `private.media_protect_integrity()` raises P0403
unless `current_setting('cid.evidence_service', true) = 'on'`, which only the
definer RPCs set. The descriptive family (`classification`, `source`,
`collected_by`, `collected_at`, `location_collected`) edits under `media_upd`.
The custody ledger: `private.custody_event(media, type, reason, prev, next,
job, export, meta)` is the one writer; `custody_chain_stamp` computes
`event_hash = sha256(prev_hash ‖ custody_canonical(NEW))` under an advisory
lock; `custody_chain_block` refuses UPDATE / DELETE / TRUNCATE for every role.
Derivatives are new `media` rows via `evidence_derivative_register` (service)
— never an overwrite. The bucket path is the contract:
`case/<case_id>/<media_id>/<file>`; `evidence_register` refuses any other
shape and any row without a `storage_path` (`bad_state`).

## 24.5 Packets — the snapshot is the security boundary

`case_packet_request` does not render; it **snapshots**.
`private.case_packet_snapshot(case, sections)` runs under the caller and
collects labels, numbers, text, evidence numbers, sha256 hex and the storage
paths of *included* media, using `perm_registry_visible`,
`has_restricted_packet_approval`, `siu_blocked` and `can_view_legal_request`
— it has no CI arm and cannot grow one. Whatever the renderer prints later
comes from that JSON, so the renderer (service role) never decides
visibility. `excluded: {restricted_media, sealed_legal}` is stored so the
cover can say what was left out. The manifest shape is fixed
(`manifest_version: 1`, `files[{path, size, sha256, source}]`,
`source_evidence_ids`) and `manifest_sha256` is the hash of the canonical
text the runner wrote to `manifest.json`, so `manifest_verify` and
`scripts/verify-bundle.mjs` agree byte for byte.

## 24.6 External sources — the URL policy lives in four places

`private.url_static_check(p_url)` in Postgres, and three **byte-identical**
TypeScript copies: `supabase/functions/_shared/urlPolicy.ts` (the runner),
`src/lib/urlPolicy.ts` (the client's pre-check and the vitest suite),
`workers/src/urlPolicy.ts` (the worker). Edit the `_shared` copy and copy it
to the other two — `src/lib/urlPolicy.test.ts` fails when they drift and pins
every blocked class (scheme, userinfo, length, local / internal names, every
private / loopback / link-local / CGNAT / metadata range in v4 and v6 and
their mapped / compatible / NAT64 / 6to4 disguises, the crawler block / allow
lists). The static check is necessary, not sufficient: the fetch provider
resolves DNS and re-checks **every** address of **every** redirect hop with
`isBlockedAddress`, caps bytes and time from `crawler_policy`, and the
browser never fetches a submitted page.

## 24.7 Graph — one INVOKER function, no client joins

`graph_expand(kind, id, depth, kinds, limit)` is `plpgsql STABLE SECURITY
INVOKER` with `search_path = public, extensions`: it guards
`private.is_active()`, clamps depth to 1–3 and limit to 500, filters every
node with `private.perm_registry_visible(kind, id)` and every edge with its
link kind's visibility, and reads cases through `private.can_read_case`.
Row 0 is the root. It never joins a CI table and has no `ci` node kind. The
client (`InvestigationGraph`, Cytoscape + fcose behind `next/dynamic`) only
draws; expansion is another `graph_expand` call rooted at the node; the
shortest path is a client BFS over the loaded subgraph
(`src/lib/graphModel.ts`). Adding a node or edge kind means adding an arm to
the function **through an existing chokepoint** — and a line to
`tests/rls/v192c` #9 proving the CI stays invisible.

## 24.8 Search — candidates outside, authority inside

Exact search is INVOKER SQL over `document_pages.tsv`,
`external_source_versions.tsv` and `search_all`. The index tier
(Meilisearch, flag `meilisearch`) is **candidate-only**: `search.sync` builds
documents from readable registry rows (never restricted / SIU-blocked media,
sealed legal or CI anything), the `search-query` function fetches
candidates with the server-side key and then calls `search_authorize(hits)`
**under the caller's JWT**, which keeps only hits whose row passes an
RLS-scoped select and drops any kind it does not index. The semantic tier
(pgvector, flag `semantic_search`) never leaves Postgres: `semantic_chunks`
read through `private.semantic_chunk_visible`; the `semantic-query` function
embeds the query with the server-side key and calls `hybrid_search` as the
caller. Neither function ever uses the service role for a search RPC. The
client adapter (`src/lib/services/search`) merges the tiers by
reciprocal-rank fusion and falls back to exact when a flagged tier answers
503 — the palette says "showing exact matches".

## 24.9 Flags and failure isolation

`feature_flags` rows (Owner writes through `feature_flag_set`, realtime
published) with a per-build override `NEXT_PUBLIC_ENABLE_<KEY>=on|off`
(`src/lib/flags.ts`: `useFeatureFlags()`, `flagOn(key)`). Three ship on
(`advanced_graph`, `evidence_sealing`, `advanced_editor` — no external
service); seven ship off. The rule for every flagged surface: **off or
absent means the fallback, never an error** — the table in
[`PLATFORM-UPGRADE.md` §13](../PLATFORM-UPGRADE.md) is the contract a
reviewer checks. `system_health()` (Owner) reports probes, queue stats, cron
runs and failures; `service_health_events` never stores a URL or a
credential.

## 24.10 Mocks and tests

`src/mocks/handlers/platform.ts` answers every new RPC from the mock store
with the contract's refusal styles (P0403 raise → PostgREST 400,
`{ok:false, code}` returns), enforces the fourteen tables' read walls
(`visiblePlatformRows`, chained by `postgrest.ts`) and write refusals
(42501), emulates the five buckets' wire shapes and policies, and answers
503 for the two query functions. Fixture builders for every new table live
in `src/mocks/fixtures/rows.ts`. The live suites are `tests/rls/v192a`
(evidence), `v192b` (packets / documents / jobs), `v192c` (sources / graph /
search + the CI proof); the E2E specs `evidence`, `packets`, `sources`,
`graph`, `ci-visibility` are LIVE-gated like the rest.

## 24.11 Reference-only projects and future notes

Loom, Veritio, OES and D-CIP contributed concepts (immutable originals, the
canonical-JSON hash chain, provenance columns, page references), not code.
Coolify is documented as an optional way to host `docker-compose.yml`
([`DEPLOYMENT.md` §5a](../DEPLOYMENT.md)). OpenHands is a development-only
idea: an agent may be pointed at this repository, never at the live project.
Dify / Langflow (and any future model pipeline) would have to be
**authorization-first** — every candidate re-checked per hit in Postgres
the way `search_authorize` does — before it may read a narrative; that note
is the only artefact of their evaluation. OpenFGA was evaluated and rejected
(two authorities, non-transactional tuples, a second copy of the CI rule —
[`PLATFORM-UPGRADE.md` §11](../PLATFORM-UPGRADE.md)); the `openfga` flag is
seeded false and unused so a future evaluation has a switch.

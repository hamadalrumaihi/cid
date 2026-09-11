# Platform Upgrade — evidence, documents, sources, graph, search, jobs

The single-phase platform upgrade (migration
[`20261105120000_platform_upgrade.sql`](../supabase/migrations/20261105120000_platform_upgrade.sql),
one PR on `claude/portal-improvements-plan-ubkiho`). This is the master
document: the Phase 0 audit in brief, the integration decision for every
project that was evaluated, the architecture before and after, the design of
each new surface, how the CI compartment and restricted material stay
invisible on every one of them, feature flags and failure isolation, the
inventory of what shipped, tests, deployment, rollback, known issues and the
final feature matrix. Authority rules live in
[AUTHORIZATION.md §22](AUTHORIZATION.md#22-platform-services--evidence-packets-sources-graph-search-jobs-flags-20261105120000),
the member's view in [WORKFLOWS.md §16–§18](WORKFLOWS.md) and
[USER-GUIDE.md](USER-GUIDE.md), operations in [OPERATIONS.md](OPERATIONS.md),
shipping in [DEPLOYMENT.md](DEPLOYMENT.md), the developer's map in
[handbook ch. 24](handbook/24-platform-services.md).

> Counts in the inventory tables (§14) are taken from the contract the agents
> built against; the integrator reconciles them with the applied migration at
> the end of the PR.

---

## 1. Non-negotiables

- **Supabase is the system of record** — Auth, Postgres, Storage, Realtime,
  RLS. RLS is the hard wall; every client check is cosmetic.
- **The CI rule is unchanged and untouched**: `canAccessCI =
  private.has_full_ci_access() || private.can_access_ci(ci)`. Nothing new
  joins `confidential_informants` or any `ci_*` table; nothing new returns a
  CI row, count, placeholder, label, embedding or index document; `persons`
  still has no CI column.
- **Restricted material is excluded server-side before anything is built** —
  restricted media (`media.restricted`), SIU-blocked sections
  (`private.siu_blocked`), sealed legal requests, restricted intelligence
  never enter a document, packet, index, embedding, graph node or
  notification. Nothing is "hidden with CSS".
- **Original evidence is immutable.** Derivatives are separate rows that
  record their parent and the parent's hash; custody is append-only and
  hash-chained; integrity columns are written by the evidence service alone.
- **Long work is a `background_jobs` row.** The UI never blocks; results
  land in the Action Center / notifications with a deep link.
- **Every auxiliary service is optional and flagged.** Without Stirling,
  Crawl4AI, Docling, Meilisearch, Redis/worker, an embeddings provider,
  Sentry or an OTel collector the portal keeps working: the in-Supabase
  runner handles the lightweight job kinds, DB full-text search is the
  fallback, documents stay viewable.
- **No service-role key in browser code. No secret values in the repo.
  Migrations are additive only.**

## 2. Phase 0 — what the audit found

Five audits (evidence, search/graph, jobs, authorization, shell) read the
whole codebase before a line was written. Condensed:

**Evidence.** `public.evidence` and `custody_chain` were frozen legacy tables
that had never held a custody row; `media` was the canonical store but every
row was an `external_url` on FiveManage behind a browser-visible
`NEXT_PUBLIC_` key — no bucket, no signed URL, no hash anywhere on the
evidence path (`media.tags.checksum_sha256` and `ExternalMedia.checksum` were
declared and never filled). Evidence identity was `EV-<first 8 hex of the
uuid>`, user-overridable and unconstrained. No derivatives (the grid loaded
originals), no seal on media (any active member could edit any non-restricted
row and `media` had no version history), no mime/size captured at ingest,
and the case packet — the one export a court receives — was unaudited and
unmanifested. The one thing done right was the `field-evidence` bucket
(private, path-scoped policies, no UPDATE policy, 300 s signed URLs) — the
pattern the upgrade generalises.

**Search and graph.** `search_all` was a SECURITY INVOKER trigram union over
18 kinds — its security model *is* INVOKER + RLS, and it has no CI arm by
construction. Three tsvector indexes existed (documents, sections,
narcotics); ~129 trigram indexes; pgvector was not installed; no embedding
column anywhere. Two unrelated graph surfaces: a hand-rolled SVG
`NetworkView` doing nine unbounded table reads, and a React Flow
`CaseGraphTab`; no graph RPC. `private.perm_registry_visible(kind, id)` already
authorised 24 kinds per row (folding `siu_blocked` per section) — the ready-made
node filter. The CI exclusion had eight documented surfaces
(`search_all`, `ci_search` gating, `case_audit_feed`, `entity_suggest`,
`entity_crossref`, recents, notifications, the Trash) that every new surface
must replicate.

**Jobs, functions, audit, health.** Eight pg_cron jobs wrapped in
`private.job_begin` / `job_end`, `pg_net` used once (`sops-sync`), three
Deno functions (two JWT-verified Discord DMs, one shared-secret sync), a
dormant integration skeleton. No Next route handlers, middleware or
`instrumentation.ts` — the app is a static SPA on PostgREST. No
`docker-compose`, no worker, no container story. `audit_log` is hash-chained,
append-only, verified nightly. `notificationTitles.json` had 90 kinds
validated by a gate. System Health was client-side inference (round-trip,
session, realtime counters); `scheduled_job_runs` was not surfaced. Three ad
hoc flag mechanisms (build env, a `siu_settings` row, `integration_sources.enabled`)
and no framework. The 142 KB gzip first-load budget gates `rootMainFiles`
only — anything behind `await import()` is outside it.

**Authorization.** One chokepoint per question (`can_read_case`,
`case_writable`, `can_access_bureau`, `has_full_ci_access` / `can_access_ci`,
`siu_blocked`, `can_view_legal_request`), one router (`private.perm_dispatch`,
re-emitted whole by every migration that adds an arm), one catalog
(`permission_catalog`, free sort blocks 740–799 and 835+), two refusal styles
(`perm_raise` → P0403 for authority, `{ok:false, code, message}` for
validation), a rigid migration convention (header + APPLICATION NOTE +
rollback block, definer + empty `search_path`, revoke-then-grant, guarded
realtime, `rls_test_cleanup` splices) and four drift gates
(`check:schema`, `check:freshness`, `check:realtime`, `gen:permissions --check`).

**Shell.** One dynamic `[tab]` route; `PAGE_META` / `TAB_LABEL` /
`NAV_CATEGORIES` are the routing truth; tools live in `toolsModel.ts` +
`toolRegistry.tsx`; case tabs in `caseTabs.ts`; Owner Console panels in
`OwnerView.SECTIONS`; heavy libraries stay out of the shared bundle behind
`next/dynamic`; MSW handlers are ordered (explicit RPC routes before the
generic catch-all); every screen has a design-system contract (underline
tabs, one Badge, `EmptyState` / `Skeleton` / `ErrorNotice`, 44 px touch
floor, `useNarrow()`).

## 3. Integration decision matrix

Decisions are final (contract §1). "Current" is what the portal had before
the upgrade; "Overlap" what the project would duplicate; "Security impact"
what a reviewer must watch.

| # | Project | Current implementation | New project | Overlap | Benefit | Complexity | Security impact | Decision |
|---|---|---|---|---|---|---|---|---|
| 1 | **Stirling PDF** | `@react-pdf/renderer` in the browser; no page tools | Self-hosted PDF tool server (merge, split, OCR, redact, compress, …) | none — nothing manipulated PDFs | 19 document tools, OCR, redaction on evidence documents | medium — a container + a provider adapter | bytes leave Postgres to a trusted internal service; outputs must be re-registered as derivatives with parent hash | **ADD** — worker provider, flag `stirling_pdf`; the runner's pdf-lib covers merge / split / rotate / page numbers / watermark / metadata without it |
| 2 | **Crawl4AI** | none (external URLs stored as strings, never fetched) | Headless-browser crawler with markdown output | none | Snapshots of open-source pages as verifiable, versioned intelligence | medium — a container; SSRF surface | outbound fetches on behalf of the portal: private ranges, metadata endpoints, redirects and DNS must be policed at every hop | **ADD** — worker provider, flag `crawl4ai`; the runner has a guarded basic fetch provider with the same URL policy |
| 3 | **Cytoscape.js** | hand-rolled SVG `NetworkView` (9 unbounded reads) + React Flow `CaseGraphTab` | Graph rendering + layouts (fcose) | replaces both graph engines | one graph over one RLS-scoped RPC (`graph_expand`); expand, paths, focus, export | medium — client only; `@xyflow/react` removed | none new: the server decides every node and edge; the client draws | **ADD** — `InvestigationGraph` on `graph_expand`; NetworkView + CaseGraphTab rebuilt on it |
| 4 | **BullMQ** | none (pg_cron sweeps only) | Redis-backed queue with concurrency, rate limits, retries | would duplicate a job table | worker concurrency and rate limiting per queue | medium — a Node process + Redis | the worker holds the service-role key; it must never reach a browser or Vercel | **ADD (worker only)** — Postgres `background_jobs` is the record; Redis is transport; without Redis the same processors run in-process |
| 5 | **Docling** | none | Document understanding (layout, tables, OCR) → structured text | none | page text for search, tables and outline for evidence documents | medium — a container | document bytes to an internal service; the index it feeds must exclude restricted / CI | **ADD** — worker provider, flag `document_processing`; runner fallback `unpdf` page text |
| 6 | **Meilisearch** | `search_all` (INVOKER, pg_trgm) + three FTS tables | External full-text index | replaces the trigram union — but its whole security model is RLS | typo-tolerant ranking over narrative text | high — an ACL must be denormalised and invalidated on every visibility change | an external index has no RLS; a stale ACL is a leak | **PARTIAL** — candidates only, flag `meilisearch`; every hit re-authorised in Postgres by `search_authorize`; DB FTS is the fallback |
| 7 | **pgvector** | none | Embeddings + ANN search in Postgres | none | meaning-based search over pages, sources, reports | low–medium — an extension, a column, a provider | stays inside Postgres: INVOKER RPCs keep RLS; chunks must never be built from restricted / CI material | **ADD** — `semantic_chunks.embedding vector(1536)`, flag `semantic_search`; disabled without a provider |
| 8 | **Evidence Seal** (concepts) | no hash, no manifest, no seal on media | Sealed evidence bundles with manifests | none | SHA-256 originals, hash-chained custody, manifests for packets / bundles, offline verification | medium — SQL + a small CLI | the seal is only as good as the immutability of the integrity columns (trigger-locked) | **ADD (own implementation)** — `export_manifests`, `manifest.json` + `manifest.sha256`, `manifest_verify`, `scripts/verify-bundle.mjs` |
| 9 | **OpenTelemetry** | none | Traces / metrics export | none | worker observability; optional Next traces | low | must never carry narratives, ids only | **PARTIAL** — worker `@opentelemetry/sdk-node`; Next `instrumentation.ts` registers `@vercel/otel` only when the endpoint env is set |
| 10 | **Sentry** | `client_errors` table + owner bell | Error tracking SDK | complements `client_errors` | stack traces, releases | low — but the bundle budget | events leave the browser: scrubbed `beforeSend`, CSP `connect-src` widened only to the ingest hosts | **ADD (lazy)** — `@sentry/browser` dynamically imported inside `errorReport.ts` when the DSN is set; `@sentry/node` in the worker |
| 11 | Loom | — | Async video messaging | none | — | — | third-party hosting of case material | **REFERENCE ONLY** — the concept adopted is immutable originals |
| 12 | Veritio | — | Verification / provenance | none | — | — | — | **REFERENCE ONLY** — canonical-JSON hash chain adopted |
| 13 | OES | — | Evidence system | none | — | — | — | **REFERENCE ONLY** — provenance columns (`source`, `collected_by/at`, `location_collected`) adopted |
| 14 | D-CIP | — | Digital case intelligence | none | — | — | — | **REFERENCE ONLY** — page references (`#page=N`) adopted |
| 15 | **OpenFGA** | RLS + `perm_dispatch` (relationship-based already) | Zanzibar-style authorization service | duplicates the whole authority model | — | high | two models that can disagree; a tuple store outside the transaction | **REJECT** (evaluated — §11) |
| 16 | EditorCN | Tiptap + markdown | Editor component kit | Tiptap already | — | — | — | **REFERENCE** — slash commands / entity blocks adopted in the existing Tiptap |
| 17 | Lexical | Tiptap | Editor framework | replaces Tiptap | — | high (rewrite) | — | **REJECT** |
| 18 | Retraced | `audit_log` hash-chained, verified nightly, exportable | Audit-log service | duplicates | — | — | a second ledger to keep consistent | **REJECT** |
| 19 | Unstructured | — | Document parsing | Docling | — | — | — | **REJECT** — Docling preferred |
| 20 | **Redis** | none | In-memory transport | — | BullMQ transport | low | internal network only, nothing published | **ADD (worker only)** — `docker-compose.yml` |
| 21 | Coolify | Vercel + Supabase | Self-hosting PaaS | — | one-click compose hosting for the optional services | — | — | **REFERENCE (optional)** — `docker-compose.yml` + [DEPLOYMENT.md §8](DEPLOYMENT.md) |
| 22 | OpenHands | — | AI dev agent | — | — | — | — | **REFERENCE (dev only)** — note in [handbook ch. 24](handbook/24-platform-services.md) |
| 23 | Browser Use | Playwright E2E | Browser automation agent | duplicates Playwright | — | — | — | **REJECT** — the existing Playwright suite gets the CI-visibility flow (`tests/e2e/ci-visibility.spec.ts`) |
| 24 | Dify | — | LLM app builder | — | — | — | narratives to a model | **REJECT (now)** — future note: any pipeline must be authorization-first (search_authorize-style re-check per hit) |
| 25 | Langflow | — | LLM flow builder | — | — | — | same | **REJECT (now)** — same note |
| — | Temporal | pg_cron + `background_jobs` | Workflow engine | duplicates the job table | — | high | — | **REJECT** (as instructed) |
| — | Maxun | — | No-code scraper | Crawl4AI | — | — | — | **REJECT** (as instructed) |
| — | Open WebUI | — | Chat UI for models | — | — | — | — | **REJECT** (as instructed) |

## 4. Architecture — before and after

**Before**

```
Browser (Next.js SPA on Vercel) ── anon key + user JWT ──► Supabase
  │                                                        ├─ Auth · PostgREST · Realtime
  │                                                        ├─ Postgres: RLS · private.* · definer RPCs · audit_log (hash chain)
  │                                                        ├─ pg_cron (8 sweeps) · pg_net (sops-sync only)
  │                                                        └─ Edge functions: discord-announce · discord-notify · sops-sync
  ├── direct upload, permanent public URL ──► FiveManage (media bytes, browser-visible key)
  └── @react-pdf/renderer (packet built and hashed nowhere)
```

**After**

```
Browser (Next.js SPA on Vercel) ── anon key + user JWT ──► Supabase
  │  client SHA-256 → private bucket upload → evidence_register     ├─ Storage: case-evidence · case-packets · case-documents ·
  │  adapters (pdf · documents · crawler · search · queues · flags)  │          external-source-snapshots · exports (all private, RLS on objects)
  │  Cytoscape graph over graph_expand (INVOKER)                     ├─ Postgres: + background_jobs · custody events (hash chain) ·
  │  Tiptap slash commands / entity blocks                           │   export_manifests · case_packets · document_pages/extractions ·
  │  lazy Sentry (scrubbed) · flags (realtime)                       │   external_sources/versions/links · semantic_chunks (pgvector) ·
  │                                                                  │   search_index_queue · service_health_events · feature_flags
  │                                                                  ├─ pg_cron: + jobs kick/reap · integrity sweep · source recheck · health probe
  │                                                                  ├─ Edge functions: + jobs-runner (x-jobs-secret) · semantic-query · search-query
  │                                                                  │   (query functions run the search RPCs under the CALLER's JWT)
  │                                                                  └─ Realtime: + background_jobs · custody events · case_packets · feature_flags
  │
  └── notifications / Action Center deep links ◄── every job result

OPTIONAL (docker-compose / Coolify, internal network, nothing published):
  worker (BullMQ, service role) ── job_claim/heartbeat/complete/fail ──► Postgres
     ├─ redis (transport only)      ├─ stirling (pdf.tool)      ├─ crawl4ai (source.fetch)
     ├─ docling (document.extract)  ├─ meilisearch (search.sync → candidates → search_authorize)
     └─ embeddings provider (embeddings.generate → semantic_chunks)   · Sentry/OTel from the worker only
```

The runner (`jobs-runner`) is the always-present tier: it claims the
lightweight kinds with a 50 s budget per job; kinds it does not implement are
left for the worker (never claimed). The portal is fully functional with
nothing from the optional box deployed.

## 5. Evidence architecture

**Ingest.** `MediaTab` ("Evidence & Media") hashes the file in the browser
(`crypto.subtle.digest('SHA-256')`, `src/lib/hash.ts`, files ≤ 100 MB),
uploads to `case-evidence` at `case/<case_id>/<media_id>/<file>` (the media
row is inserted first with `storage_path`, `type`, `mime`, `byte_size`,
`original_filename`; the bucket INSERT policy requires a live media row owned
by the uploader at exactly that path), then calls `evidence_register`. The
FiveManage path stays as a fallback (video above the limit, or
`NEXT_PUBLIC_EVIDENCE_HOST=fivemanage`); legacy external rows keep working in
`MediaView` and `PersonProfile` but can never be registered (`bad_state` —
external bytes cannot be hashed).

**Register.** `evidence_register` validates the path shape, the 64-hex hash
and the size, refuses a second registration (`bad_state`), sets the integrity
columns under the service GUC, assigns `EV-000001`-style numbers from
`private.evidence_number_seq`, sets `integrity_status='unverified'` and
`current_custodian=auth.uid()`, appends COLLECTED (when `collected_at` is
given) → UPLOADED → REGISTERED, enqueues `evidence.verify` (and
`evidence.derive` for images / PDFs, `document.extract` for PDF / docx /
text) and audits `EVIDENCE_REGISTERED`.

**Verify.** The runner (or worker) streams the object, recomputes SHA-256 and
calls `evidence_verify_result`: a match → `verified` + `last_integrity_check`
+ VERIFIED; a mismatch → `integrity_status='failed'` — the expected hash is
NEVER changed — INTEGRITY_FAILURE with `{expected, actual}`, audit
`EVIDENCE_INTEGRITY_FAILURE`, and `evidence_integrity_failure` (security,
high priority) to the uploader, the current custodian, the case lead and
every Owner. A daily sweep re-verifies up to 50 verified items older than 30
days.

**Immutability.** `private.media_protect_integrity()` (BEFORE UPDATE) raises
P0403 on any client change to the integrity / custody / derivative / sealed
columns unless `cid.evidence_service = 'on'`; on INSERT a client may set only
`mime`, `byte_size`, `original_filename`. `media` joins `record_versions`
(full-row history). Derivatives (`evidence_derivative_register`, service
role) are separate media rows with `parent_media_id`, `parent_sha256`,
`derivative_type` (preview / thumbnail / ocr / compressed / redacted /
converted / packet / generated), `derivative_service(_version)`, the
parent's case / restricted flag copied, integrity verified at birth, and a
DERIVATIVE_CREATED event on the parent.

**Access.** Storage reads mint 300 s signed URLs after
`perm_registry_visible('media', id)`; every view / download calls
`evidence_access_log` (VIEWED deduped per actor within 10 minutes). Custody
transfer (`evidence_custody_transfer`: custodian, uploader or command → an
active member who can read the case; TRANSFERRED; `evidence_custody_transfer`
notification with ids only), seal (`evidence_seal`: Senior Detective+ or the
uploader, flag `evidence_sealing`, requires `verified`; SEALED), release
(`evidence_release`: command; RELEASED).

## 6. Chain of custody and the hash chain

`evidence_custody_events` is append-only and RPC-only: no client INSERT
(42501), and `private.custody_chain_block()` raises P0403 on UPDATE / DELETE /
TRUNCATE for every role. `private.custody_chain_stamp()` (BEFORE INSERT)
takes an advisory transaction lock on the media id, sets `prev_hash` to the
media's last `event_hash`, and computes

```
event_hash = sha256( coalesce(prev_hash, '') || custody_canonical(NEW) )
custody_canonical = jsonb_build_object(media_id, case_id, event_type, actor_id,
  occurred_at (UTC, microseconds), previous_custodian, new_custodian, reason,
  job_id, export_id, metadata)::text          -- jsonb key order is canonical
```

`evidence_chain_verify(media)` recomputes the chain and answers `{ok, events,
first_bad_id}`; the detail sheet shows the result beside the timeline.
Eighteen event types: COLLECTED, UPLOADED, REGISTERED, VIEWED, DOWNLOADED,
TRANSFERRED, ASSIGNED, PROCESSED, DERIVATIVE_CREATED, OCR_PROCESSED,
REDACTED, EXPORTED, PACKET_INCLUDED, VERIFIED, SEALED, RELEASED, ARCHIVED,
INTEGRITY_FAILURE. The case timeline gains a `custody` lane (TRANSFERRED,
VERIFIED, INTEGRITY_FAILURE, SEALED, RELEASED, DERIVATIVE_CREATED, EXPORTED,
PACKET_INCLUDED). The same canonical-JSON-then-SHA-256 discipline is the
`audit_log` chain's (2026-10-06), so the two ledgers verify the same way.

## 7. Document architecture

**What Stirling changes** (`pdf.tool`, queue `pdf`, flag `stirling_pdf`):
merge, split, extract_pages, rearrange, rotate, crop, compress, ocr,
image_to_pdf, pdf_to_images, watermark, page_numbers, flatten,
metadata_inspect, metadata_remove, sanitize, repair, compare, redact.
`document_tool_request(case, tool, inputs, options)` checks every input media
is visible and in the case, enqueues the job, and the result is registered
as a derivative (`converted` / `redacted` / `ocr` / `compressed` /
`generated`) with `document_ready` / `document_failed` to the requester.
Without Stirling the runner's pdf-lib handles merge, split, extract_pages,
rearrange, rotate, page_numbers, watermark, metadata_remove /
metadata_inspect and compare; the other tools are disabled in the UI with
"Requires the document service".

**What Docling understands** (`document.extract`, queue `documents`, flag
`document_processing`): layout, per-page text, tables and an outline for
PDF / docx / pptx / xlsx / html / images with OCR. `document_extract_result`
replaces `document_pages` (one row per page, `tsv` generated), marks
`document_extractions` ready, appends OCR_PROCESSED / PROCESSED, enqueues
`search.sync` + `embeddings.generate`. **Runner fallback**: `unpdf` per-page
text for PDF, passthrough for text/plain, docx left for the worker.
Documents stay viewable either way (signed URL, `#page=N`).

**Packets** (`packet.render`, queue `pdf`): `case_packet_request(case, type,
sections, options)` builds the **snapshot under the caller** —
`private.case_packet_snapshot` uses `perm_registry_visible`,
`has_restricted_packet_approval`, `siu_blocked`, `can_view_legal_request`,
never CI — and stores only what the packet prints (labels, numbers, text,
evidence numbers, sha256 hex, storage paths of included media for the
renderer) plus `excluded: {restricted_media, sealed_legal}`. Presets: full,
doj, command, disclosure, custom (18 sections). The renderer (pdf-lib in the
runner; identical in the worker) writes `packet.pdf` + `manifest.json` +
`manifest.sha256` to `case-packets/case/<case>/<packet>/`, then
`case_packet_render_result` writes the immutable `export_manifests` row,
appends PACKET_INCLUDED per included item and EXPORTED (export_id = the
manifest), notifies `case_packet_ready` and audits `CASE_PACKET_EXPORTED`.
Downloads call `case_packet_access_log` (audit `CASE_PACKET_DOWNLOADED`).
**Verify package**: the member drops the files, the browser hashes them,
`manifest_verify(manifest, files)` answers `verified | modified | missing |
unexpected | hash_mismatch` per file; `scripts/verify-bundle.mjs` does the
same offline. Evidence bundles (`bundle.build`, queue `exports`) zip the
chosen items with a manifest into `exports/export/<user>/<job>/bundle.zip`.

## 8. Crawler architecture and the SSRF policy

`external_source_submit(url, case?, notes?)` → `private.url_static_check`
(below) → an `external_sources` row (`SRC-000001` from
`private.external_source_seq`, status `pending`) → `source.fetch` (queue
`crawler`). The fetch provider (Crawl4AI when `CRAWL4AI_URL` is set and the
flag is on, else the guarded basic fetch in the runner / worker) resolves
DNS and rejects any private / loopback / link-local / metadata address,
follows at most 5 redirects re-checking every hop, caps bytes and time from
`crawler_policy`, converts HTML to text / markdown with a small sanitizer,
stores the snapshot in `external-source-snapshots/source/<id>/<version>.<ext>`
and calls `external_source_ingest` — the first version or a changed
`content_hash` becomes a new immutable `external_source_versions` row with a
`diff_summary` (added / removed / modified lines, first five samples of each),
status `ready` (first) or `changed` (later, notifying the submitter and the
case lead); an unchanged page only bumps `last_checked_at`. A daily recheck
enqueues fetches for sources older than `recheck_hours` (max 100).
**Versions never auto-modify any registry record.** Analysts verify
(`external_source_verify`: unverified / verified / disputed / rejected +
reliability), link (`external_source_link`: case, person, vehicle, gang,
place, narcotic, evidence, report, intel — the target must be visible; there
is no `ci` kind), recrawl, annotate; the Owner edits `crawler_policy`.

**The URL policy** (`private.url_static_check`, mirrored byte-identically in
`supabase/functions/_shared/urlPolicy.ts`, `src/lib/urlPolicy.ts` and
`workers/src/urlPolicy.ts` — a unit test asserts the three do not drift):
scheme http / https only (`file:`, `ftp:`, `data:`, `javascript:` refused);
no userinfo; length ≤ 2048; host not `localhost` / `metadata` /
`instance-data` / `metadata.google.internal` and not ending `.localhost
.local .internal .lan .home .arpa .corp`; no single-label host; IP literals
(and their decimal / octal / hex disguises, which the WHATWG parser
canonicalises) refused in 0/8, 10/8, 127/8, 169.254/16 (incl.
169.254.169.254), 172.16/12, 192.168/16, 100.64/10 (incl. 100.100.100.200),
192.0.0/24, 198.18/15, 224/4 and above; IPv6 `::`, `::1`, fc00::/7,
fe80::/10, fec0::/10, ff00::/8, documentation, Teredo, and the IPv4-mapped /
compatible / SIIT / NAT64 / 6to4 forms of every blocked v4 range;
`block_domains` suffix match; `allow_domains` suffix match when non-empty.
The browser never fetches a submitted page.

## 9. Graph architecture

`public.graph_expand(kind, id, depth, kinds, limit)` is a plpgsql STABLE
**SECURITY INVOKER** function guarded by `private.is_active()`: depth clamped
1–3, limit ≤ 500, every node filtered by `private.perm_registry_visible(kind,
id)`, every edge by its link kind's visibility (gang membership, addresses,
vehicles, relationships, accounts, case intel links, case links, external
source links), case arms through `private.can_read_case`, soft-deleted and
merged rows excluded, row 0 the root. Node kinds: case, person, vehicle,
gang, place, narcotic, evidence, report, account, external_source. Edge
kinds: involved_in, suspect_in, witness_in, victim_in, owns, drives,
member_of, associated_with, seen_at, located_at, mentioned_in, evidence_of,
source_for, linked_to, related_case. **It never joins a CI table** — there is
no `ci` node kind, and a truncated or filtered result is indistinguishable
from a sparse one. The client (`src/components/graph/InvestigationGraph.tsx`,
Cytoscape + fcose behind `next/dynamic`; `src/lib/graphModel.ts` pure) adds
the root picker, depth, kind filters, legend, click → RecordPeek, expand /
collapse / focus, shortest path (client BFS over the loaded subgraph),
fullscreen, in-graph search, saved views and PNG export. `NetworkView` is a
thin wrapper; `CaseGraphTab` roots it at the case; `@xyflow/react` is gone.

## 10. Search — exact, semantic, hybrid

- **Exact** (always): `search_all` (unchanged) + `document_search` (INVOKER
  `websearch_to_tsquery` over `document_pages.tsv`, `ts_headline`, RLS
  through the pages' policy) + `external_source_search` (INVOKER FTS over the
  current version of visible sources). The palette gains "Case documents"
  (page hits, `caseLink(case, 'documents', {media, page})`) and "External
  sources" (`/intelligence?source=<id>`).
- **Index** (flag `meilisearch`): triggers enqueue `search_index_queue`
  rows; `search.sync` builds index documents that NEVER include restricted
  media, SIU-blocked media, CI anything or sealed legal; the `search-query`
  edge function fetches candidates with the server-side key and then calls
  `search_authorize(hits)` **under the caller's JWT** — only hits whose row is
  visible through RLS come back, with labels; a `{kind:'ci'}` hit is dropped.
- **Semantic** (flag `semantic_search`): `embeddings.generate` chunks
  documents / reports / sources / case summaries into `semantic_chunks`
  (HNSW cosine index; RLS via `private.semantic_chunk_visible`); the
  `semantic-query` function embeds the query server-side and calls
  `hybrid_search` under the caller's JWT.
- **Hybrid**: `hybrid_search(q, embedding?, limit, case?)` — reciprocal-rank
  fusion of the exact searches with `semantic_search`; `mode` = exact /
  semantic / both. The client adapter (`src/lib/services/search`) merges by
  RRF itself when the server function is unavailable, and the palette shows
  "showing exact matches" when a flagged tier answers 503.

Neither query function ever uses the service role for a search RPC.

## 11. Permission architecture — RLS + `perm_dispatch`, and why not OpenFGA

Every new table has RLS on and SELECT-only client policies; every write is a
definer RPC or the service role. The new arms follow the house pattern:
`perm_dispatch` gains `case_packet` (read / download: `can_read_case` and the requester, command or the Owner; soft_delete /
restore: the requester or command) and `external_source` (read:
`external_source_visible`; edit / soft_delete: the submitter or command);
`soft_delete_table` maps both; `trash_list` labels a packet `packet:<type>`
and a source by its number; 30 `permission_catalog` rows (740–849)
carry `test_id` v192a / v192b / v192c.

**OpenFGA, evaluated with two officers.** *Tom* is a detective in Major
Crimes; *Smith* is a detective in Street Crimes. Case MCB-4000123 belongs to
Major Crimes. Today: `private.can_access_case(case)` admits Tom (bureau
match) and refuses Smith — until the lead grants Smith a `case_access_grants`
row that **expires** (hourly sweep), or the case becomes JTF, or Smith's
bureau joins the operation, or Smith is recused from the SIB compartment, or
the case is archived (read-only for both), or a section of a linked person is
SIU-hidden for Tom but not for the SIB agent. In OpenFGA those are tuples
(`user:tom member bureau:major_crimes`, `case:123 bureau bureau:major_crimes`,
`case:123 grantee user:smith`) and a model (`viewer = member from bureau or
grantee or lead or …`). Three problems decided it: (1) **two authorities** —
RLS must still hold (PostgREST talks to Postgres, not to FGA), so the model
would be a *second* copy of `can_access_case`, `can_read_case`,
`case_writable`, `siu_blocked`, `can_view_legal_request` and `can_access_ci`,
and any drift between the two is a leak with no gate to catch it; (2)
**time and state** — expiring grants, archived read-only, SIB release gates,
"once submitted to the judge" are evaluated at query time inside the
transaction; tuples written from a trigger to an external store are neither
transactional nor instantly consistent; (3) **the CI wall** — the one rule
that must never be re-implemented anywhere would have to exist in the FGA
model too. The existing system is already relationship-based (per-row,
per-section, per-standing) with one router and one catalog. **Rejected;**
the flag `openfga` is seeded false and unused, kept so a future evaluation
has a switch.

## 12. CI security across every new surface

| Surface | Mechanism (server-side, before anything is built) |
|---|---|
| `graph_expand` | INVOKER; no `ci` node kind; never joins `confidential_informants` / `ci_*`; nodes through `perm_registry_visible`, which has no CI arm; labels from registry rows only |
| `document_search`, `external_source_search`, `hybrid_search`, `semantic_search` | INVOKER over `document_pages` / `external_source_versions` / `semantic_chunks`, none of which can hold CI text: the index / chunk builders read the registry, never `ci_*`; a page of a CI export cannot exist because `ci_export` never writes a media row |
| `search_authorize` | re-authorises every candidate through RLS-scoped selects on the three indexed kinds; a `{kind:'ci'}` hit (or any unknown kind) is dropped, never labelled |
| `search_index_queue` / Meilisearch documents | built by the runner / worker from readable registry rows only; restricted / SIU-blocked media, sealed legal and CI anything are excluded at build time; the index is candidate-only |
| `case_packet_request` snapshot | `private.case_packet_snapshot` evaluated under the caller with `perm_registry_visible`, `has_restricted_packet_approval`, `siu_blocked`, `can_view_legal_request`; no CI arm exists in it; the snapshot text is what the test pins (`v192c` #9 — neither the CI number nor the CI id appears) |
| `evidence_derivative_register`, `document_extract_result` | copy the parent's `restricted` flag; a derivative of a restricted item is restricted |
| `external_source_link` | kinds are a CHECK vocabulary without `ci`; the target must be `perm_registry_visible` |
| Notifications (`case_packet_*`, `evidence_*`, `external_source_*`, `document_*`, `background_job_failed`) | `private.action_notify` — ids only, text keys stripped, recipients already inside the wall; `notification_resolve` labels a packet / source / media subject only when visible |
| `case_timeline` custody / packet / source / document lanes | media through the visible-media CTE; packets through `can_read_case`; sources through their links' visibility |
| `case_audit_feed` | gains `case_packets` and `external_sources` kids; keeps `entity not like 'ci\_%'` |
| `trash_list` | packet / source arms carry the case-readability conjunct; CI kinds keep their `can_access_ci` conjunct |
| Storage objects | bucket policies through `perm_registry_visible('media', …)`, `can_read_case` + the packet's requester / command / Owner, `external_source_visible`, `auth.uid()` — a CI export is never a bucket object |
| The client | the palette calls `ci_search` only for an involved caller (unchanged); the graph picker is `entity_suggest` (no CI edge); nothing client-side is a wall |

Pinned by `tests/rls/v192c.test.ts` #9 (the CI proof — before and after
retirement) and `tests/e2e/ci-visibility.spec.ts` (palette, autocomplete,
graph, documents search, packet dialog, direct RPC; the lead sees it).

## 13. Audit, observability, flags and failure isolation

**Audit.** Twenty-six new SCREAMING_SNAKE actions in `audit_log`
(EVIDENCE_REGISTERED … MANIFEST_VERIFIED, contract §2.10), every one written
inside the definer RPC that performed the transition, ids only in `detail`.
Custody has its own ledger (§6). The nightly `audit-chain-verify` covers the
new rows like any other.

**Observability.** `system_health()` (Owner) returns the latest probe per
service (`service_health_events`, 7-day retention, never a URL or credential
in `detail`), `background_jobs_stats()` (counts by queue × status,
`failed_24h`, `oldest_queued_seconds`, `active_workers`), the last 20
`scheduled_job_runs` and the last 20 failed jobs. The Owner Console → System
Health section renders it with Retry / Cancel, the flag toggles and the
crawler policy editor. `health.probe` runs every 10 minutes from the runner
(self, Supabase, any configured service URL). Sentry: lazy, DSN-gated,
scrubbed (`src/lib/services/telemetry/scrub.ts` — no bodies, cookies,
headers, query strings, narratives or CI numbers); `client_errors` stays the
primary record. OTel: worker process only, plus `@vercel/otel` in
`src/instrumentation.ts` when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

**Feature flags.** `feature_flags` (Owner writes through `feature_flag_set`,
audited; realtime published; `NEXT_PUBLIC_ENABLE_<KEY>=on|off` wins for one
build). Seeded: `stirling_pdf`, `crawl4ai`, `document_processing`,
`meilisearch`, `semantic_search`, `openfga`, `ai_assistant` **off**;
`advanced_graph`, `evidence_sealing`, `advanced_editor` **on** (they need no
external service).

| Service / flag | When absent or off | What still works |
|---|---|---|
| Stirling (`stirling_pdf`) | runner pdf-lib tools; the rest disabled with "Requires the document service" | packets, bundles, viewing, page search |
| Crawl4AI (`crawl4ai`) | the guarded basic fetch (same URL policy) | sources, versions, diffs, verification |
| Docling (`document_processing`) | `unpdf` page text for PDF, passthrough for text | search over extracted pages of PDFs; docx waits for the worker |
| Meilisearch (`meilisearch`) | `search-query` answers 503 `unavailable`; the palette shows exact matches | `search_all` + DB FTS |
| Embeddings (`semantic_search`) | `semantic-query` answers 503; the Semantic chip is not offered | exact and index tiers |
| Redis / worker | the runner claims the lightweight kinds; worker-only kinds stay queued and the Owner sees `oldest_queued_seconds` grow | everything the runner implements |
| Sentry / OTel | nothing is exported | `client_errors`, `scheduled_job_runs` |
| The runner itself (`JOBS_SECRET` missing, function not deployed) | `private.jobs_kick` is a silent no-op; rows stay `queued`; System Health shows the depth | every synchronous surface — nothing in the portal blocks on a job |

## 14. What shipped (inventory)

Counts verified against the applied migration and the live catalogs on
2026-09-10.

**Tables (14):** `feature_flags`, `background_jobs`, `evidence_custody_events`,
`export_manifests`, `case_packets`, `document_pages`, `document_extractions`,
`crawler_policy`, `external_sources`, `external_source_versions`,
`external_source_links`, `search_index_queue`, `semantic_chunks`,
`service_health_events`. **Extended:** `media` (+ 20 columns: sha256,
byte_size, mime, original_filename, evidence_number, classification,
integrity_status, last_integrity_check, current_custodian, source,
collected_by, collected_at, location_collected, parent_media_id,
derivative_type, derivative_service, derivative_service_version,
parent_sha256, sealed_at, sealed_by), joins `record_versions`.
**Extension:** `vector` (schema `extensions`).

**Indexes (53 new — 48 on the fourteen tables, 5 on `media`):** `background_jobs` unique `(kind, idempotency_key)`,
partial `(queue, priority, run_after)`, `(created_by, created_at desc)`,
`(case_id)`, `(status, finished_at)`; `media` `(parent_media_id)` partial,
`(case_id, evidence_number)`, `(integrity_status)`, unique `evidence_number`;
custody `(media_id, id)`, `(case_id, occurred_at desc)`; `document_pages` GIN
on `tsv` + unique `(media_id, page_no)`; `document_extractions` unique
`media_id`; `external_source_versions` GIN on `tsv` + unique `(source_id,
version_no)`; `external_source_links` unique `(source_id, kind, ref_id)`;
`semantic_chunks` HNSW cosine + unique `(source_kind, source_id, page_no,
chunk_no)`; `external_sources` unique `source_number`; `case_packets`
`(case_id)`; FK indexes on every new reference.

**Policies:** SELECT-only on every new table (`feature_flags`: all active;
`background_jobs`: creator or Owner; custody / pages / extractions:
`perm_registry_visible('media')`; manifests / packets: `can_read_case` (+
`deleted_at is null or is_owner()`); sources: `external_source_visible`;
versions: through the source; links: source visible AND target visible;
chunks: `semantic_chunk_visible`; health: Owner; index queue / crawler
policy: service role / Owner); `storage.objects` policies for the five
buckets (§15); no client INSERT / UPDATE / DELETE anywhere.

**Triggers:** `media_protect_integrity` (BEFORE INSERT / UPDATE),
`media_version`, `custody_chain_stamp`, `custody_chain_block`, immutability
blocks on `export_manifests` and `external_source_versions`, index-queue
enqueue triggers on `document_pages` / `external_source_versions` / `reports`,
`block_direct_soft_delete` on `case_packets` and `external_sources`.

**RPCs — public, authenticated (32):** `feature_flag_set`,
`background_job_cancel`, `background_job_retry`, `background_jobs_stats`,
`evidence_register`, `evidence_verify_request`, `evidence_custody_transfer`,
`evidence_access_log`, `evidence_chain_verify`, `evidence_seal`,
`evidence_release`, `manifest_verify`, `case_packet_request`,
`case_packet_access_log`, `evidence_bundle_request`, `document_tool_request`,
`document_extract_request`, `document_search`, `external_source_submit`,
`external_source_recrawl`, `external_source_verify`, `external_source_link`,
`external_source_unlink`, `external_source_update`, `external_source_search`,
`crawler_policy_set`, `graph_expand`, `graph_path`,
`search_authorize`, `semantic_search`, `hybrid_search`, `system_health`.
**Service role (14):** `job_claim`, `job_heartbeat`, `job_complete`,
`job_fail`, `evidence_verify_result`, `evidence_derivative_register`,
`case_packet_render_result`, `case_packet_failed`, `evidence_bundle_result`,
`document_extract_result`, `document_extract_failed`,
`external_source_ingest`, `external_source_failed`, `semantic_chunks_replace`.
**Private helpers:** `job_enqueue`, `jobs_kick`, `job_reap`,
`next_evidence_number`, `custody_event`, `custody_canonical`,
`case_packet_snapshot`, `url_static_check`, `external_source_visible`,
`semantic_chunk_visible`, and the re-emitted `perm_dispatch`,
`soft_delete_table`, `trash_list`, `case_timeline`, `case_audit_feed`,
`action_key_class`, `action_notify`, `notification_resolve`,
`rls_test_cleanup`.

**Cron (5 new):** `background-jobs-kick` (`*/2 * * * *`),
`background-jobs-reap` (`*/5 * * * *`), `evidence-integrity-sweep` (daily
02:30), `external-source-recheck` (daily 04:10), `health-probe`
(`*/10 * * * *`).

**Edge functions (3 new):** `jobs-runner` (verify_jwt false; `x-jobs-secret`
against `app_secrets.JOBS_SECRET`), `semantic-query` (JWT), `search-query`
(JWT). **Shared code** (`supabase/functions/_shared/`): `urlPolicy.ts`,
`jobCore.ts`, `htmlText.ts`, `manifest.ts`, `chunk.ts`, `packetPdf.ts` —
byte-identical copies under `workers/src/`.

**Queues (10):** pdf, crawler, documents, ocr, search, embeddings, evidence,
exports, notifications, health. **Job kinds (10):** `evidence.verify`,
`evidence.derive`, `packet.render`, `pdf.tool`, `bundle.build`,
`source.fetch`, `document.extract`, `search.sync`, `embeddings.generate`,
`health.probe`.

**Env vars — client (optional):** `NEXT_PUBLIC_SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_ENV`, `NEXT_PUBLIC_EVIDENCE_HOST`,
`NEXT_PUBLIC_ENABLE_<FLAG>` × 10; **server:** `OTEL_EXPORTER_OTLP_ENDPOINT`;
**secrets (never in the repo):** `app_secrets.JOBS_SECRET`; **runner
function env (optional):** `MEILI_URL`, `MEILI_MASTER_KEY`,
`EMBEDDINGS_BASE_URL`, `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL`,
`STIRLING_URL`, `CRAWL4AI_URL`, `DOCLING_URL`; **worker:** `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `STIRLING_URL`, `CRAWL4AI_URL`,
`DOCLING_URL`, `MEILI_URL`, `MEILI_MASTER_KEY`, `EMBEDDINGS_*`, `SENTRY_DSN`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `WORKER_NAME`, `JOB_CONCURRENCY_<QUEUE>`
(full list in [`workers/README.md`](../workers/README.md)).

**Docker services (6, `docker-compose.yml`):** worker, redis, stirling,
crawl4ai, docling, meilisearch — internal network, nothing published except
(optionally) meili.

**Client adapters (`src/lib/services/`):** `pdf/`, `documents/`, `crawler/`,
`search/` (exact → index → semantic, RRF merge, fallback), `queues/jobs.ts`,
`telemetry/`; `src/lib/flags.ts`, `evidence.ts`, `hash.ts`, `manifest.ts`,
`packets.ts`, `documents.ts`, `externalSources.ts`, `graphModel.ts`,
`jobsModel.ts`, `urlPolicy.ts`, `timelineFilters.ts`. Components import
adapters, never providers.

**Notification kinds (10):** `case_packet_ready`, `case_packet_failed`,
`evidence_bundle_ready`, `evidence_integrity_failure` (security, high),
`evidence_custody_transfer`, `external_source_changed`,
`external_source_failed`, `document_ready`, `document_failed`,
`background_job_failed` (Owner, deduped per kind per hour).

## 15. Storage buckets (all private)

| Bucket | Path | Read | Write |
|---|---|---|---|
| `case-evidence` (100 MB; images, mp4 / webm / quicktime, audio, pdf, text, zip, docx / xlsx) | `case/<case_id>/<media_id>/<file>` | `perm_registry_visible('media', segment 3)` | INSERT: `case_writable(segment 2)` AND a live media row at that path owned by the uploader; no UPDATE; DELETE service role only |
| `case-documents` | same shape (generated documents are media rows too) | same | same |
| `case-packets` | `case/<case_id>/<packet_id>/packet.pdf · manifest.json · manifest.sha256` | a live `case_packets` row + `can_read_case` + requester / command / Owner | service role only |
| `external-source-snapshots` | `source/<source_id>/<version_id>.<ext>` | `external_source_visible` | service role only |
| `exports` | `export/<user_id>/<job_id>/<file>` | segment 2 = `auth.uid()` | service role only |

Signed URLs are minted for 300 s after the row-level check; the FiveManage
host remains only as the legacy / fallback path ([UPLOADS.md](UPLOADS.md)).

## 16. Tests

| Suite | What it pins |
|---|---|
| `tests/rls/v192a.test.ts` | evidence: register once (series number, hash-chained COLLECTED → UPLOADED → REGISTERED, verify job, audit), `bad_state` on a re-register and on an external row, integrity columns P0403, custody append-only (UPDATE / DELETE P0403, INSERT 42501), custody transfer + ids-only notification + P0403 for a non-custodian, access-log dedupe, chain verify, seal needs verified, release is command, the other bureau reads nothing, `background_jobs` private to creator / Owner, inactive denied |
| `tests/rls/v192b.test.ts` | packets: request → queued + `packet.render` + audit; the snapshot excludes and counts the restricted photo and carries no CI-shaped key; the other bureau P0403 / zero rows; access log audited; `manifest_verify` discloses nothing; `document_search` empty-safe; pages / extractions RPC-only; `document_tool_request` validation; `document_extract_request`; `evidence_bundle_request` validation; no direct writes; soft delete through `soft_delete('case_packet')` + `trash_list` |
| `tests/rls/v192c.test.ts` | sources: submit, every SSRF class `bad_url`, case-pinned invisibility, verify / link (`ci` kind refused) / unlink, versions immutable, search empty-safe; `graph_expand` root + case + gang edges, clamps, kinds filter, inactive; **the CI proof** across graph / searches / `search_authorize` / `search_all` / packet snapshot / `trash_list` / `ci_get` before and after retirement; Owner-only RPCs P0403, flags readable, Owner positive path |
| `src/lib/urlPolicy.test.ts` | every blocked URL class + the three-copy identity |
| `src/lib/jobsModel.test.ts` | `min(1h, 5s·2^attempts)`, lease / reap, retry gate, terminal statuses, progress |
| `src/lib/hash.test.ts`, `manifest.test.ts`, `graphModel.test.ts`, `flags.test.ts`, `packets.test.ts`, `documents.test.ts`, `externalSources.test.ts`, `evidence.test.ts`, `timelineFilters.test.ts`, `services/search/search-service.test.ts`, `services/telemetry/scrub.test.ts` | the pure client modules |
| `src/mocks/handlers/platform.ts` (+ fixtures) | the offline contract of every new RPC, table wall, bucket and query function |
| `tests/e2e/evidence.spec.ts`, `packets.spec.ts`, `sources.spec.ts`, `graph.spec.ts`, `ci-visibility.spec.ts` | the UI contract, LIVE-gated |

## 17. Deployment

1. **Migration** — applied live first (Supabase MCP) as `platform_upgrade`;
   then the artifact ritual: `database.types.ts`, `npm run gen:snapshot`,
   `gen:permissions`, `check:schema`, `check:freshness`, `check:realtime`,
   `check:notif-titles`, `MIGRATION-HISTORY.md`.
2. **Secret** — insert `JOBS_SECRET` into `app_secrets` (a long random
   value; never in the repo) and set the same value as the `jobs-runner`
   function secret.
3. **Edge functions** —
   `supabase functions deploy jobs-runner --no-verify-jwt`,
   `supabase functions deploy semantic-query`,
   `supabase functions deploy search-query`
   (plus the existing three). Optional function env: `MEILI_URL`,
   `MEILI_MASTER_KEY`, `EMBEDDINGS_*`, `STIRLING_URL`, `CRAWL4AI_URL`,
   `DOCLING_URL`.
4. **Vercel** — the client env is unchanged for a minimal deploy; add
   `NEXT_PUBLIC_SENTRY_DSN` / `_ENV`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
   `NEXT_PUBLIC_EVIDENCE_HOST`, `NEXT_PUBLIC_ENABLE_<FLAG>` only when wanted.
   CSP `connect-src` already lists the Sentry ingest hosts.
5. **Optional services** — `docker-compose up -d` on any host (or import
   the compose file into Coolify); set the worker env from
   `workers/README.md`; flip the matching flags in Owner Console → System
   Health once the health cards are green.
6. **Verify** — `npm run test:rls` (v192a–c), `npm run test:e2e`, Owner
   Console → System Health (runner healthy, queue depth zero after a
   register / packet request).

## 18. Rollback

Because the migration is additive and every service is optional, the order
is: **flags off → functions undeployed → app rollback → (last resort) the
migration's rollback block.**

1. Owner Console → System Health: turn every flag off (or set
   `NEXT_PUBLIC_ENABLE_<FLAG>=off`); stop the compose stack. The portal is
   now exactly "runner-only".
2. `supabase functions delete jobs-runner semantic-query search-query`
   (or unschedule `background-jobs-kick`): jobs stay queued, nothing else
   changes; `evidence_register` still works (verification simply waits).
3. Vercel → previous deployment → Promote (the prior build ignores the new
   columns and tables).
4. Only if the schema itself must go: the `-- Rollback:` block at the top of
   `20261105120000_platform_upgrade.sql` names every object to drop
   (buckets last, after emptying them). This destroys custody events,
   manifests and packets — export `audit_log` first.

## 19. Known issues

- Security review (2026-09-10, folded in as migration PART 6): packet rows,
  objects and downloads are now the requester's, command's or the Owner's
  (the snapshot is built under the requester's rights); extraction / tool /
  bundle inputs and bucket uploads must live under `case/<case_id>/<media_id>/`;
  `is_service_caller` fails closed without a JWT; the runner / worker refuse
  any path outside the row's folder; the packet renderer reads the
  snapshot's `evidence` list (index + images). Open by design: any member who
  can see a source may mark it *verified*; a source's `classification` only
  affects indexing, not visibility.
- `docker-compose.yml` isolates Crawl4AI on its own network, but Stirling and
  Docling still run without API keys on the internal network — set
  `STIRLING_API_KEY` / `DOCLING_API_KEY` (and Stirling's security mode) before
  exposing the tier beyond one host.

- Docx extraction needs the worker (Docling); the runner leaves it queued.
- `graph_path` (server-side shortest path) is bounded to six hops; the
  client also computes paths over the loaded subgraph for longer chains.
- The Meilisearch index is candidate-only by design: a stale index can
  *omit* a hit until the next `search.sync`; it can never *reveal* one
  (`search_authorize`).
- Storage uploads are whole-file (≤ 100 MB by the bucket limit); resumable
  uploads are not part of this phase.
- The dedicated test project for seeded E2E / visual suites remains
  unprovisioned; the new E2E specs are LIVE-gated like the rest.

## 20. Final feature matrix

| # | Feature | Before | After | Technology |
|---|---|---|---|---|
| 1 | Evidence storage | FiveManage public URL, browser-visible key | private `case-evidence` bucket, path-scoped RLS, 300 s signed URLs | Supabase Storage |
| 2 | Evidence hashing | none | client SHA-256 at upload, server re-hash, `sha256`/`byte_size`/`mime` on the row | Web Crypto, runner |
| 3 | Evidence numbers | `EV-<uuid8>`, free text | `EV-000001` series, unique | Postgres sequence |
| 4 | Integrity verification | none | `evidence.verify` on register + 30-day sweep; VERIFIED / INTEGRITY FAILURE with fan-out | jobs-runner / worker |
| 5 | Chain of custody | frozen empty `custody_chain` | 18-event, hash-chained, append-only `evidence_custody_events`, `evidence_chain_verify` | Postgres triggers (SHA-256) |
| 6 | Immutable originals | any member could edit any row | integrity columns trigger-locked; derivatives as child rows with parent hash; `media` versioned | Postgres |
| 7 | Derivatives | none | preview / thumbnail / ocr / compressed / redacted / converted / generated rows | worker (sharp), Stirling, Docling |
| 8 | Evidence seal / release | none | `evidence_seal` (verified only, flag), `evidence_release` (command) | Postgres |
| 9 | Case packets | browser-built, unaudited, no manifest | server-rendered, snapshot under the caller, watermark, manifest + sha256, audited download | pdf-lib (runner / worker) |
| 10 | Manifest verification | none | `manifest_verify` in-app + `scripts/verify-bundle.mjs` offline | Postgres, Node |
| 11 | Evidence bundles | none | zip + manifest into `exports`, EXPORTED per item | fflate |
| 12 | Document tools | none | 19 tools; 6 without Stirling | Stirling PDF, pdf-lib |
| 13 | Document extraction | none | per-page text, tables, outline; `document_pages` FTS | Docling, unpdf |
| 14 | Documents tab | — | Reports · Evidence Documents · Legal · Generated · Case Packets · Document Tools + JobsTray | React |
| 15 | External sources | dormant tables, never fetched | submit → crawl → versioned snapshots with diffs, verify, link, recheck | Crawl4AI / basic fetch |
| 16 | SSRF policy | none | static URL check (DB + 3 identical TS copies) + per-hop DNS / redirect checks | Postgres, TS |
| 17 | Investigation graph | SVG NetworkView + React Flow case graph, client-side joins | one INVOKER `graph_expand`, Cytoscape with expand / path / focus / export | Cytoscape.js + fcose |
| 18 | Global search | `search_all` | + Case documents + External sources groups; deep links | Postgres FTS |
| 19 | Index search | none | Meilisearch candidates re-authorised by `search_authorize` (flag) | Meilisearch |
| 20 | Semantic / hybrid search | none | pgvector chunks, `semantic_search`, `hybrid_search` (RRF), Semantic chip (flag) | pgvector, embeddings provider |
| 21 | Background jobs | pg_cron sweeps only | `background_jobs` record, runner + optional BullMQ worker, retries `min(1h, 5s·2^n)`, reap, cancel / retry, Action Center results | Postgres, Deno, BullMQ / Redis |
| 22 | System health | client inference | `system_health()`: service probes, queue stats, cron runs, failures; flag toggles; crawler policy | Postgres, runner |
| 23 | Feature flags | ad hoc env / rows | `feature_flags` + Owner RPC + realtime + env override | Postgres, zustand |
| 24 | Report editor | Tiptap + @-mentions | + slash commands, entity blocks (`[kind:id]`), tables, underline, links; mention kinds + evidence / charge / report / legal / source | Tiptap extensions |
| 25 | Telemetry | `client_errors` | + lazy scrubbed Sentry (browser, DSN-gated), Sentry + OTel in the worker, `@vercel/otel` when configured | Sentry, OpenTelemetry |

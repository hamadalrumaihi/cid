# CID Portal worker

Standalone Node 20 (ESM, TypeScript) process that drains `public.background_jobs`
with the full provider set. It is **optional**: without it the `jobs-runner`
edge function handles the lightweight kinds and the portal keeps working.

## The record is Postgres; Redis is transport

- Every job is a row in `public.background_jobs`. The worker only ever
  learns about work through `public.job_claim(p_worker, p_queues, p_kinds, p_batch)`
  (`for update skip locked`, 5‑minute lease) and reports through
  `job_heartbeat` / `job_complete` / `job_fail`. There is no second source of
  truth: progress, results, errors and retries all live in the row, so the
  Owner console, the Action Center and `background_jobs_stats()` see the
  same thing whether the runner or the worker did the work.
- When `REDIS_URL` is set the claimed row is *mirrored* into a BullMQ queue
  (`cid:<queue>`) and processed by a BullMQ `Worker` with per‑queue
  concurrency and an optional rate limiter. Redis holds nothing durable: if
  it is wiped, leases expire and `private.job_reap()` puts the rows back to
  `queued`.
- Without `REDIS_URL` the same processors run in‑process with the same
  concurrency/rate limits. That is the recommended way to start.

## Job kinds

| queue | kind | provider when configured | fallback |
|---|---|---|---|
| evidence | `evidence.verify` | — | SHA‑256 in process |
| evidence | `evidence.derive` | sharp (thumbnail 320 px, preview 1600 px, WebP) | — |
| pdf | `packet.render` | pdf‑lib (always; the packet is hashed into a manifest, so both tiers render identically) | — |
| pdf | `pdf.tool` | Stirling‑PDF (`STIRLING_URL`) | pdf‑lib for merge / split / extract_pages / rearrange / rotate / page_numbers / watermark / metadata_remove / metadata_inspect / compare; other tools fail `needs_stirling` |
| exports | `bundle.build` | — | fflate zip + manifest |
| crawler | `source.fetch` | Crawl4AI (`CRAWL4AI_URL`) | guarded basic fetch (same SSRF checks) |
| documents | `document.extract` | Docling (`DOCLING_URL`) — pdf/docx/pptx/xlsx/html/images with OCR, tables, outline | unpdf per‑page text for PDF, passthrough for text; other types fail `unsupported_mime` |
| search | `search.sync` | Meilisearch (`MEILI_URL` + `MEILI_MASTER_KEY`) | rows marked `meili_unconfigured` |
| embeddings | `embeddings.generate` | OpenAI‑compatible `/v1/embeddings` (`EMBEDDINGS_API_KEY`) | skipped |
| health | `health.probe` | writes `service_health_events` for worker, supabase, redis and every configured service URL | — |

The kind implementations live in `src/jobCore.ts`, which is byte‑identical
to `supabase/functions/_shared/jobCore.ts` (same for `urlPolicy.ts`,
`htmlText.ts`, `manifest.ts`, `chunk.ts`, `packetPdf.ts`). Edit the
`_shared` copy and copy it here; `npm test` fails when the copies drift.

## Environment

| variable | required | purpose |
|---|---|---|
| `SUPABASE_URL` | yes | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | service role (never in the browser; this process only) |
| `WORKER_NAME` | no | `claimed_by` label; default `worker-<host>-<pid>` |
| `JOB_CONCURRENCY_<QUEUE>` | no | parallel jobs per queue (`JOB_CONCURRENCY_PDF=1`); default `JOB_CONCURRENCY` or 2 |
| `JOB_RATE_<QUEUE>` | no | max jobs per minute per queue (`JOB_RATE_CRAWLER=30`) |
| `JOB_BUDGET_MS` | no | per‑job budget hint (default 20 min) |
| `REDIS_URL` | no | enable BullMQ transport (`redis://redis:6379`) |
| `STIRLING_URL`, `STIRLING_API_KEY` | no | Stirling‑PDF base URL (+ key when security is on) |
| `CRAWL4AI_URL`, `CRAWL4AI_API_TOKEN` | no | Crawl4AI base URL (+ bearer token) |
| `DOCLING_URL`, `DOCLING_API_KEY`, `DOCLING_CONVERT_PATH`, `DOCLING_TIMEOUT_MS` | no | docling‑serve base URL; path default `/v1alpha/convert/file` (falls back to `/v1/convert/file`) |
| `MEILI_URL`, `MEILI_MASTER_KEY` | no | Meilisearch (index `cid`) |
| `EMBEDDINGS_API_KEY`, `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_MODEL` | no | OpenAI‑compatible embeddings; defaults `https://api.openai.com`, `text-embedding-3-small` (1536 dims — must match `semantic_chunks.embedding vector(1536)`) |
| `SENTRY_DSN`, `SENTRY_ENV`, `WORKER_RELEASE` | no | Sentry (scrubbed `beforeSend`: no args, URLs, bodies) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | OTLP/HTTP traces; one span per job with `job.id`, `job.kind`, `job.queue` only |

## Run

```bash
cd workers
npm install
cp ../.env.docker.example .env   # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY at minimum
npm run dev                      # tsx watch, in-process (no Redis needed)

npm run build && npm start       # compiled dist/
npm test                         # vitest: shared-module identity + url policy + html text
npx tsc --noEmit                 # typecheck
```

Docker / Coolify: the root `docker-compose.yml` builds this directory and
adds Redis, Stirling, Crawl4AI, Docling and Meilisearch on an internal
network. Only the worker needs the Supabase credentials; every other
service is reached by its compose name and has no published port.

## Crawler safety

Both providers run the same admission policy: `urlStaticCheck` (scheme,
userinfo, host classes, `crawler_policy` allow/block lists), then every
resolved address (`dns.promises.lookup({all:true})`) is checked with
`isBlockedAddress` — loopback, RFC1918, link‑local, CGNAT, ULA, metadata
endpoints, IPv4‑mapped/NAT64 forms — before any connection, and again on
every redirect hop (basic provider) or on the final URL (Crawl4AI). Byte
caps and timeouts come from `crawler_policy`. Residual risk: fetch cannot
pin the resolved IP, so a DNS answer that flips between check and connect
is not caught; keep the crawler containers on a network without a route to
cloud metadata.

## Graceful shutdown

`SIGTERM`/`SIGINT` stop the pollers, wait for in‑flight jobs, close BullMQ
workers/queues and flush telemetry. Jobs claimed but interrupted are
re‑queued by `private.job_reap()` when their lease expires (cron `*/5`).

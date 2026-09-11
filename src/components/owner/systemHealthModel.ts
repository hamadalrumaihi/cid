/** Pure model behind the Owner Console → System Health section (platform
 *  upgrade §2.9 / §5.2): parses the `system_health()` jsonb defensively,
 *  orders services and queues, and normalises crawler-policy domain input.
 *  No React, no db — tested in systemHealthModel.test.ts. Services are
 *  identified by name only; a URL or credential never appears here (the
 *  server never stores one in `detail` either). */

export const HEALTH_SERVICES = ['supabase', 'runner', 'worker', 'redis', 'stirling', 'crawl4ai', 'docling', 'meilisearch', 'embeddings', 'openfga'] as const
export type HealthService = (typeof HEALTH_SERVICES)[number]

export const SERVICE_LABEL: Record<HealthService, string> = {
  supabase: 'Supabase', runner: 'Jobs runner (edge function)', worker: 'Worker (BullMQ)', redis: 'Redis',
  stirling: 'Stirling PDF', crawl4ai: 'Crawl4AI', docling: 'Docling', meilisearch: 'Meilisearch',
  embeddings: 'Embeddings provider', openfga: 'OpenFGA',
}

/** What a dark service takes away — the card's one-line explanation. */
export const SERVICE_ROLE: Record<HealthService, string> = {
  supabase: 'Database, auth, storage and realtime — the system of record.',
  runner: 'Runs the lightweight job kinds inside Supabase when no worker is deployed.',
  worker: 'External worker for heavy job kinds (PDF tools, crawls, extraction).',
  redis: 'Job transport for the worker (Postgres stays the record).',
  stirling: 'Document tools beyond pdf-lib (OCR, compress, redact, sanitize …).',
  crawl4ai: 'Browser-rendered fetches for external sources.',
  docling: 'Structured extraction for evidence documents.',
  meilisearch: 'Search index candidates (re-authorized in Postgres per hit).',
  embeddings: 'Vectors for semantic search (pgvector stays in Postgres).',
  openfga: 'Evaluated and rejected — never probed in this deployment.',
}

export const JOB_QUEUES = ['pdf', 'crawler', 'documents', 'ocr', 'search', 'embeddings', 'evidence', 'exports', 'notifications', 'health'] as const

export type ServiceStatus = 'healthy' | 'degraded' | 'offline' | 'unknown'

export interface ServiceHealth {
  service: string
  status: ServiceStatus
  latencyMs: number | null
  checkedAt: string | null
}

export interface QueueDepth {
  queue: string
  queued: number
  running: number
  failed: number
  succeeded: number
  total: number
}

export interface JobStats {
  byQueue: Record<string, Record<string, number>>
  failed24h: number
  oldestQueuedSeconds: number
  activeWorkers: number
}

export interface CronRun { job: string; status: string; startedAt: string | null; finishedAt: string | null }
export interface JobFailure { id: string | null; kind: string; error: string | null; finishedAt: string | null }

export interface SystemHealth {
  services: ServiceHealth[]
  jobs: JobStats
  cron: CronRun[]
  failures: JobFailure[]
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : fallback)

const asStatus = (v: unknown): ServiceStatus => (v === 'healthy' || v === 'degraded' || v === 'offline' ? v : 'unknown')

/** Parse the RPC's jsonb. Every known service appears once (in HEALTH_SERVICES
 *  order, `unknown` when never probed); services the server reports that
 *  this build does not know are appended so nothing is silently hidden. */
export function parseSystemHealth(v: unknown): SystemHealth {
  const root = obj(v)
  const reported = new Map<string, ServiceHealth>()
  for (const raw of arr(root.services)) {
    const s = obj(raw)
    const service = str(s.service)
    if (!service) continue
    reported.set(service, { service, status: asStatus(s.status), latencyMs: s.latency_ms == null ? null : num(s.latency_ms), checkedAt: str(s.checked_at) })
  }
  const services: ServiceHealth[] = HEALTH_SERVICES.map((k) => reported.get(k) ?? { service: k, status: 'unknown', latencyMs: null, checkedAt: null })
  for (const [k, s] of reported) if (!(HEALTH_SERVICES as readonly string[]).includes(k)) services.push(s)

  const jobs = obj(root.jobs)
  const byQueue: Record<string, Record<string, number>> = {}
  for (const [q, statuses] of Object.entries(obj(jobs.by_queue))) {
    byQueue[q] = {}
    for (const [st, n] of Object.entries(obj(statuses))) byQueue[q][st] = num(n)
  }
  return {
    services,
    jobs: { byQueue, failed24h: num(jobs.failed_24h), oldestQueuedSeconds: num(jobs.oldest_queued_seconds), activeWorkers: num(jobs.active_workers) },
    cron: arr(root.cron).map((r) => { const c = obj(r); return { job: str(c.job) ?? '—', status: str(c.status) ?? 'unknown', startedAt: str(c.started_at), finishedAt: str(c.finished_at) } }),
    failures: arr(root.failures).map((r) => { const f = obj(r); return { id: str(f.id), kind: str(f.kind) ?? 'unknown', error: str(f.error), finishedAt: str(f.finished_at) } }),
  }
}

/** Queue depth rows in JOB_QUEUES order, then any queue the server reports
 *  beyond the vocabulary; queues with no jobs still render (depth 0). */
export function queueDepths(byQueue: Record<string, Record<string, number>>): QueueDepth[] {
  const names = [...JOB_QUEUES, ...Object.keys(byQueue).filter((q) => !(JOB_QUEUES as readonly string[]).includes(q))]
  return names.map((queue) => {
    const s = byQueue[queue] ?? {}
    const queued = s.queued ?? 0
    const running = (s.running ?? 0) + (s.claimed ?? 0)
    const failed = s.failed ?? 0
    const succeeded = s.succeeded ?? 0
    return { queue, queued, running, failed, succeeded, total: Object.values(s).reduce((a, b) => a + b, 0) }
  })
}

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'danger'

export function serviceTone(status: ServiceStatus): Tone {
  return status === 'healthy' ? 'good' : status === 'degraded' ? 'warn' : status === 'offline' ? 'danger' : 'neutral'
}

export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = { healthy: 'HEALTHY', degraded: 'DEGRADED', offline: 'OFFLINE', unknown: 'NOT PROBED' }

export function cronTone(status: string): Tone {
  return status === 'succeeded' ? 'good' : status === 'failed' ? 'danger' : status === 'running' ? 'accent' : 'neutral'
}

/** `0` → "—", `42` → "42s", `600` → "10m", `7380` → "2h 3m". */
export function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

/** Seconds between two ISO stamps (null when either is missing / invalid). */
export function durationSeconds(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const a = Date.parse(from)
  const b = Date.parse(to)
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 1000) : null
}

/* ── crawler policy ──────────────────────────────────────────────────────── */

export const POLICY_LIMITS = [
  { key: 'max_pages', label: 'Max pages per fetch', min: 1, max: 100, hint: 'Pages a single crawl may visit.' },
  { key: 'max_depth', label: 'Max link depth', min: 0, max: 5, hint: '0 = the submitted page only.' },
  { key: 'timeout_ms', label: 'Timeout (ms)', min: 1000, max: 120000, hint: 'Per request.' },
  { key: 'max_bytes', label: 'Max bytes per page', min: 65536, max: 52428800, hint: 'Larger responses are cut off.' },
  { key: 'rate_per_min', label: 'Requests per minute', min: 1, max: 600, hint: 'Across all crawls.' },
  { key: 'recheck_hours', label: 'Re-check interval (hours)', min: 1, max: 8760, hint: 'How often a source is re-fetched for changes.' },
] as const
export type PolicyLimitKey = (typeof POLICY_LIMITS)[number]['key']

export interface CrawlerPolicyValues {
  allow_domains: string[]
  block_domains: string[]
  max_pages: number
  max_depth: number
  timeout_ms: number
  max_bytes: number
  rate_per_min: number
  recheck_hours: number
}

/** A domain as the policy stores it: lower-case host, no scheme / path /
 *  port / userinfo, no leading dot; null when nothing host-like remains. */
export function normaliseDomain(input: string): string | null {
  let s = String(input ?? '').trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
  s = s.replace(/^[^/@]+@/, '') // userinfo
  s = s.split(/[/?#]/)[0] // path / query / fragment
  s = s.replace(/:\d+$/, '') // port
  s = s.replace(/^\.+|\.+$/g, '') // leading / trailing dots
  s = s.replace(/^\*\./, '') // wildcard prefix — suffix match is implicit
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null
  return s
}

/** Add domains (comma / whitespace separated) to a list, normalised and
 *  deduped; returns the new list plus the inputs that were rejected. */
export function addDomains(list: readonly string[], input: string): { list: string[]; rejected: string[] } {
  const out = [...list]
  const rejected: string[] = []
  for (const part of input.split(/[\s,;]+/)) {
    if (!part) continue
    const d = normaliseDomain(part)
    if (!d) { rejected.push(part); continue }
    if (!out.includes(d)) out.push(d)
  }
  return { list: out, rejected }
}

/** Only the keys that changed — the RPC patches. Lists compare by content. */
export function policyPatch(orig: CrawlerPolicyValues, next: CrawlerPolicyValues): Partial<CrawlerPolicyValues> {
  const patch: Partial<CrawlerPolicyValues> = {}
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  if (!same(orig.allow_domains, next.allow_domains)) patch.allow_domains = next.allow_domains
  if (!same(orig.block_domains, next.block_domains)) patch.block_domains = next.block_domains
  for (const { key } of POLICY_LIMITS) if (orig[key] !== next[key]) patch[key] = next[key]
  return patch
}

/** Clamp a numeric limit into its documented range (NaN → the original). */
export function clampLimit(key: PolicyLimitKey, value: number, fallback: number): number {
  const lim = POLICY_LIMITS.find((l) => l.key === key)!
  if (!Number.isFinite(value)) return fallback
  return Math.max(lim.min, Math.min(lim.max, Math.round(value)))
}

/** Pins for the System Health model: defensive parsing of `system_health()`,
 *  queue ordering, duration formatting and crawler-policy domain handling. */
import { describe, expect, it } from 'vitest'
import {
  HEALTH_SERVICES, addDomains, clampLimit, durationSeconds, fmtDuration, normaliseDomain, parseSystemHealth, policyPatch, queueDepths,
  serviceTone, type CrawlerPolicyValues,
} from './systemHealthModel'

describe('parseSystemHealth', () => {
  it('lists every known service once (unknown when never probed) and appends unknown names', () => {
    const h = parseSystemHealth({
      services: [
        { service: 'supabase', status: 'healthy', latency_ms: 12, checked_at: '2026-09-10T10:00:00Z' },
        { service: 'stirling', status: 'offline', latency_ms: null, checked_at: '2026-09-10T10:00:00Z' },
        { service: 'mystery', status: 'degraded', latency_ms: '40', checked_at: null },
        { status: 'healthy' },
      ],
      jobs: { by_queue: { pdf: { queued: 2, failed: 1 }, health: { succeeded: '9' } }, failed_24h: 1, oldest_queued_seconds: 95, active_workers: 1 },
      cron: [{ job: 'legal-sweep', status: 'succeeded', started_at: '2026-09-10T09:00:00Z', finished_at: '2026-09-10T09:00:02Z' }],
      failures: [{ id: 'j1', kind: 'packet.render', error: 'boom', finished_at: null }],
    })
    expect(h.services).toHaveLength(HEALTH_SERVICES.length + 1)
    expect(h.services[0]).toEqual({ service: 'supabase', status: 'healthy', latencyMs: 12, checkedAt: '2026-09-10T10:00:00Z' })
    expect(h.services.find((s) => s.service === 'stirling')?.status).toBe('offline')
    expect(h.services.find((s) => s.service === 'redis')).toEqual({ service: 'redis', status: 'unknown', latencyMs: null, checkedAt: null })
    expect(h.services.at(-1)).toEqual({ service: 'mystery', status: 'degraded', latencyMs: 40, checkedAt: null })
    expect(h.jobs).toEqual({ byQueue: { pdf: { queued: 2, failed: 1 }, health: { succeeded: 9 } }, failed24h: 1, oldestQueuedSeconds: 95, activeWorkers: 1 })
    expect(h.cron).toEqual([{ job: 'legal-sweep', status: 'succeeded', startedAt: '2026-09-10T09:00:00Z', finishedAt: '2026-09-10T09:00:02Z' }])
    expect(h.failures).toEqual([{ id: 'j1', kind: 'packet.render', error: 'boom', finishedAt: null }])
  })

  it('tolerates garbage', () => {
    for (const v of [null, undefined, 'x', 42, [], { services: 'no', jobs: [], cron: {}, failures: null }]) {
      const h = parseSystemHealth(v)
      expect(h.services).toHaveLength(HEALTH_SERVICES.length)
      expect(h.services.every((s) => s.status === 'unknown')).toBe(true)
      expect(h.jobs.failed24h).toBe(0)
      expect(h.cron).toEqual([])
      expect(h.failures).toEqual([])
    }
  })

  it('never carries a URL or detail through', () => {
    const h = parseSystemHealth({ services: [{ service: 'meilisearch', status: 'healthy', url: 'http://meili:7700', detail: { key: 'x' } }] })
    expect(JSON.stringify(h)).not.toContain('meili:7700')
    expect(JSON.stringify(h)).not.toContain('"key"')
  })
})

describe('queues, tones, durations', () => {
  it('queueDepths keeps the vocabulary order, folds claimed into running, appends extras', () => {
    const rows = queueDepths({ health: { succeeded: 3 }, pdf: { queued: 1, claimed: 1, running: 2, failed: 1 }, extra: { queued: 1 } })
    expect(rows[0]).toEqual({ queue: 'pdf', queued: 1, running: 3, failed: 1, succeeded: 0, total: 5 })
    expect(rows.map((r) => r.queue).slice(0, 3)).toEqual(['pdf', 'crawler', 'documents'])
    expect(rows.at(-1)).toMatchObject({ queue: 'extra', queued: 1, total: 1 })
    expect(rows.find((r) => r.queue === 'ocr')?.total).toBe(0)
  })

  it('tones and formats', () => {
    expect(serviceTone('healthy')).toBe('good')
    expect(serviceTone('degraded')).toBe('warn')
    expect(serviceTone('offline')).toBe('danger')
    expect(serviceTone('unknown')).toBe('neutral')
    expect(fmtDuration(0)).toBe('—')
    expect(fmtDuration(42)).toBe('42s')
    expect(fmtDuration(600)).toBe('10m')
    expect(fmtDuration(7380)).toBe('2h 3m')
    expect(fmtDuration(7200)).toBe('2h')
    expect(durationSeconds('2026-09-10T09:00:00Z', '2026-09-10T09:00:02Z')).toBe(2)
    expect(durationSeconds('2026-09-10T09:00:00Z', null)).toBeNull()
    expect(durationSeconds('2026-09-10T09:00:05Z', '2026-09-10T09:00:00Z')).toBeNull()
  })
})

describe('crawler policy', () => {
  it('normalises domains to a bare lower-case host', () => {
    expect(normaliseDomain(' HTTPS://User:pw@Example.ORG:8443/path?q=1#f ')).toBe('example.org')
    expect(normaliseDomain('*.gov.example')).toBe('gov.example')
    expect(normaliseDomain('.news.example.')).toBe('news.example')
    expect(normaliseDomain('localhost')).toBeNull()
    expect(normaliseDomain('not a host')).toBeNull()
    expect(normaliseDomain('')).toBeNull()
  })

  it('addDomains splits, normalises, dedupes and reports rejects', () => {
    const { list, rejected } = addDomains(['a.example'], 'B.example, a.example bad host https://c.example/x')
    expect(list).toEqual(['a.example', 'b.example', 'c.example'])
    expect(rejected).toEqual(['bad', 'host'])
  })

  it('policyPatch sends only what changed; clampLimit keeps the documented ranges', () => {
    const orig: CrawlerPolicyValues = { allow_domains: [], block_domains: ['x.example'], max_pages: 5, max_depth: 1, timeout_ms: 20000, max_bytes: 5242880, rate_per_min: 30, recheck_hours: 168 }
    expect(policyPatch(orig, { ...orig })).toEqual({})
    expect(policyPatch(orig, { ...orig, max_pages: 10, block_domains: ['x.example', 'y.example'] })).toEqual({ max_pages: 10, block_domains: ['x.example', 'y.example'] })
    expect(clampLimit('max_pages', 500, 5)).toBe(100)
    expect(clampLimit('max_depth', -3, 1)).toBe(0)
    expect(clampLimit('timeout_ms', Number.NaN, 20000)).toBe(20000)
    expect(clampLimit('rate_per_min', 12.6, 30)).toBe(13)
  })
})

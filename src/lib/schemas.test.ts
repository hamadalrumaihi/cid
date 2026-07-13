import { describe, expect, it } from 'vitest'
import type { Json } from './database.types'
import {
  parseLegalFormEntries,
  parseNotifPayload,
  parsePacketManifest,
  parseReopenLog,
  parseReportSignature,
  parseSecurityOverview,
} from './schemas'

describe('parseLegalFormEntries', () => {
  it('returns display entries for plain string form data', () => {
    expect(parseLegalFormEntries({ items_requested: 'Ledgers', date_range: '2026-01 → 2026-06' }))
      .toEqual([['items_requested', 'Ledgers'], ['date_range', '2026-01 → 2026-06']])
  })

  it('filters _-prefixed meta keys and drops empty values', () => {
    expect(parseLegalFormEntries({
      _meta: { frozen: true },
      _reopen_log: [],
      kept: 'yes',
      empty: '',
      gone: null,
    } as unknown as Json)).toEqual([['kept', 'yes']])
  })

  it('stringifies non-string values instead of dropping them', () => {
    expect(parseLegalFormEntries({ count: 3, flag: false, rows: [1, 2], nested: { a: 1 } }))
      .toEqual([['count', '3'], ['flag', 'false'], ['rows', '[1,2]'], ['nested', '{"a":1}']])
  })

  it('degrades garbage (null, arrays, scalars) to []', () => {
    expect(parseLegalFormEntries(null)).toEqual([])
    expect(parseLegalFormEntries(undefined)).toEqual([])
    expect(parseLegalFormEntries(['a', 'b'])).toEqual([])
    expect(parseLegalFormEntries('form')).toEqual([])
    expect(parseLegalFormEntries(42)).toEqual([])
  })
})

describe('parsePacketManifest', () => {
  it('keeps well-formed entries and strips unknown keys', () => {
    expect(parsePacketManifest([
      { exhibit_id: 'e1', type: 'external_link', source_id: null, title: 'Ledger', junk: 'dropped' },
      { exhibit_id: 'e2', type: 'finalized_report', source_id: 's1' },
    ] as unknown as Json)).toEqual([
      { exhibit_id: 'e1', type: 'external_link', source_id: null, title: 'Ledger' },
      { exhibit_id: 'e2', type: 'finalized_report', source_id: 's1' },
    ])
  })

  it('drops malformed entries, keeps the rest', () => {
    expect(parsePacketManifest([
      'junk', 7, null,
      { title: 3 }, // wrong type
      { title: 'ok' },
    ] as unknown as Json)).toEqual([{ title: 'ok' }])
  })

  it('degrades non-arrays to []', () => {
    expect(parsePacketManifest(null)).toEqual([])
    expect(parsePacketManifest({ exhibit_id: 'e1' })).toEqual([])
    expect(parsePacketManifest('[]')).toEqual([])
  })
})

describe('parseNotifPayload', () => {
  it('passes known fields through and keeps unknown keys (loose)', () => {
    expect(parseNotifPayload({ request_id: 'r1', sealed: true, custom_extra: 'kept' }))
      .toEqual({ request_id: 'r1', sealed: true, custom_extra: 'kept' })
  })

  it('degrades whole payloads with wrong-typed known fields to {}', () => {
    expect(parseNotifPayload({ case_id: 5 } as unknown as Json)).toEqual({})
    expect(parseNotifPayload({ sealed: 'yes' } as unknown as Json)).toEqual({})
  })

  it('degrades non-objects to {}', () => {
    expect(parseNotifPayload(null)).toEqual({})
    expect(parseNotifPayload([1, 2])).toEqual({})
    expect(parseNotifPayload('payload')).toEqual({})
  })
})

describe('parseReportSignature', () => {
  it('parses a full signature', () => {
    expect(parseReportSignature({ officer: 'D. Moretti', signer_id: 'u1', badge: '77', signed_at: '2026-07-10T12:00:00Z' }))
      .toEqual({ officer: 'D. Moretti', signer_id: 'u1', badge: '77', signed_at: '2026-07-10T12:00:00Z' })
  })

  it('repairs a missing or wrong-typed officer to the "Officer" fallback', () => {
    expect(parseReportSignature({})).toEqual({ officer: 'Officer' })
    expect(parseReportSignature({ officer: 42, badge: null } as unknown as Json))
      .toEqual({ officer: 'Officer', badge: null })
  })

  it('returns null for non-objects (arrays included)', () => {
    expect(parseReportSignature(null)).toBeNull()
    expect(parseReportSignature(undefined)).toBeNull()
    expect(parseReportSignature('signed')).toBeNull()
    expect(parseReportSignature(7)).toBeNull()
    expect(parseReportSignature([{ officer: 'A' }])).toBeNull()
  })
})

describe('parseReopenLog', () => {
  it('keeps well-formed entries, including a repaired nested prev_signature', () => {
    expect(parseReopenLog([
      { at: '2026-07-10T12:00:00Z', by: 'u1', prev_signature: { officer: 'A' } },
      { at: '2026-07-11T12:00:00Z', by: 'u2', prev_signature: null },
      { prev_signature: { officer: 99 } }, // officer catch → 'Officer'
    ] as unknown as Json)).toEqual([
      { at: '2026-07-10T12:00:00Z', by: 'u1', prev_signature: { officer: 'A' } },
      { at: '2026-07-11T12:00:00Z', by: 'u2', prev_signature: null },
      { prev_signature: { officer: 'Officer' } },
    ])
  })

  it('drops malformed entries and degrades non-arrays to []', () => {
    expect(parseReopenLog(['junk', { at: 5 }, { by: 'u1' }] as unknown as Json))
      .toEqual([{ by: 'u1' }])
    expect(parseReopenLog(null)).toEqual([])
    expect(parseReopenLog({ at: 'x' })).toEqual([])
  })
})

describe('parseSecurityOverview', () => {
  it('parses a full overview and fills per-field fallbacks on a minimal run', () => {
    const parsed = parseSecurityOverview({
      runs: [{ id: 'r1', suite: 'RLS security wall', created_at: '2026-07-10T12:00:00Z' }],
      fixtures: [{ email: 'rls-test-lsb@cidportal.test', present: true, issues: [] }],
      leftovers: { cases: 2 },
    } as unknown as Json)
    expect(parsed.runs).toHaveLength(1)
    expect(parsed.runs[0]).toMatchObject({
      id: 'r1', suite: 'RLS security wall',
      passed: 0, failed: 0, skipped: 0, total: 0,
      failures: [], commit_sha: null, branch: null, release: null,
      source: 'local', duration_ms: null,
    })
    expect(parsed.fixtures).toEqual([{ email: 'rls-test-lsb@cidportal.test', present: true, issues: [] }])
    expect(parsed.leftovers).toEqual({ cases: 2 })
  })

  it('catches malformed sections individually instead of failing the whole shape', () => {
    const parsed = parseSecurityOverview({
      runs: 'nope',
      fixtures: [{ email: 'rls-test-owner@cidportal.test', present: 'yes', issues: 'none' }],
      leftovers: { cases: 'two' },
    } as unknown as Json)
    expect(parsed.runs).toEqual([])
    expect(parsed.fixtures).toEqual([{ email: 'rls-test-owner@cidportal.test', present: false, issues: [] }])
    expect(parsed.leftovers).toEqual({})
  })

  it('falls back to the safe empty shape on garbage', () => {
    const empty = { runs: [], fixtures: [], leftovers: {} }
    expect(parseSecurityOverview(null)).toEqual(empty)
    expect(parseSecurityOverview(undefined)).toEqual(empty)
    expect(parseSecurityOverview('overview')).toEqual(empty)
    expect(parseSecurityOverview([1])).toEqual(empty)
  })
})

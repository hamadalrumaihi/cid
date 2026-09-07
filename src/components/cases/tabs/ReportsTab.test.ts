import { describe, expect, it } from 'vitest'
import { collectReportPersonIds, sealSignatureItems } from './ReportsTab'
import { FORM_SCHEMAS, type FormSchema } from '@/lib/forms'

/** The read view resolves ONLY the person ids a report's fields actually
 *  reference (bounded in:{id} lookup — the whole-registry load is gone), so
 *  this collector is the contract: kv person fields' `_${key}_person_id`
 *  companions plus grid rows' `person_id`, and nothing else. It must stay
 *  tolerant of every legacy fields shape still in the database. */
describe('collectReportPersonIds', () => {
  const arrest = FORM_SCHEMAS.arrest_warrant // suspects grid: full_name person col
  const cid = FORM_SCHEMAS.cid_investigative_report // subjects grid: name person col

  it('collects grid person_id cells and kv _key_person_id companions', () => {
    expect(collectReportPersonIds(cid, {
      subjects: [
        { name: 'Tommy Vercelli', person_id: 'p1' },
        { name: 'Free Text Guy' }, // unlinked row — nothing to resolve
        { name: 'Dup', person_id: 'p1' }, // deduped
      ],
    })).toEqual(['p1'])
    // kv person fields carry the id in a `_${key}_person_id` companion (no
    // current template uses one, but the read view still honors the shape).
    const kvSchema: FormSchema = { title: 't', subtitle: 's', sections: [
      { id: 'who', label: 'Who', type: 'kv', fields: [{ key: 'name_alias', label: 'Name / Alias', type: 'text', person: true }] },
    ] }
    expect(collectReportPersonIds(kvSchema, {
      name_alias: 'Ghost',
      _name_alias_person_id: 'p9',
    })).toEqual(['p9'])
  })

  it('legacy name-only reports (no ids anywhere) yield nothing', () => {
    expect(collectReportPersonIds(arrest, {
      suspects: [{ full_name: 'John Doe', charges: '187 PC' }],
      warrant_title: 'Arrest — John Doe',
    })).toEqual([])
  })

  it('is tolerant of malformed / legacy shapes', () => {
    expect(collectReportPersonIds(undefined, { subjects: [{ person_id: 'p1' }] })).toEqual([])
    expect(collectReportPersonIds(cid, {})).toEqual([])
    expect(collectReportPersonIds(cid, { subjects: 'not-an-array' })).toEqual([])
    expect(collectReportPersonIds(cid, { subjects: [null, 42, { person_id: '  ' }, { person_id: 7 }] })).toEqual([])
    expect(collectReportPersonIds(cid, { _name_person_id: 'kv-key-not-in-schema' })).toEqual([])
  })

  it('non-person fields never contribute, even if an id-like key exists', () => {
    // det_name is NOT a person-flagged field — its companion must be ignored.
    expect(collectReportPersonIds(cid, {
      det_name: 'Det. Marsh',
      _det_name_person_id: 'should-not-appear',
    })).toEqual([])
  })
})

/** Sealed reports show BOTH signatures (author seal + reviewer approval) and
 *  every superseded pair a reopen preserved in fields._reopen_log — the
 *  contract's report_reopen keeps prev_signature AND prev_reviewer_signature
 *  per entry, so both must surface (superseded) and neither may be dropped. */
describe('sealSignatureItems', () => {
  const author = { officer: 'Det. Marsh', signer_id: 'u1', badge: '1201', signed_at: '2026-09-01T10:00:00Z', typed: 'Det. Marsh' }
  const reviewer = { officer: 'Lt. Cole', signer_id: 'u2', badge: '0400', signed_at: '2026-09-02T10:00:00Z', typed: 'Lt. Cole', role: 'bureau_lead' }

  it('lists the author seal then the reviewer approval with its role', () => {
    const items = sealSignatureItems({ signature: author, reviewer_signature: reviewer, fields: {} })
    expect(items.map((i) => [i.id, i.action, i.role ?? null, i.superseded ?? false])).toEqual([
      ['current', 'report seal', null, false],
      ['reviewer', 'review approval', 'bureau_lead', false],
    ])
    expect(items[1].badge).toBe('0400')
  })

  it('a draft (no signatures) yields nothing; a self-sealed report has only the author', () => {
    expect(sealSignatureItems({ signature: null, reviewer_signature: null, fields: {} })).toEqual([])
    expect(sealSignatureItems({ signature: author, reviewer_signature: null, fields: {} }).map((i) => i.id)).toEqual(['current'])
  })

  it('reopen log entries surface both previous signatures as superseded, in order', () => {
    const fields = { _reopen_log: [
      { at: '2026-09-03T00:00:00Z', by: 'u9', reason: 'typo', prev_signature: author, prev_reviewer_signature: reviewer },
      { at: '2026-09-04T00:00:00Z', prev_signature: author }, // self-seal era: no reviewer
      'garbage', // malformed entries are skipped, never crash
    ] }
    const items = sealSignatureItems({ signature: null, reviewer_signature: null, fields })
    expect(items.map((i) => [i.id, i.superseded, i.at])).toEqual([
      ['prev-0', true, '2026-09-03T00:00:00Z'],
      ['prev-rev-0', true, '2026-09-03T00:00:00Z'],
      ['prev-1', true, '2026-09-04T00:00:00Z'],
    ])
  })
})

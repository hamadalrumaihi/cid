import { describe, expect, it } from 'vitest'
import type { Json } from './database.types'
import { FORM_SCHEMAS, REPORT_TEMPLATES, SEEDED_REQUIRED, fallbackRequiredKeys, formGapsForKeys, formKeySatisfied, formValueKeys, reportFinalizeGaps, type FormSchema } from './forms'
import {
  STARTER_REQUIRED, advisoryGaps, fallbackTemplates, fallbackVersionFor, formSchemaZ, isReportEditable, isTemplateKey,
  missingSchemaKeys, parseFormSchema, parseSignatureInfo, reopenEntries, reportReviewTone, requiredGaps, reviewStatusOf,
  REPORT_REVIEW_LABEL, sortTemplates, starterSchema, unwrapAdminResult, validateFormSchema, versionFromRow,
} from './reportTemplates'

/** The zod validator mirrors report_template_save's shape rules (contract
 *  §2): every seeded FORM_SCHEMAS entry must pass, and each server refusal
 *  (unknown types, select without opts, duplicate ids / keys) must be caught
 *  BEFORE the round trip so the template editor can say what to fix. */
describe('formSchemaZ / parseFormSchema', () => {
  it('accepts all 14 seeded FORM_SCHEMAS unchanged (P5-06: every template renders)', () => {
    const keys = Object.keys(FORM_SCHEMAS)
    expect(keys).toHaveLength(14)
    for (const k of keys) {
      const v = validateFormSchema(FORM_SCHEMAS[k])
      expect(v.ok, `${k}: ${v.ok ? '' : v.error}`).toBe(true)
      expect(parseFormSchema(FORM_SCHEMAS[k])).toEqual(FORM_SCHEMAS[k])
    }
  })

  it('the six new narrative templates use only the existing section / field types', () => {
    for (const k of ['incident_followup', 'interview', 'arrest_report', 'search_report', 'case_closure', 'warrant_return']) {
      expect(FORM_SCHEMAS[k], k).toBeTruthy()
      expect(formSchemaZ.safeParse(FORM_SCHEMAS[k]).success, k).toBe(true)
    }
  })

  const base = (): FormSchema => ({ title: 'T', subtitle: 'S', sections: [
    { id: 'a', label: 'A', type: 'kv', fields: [{ key: 'x', label: 'X', type: 'text' }] },
    { id: 'b', label: 'B', type: 'textarea', key: 'y' },
    { id: 'g', label: 'G', type: 'grid', cols: [{ key: 'c1', label: 'C1' }] },
    { id: 'n', label: 'N', type: 'note', text: 'hello' },
  ] })

  it('rejects the shapes the server rejects, naming the path', () => {
    const dupId = base(); dupId.sections[1].id = 'a'
    expect(validateFormSchema(dupId)).toMatchObject({ ok: false, error: expect.stringContaining('duplicate section id "a"') })
    const dupKey = base(); (dupKey.sections[1] as { key: string }).key = 'x'
    expect(validateFormSchema(dupKey)).toMatchObject({ ok: false, error: expect.stringContaining('duplicate field key "x"') })
    const noOpts = base(); (noOpts.sections[0] as { fields: { type: string }[] }).fields[0].type = 'select'
    expect(validateFormSchema(noOpts)).toMatchObject({ ok: false, error: expect.stringContaining('opts') })
    const badType = { ...base(), sections: [{ id: 'z', label: 'Z', type: 'image', src: 'x' }] }
    expect(validateFormSchema(badType).ok).toBe(false)
    const badField = base(); (badField.sections[0] as { fields: { type: string }[] }).fields[0].type = 'number'
    expect(validateFormSchema(badField).ok).toBe(false)
    const dupCol = base(); (dupCol.sections[2] as { cols: { key: string; label: string }[] }).cols.push({ key: 'c1', label: 'again' })
    expect(validateFormSchema(dupCol)).toMatchObject({ ok: false, error: expect.stringContaining('duplicate column key "c1"') })
    expect(validateFormSchema({ title: '', subtitle: '', sections: [] }).ok).toBe(false)
    expect(parseFormSchema(null)).toBeNull()
    expect(parseFormSchema('nope')).toBeNull()
  })

  it('grid column keys may repeat a kv field key (different namespaces) and section ids may equal field keys', () => {
    const s = base(); (s.sections[2] as { cols: { key: string; label: string }[] }).cols[0].key = 'x'
    expect(validateFormSchema(s).ok).toBe(true)
  })

  it('missingSchemaKeys reports required / advisory keys the schema lacks (grid ids count as keys)', () => {
    expect(missingSchemaKeys(base(), ['x', 'y', 'g', 'zzz'])).toEqual(['zzz'])
  })

  it('starterSchema validates and STARTER_REQUIRED keys exist in it; isTemplateKey is snake_case', () => {
    const s = starterSchema('Use of Force')
    expect(validateFormSchema(s).ok).toBe(true)
    expect(s.title).toBe('Use of Force')
    expect(missingSchemaKeys(s, STARTER_REQUIRED)).toEqual([])
    expect(isTemplateKey('use_of_force')).toBe(true)
    expect(isTemplateKey('Use-Of-Force')).toBe(false)
    expect(isTemplateKey('_x')).toBe(false)
    expect(isTemplateKey('a')).toBe(false)
  })
})

/** Required-field semantics (RB4, contract report_submit): a key is
 *  satisfied by a non-blank string, a non-empty array, or a grid with ≥ 1
 *  row. These are the client mirror of the server's hard block. */
describe('required-field checker', () => {
  const schema = FORM_SCHEMAS.incident_followup

  it('formValueKeys lists kv fields, textarea keys and grid ids in schema order', () => {
    const keys = formValueKeys(schema).map((k) => k.key)
    expect(keys.slice(0, 3)).toEqual(['case_number', 'date', 'detective'])
    expect(keys).toContain('developments') // textarea key
    expect(keys).toContain('contacts') // grid id
    expect(keys).toContain('evidence') // grid id
  })

  it('formKeySatisfied: blank / whitespace / null / empty array fail; text, checks and grid rows pass', () => {
    expect(formKeySatisfied({}, 'x')).toBe(false)
    expect(formKeySatisfied({ x: '   ' }, 'x')).toBe(false)
    expect(formKeySatisfied({ x: null }, 'x')).toBe(false)
    expect(formKeySatisfied({ x: [] }, 'x')).toBe(false)
    expect(formKeySatisfied({ x: 'ok' }, 'x')).toBe(true)
    expect(formKeySatisfied({ x: ['Yes'] }, 'x')).toBe(true)
    expect(formKeySatisfied({ x: [{}] }, 'x')).toBe(true) // a grid with one (even empty) row
    expect(formKeySatisfied({ x: 0 }, 'x')).toBe(true)
  })

  it('requiredGaps / advisoryGaps label gaps from the pinned version, unknown keys fall back to the key', () => {
    const version = { schema, required: ['case_number', 'date', 'detective', 'narrative', 'contacts', 'ghost_key'], advisory: ['next_steps'] }
    const values = { case_number: 'MCB-1', detective: 'Det. Marsh', contacts: [{ name: 'A' }] }
    expect(requiredGaps(version, values)).toEqual([
      { key: 'date', label: 'Date' },
      { key: 'narrative', label: 'Narrative' },
      { key: 'ghost_key', label: 'ghost_key' },
    ])
    expect(advisoryGaps(version, values)).toEqual([{ key: 'next_steps', label: 'Next Steps' }])
    expect(requiredGaps(version, { ...values, date: '2026-09-07', narrative: 'x', ghost_key: 'y' })).toEqual([])
    expect(formGapsForKeys(schema, [], values)).toEqual([])
  })

  it('SEEDED_REQUIRED covers all 14 templates and every key exists in its schema (grid ids included)', () => {
    expect(Object.keys(SEEDED_REQUIRED).sort()).toEqual(Object.keys(FORM_SCHEMAS).sort())
    for (const [k, keys] of Object.entries(SEEDED_REQUIRED)) {
      expect(missingSchemaKeys(FORM_SCHEMAS[k], keys), k).toEqual([])
      expect(fallbackRequiredKeys(k)).toEqual([...keys])
    }
    expect(fallbackRequiredKeys('raid_seizure')).toContain('inventory') // a grid: satisfied by ≥ 1 row
  })

  it('fallbackRequiredKeys derives the seeded shape for an unknown key from its schema', () => {
    expect(fallbackRequiredKeys('custom_thing', FORM_SCHEMAS.incident_followup)).toEqual(['case_number', 'date', 'detective', 'narrative'])
    expect(fallbackRequiredKeys('custom_thing', FORM_SCHEMAS.search_warrant)).toEqual(['case_number', 'date', 'affiant', 'probable_cause'])
    expect(fallbackRequiredKeys('nope')).toEqual([])
    expect(fallbackRequiredKeys(null)).toEqual([])
  })

  it('reportFinalizeGaps stays a thin wrapper (labels of the fallback gaps; unknown template → none)', () => {
    expect(reportFinalizeGaps({ template: 'incident_followup', kind: 'initial', seq: 1, fields: { case_number: 'X' } })).toEqual(['Date', 'Reporting Detective', 'Narrative'])
    expect(reportFinalizeGaps({ template: 'no_such', kind: 'initial', seq: 1, fields: {} })).toEqual([])
    expect(reportFinalizeGaps({ template: 'incident_followup', kind: 'initial', seq: 1, fields: 'garbage' })).toHaveLength(4)
    expect(reportFinalizeGaps({ template: 'raid_seizure', kind: 'initial', seq: 1, fields: { case_number: 'X', seizure_date: 'd', operation: 'o', inventory: [{ item: 'x' }] } })).toEqual([])
  })
})

/** Fallback catalog (contract: the tab never dead-ends): FORM_SCHEMAS become
 *  in-memory published versions — unpinnable (id null), with the seed's
 *  review rule (legal drafting forms self-seal) and required map. */
describe('fallback versions and catalog', () => {
  it('fallbackVersionFor derives an unpinnable version with the seed rules', () => {
    const v = fallbackVersionFor('incident_followup')!
    expect(v.id).toBeNull()
    expect(v.fallback).toBe(true)
    expect(v.reviewRequired).toBe(true)
    expect(v.required).toEqual([...SEEDED_REQUIRED.incident_followup])
    expect(v.schema).toBe(FORM_SCHEMAS.incident_followup)
    for (const k of ['arrest_warrant', 'search_warrant', 'wiretap_warrant', 'subpoena']) expect(fallbackVersionFor(k)!.reviewRequired, k).toBe(false)
    expect(fallbackVersionFor('surveillance_report')!.reviewRequired).toBe(true)
    expect(fallbackVersionFor('nope')).toBeNull()
    expect(fallbackVersionFor(null)).toBeNull()
  })

  it('fallbackTemplates covers every REPORT_TEMPLATES entry, default first after sorting', () => {
    const t = sortTemplates(fallbackTemplates())
    expect(t).toHaveLength(REPORT_TEMPLATES.length)
    expect(t[0].key).toBe('cid_investigative_report')
    expect(t[0].isDefault).toBe(true)
    expect(t.every((x) => x.fallback && x.version.id === null && x.active)).toBe(true)
  })

  it('sortTemplates: default first, then sort_order, then name', () => {
    const rows = [
      { id: '1', key: 'b', name: 'Bravo', description: null, isDefault: false, sortOrder: 2, active: true, fallback: false },
      { id: '2', key: 'a', name: 'Alpha', description: null, isDefault: false, sortOrder: 2, active: true, fallback: false },
      { id: '3', key: 'z', name: 'Zulu', description: null, isDefault: true, sortOrder: 9, active: true, fallback: false },
      { id: '4', key: 'c', name: 'Charlie', description: null, isDefault: false, sortOrder: 1, active: true, fallback: false },
    ]
    expect(sortTemplates(rows).map((r) => r.key)).toEqual(['z', 'c', 'a', 'b'])
  })

  it('versionFromRow types a DB row and refuses one whose schema does not validate', () => {
    const row = {
      id: 'v1', template_id: 't1', version_number: 3, schema: FORM_SCHEMAS.interview as unknown as Json, required: ['case_number'], advisory: ['assessment'],
      review_required: false, status: 'published', change_summary: 'x', created_at: '2026-01-01', created_by: 'u', published_at: '2026-01-02', published_by: 'u', superseded_at: null,
    }
    const v = versionFromRow(row, 'interview')!
    expect(v).toMatchObject({ id: 'v1', templateId: 't1', templateKey: 'interview', versionNumber: 3, required: ['case_number'], advisory: ['assessment'], reviewRequired: false, status: 'published', fallback: false })
    expect(versionFromRow({ ...row, schema: { title: 'broken' } as Json }, 'interview')).toBeNull()
    expect(versionFromRow({ ...row, status: 'weird' }, 'interview')!.status).toBe('published')
  })
})

describe('review-flow vocabulary', () => {
  it('labels and tones per status; legacy rows derive from finalized', () => {
    expect(REPORT_REVIEW_LABEL).toEqual({ draft: 'Draft', submitted: 'Awaiting review', returned: 'Returned for revision', approved: 'Sealed' })
    expect(reviewStatusOf({ review_status: 'submitted' })).toBe('submitted')
    expect(reviewStatusOf({ review_status: null, finalized: true })).toBe('approved')
    expect(reviewStatusOf({ review_status: 'bogus', finalized: false })).toBe('draft')
    expect(reportReviewTone('draft')).toBe('neutral')
    expect(reportReviewTone('submitted')).toBe('accent')
    expect(reportReviewTone('returned')).toBe('warn')
    expect(reportReviewTone('approved')).toBe('good')
  })

  it('isReportEditable: draft or returned and not finalized', () => {
    expect(isReportEditable({ review_status: 'draft', finalized: false })).toBe(true)
    expect(isReportEditable({ review_status: 'returned', finalized: false })).toBe(true)
    expect(isReportEditable({ review_status: 'submitted', finalized: false })).toBe(false)
    expect(isReportEditable({ review_status: 'approved', finalized: true })).toBe(false)
    expect(isReportEditable({ review_status: 'draft', finalized: true })).toBe(false) // inconsistent row: the seal wins
  })

  it('parseSignatureInfo keeps typed + role; reopenEntries keeps both previous signatures and skips junk', () => {
    expect(parseSignatureInfo({ officer: 'Lt. Cole', badge: '0400', typed: 'Lt. Cole', role: 'bureau_lead', signed_at: 't' })).toMatchObject({ officer: 'Lt. Cole', role: 'bureau_lead', typed: 'Lt. Cole' })
    expect(parseSignatureInfo({})).toMatchObject({ officer: 'Officer' })
    expect(parseSignatureInfo(null)).toBeNull()
    expect(parseSignatureInfo([1])).toBeNull()
    const entries = reopenEntries({ _reopen_log: [{ at: 'a', by: 'u', reason: 'r', prev_signature: { officer: 'A' }, prev_reviewer_signature: { officer: 'B', role: 'director' } }, 42] })
    expect(entries).toHaveLength(1)
    expect(entries[0].prev_reviewer_signature?.role).toBe('director')
    expect(reopenEntries({})).toEqual([])
    expect(reopenEntries({ _reopen_log: 'x' })).toEqual([])
  })
})

/** Template-admin RPCs return jsonb `{ok:true,…}` / `{ok:false, code,
 *  message}`; a raise arrives as res.error. All three collapse to one shape. */
describe('unwrapAdminResult', () => {
  it('passes ok payloads through, surfaces the server message on denial, and the transport error otherwise', () => {
    expect(unwrapAdminResult({ data: { ok: true, version_id: 'v' }, error: null })).toEqual({ ok: true, data: { ok: true, version_id: 'v' } })
    expect(unwrapAdminResult({ data: { ok: false, code: 'denied', message: 'Director only' }, error: null })).toEqual({ ok: false, message: 'Director only' })
    expect(unwrapAdminResult({ data: { ok: false }, error: null })).toEqual({ ok: false, message: 'Not allowed.' })
    expect(unwrapAdminResult({ data: null, error: { message: 'boom' } })).toEqual({ ok: false, message: 'boom' })
    expect(unwrapAdminResult({ data: 'weird', error: null })).toEqual({ ok: false, message: 'Unexpected response.' })
  })
})

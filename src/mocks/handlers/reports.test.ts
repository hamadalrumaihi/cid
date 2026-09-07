/** Pins for the Phase 5 report-builder mock handlers: the lazy template
 *  seed (14 FORM_SCHEMAS, published v1, the review rule and the REQUIRED
 *  map), template administration (propose / publish / discard / update
 *  authority, schema validation, pinned versions surviving a publish), the
 *  review flow (required fields, the case_closure task gate + waivers,
 *  submit → return → resubmit → approve, reopen with a reason, self-seal
 *  templates), entities + exports, and the direct-write triggers. Refusals
 *  are returned ({ok:false, code}) where the server returns them and RAISED
 *  (ReportRpcError) where the server raises. These call the handlers
 *  directly against the mock store — no MSW server, no network; the wire
 *  shape is exercised by tests/msw. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Json, Tables } from '@/lib/database.types'
import { FORM_SCHEMAS, REPORT_TEMPLATES, type FormSchema } from '@/lib/forms'
import {
  caseChargeRow, caseRow, caseTaskRow, emptyCase, personRow, profileRow, reportEntityRow, reportExportRow, reportRow,
  reportTemplateRow, reportTemplateVersionRow, roleSession,
} from '../fixtures'
import { mockId, readRows, resetMockStore, seedRows, setSession } from '../store'
import {
  REPORT_RPCS, REPORT_RPC_ONLY_TABLES, ReportRpcError, SEED_TEMPLATE_KEYS, TEMPLATE_REQUIRED, caseTaskUnwaive, caseTaskWaive,
  ensureReportTemplates, pinReportTemplateVersion, reportCreate, reportEntitiesSet, reportFinalize, reportHandlers,
  reportRecordExport, reportReopen, reportReview, reportSubmit, reportTemplateDiscard, reportTemplatePublish,
  reportTemplateSave, reportTemplateUpdate, reportUpdateGuard, seedReportTemplates, visibleReportRows,
} from './reports'

const asUser = (p: Tables<'profiles'>) => setSession({ userId: p.id, email: p.email ?? 'x@cid.test', password: 'mock-password' })
const SELF_SEAL = ['arrest_warrant', 'search_warrant', 'wiretap_warrant', 'subpoena']

/** A minimal valid FormSchema for the admin tests. */
const SCHEMA: FormSchema = {
  title: 'Mock Narrative',
  subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
  sections: [
    { id: 'hdr', label: 'Report', type: 'kv', fields: [
      { key: 'case_number', label: 'Case Number', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'detective', label: 'Detective', type: 'text' },
      { key: 'mode', label: 'Mode', type: 'select', opts: ['', 'A', 'B'] },
    ] },
    { id: 'people', label: 'People', type: 'grid', cols: [{ key: 'name', label: 'Name' }] },
    { id: 'narrative', label: 'Narrative', type: 'textarea', key: 'narrative' },
    { id: 'note', label: 'Note', type: 'note', text: 'Read me.' },
  ],
}

/** Every `required` key of a version, filled so submit passes. */
function fillRequired(v: Tables<'report_template_versions'>): Record<string, Json> {
  const schema = v.schema as unknown as FormSchema
  const out: Record<string, Json> = {}
  for (const key of v.required) {
    const grid = schema.sections.find((s) => s.type === 'grid' && s.id === key)
    const field = schema.sections.flatMap((s) => (s.type === 'kv' ? s.fields : [])).find((f) => f.key === key)
    out[key] = grid ? [{ [(grid as { cols: { key: string }[] }).cols[0].key]: 'x' }]
      : field?.type === 'checks' ? [field.opts?.[0] ?? 'x']
        : field?.type === 'select' ? field.opts?.find(Boolean) ?? 'x'
          : `value for ${key}`
  }
  return out
}

/** A detective's case + the cast: the bureau lead (reviewer), a senior
 *  detective in the same bureau, an outsider in another bureau, a director. */
function workspace() {
  const me = roleSession('detective')
  const [lead, senior, outsider, director] = seedRows('profiles', [
    profileRow({ role: 'bureau_lead', display_name: 'Lt. Lead' }),
    profileRow({ role: 'senior_detective', display_name: 'SrDet Same Bureau' }),
    profileRow({ division: 'street_crimes', display_name: 'Det. Outsider' }),
    profileRow({ role: 'director', display_name: 'Dir. Hale' }),
  ])
  const { caseRecord } = emptyCase({ created_by: me.profile.id, lead_detective_id: me.profile.id })
  const [otherCase] = seedRows('cases', [caseRow({ bureau: 'street_crimes', case_number: 'SCB-5000001', created_by: outsider.id })])
  return { me, lead, senior, outsider, director, caseRecord, otherCase }
}
type W = ReturnType<typeof workspace>

const versionOf = (r: Tables<'reports'>) => readRows('report_template_versions').find((v) => v.id === r.template_version_id)!
const draft = (w: W, template = 'incident_followup') => {
  asUser(w.me.profile)
  return reportCreate({ p_case: w.caseRecord.id, p_template: template })
}
const ready = (w: W, template = 'incident_followup') => {
  const r = draft(w, template)
  r.fields = fillRequired(versionOf(r))
  return r
}
const expectRaise = (fn: () => unknown, re: RegExp) => {
  try { fn() } catch (e) {
    expect(e).toBeInstanceOf(ReportRpcError)
    expect((e as Error).message).toMatch(re)
    return
  }
  throw new Error(`expected a raise matching ${re}`)
}
const notes = (type: string) => readRows('notifications').filter((n) => n.type === type)
const audits = (entityId: string) => readRows('audit_log').filter((a) => a.entity_id === entityId).map((a) => a.action)

beforeEach(() => resetMockStore())

describe('registry', () => {
  it('exposes every Phase 5 RPC and refuses every write to the RPC-only tables', () => {
    for (const fn of ['report_template_save', 'report_template_publish', 'report_template_discard', 'report_template_update',
      'report_create', 'report_submit', 'report_review', 'report_finalize', 'report_reopen',
      'report_entities_set', 'report_record_export', 'case_task_waive', 'case_task_unwaive']) expect(fn in REPORT_RPCS, fn).toBe(true)
    expect(REPORT_RPC_ONLY_TABLES).toHaveLength(4)
    expect(reportHandlers).toHaveLength(REPORT_RPC_ONLY_TABLES.length * 3)
  })
})

describe('template seed (P5-01)', () => {
  it('seeds the 14 FORM_SCHEMAS as published v1; review_required false only for the legal drafting forms; every required key exists in its schema', () => {
    roleSession('detective')
    expect(SEED_TEMPLATE_KEYS).toHaveLength(14)
    ensureReportTemplates()
    const templates = readRows('report_templates')
    expect(templates.map((t) => t.key).sort()).toEqual([...SEED_TEMPLATE_KEYS].sort())
    expect(templates.filter((t) => t.is_default).map((t) => t.key)).toEqual(['cid_investigative_report'])
    expect(templates.every((t) => t.active)).toBe(true)
    const versions = readRows('report_template_versions')
    expect(versions).toHaveLength(14)
    for (const t of templates) {
      const v = versions.find((x) => x.template_id === t.id)!
      expect(v, t.key).toMatchObject({ version_number: 1, status: 'published' })
      expect(v.published_at).toBeTruthy()
      expect(v.review_required, t.key).toBe(!SELF_SEAL.includes(t.key))
      expect(v.schema).toEqual(FORM_SCHEMAS[t.key])
      expect(Array.isArray(v.advisory)).toBe(true)
      expect(v.required, t.key).toEqual(TEMPLATE_REQUIRED[t.key])
      expect(v.required.length).toBeGreaterThan(0)
      const schema = v.schema as unknown as FormSchema
      const keys = new Set(schema.sections.flatMap((s) => (s.type === 'kv' ? s.fields.map((f) => f.key) : s.type === 'textarea' ? [s.key] : s.type === 'grid' ? [s.id] : [])))
      for (const k of v.required) expect(keys.has(k), `${t.key}.${k}`).toBe(true)
    }
    // Idempotent: a second seed adds nothing; the REPORT_TEMPLATES order is the sort order.
    expect(seedReportTemplates().templates).toEqual([])
    expect(templates.map((t) => t.key)).toEqual(REPORT_TEMPLATES.map((t) => t.id))
  })

  it('templates read for active members and the Owner only; entities / exports read through the parent report', () => {
    const w = workspace()
    ensureReportTemplates()
    const r = draft(w)
    seedRows('report_entities', [reportEntityRow({ report_id: r.id, inserted_by: w.me.profile.id })])
    seedRows('report_exports', [reportExportRow({ report_id: r.id, exported_by: w.me.profile.id })])
    expect(visibleReportRows('report_templates', readRows('report_templates'))).toHaveLength(14)
    expect(visibleReportRows('report_entities', readRows('report_entities'))).toHaveLength(1)
    expect(visibleReportRows('report_exports', readRows('report_exports'))).toHaveLength(1)
    asUser(w.outsider)
    expect(visibleReportRows('report_template_versions', readRows('report_template_versions'))).toHaveLength(14)
    expect(visibleReportRows('report_entities', readRows('report_entities'))).toEqual([])
    expect(visibleReportRows('report_exports', readRows('report_exports'))).toEqual([])
    roleSession('owner')
    expect(visibleReportRows('report_entities', readRows('report_entities'))).toHaveLength(1)
    roleSession('applicant')
    expect(visibleReportRows('report_templates', readRows('report_templates'))).toEqual([])
    setSession(null)
    expect(visibleReportRows('report_template_versions', readRows('report_template_versions'))).toEqual([])
    expect(visibleReportRows('cases', readRows('cases'))).toHaveLength(2)
  })
})

describe('template administration (P5-02)', () => {
  it('a detective is denied; a Bureau Lead proposes a draft on an existing key (replacing it) but cannot publish or create a key; the director does both', () => {
    const w = workspace()
    expect(reportTemplateSave({ p_key: 'incident_followup', p_name: 'x', p_schema: SCHEMA, p_required: ['case_number'] })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.lead)
    const first = reportTemplateSave({ p_key: 'incident_followup', p_name: 'Incident Follow-up Report', p_schema: SCHEMA, p_required: ['case_number', 'narrative'], p_advisory: ['detective'], p_change_summary: 'tighter' }) as { ok: boolean; template_id: string; version_id: string; version_number: number }
    expect(first).toMatchObject({ ok: true, version_number: 2 })
    const again = reportTemplateSave({ p_key: 'incident_followup', p_name: 'Incident Follow-up Report', p_schema: SCHEMA, p_required: ['case_number'] }) as { version_id: string; version_number: number }
    expect(again.version_number).toBe(2)
    expect(readRows('report_template_versions').filter((v) => v.template_id === first.template_id && v.status === 'draft')).toHaveLength(1)
    expect(readRows('report_template_versions').find((v) => v.id === again.version_id)).toMatchObject({ status: 'draft', required: ['case_number'], review_required: true, created_by: w.lead.id })
    expect(reportTemplatePublish({ p_version: again.version_id })).toMatchObject({ ok: false, code: 'denied' })
    expect(reportTemplateSave({ p_key: 'lead_new_key', p_name: 'New', p_schema: SCHEMA, p_required: [] })).toMatchObject({ ok: false, code: 'denied' })
    expect(readRows('report_templates').find((t) => t.key === 'lead_new_key')).toBeUndefined()
    asUser(w.director)
    const created = reportTemplateSave({ p_key: 'field_contact', p_name: 'Field Contact', p_schema: SCHEMA, p_required: ['case_number', 'narrative'], p_review_required: false, p_description: 'A quick one' }) as { ok: boolean; template_id: string; version_id: string; version_number: number }
    expect(created).toMatchObject({ ok: true, version_number: 1 })
    expect(readRows('report_templates').find((t) => t.id === created.template_id)).toMatchObject({ key: 'field_contact', active: true, is_default: false, description: 'A quick one', created_by: w.director.id })
    expect(readRows('report_template_versions').find((v) => v.id === created.version_id)).toMatchObject({ status: 'draft', review_required: false })
    // Not yet published → not creatable.
    asUser(w.me.profile)
    expectRaise(() => reportCreate({ p_case: w.caseRecord.id, p_template: 'field_contact' }), /unknown report template/i)
    roleSession('owner')
    expect(reportTemplatePublish({ p_version: created.version_id })).toMatchObject({ ok: true, version_id: created.version_id, superseded_version_id: null })
    asUser(w.me.profile)
    expect(reportCreate({ p_case: w.caseRecord.id, p_template: 'field_contact' }).template_version_id).toBe(created.version_id)
  })

  it('a malformed schema or a required key outside the schema raises; the catalog is untouched', () => {
    const w = workspace()
    ensureReportTemplates()
    asUser(w.director)
    const before = readRows('report_template_versions').length
    expectRaise(() => reportTemplateSave({ p_key: 'bad', p_name: 'Bad', p_schema: { title: 'x', subtitle: 'y', sections: 'nope' }, p_required: [] }), /at least one section/i)
    expectRaise(() => reportTemplateSave({ p_key: 'bad', p_name: 'Bad', p_schema: { ...SCHEMA, sections: [{ id: 'a', label: 'A', type: 'kv', fields: [{ key: 'k', label: 'K', type: 'bogus' }] }] }, p_required: [] }), /type in text\|date/i)
    expectRaise(() => reportTemplateSave({ p_key: 'bad', p_name: 'Bad', p_schema: { ...SCHEMA, sections: [SCHEMA.sections[0], SCHEMA.sections[0]] }, p_required: [] }), /duplicate section id/i)
    expectRaise(() => reportTemplateSave({ p_key: 'bad', p_name: 'Bad', p_schema: { ...SCHEMA, sections: [{ id: 'a', label: 'A', type: 'kv', fields: [{ key: 'mode', label: 'M', type: 'select' }] }] }, p_required: [] }), /needs opts/i)
    expectRaise(() => reportTemplateSave({ p_key: 'bad', p_name: 'Bad', p_schema: SCHEMA, p_required: ['nowhere'] }), /not in the schema/i)
    expectRaise(() => reportTemplateSave({ p_key: 'bad', p_name: 'Bad', p_schema: SCHEMA, p_required: 'case_number' }), /array of field keys/i)
    expect(readRows('report_template_versions')).toHaveLength(before)
    expect(readRows('report_templates').find((t) => t.key === 'bad')).toBeUndefined()
  })

  it('publish supersedes the previous version while an existing report keeps its pinned version; discard is author-or-admin; update patches whitelisted keys', () => {
    const w = workspace()
    const r1 = draft(w)
    const v1 = versionOf(r1)
    asUser(w.lead)
    const saved = reportTemplateSave({ p_key: 'incident_followup', p_name: 'Incident Follow-up Report', p_schema: SCHEMA, p_required: ['case_number'] }) as { version_id: string; template_id: string }
    asUser(w.director)
    const pub = reportTemplatePublish({ p_version: saved.version_id, p_note: 'v2 live' })
    expect(pub).toEqual({ ok: true, version_id: saved.version_id, superseded_version_id: v1.id })
    expect(v1.status).toBe('superseded'); expect(v1.superseded_at).toBeTruthy()
    expect(readRows('report_template_versions').find((v) => v.id === saved.version_id)).toMatchObject({ status: 'published', published_by: w.director.id })
    expect(r1.template_version_id).toBe(v1.id)
    const r2 = draft(w)
    expect(r2.template_version_id).toBe(saved.version_id)
    expect(audits(saved.template_id)).toContain('REPORT_TEMPLATE_PUBLISHED')
    asUser(w.director)
    expectRaise(() => reportTemplatePublish({ p_version: saved.version_id }), /only a draft/i)

    // Discard: the draft's author or an admin; never a published version.
    asUser(w.lead)
    const d = reportTemplateSave({ p_key: 'incident_followup', p_name: 'x', p_schema: SCHEMA, p_required: [] }) as { version_id: string }
    asUser(w.outsider)
    expect(reportTemplateDiscard({ p_version: d.version_id })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.lead)
    expect(reportTemplateDiscard({ p_version: d.version_id })).toEqual({ ok: true })
    expect(readRows('report_template_versions').find((v) => v.id === d.version_id)).toBeUndefined()
    asUser(w.director)
    expectRaise(() => reportTemplateDiscard({ p_version: saved.version_id }), /only a draft/i)

    // Update: whitelisted keys only; is_default clears the others.
    asUser(w.lead)
    expect(reportTemplateUpdate({ p_template: saved.template_id, p_patch: { active: false } })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.director)
    expectRaise(() => reportTemplateUpdate({ p_template: saved.template_id, p_patch: { key: 'renamed' } }), /unknown template field/i)
    expect(reportTemplateUpdate({ p_template: saved.template_id, p_patch: { is_default: true, sort_order: 1, description: 'Primary' } })).toEqual({ ok: true })
    expect(readRows('report_templates').filter((t) => t.is_default).map((t) => t.key)).toEqual(['incident_followup'])
    expect(reportTemplateUpdate({ p_template: saved.template_id, p_patch: { active: false } })).toEqual({ ok: true })
    expect(audits(saved.template_id).filter((a) => a === 'REPORT_TEMPLATE_UPDATED')).toHaveLength(2)
    asUser(w.me.profile)
    expectRaise(() => reportCreate({ p_case: w.caseRecord.id, p_template: 'incident_followup' }), /unknown report template/i)
  })
})

describe('report_create and the direct-write triggers', () => {
  it('pins the published version; an unknown / retired template raises; a direct INSERT pins a known key and leaves an unknown one null', () => {
    const w = workspace()
    seedReportTemplates()
    const [retired] = seedRows('report_templates', [reportTemplateRow({ key: 'retired_form', active: false })])
    seedRows('report_template_versions', [reportTemplateVersionRow({ template_id: retired.id })])
    const r = reportCreate({ p_case: w.caseRecord.id, p_template: 'interview', p_kind: 'supplemental', p_fields: { narrative: 'hi' } })
    expect(r).toMatchObject({ template: 'interview', kind: 'supplemental', seq: 1, author_id: w.me.profile.id, review_status: 'draft', finalized: false, fields: { narrative: 'hi' } })
    expect(r.template_version_id).toBe(readRows('report_template_versions').find((v) => v.template_id === readRows('report_templates').find((t) => t.key === 'interview')!.id)!.id)
    expect(reportCreate({ p_case: w.caseRecord.id, p_template: 'interview', p_kind: 'supplemental' }).seq).toBe(2)
    expectRaise(() => reportCreate({ p_case: w.caseRecord.id, p_template: 'nope' }), /unknown report template/i)
    expectRaise(() => reportCreate({ p_case: w.caseRecord.id, p_template: 'retired_form' }), /unknown report template/i)
    expectRaise(() => reportCreate({ p_case: w.otherCase.id, p_template: 'interview' }), /case not found/i)
    asUser(w.outsider)
    expectRaise(() => reportCreate({ p_case: w.caseRecord.id, p_template: 'interview' }), /case not found/i)

    const known = pinReportTemplateVersion(reportRow({ case_id: w.caseRecord.id, template: 'incident_followup' }))
    expect(known.template_version_id).toBeTruthy()
    const legacy = pinReportTemplateVersion(reportRow({ case_id: w.caseRecord.id, template: 'initial' }))
    expect(legacy.template_version_id).toBeNull()
  })

  it('reportUpdateGuard refuses workflow columns and locks fields once submitted or sealed', () => {
    const w = workspace()
    const r = draft(w)
    expect(reportUpdateGuard(r, { fields: { narrative: 'edit' } })).toBeNull()
    expect(reportUpdateGuard(r, { review_status: 'approved' })).toMatch(/read-only/i)
    expect(reportUpdateGuard(r, { finalized: true })).toMatch(/read-only/i)
    expect(reportUpdateGuard(r, { template_version_id: mockId() })).toMatch(/read-only/i)
    r.review_status = 'submitted'
    expect(reportUpdateGuard(r, { fields: { narrative: 'late edit' } })).toMatch(/locked until it is returned/i)
    expect(reportUpdateGuard(r, { fields: r.fields })).toBeNull()
    r.review_status = 'returned'
    expect(reportUpdateGuard(r, { fields: { narrative: 'fix' } })).toBeNull()
    r.finalized = true
    expect(reportUpdateGuard(r, { fields: { narrative: 'tamper' } })).toMatch(/locked/i)
  })
})

describe('review flow (P5-03)', () => {
  it('submit needs the required keys (labels in the message) and the author; a report without a pinned template refuses', () => {
    const w = workspace()
    const r = draft(w)
    expectRaise(() => reportSubmit({ p_report: r.id }), /required fields missing: Case Number, Date, Reporting Detective, Narrative/)
    r.fields = { ...fillRequired(versionOf(r)), narrative: '   ' }
    expectRaise(() => reportSubmit({ p_report: r.id }), /required fields missing: Narrative$/)
    r.fields = fillRequired(versionOf(r))
    asUser(w.lead)
    expectRaise(() => reportSubmit({ p_report: r.id }), /only the author/i)
    asUser(w.outsider)
    expectRaise(() => reportSubmit({ p_report: r.id }), /not found/i)
    const [legacy] = seedRows('reports', [reportRow({ case_id: w.caseRecord.id, author_id: w.me.profile.id, template: 'initial' })])
    asUser(w.me.profile)
    expectRaise(() => reportSubmit({ p_report: legacy.id }), /no published template/i)
    expect(r.review_status).toBe('draft')
  })

  it('submit → submitted with the author signature and a reviewer fan-out; review is never the author or an outsider; return needs a note; resubmit; approve seals with both signatures', () => {
    const w = workspace()
    const r = ready(w)
    const sub = reportSubmit({ p_report: r.id, p_signature: 'Det. Me', p_badge: '4021' })
    expect(sub).toMatchObject({ review_status: 'submitted', submitted_by: w.me.profile.id, finalized: false })
    expect(sub.submitted_at).toBeTruthy()
    expect(sub.signature).toMatchObject({ officer: w.me.profile.display_name, signer_id: w.me.profile.id, badge: '4021', typed: 'Det. Me' })
    expect(audits(r.id)).toContain('REPORT_SUBMITTED')
    const pings = notes('report_submitted')
    expect(pings.map((n) => n.user_id).sort()).toEqual([w.lead.id, w.senior.id, w.director.id].sort())
    expect(pings[0].payload).toMatchObject({ report_id: r.id, case_id: w.caseRecord.id, template: 'incident_followup', actor_id: w.me.profile.id })
    expectRaise(() => reportSubmit({ p_report: r.id }), /not awaiting submission/i)

    // Reviewers: never the author, never another bureau's detective.
    expectRaise(() => reportReview({ p_report: r.id, p_decision: 'approve' }), /may not review/i)
    asUser(w.outsider)
    expectRaise(() => reportReview({ p_report: r.id, p_decision: 'approve' }), /not found/i)
    asUser(w.lead)
    expectRaise(() => reportReview({ p_report: r.id, p_decision: 'return' }), /note is required/i)
    expectRaise(() => reportReview({ p_report: r.id, p_decision: 'shrug', p_note: 'x' }), /invalid decision/i)
    const ret = reportReview({ p_report: r.id, p_decision: 'return', p_note: 'Name the second officer.' })
    expect(ret).toMatchObject({ review_status: 'returned', review_note: 'Name the second officer.', reviewed_by: w.lead.id, finalized: false })
    expect(notes('report_returned').map((n) => n.user_id)).toEqual([w.me.profile.id])
    expect(notes('report_returned')[0].payload).toMatchObject({ reason: 'Name the second officer.' })
    expectRaise(() => reportReview({ p_report: r.id, p_decision: 'approve' }), /not awaiting review/i)

    asUser(w.me.profile)
    r.fields = { ...fillRequired(versionOf(r)), narrative: 'Second officer named.' }
    expect(reportSubmit({ p_report: r.id }).review_status).toBe('submitted')
    asUser(w.senior)
    const ok = reportReview({ p_report: r.id, p_decision: 'approve', p_signature: 'SrDet Same Bureau', p_badge: '77' })
    expect(ok).toMatchObject({ review_status: 'approved', finalized: true, reviewed_by: w.senior.id })
    expect(ok.reviewer_signature).toMatchObject({ signer_id: w.senior.id, typed: 'SrDet Same Bureau', badge: '77', role: 'senior_detective' })
    const versions = readRows('report_versions').filter((v) => v.report_id === r.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ version_number: 1, fields: r.fields, signature: r.signature, reviewer_signature: ok.reviewer_signature })
    expect(audits(r.id)).toEqual(expect.arrayContaining(['REPORT_APPROVED', 'REPORT_FINALIZED']))
    expect(notes('report_finalized').map((n) => n.user_id)).toEqual([w.me.profile.id])
    expect(reportUpdateGuard(r, { fields: { narrative: 'tamper' } })).toMatch(/locked/i)
  })

  it('reopen needs bureau command AND a reason; it clears both signatures and logs the seal break; report_finalize refuses a review-required template', () => {
    const w = workspace()
    const r = ready(w)
    reportSubmit({ p_report: r.id })
    asUser(w.lead)
    reportReview({ p_report: r.id, p_decision: 'approve', p_signature: 'Lead' })
    const prevSig = r.signature, prevRev = r.reviewer_signature
    asUser(w.me.profile)
    expectRaise(() => reportReopen({ p_report: r.id, p_reason: 'mine' }), /only a Bureau Lead/i)
    asUser(w.lead)
    expectRaise(() => reportReopen({ p_report: r.id }), /reason is required/i)
    expectRaise(() => reportReopen({ p_report: r.id, p_reason: '   ' }), /reason is required/i)
    const re = reportReopen({ p_report: r.id, p_reason: 'Wrong date on page one.' })
    expect(re).toMatchObject({ finalized: false, review_status: 'draft', signature: null, reviewer_signature: null, reviewed_by: null, reviewed_at: null, review_note: null })
    const log = (re.fields as { _reopen_log: Record<string, unknown>[] })._reopen_log
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ by: w.lead.id, reason: 'Wrong date on page one.', prev_signature: prevSig, prev_reviewer_signature: prevRev })
    expect(audits(r.id)).toContain('REPORT_REOPENED')
    expect(notes('report_reopened').map((n) => n.user_id)).toEqual([w.me.profile.id])
    expectRaise(() => reportReopen({ p_report: r.id, p_reason: 'again' }), /not finalized/i)
    // A Bureau Lead of ANOTHER bureau cannot reopen; the Owner can.
    const [scbLead] = seedRows('profiles', [profileRow({ role: 'bureau_lead', division: 'street_crimes' })])
    asUser(w.me.profile); reportSubmit({ p_report: r.id })
    asUser(w.lead); reportReview({ p_report: r.id, p_decision: 'approve' })
    asUser(scbLead)
    expectRaise(() => reportReopen({ p_report: r.id, p_reason: 'x' }), /not found|only a Bureau Lead/i)
    roleSession('owner')
    expect(reportReopen({ p_report: r.id, p_reason: 'Owner audit.' }).finalized).toBe(false)
    expect((r.fields as { _reopen_log: unknown[] })._reopen_log).toHaveLength(2)

    asUser(w.me.profile)
    expectRaise(() => reportFinalize({ p_report: r.id }), /requires review/i)
    expect(r.finalized).toBe(false)
  })

  it('a self-seal template seals on submit (or report_finalize) with a version row and notifies the case lead, never the author', () => {
    const w = workspace()
    w.caseRecord.lead_detective_id = w.lead.id
    const r = ready(w, 'arrest_warrant')
    const sealed = reportSubmit({ p_report: r.id, p_badge: 'AW1' })
    expect(sealed).toMatchObject({ finalized: true, review_status: 'approved', reviewer_signature: null })
    expect(sealed.signature).toMatchObject({ badge: 'AW1', signer_id: w.me.profile.id })
    expect(readRows('report_versions').filter((v) => v.report_id === r.id)).toMatchObject([{ version_number: 1, reviewer_signature: null }])
    expect(readRows('audit_log').find((a) => a.entity_id === r.id && a.action === 'REPORT_FINALIZED')!.detail).toMatchObject({ self_sealed: true })
    expect(notes('report_finalized').map((n) => n.user_id)).toEqual([w.lead.id])
    expect(notes('report_submitted')).toEqual([])

    const r2 = draft(w, 'search_warrant')
    expectRaise(() => reportFinalize({ p_report: r2.id }), /required fields missing/i)
    r2.fields = fillRequired(versionOf(r2))
    expect(reportFinalize({ p_report: r2.id, p_badge: 'SW1' })).toMatchObject({ finalized: true, review_status: 'approved' })
    expectRaise(() => reportFinalize({ p_report: r2.id }), /already finalized/i)
    expect(notes('report_finalized')).toHaveLength(2)
    // When the author IS the case lead there is no self-notification.
    w.caseRecord.lead_detective_id = w.me.profile.id
    const r3 = ready(w, 'subpoena')
    reportSubmit({ p_report: r3.id })
    expect(notes('report_finalized')).toHaveLength(2)
  })

  it('case_closure refuses submit while a task is open; waive (reason required, case lead / bureau command) or done clears the gate; unwaive restores it', () => {
    const w = workspace()
    const [open, other] = seedRows('case_tasks', [
      caseTaskRow({ case_id: w.caseRecord.id, title: 'Return the phone' }),
      caseTaskRow({ case_id: w.caseRecord.id, title: 'Notify victim' }),
    ])
    const r = ready(w, 'case_closure')
    expectRaise(() => reportSubmit({ p_report: r.id }), /2 open task\(s\) must be done or waived/i)
    other.done = true
    expectRaise(() => reportSubmit({ p_report: r.id }), /1 open task\(s\)/i)
    asUser(w.outsider)
    expectRaise(() => caseTaskWaive({ p_task: open.id, p_reason: 'x' }), /not found/i)
    asUser(w.senior)
    expectRaise(() => caseTaskWaive({ p_task: open.id, p_reason: 'x' }), /only the case lead/i)
    asUser(w.lead)
    expectRaise(() => caseTaskWaive({ p_task: open.id }), /reason is required/i)
    const waived = caseTaskWaive({ p_task: open.id, p_reason: 'Phone destroyed in evidence.' })
    expect(waived).toMatchObject({ waived_by: w.lead.id, waive_reason: 'Phone destroyed in evidence.', done: false })
    expect(waived.waived_at).toBeTruthy()
    expect(audits(open.id)).toContain('TASK_WAIVED')
    asUser(w.me.profile)
    expect(reportSubmit({ p_report: r.id }).review_status).toBe('submitted')
    // The case lead may unwaive; the gate is back for the next closure draft.
    expect(caseTaskUnwaive({ p_task: open.id })).toMatchObject({ waived_at: null, waived_by: null, waive_reason: null })
    expect(audits(open.id)).toContain('TASK_UNWAIVED')
    const r2 = ready(w, 'case_closure')
    expectRaise(() => reportSubmit({ p_report: r2.id }), /1 open task/i)
  })
})

describe('entities and exports (P5-04 / P5-07)', () => {
  it('report_entities_set replaces the set for the author while editable; refs must exist, be readable and (charges) belong to the case; never writes the source', () => {
    const w = workspace()
    const r = draft(w)
    const [person] = seedRows('persons', [personRow({ name: 'Tommy Vercelli' })])
    const [charge, foreign] = seedRows('case_charges', [caseChargeRow({ case_id: w.caseRecord.id }), caseChargeRow({ case_id: w.otherCase.id })])
    const personBefore = JSON.stringify(person)
    const res = reportEntitiesSet({ p_report: r.id, p_items: [
      { kind: 'person', ref_id: person.id, role: 'subject', label: 'Tommy Vercelli', snapshot: { name: 'Tommy Vercelli' } },
      { kind: 'charge', ref_id: charge.id, role: 'charge', label: '(1)09 Attempted Murder' },
      { kind: 'timeline_event', ref_id: null, role: 'event', label: '02:10 — shots fired', edited: true },
    ] })
    expect(res).toEqual({ ok: true, count: 3 })
    const rows = readRows('report_entities').filter((e) => e.report_id === r.id)
    expect(rows.map((e) => [e.kind, e.role, e.edited])).toEqual([['person', 'subject', false], ['charge', 'charge', false], ['timeline_event', 'event', true]])
    expect(rows.every((e) => e.inserted_by === w.me.profile.id)).toBe(true)
    expect(JSON.stringify(person)).toBe(personBefore)
    expect(audits(r.id)).toContain('REPORT_ENTITIES_SET')

    expectRaise(() => reportEntitiesSet({ p_report: r.id, p_items: [{ kind: 'case', ref_id: w.otherCase.id, label: 'SCB case' }] }), /not found or not readable/i)
    expectRaise(() => reportEntitiesSet({ p_report: r.id, p_items: [{ kind: 'charge', ref_id: foreign.id, label: 'x' }] }), /not found or not readable/i)
    expectRaise(() => reportEntitiesSet({ p_report: r.id, p_items: [{ kind: 'spaceship', ref_id: person.id, label: 'x' }] }), /unknown entity kind/i)
    expectRaise(() => reportEntitiesSet({ p_report: r.id, p_items: [{ kind: 'timeline_event', ref_id: person.id, label: 'x' }] }), /timeline_event/i)
    expectRaise(() => reportEntitiesSet({ p_report: r.id, p_items: [{ kind: 'person', ref_id: mockId(), label: 'ghost' }] }), /not found or not readable/i)
    expect(readRows('report_entities').filter((e) => e.report_id === r.id)).toHaveLength(3)

    // "Mentioned in reports" is a plain read by (kind, ref_id) under the report's visibility.
    expect(visibleReportRows('report_entities', readRows('report_entities').filter((e) => e.kind === 'person' && e.ref_id === person.id)).map((e) => e.report_id)).toEqual([r.id])
    asUser(w.outsider)
    expect(reportEntitiesSet({ p_report: r.id, p_items: [] })).toMatchObject({ ok: false, code: 'denied' })
    expect(visibleReportRows('report_entities', readRows('report_entities'))).toEqual([])
    // A case-writable editor who is not the author may also set.
    asUser(w.lead)
    expect(reportEntitiesSet({ p_report: r.id, p_items: [{ kind: 'case', ref_id: w.caseRecord.id, role: 'related_case', label: w.caseRecord.case_number }] })).toEqual({ ok: true, count: 1 })
    expect(readRows('report_entities').filter((e) => e.report_id === r.id).map((e) => e.kind)).toEqual(['case'])
    asUser(w.me.profile)
    r.fields = fillRequired(versionOf(r))
    reportSubmit({ p_report: r.id })
    expect(reportEntitiesSet({ p_report: r.id, p_items: [] })).toMatchObject({ ok: false, code: 'denied' })
    expect(readRows('report_entities').filter((e) => e.report_id === r.id)).toHaveLength(1)
  })

  it('report_record_export: pdf / docx / md for any reader, a 10-char code stable per version, null version for a draft, the sealed number after the seal', () => {
    const w = workspace()
    const r = draft(w)
    expectRaise(() => reportRecordExport({ p_report: r.id, p_format: 'odt' }), /pdf, docx or md/i)
    const pdf = reportRecordExport({ p_report: r.id, p_format: 'pdf' }) as { ok: boolean; id: string; version_number: number | null; verification_code: string }
    expect(pdf.ok).toBe(true)
    expect(pdf.version_number).toBeNull()
    expect(pdf.verification_code).toMatch(/^[0-9A-F]{10}$/)
    const md = reportRecordExport({ p_report: r.id, p_format: 'md' }) as { verification_code: string }
    expect(md.verification_code).toBe(pdf.verification_code)
    asUser(w.lead)
    expect((reportRecordExport({ p_report: r.id, p_format: 'docx' }) as { ok: boolean }).ok).toBe(true)
    asUser(w.outsider)
    expect(reportRecordExport({ p_report: r.id, p_format: 'pdf' })).toMatchObject({ ok: false, code: 'denied' })
    expect(readRows('report_exports').map((e) => e.format)).toEqual(['pdf', 'md', 'docx'])
    expect(readRows('report_exports').find((e) => e.id === pdf.id)).toMatchObject({ report_id: r.id, exported_by: w.me.profile.id, version_number: null })
    expect(audits(r.id).filter((a) => a === 'REPORT_EXPORTED')).toHaveLength(3)

    asUser(w.me.profile)
    r.fields = fillRequired(versionOf(r))
    reportSubmit({ p_report: r.id })
    asUser(w.lead)
    reportReview({ p_report: r.id, p_decision: 'approve' })
    const sealed = reportRecordExport({ p_report: r.id, p_format: 'pdf' }) as { version_number: number | null; verification_code: string }
    expect(sealed.version_number).toBe(1)
    expect(sealed.verification_code).not.toBe(pdf.verification_code)
    expect(sealed.verification_code).toMatch(/^[0-9A-F]{10}$/)
  })
})

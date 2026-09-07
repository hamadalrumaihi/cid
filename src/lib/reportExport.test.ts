/** Pins for the report export builders (P5-07): sealed exports use the
 *  frozen version, drafts carry the banner, restricted media is omitted and
 *  counted (never a URL), mention tokens flatten to labels, and the DOCX and
 *  Markdown are flattenings of the same spec. */
import { describe, expect, it } from 'vitest'
import type { Tables } from './database.types'
import type { FormSchema } from './forms'
import { mentionToken } from './mentions'
import {
  isSealedExport, parseSignatureLike, reportDocx, reportExportFilename, reportMarkdown, reportPdfSpec, specToMarkdown,
  type ReportExportInput,
} from './reportExport'
import { specToDocx } from './legalExport'

const P = '11111111-2222-4333-8444-555555555555'
const M_OK = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const M_RESTRICTED = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const schema: FormSchema = {
  title: 'Incident Follow-up',
  subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
  sections: [
    { id: 'hdr', label: 'Header', type: 'kv', fields: [{ key: 'case_number', label: 'Case Number', type: 'text' }, { key: 'detective', label: 'Detective', type: 'text' }] },
    { id: 'subjects', label: 'Subjects', type: 'grid', cols: [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }] },
    { id: 'narrative', label: 'Narrative', type: 'textarea', key: 'narrative' },
    { id: 'media', label: 'Media', type: 'textarea', key: 'media_refs', mediaPick: true },
    { id: 'note', label: 'Notice', type: 'note', text: 'Statements are sworn.' },
  ],
}

const liveFields = {
  case_number: 'MCB-0001', detective: 'Det. Live',
  subjects: [{ name: 'John Doe', role: 'Suspect' }, { name: '', role: '' }],
  narrative: `Spoke with ${mentionToken('person', P)} about the drop.\n\nSecond paragraph.`,
  media_refs: `[media:${M_OK}] Door cam still\n[media:${M_RESTRICTED}] Hidden photo\nLegacy line — https://cdn.example/x.png`,
}
const sealedFields = { ...liveFields, detective: 'Det. Sealed', narrative: 'Frozen narrative.' }

const report: ReportExportInput['report'] = {
  id: 'r1', template: 'incident_followup', kind: 'initial', seq: 1, fields: liveFields, finalized: false, review_status: 'draft',
  created_at: '2026-09-01T10:00:00Z', signature: null, reviewer_signature: null,
}
const version: Tables<'report_versions'> = {
  id: 'v2', report_id: 'r1', version_number: 2, fields: sealedFields, created_at: '2026-09-02T10:00:00Z', created_by: 'u1',
  signature: { officer: 'Det. Sealed', badge: '123', signed_at: '2026-09-02T09:00:00Z', typed: 'D. Sealed' },
  reviewer_signature: { officer: 'Lt. Reviewer', badge: '7', role: 'bureau_lead', signed_at: '2026-09-02T10:00:00Z' },
}

const base: ReportExportInput = {
  report, version: null, schema, templateName: 'Incident Follow-up', templateVersion: 3, caseNumber: 'MCB-0001', caseTitle: 'Dockside',
  entities: [
    { kind: 'person', ref_id: P, role: 'mention', label: 'John Doe', edited: false },
    { kind: 'person', ref_id: P, role: 'subject', label: 'John Doe', edited: true },
    { kind: 'media', ref_id: M_OK, role: 'exhibit', label: 'Door cam still — https://cdn.example/still.png', edited: false },
    { kind: 'media', ref_id: M_RESTRICTED, role: 'exhibit', label: 'Hidden photo', edited: false },
  ],
  authorSignature: { officer: 'Det. Live', badge: '123' },
  reviewerSignature: null,
  verification: { code: 'ABCDEF1234', versionNumber: null, exportedAt: '2026-09-03T00:00:00Z', format: 'pdf' },
  restrictedMediaIds: new Set([M_RESTRICTED]),
}
const flat = (spec: ReturnType<typeof reportPdfSpec>): string => JSON.stringify(spec)

describe('draft vs sealed', () => {
  it('a draft exports the live fields under the DRAFT banner', () => {
    const spec = reportPdfSpec(base)
    expect(isSealedExport(base)).toBe(false)
    expect(spec.docType).toBe('DRAFT REPORT')
    expect(spec.refCode).toBe(schema.title)
    expect(spec.subtitle).toContain('DRAFT — not sealed')
    expect(spec.sections[0].title).toBe('Draft — not sealed')
    expect(flat(spec)).toContain('Det. Live')
    expect(flat(spec)).not.toContain('Frozen narrative')
    expect(spec.meta).toContainEqual(['Template', 'Incident Follow-up (template v3)'])
    expect(spec.meta).toContainEqual(['Status', 'Draft'])
  })

  it('a sealed report exports the frozen version and its version-bound signatures', () => {
    const sealed: ReportExportInput = {
      ...base, report: { ...report, finalized: true, review_status: 'approved' }, version,
      verification: { code: 'SEALED0001', versionNumber: 2 },
    }
    const spec = reportPdfSpec(sealed)
    expect(spec.docType).toBe('CID REPORT')
    expect(spec.sections[0].title).not.toBe('Draft — not sealed')
    expect(flat(spec)).toContain('Frozen narrative')
    expect(flat(spec)).not.toContain('Det. Live')
    const sig = spec.sections.find((s) => s.title === 'Signatures')!
    expect(sig.paras![0]).toContain('Det. Sealed')
    expect(sig.paras![0]).toContain('signed as “D. Sealed”')
    expect(sig.paras![1]).toContain('Lt. Reviewer')
    expect(sig.paras![1]).toContain('(Bureau Lead)')
    expect(spec.meta).toContainEqual(['Status', 'Sealed · v2'])
    expect(spec.meta).toContainEqual(['Verification', 'SEALED0001'])
    const ver = spec.sections.find((s) => s.title === 'Verification')!
    expect(ver.paras![0]).toContain('sealed version v2')
  })

  it('a screen copy says it was not recorded', () => {
    const ver = reportPdfSpec({ ...base, verification: null }).sections.find((s) => s.title === 'Verification')!
    expect(ver.paras![0]).toMatch(/not a recorded export/)
    expect(reportPdfSpec({ ...base, verification: null }).meta).toContainEqual(['Verification', 'Screen copy'])
  })
})

describe('content rules', () => {
  it('mention tokens flatten to the entity label; the raw id never prints', () => {
    const text = flat(reportPdfSpec(base))
    expect(text).toContain('Spoke with John Doe about the drop.')
    expect(text).not.toContain(P)
  })

  it('an unlabelled token prints "Restricted record"', () => {
    const text = flat(reportPdfSpec({ ...base, entities: [] }))
    expect(text).toContain('Spoke with Restricted record about')
  })

  it('media is listed by title only and restricted items are omitted and counted', () => {
    const spec = reportPdfSpec(base)
    const media = spec.sections.find((s) => s.title === 'Media')!
    expect(media.rows).toEqual([['Door cam still', 'Case media'], ['Legacy line', 'Reference']])
    const refs = spec.sections.find((s) => s.title.startsWith('Referenced records'))!
    expect(refs.title).toContain('2 restricted media items omitted')
    expect(refs.rows!.map((r) => r[2])).toEqual(['John Doe', 'John Doe', 'Door cam still'])
    expect(flat(spec)).not.toContain('Hidden photo')
    expect(flat(spec)).not.toContain('https://')
  })

  it('carries the "Differs from record" marker and drops blank grid rows', () => {
    const spec = reportPdfSpec(base)
    const refs = spec.sections.find((s) => s.title.startsWith('Referenced records'))!
    expect(refs.rows![1][3]).toBe('Differs from record')
    expect(spec.sections.find((s) => s.title === 'Subjects')!.rows).toEqual([['John Doe', 'Suspect']])
    expect(spec.sections.find((s) => s.title === 'Notice')!.paras).toEqual(['Statements are sworn.'])
  })
})

describe('formats', () => {
  it('DOCX is the shared flattening of the same spec', () => {
    expect(reportDocx(base)).toEqual(specToDocx(reportPdfSpec(base)))
  })

  it('Markdown carries the letterhead, meta, sections and code', () => {
    const md = reportMarkdown(base)
    expect(md.startsWith('# DRAFT REPORT — Incident Follow-up\n')).toBe(true)
    expect(md).toContain('**Verification:** ABCDEF1234')
    expect(md).toContain('## Narrative')
    expect(md).toContain('| Field | Value |')
    expect(md).toContain('Author / detective: ____')
    expect(md).not.toContain(P)
    expect(specToMarkdown({ docType: 'X', refCode: 'Y', subtitle: '', meta: [], sections: [{ title: 'T', headers: ['a|b'], rows: [] }] })).toContain('None on file.')
  })

  it('filenames encode case, template, version and code', () => {
    expect(reportExportFilename(base, 'pdf', 'ABCDEF1234')).toBe('MCB-0001-incident_followup-draft-ABCDEF1234.pdf')
    expect(reportExportFilename({ ...base, report: { ...report, finalized: true }, version }, 'md', null)).toBe('MCB-0001-incident_followup-v2-screen.md')
  })

  it('parseSignatureLike tolerates malformed json', () => {
    expect(parseSignatureLike(null)).toBeNull()
    expect(parseSignatureLike([])).toBeNull()
    expect(parseSignatureLike({ badge: 9 })).toEqual({ officer: 'Officer', signer_id: null, badge: null, signed_at: null, typed: null, role: null })
  })
})

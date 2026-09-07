import { describe, expect, it } from 'vitest'
import type { Tables } from './database.types'
import {
  chargeRows, legalExportFilename, legalInstrumentDocx, legalInstrumentSpec, legalPacketDocx, legalPacketSpec,
  specToDocx, standardOfProofLabel, targetDecisionRows,
  type LegalChargeRow, type TargetDecisionRow, type TimelineRow,
} from './legalExport'

type LegalRequest = Tables<'legal_requests'>
type LegalVersion = Tables<'legal_request_versions'>
type LegalExhibit = Tables<'legal_request_exhibits'>
type LegalSignature = Tables<'legal_request_signatures'>

/* ── Fixtures: only the columns the builders read; the cast is deliberate ── */
const request = (over: Partial<LegalRequest> = {}): LegalRequest => ({
  id: 'req-1', request_number: 'LR-2026-0042', title: 'Arrest Warrant — J. Doe (MCB-2026-0007)',
  request_type: 'warrant', subtype: 'arrest_warrant', review_status: 'approved', fulfilment_status: 'unissued',
  classification: 'standard', case_number_snapshot: 'MCB-2026-0007', case_title_snapshot: 'Dockside burglaries',
  person_id: 'p-1', person_name_snapshot: 'John Doe', recipient_name: null, recipient_type: null,
  responsible_bureau: 'major_crimes', created_by: 'det-1', decided_by: 'judge-1', decided_at: '2026-09-01T10:00:00Z',
  decision: 'approved', decision_note: 'Probable cause is established on the affidavit.',
  judicial_conditions: 'Daylight execution only.', expires_at: '2026-10-01T10:00:00Z', response_deadline: null,
  issued_at: null, issued_by: null, narrative: 'The suspect was identified on camera.', priority: 'High',
  ...over,
} as unknown as LegalRequest)

const version: LegalVersion = {
  id: 'v-2', legal_request_id: 'req-1', version_number: 2, created_at: '2026-08-30T09:00:00Z', created_by: 'det-1',
  narrative: 'The suspect was identified on camera and by two witnesses.',
  form_data: { standard_of_proof: 'probable_cause', pc_statement: 'Two witnesses placed the suspect at the dock.', items_to_seize: 'Crowbar', _target_decisions: [] },
  packet_manifest: [{ exhibit_id: 'x-old', title: 'Frozen photo', type: 'case_media' }],
  change_summary: null, content_hash: null, returned_from: null, submitted_stage: 'cid_supervisor_review',
}

const exhibits: LegalExhibit[] = [
  { id: 'ex-1', legal_request_id: 'req-1', exhibit_type: 'vehicle', display_title: 'Sedan ABC123', rationale: 'Getaway car', snapshot_metadata: {}, source_id: 'veh-1', version_id: null, added_by: 'det-1', created_at: '2026-08-29T00:00:00Z' },
  { id: 'ex-2', legal_request_id: 'req-1', exhibit_type: 'case_media', display_title: 'Dock CCTV still', rationale: null, snapshot_metadata: { url: 'https://host/secret.jpg' }, source_id: 'media-1', version_id: null, added_by: 'det-1', created_at: '2026-08-29T00:00:00Z' },
  { id: 'ex-3', legal_request_id: 'req-1', exhibit_type: 'case_media', display_title: 'Restricted body-cam', rationale: null, snapshot_metadata: { url: 'https://host/restricted.mp4' }, source_id: 'media-2', version_id: null, added_by: 'det-1', created_at: '2026-08-29T00:00:00Z' },
  { id: 'ex-4', legal_request_id: 'req-1', exhibit_type: 'external_link', display_title: 'Public notice', rationale: null, snapshot_metadata: { url: 'https://example.org/notice' }, source_id: null, version_id: null, added_by: 'det-1', created_at: '2026-08-29T00:00:00Z' },
]

const charges: LegalChargeRow[] = [
  { id: 'c-1', case_charge_id: 'cc-1', snap_code: 'PC 459', snap_offense: 'Burglary', snap_charge_class: 'Felony', snap_penal_title: 'Title 9', counts: 2 },
  { id: 'c-2', case_charge_id: 'cc-2', snap_code: null, snap_offense: 'Trespass', snap_charge_class: 'Misdemeanor', snap_penal_title: null, counts: 1 },
]

const decisions: TargetDecisionRow[] = [
  { id: 'td-1', target_key: 'subject', exhibit_id: null, decision: 'approved', reasoning: null, decided_by: 'judge-1', decided_at: '2026-09-01T10:00:00Z' },
  { id: 'td-2', target_key: 'exhibit:ex-1', exhibit_id: 'ex-1', decision: 'denied', reasoning: 'No nexus shown for the vehicle.', decided_by: 'judge-1', decided_at: '2026-09-01T10:00:00Z' },
]

const signatures: LegalSignature[] = [
  { id: 's-1', legal_request_id: 'req-1', version_id: 'v-2', action: 'cid_approved', signature: 'A. Lead', signed_at: '2026-08-31T08:00:00Z', signer_id: 'bl-1', signer_name_snapshot: 'A. Lead', signer_role_snapshot: 'bureau_lead' },
  { id: 's-2', legal_request_id: 'req-1', version_id: 'v-2', action: 'approve', signature: 'Hon. R. Bench', signed_at: '2026-09-01T10:00:00Z', signer_id: 'judge-1', signer_name_snapshot: 'Hon. R. Bench', signer_role_snapshot: 'judge' },
]

const timeline: TimelineRow[] = [
  { id: 'a-1', actor_id: 'det-1', action: 'submitted', from_status: 'not_submitted', to_status: 'cid_supervisor_review', public_note: null, created_at: '2026-08-30T09:00:00Z' },
  { id: 'a-2', actor_id: 'judge-1', action: 'approved', from_status: 'judicial_review', to_status: 'approved', public_note: 'Granted.', created_at: '2026-09-01T10:00:00Z' },
  { id: 'a-3', actor_id: null, action: 'nudged', from_status: null, to_status: null, public_note: null, created_at: '2026-09-03T10:00:00Z' },
]

const names: Record<string, string> = { 'det-1': 'Det. Smith', 'judge-1': 'Hon. R. Bench', 'bl-1': 'A. Lead' }
const name = (id: string | null | undefined) => (id && names[id]) || (id ? 'Member' : '—')
const verification = { code: 'AB12CD34EF', exportedAt: '2026-09-02T12:00:00Z', format: 'pdf' as const }

const section = (spec: { sections: { title: string }[] }, title: RegExp) =>
  spec.sections.find((s) => title.test(s.title)) as { title: string; headers?: string[]; rows?: string[][]; paras?: string[] } | undefined

describe('legalInstrumentSpec', () => {
  it('carries the decision, the frozen scope, the charges, the basis, the judge signature and the verification code', () => {
    const spec = legalInstrumentSpec(request(), version, charges, decisions, signatures, verification, { name, exhibits })
    expect(spec.docType).toBe('LEGAL INSTRUMENT')
    expect(spec.refCode).toBe('LR-2026-0042')
    expect(spec.meta).toContainEqual(['Verification', 'AB12CD34EF'])
    expect(spec.meta).toContainEqual(['Requesting detective', 'Det. Smith'])
    expect(section(spec, /^Authorisation/)?.paras?.[0]).toMatch(/Arrest Warrant APPROVED by Hon\. R\. Bench/)
    expect(section(spec, /^Authorisation/)?.paras).toContainEqual('Conditions: Daylight execution only.')
    expect(section(spec, /^Scope/)?.rows).toEqual([
      ['Subject — John Doe', 'Approved', '—'],
      ['Vehicle — Sedan ABC123', 'Denied', 'No nexus shown for the vehicle.'],
    ])
    expect(section(spec, /^Charges/)?.rows).toEqual([
      ['PC 459', 'Burglary', 'Felony', '2', 'Title 9'],
      ['—', 'Trespass', 'Misdemeanor', '1', '—'],
    ])
    const basis = section(spec, /^Basis/)?.paras ?? []
    expect(basis[0]).toBe('Standard of proof: Probable cause')
    expect(basis[1]).toBe('Probable-cause statement: Two witnesses placed the suspect at the dock.')
    expect(basis[2]).toMatch(/^Justification: The suspect was identified on camera and by two witnesses\./)
    // Particulars never repeat the basis keys.
    expect(section(spec, /^Particulars/)?.rows).toEqual([['Items To Seize', 'Crowbar']])
    expect(section(spec, /^Judicial signature/)?.paras?.[0]).toBe('Signed: Hon. R. Bench (Judge)')
    expect(section(spec, /^Verification/)?.paras?.[0]).toMatch(/Verification code AB12CD34EF — recorded PDF export .* of version v2\./)
    expect(spec.signatures).toEqual(['Judge', 'Requesting investigator'])
  })

  it('labels a partial approval and its scope heading', () => {
    const spec = legalInstrumentSpec(request({ review_status: 'partially_approved' }), version, charges, decisions, signatures, verification, { exhibits })
    expect(section(spec, /^Authorisation/)?.paras?.[0]).toMatch(/PARTIALLY APPROVED/)
    expect(section(spec, /^Scope — approved and denied targets/)).toBeDefined()
  })

  it('says so when it is an unrecorded screen copy', () => {
    const spec = legalInstrumentSpec(request(), version, [], [], [], null)
    expect(spec.meta).toContainEqual(['Verification', 'Screen copy'])
    expect(section(spec, /^Verification/)?.paras?.[0]).toMatch(/not a recorded export/)
    expect(section(spec, /^Scope/)).toBeUndefined()
    expect(section(spec, /^Charges/)?.rows).toEqual([])
    // No signature row, no decided_by name: the block still renders honestly.
    expect(section(spec, /^Judicial signature/)?.paras?.[0]).toBe('Signed: Member')
  })

  it('omits the warrant-only basis lines for a subpoena', () => {
    const spec = legalInstrumentSpec(
      request({ request_type: 'subpoena', subtype: 'phone_records', recipient_type: 'entity', recipient_name: 'Telco Inc', person_name_snapshot: null }),
      { ...version, form_data: { items_requested: 'Call logs' } }, [], [], [], verification,
    )
    expect(spec.meta).toContainEqual(['Recipient', 'Telco Inc'])
    expect(section(spec, /^Basis/)?.paras).toEqual(['Justification: The suspect was identified on camera and by two witnesses.'])
  })
})

describe('legalPacketSpec', () => {
  it('lists exhibits by title, never a media URL, and skips restricted sources with a count', () => {
    const spec = legalPacketSpec(request(), version, exhibits, timeline, charges, signatures, verification, {
      name, restrictedSourceIds: new Set(['media-2']),
    })
    const manifest = section(spec, /^Exhibit manifest/)
    expect(manifest?.title).toBe('Exhibit manifest (1 restricted item omitted)')
    expect(manifest?.rows).toEqual([
      ['Sedan ABC123', 'Vehicle', 'Getaway car', '—'],
      ['Dock CCTV still', 'Case Media', '—', '—'],
      ['Public notice', 'External Link', '—', 'https://example.org/notice'],
    ])
    expect(JSON.stringify(spec)).not.toContain('secret.jpg')
    expect(JSON.stringify(spec)).not.toContain('Restricted body-cam')
  })

  it('falls back to the frozen manifest titles when the viewer holds no exhibit rows', () => {
    const spec = legalPacketSpec(request(), version, [], timeline, charges, signatures, null)
    expect(section(spec, /^Exhibit manifest$/)?.rows).toEqual([['Frozen photo', 'Case Media', '—', '—']])
  })

  it('renders the timeline with injected status labels and resolved names', () => {
    const spec = legalPacketSpec(request(), version, exhibits, timeline, charges, signatures, verification, {
      name, statusLabel: (s) => `L:${s}`, fulfilmentLabel: (s) => `F:${s}`,
    })
    expect(spec.meta).toContainEqual(['Status', 'L:approved · F:unissued'])
    expect(section(spec, /^Timeline/)?.rows?.[1]).toEqual([
      expect.any(String), 'Approved', 'Hon. R. Bench', 'L:judicial_review', 'L:approved', 'Granted.',
    ])
    // The hourly sweep writes actor-less rows — they read as the system's.
    expect(section(spec, /^Timeline/)?.rows?.[2]).toEqual([expect.any(String), 'Nudged', 'System', '—', '—', '—'])
    expect(section(spec, /^Description/)?.paras?.[0]).toBe('Standard of proof: Probable cause')
    expect(section(spec, /^Signatures/)?.rows?.[1]).toEqual(['Hon. R. Bench', 'Judge', 'Approve', 'v2', expect.any(String)])
  })
})

describe('specToDocx and the docx variants', () => {
  it('flattens every section deterministically so the DOCX matches the PDF', () => {
    const spec = legalInstrumentSpec(request(), version, charges, decisions, signatures, verification, { name, exhibits })
    const paras = specToDocx(spec)
    expect(paras[0]).toEqual({ text: 'LEGAL INSTRUMENT — LR-2026-0042', style: 'title' })
    expect(paras[1]).toEqual({ text: 'Arrest Warrant — J. Doe (MCB-2026-0007)', style: 'subtitle' })
    expect(paras).toContainEqual({ text: 'Verification: AB12CD34EF' })
    expect(paras).toContainEqual({ text: 'Charges', style: 'heading' })
    expect(paras).toContainEqual({ text: 'Code: PC 459 · Offense: Burglary · Class: Felony · Counts: 2 · Penal title: Title 9' })
    expect(paras).toContainEqual({ text: 'Judge: ______________________________' })
    expect(legalInstrumentDocx(request(), version, charges, decisions, signatures, verification, { name, exhibits })).toEqual(paras)
  })

  it('writes "None on file." for an empty table and keeps the packet variant in step', () => {
    const paras = legalPacketDocx(request(), version, [], [], [], [], null)
    expect(paras).toContainEqual({ text: 'Charges', style: 'heading' })
    expect(paras.filter((p) => p.text === 'None on file.').length).toBeGreaterThanOrEqual(3)
    expect(paras.some((p) => p.style === 'heading' && p.text === 'Signatures')).toBe(false)
  })
})

describe('helpers', () => {
  it('targetDecisionRows resolves exhibit targets by id or key and unknown keys verbatim', () => {
    expect(targetDecisionRows([{ ...decisions[1]!, exhibit_id: null }], request(), exhibits)[0]![0]).toBe('Vehicle — Sedan ABC123')
    expect(targetDecisionRows([{ ...decisions[1]!, exhibit_id: null, target_key: 'exhibit:gone' }], request(), exhibits)[0]![0]).toBe('exhibit:gone')
  })
  it('chargeRows keeps counts as text', () => {
    expect(chargeRows(charges)[0]![3]).toBe('2')
  })
  it('standardOfProofLabel humanises unknown values and dashes blanks', () => {
    expect(standardOfProofLabel('reasonable_suspicion')).toBe('Reasonable suspicion')
    expect(standardOfProofLabel('clear_and_convincing')).toBe('Clear And Convincing')
    expect(standardOfProofLabel('')).toBe('—')
    expect(standardOfProofLabel(undefined)).toBe('—')
  })
  it('legalExportFilename is filesystem-safe and names the verification code', () => {
    expect(legalExportFilename({ request_number: 'LR/2026 0042' }, 'instrument', 'pdf', 'AB12')).toBe('LR_2026_0042-instrument-AB12.pdf')
    expect(legalExportFilename({ request_number: 'LR-1' }, 'packet', 'docx', null)).toBe('LR-1-packet-screen.docx')
  })
})

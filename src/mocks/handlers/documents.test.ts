/** Pins for the Documents / packets / manifests / jobs mock contract: a
 *  packet request seeds a queued row + job and applies the server preset;
 *  access log answers only for a live packet; manifest_verify yields the
 *  five outcomes; tool / extract requests validate their inputs and seed
 *  jobs; document_search matches within the case with a <b> headline;
 *  cancel / retry follow the creator-while-queued / Owner rules. Calls the
 *  handlers directly against the mock store — no network. */
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyCase, exportManifestRow, mediaRow, profileRow, documentPageRow } from '../fixtures'
import { readRows, resetMockStore, seedRows, setSession } from '../store'
import { DOCUMENT_RPCS, DocumentsRpcError, PACKET_PRESETS } from './documents'

const rpc = <T = unknown>(fn: string, args: Record<string, unknown> = {}): T => DOCUMENT_RPCS[fn](args) as T
const asUser = (id: string) => setSession({ userId: id, email: 'x@cid.test', password: 'mock-password' })

beforeEach(() => resetMockStore())

describe('case_packet_request', () => {
  it('seeds a queued packet + packet.render job with the preset sections', () => {
    const { caseRecord } = emptyCase()
    const [me] = seedRows('profiles', [profileRow({})])
    asUser(me.id)
    const out = rpc<{ ok: boolean; id: string; job_id: string }>('case_packet_request', { p_case: caseRecord.id, p_type: 'command', p_sections: null, p_options: { watermark: 'DRAFT' } })
    expect(out.ok).toBe(true)
    const packet = readRows('case_packets').find((p) => p.id === out.id)!
    expect(packet.sections).toEqual(PACKET_PRESETS.command)
    expect(packet.status).toBe('queued')
    expect(packet.watermark).toBe('DRAFT')
    expect(packet.requested_by).toBe(me.id)
    const job = readRows('background_jobs').find((j) => j.id === out.job_id)!
    expect(job.kind).toBe('packet.render')
    expect(job.case_id).toBe(caseRecord.id)
    expect(job.created_by).toBe(me.id)
  })

  it('refuses unknown types / sections, an empty custom packet and a missing case', () => {
    const { caseRecord } = emptyCase()
    expect(rpc('case_packet_request', { p_case: caseRecord.id, p_type: 'zip' })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(rpc('case_packet_request', { p_case: caseRecord.id, p_type: 'custom', p_sections: [] })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(rpc('case_packet_request', { p_case: caseRecord.id, p_type: 'custom', p_sections: ['cover', 'nope'] })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(rpc('case_packet_request', { p_case: 'missing', p_type: 'full' })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('case_packet_access_log answers true only for a live packet', () => {
    const { caseRecord } = emptyCase()
    const out = rpc<{ id: string }>('case_packet_request', { p_case: caseRecord.id, p_type: 'full' })
    expect(rpc('case_packet_access_log', { p_packet: out.id })).toBe(true)
    expect(rpc('case_packet_access_log', { p_packet: 'nope' })).toBe(false)
  })
})

describe('manifest_verify', () => {
  it('yields the five outcomes', () => {
    const { caseRecord } = emptyCase()
    const [m] = seedRows('export_manifests', [exportManifestRow({
      case_id: caseRecord.id,
      manifest: { manifest_version: 1, files: [
        { path: 'packet.pdf', size: 10, sha256: 'aa' },
        { path: 'EV-000001.jpg', size: 5, sha256: 'bb' },
        { path: 'EV-000002.jpg', size: 7, sha256: 'cc' },
        { path: 'EV-000003.jpg', size: 9, sha256: 'dd' },
      ] },
    })])
    const out = rpc<{ status: string; files: { path: string; status: string }[] }>('manifest_verify', {
      p_manifest: m.id,
      p_files: [
        { path: 'packet.pdf', size: 10, sha256: 'AA' },           // verified (case-insensitive)
        { path: 'EV-000001.jpg', size: 6, sha256: 'xx' },         // modified (size differs)
        { path: 'EV-000002.jpg', size: 7, sha256: 'yy' },         // hash mismatch (same size)
        { path: 'extra.txt', size: 1, sha256: 'zz' },             // unexpected
      ],
    })
    expect(out.status).toBe('hash_mismatch')
    expect(out.files).toEqual([
      { path: 'packet.pdf', status: 'verified' },
      { path: 'EV-000001.jpg', status: 'modified' },
      { path: 'EV-000002.jpg', status: 'hash_mismatch' },
      { path: 'EV-000003.jpg', status: 'missing' },
      { path: 'extra.txt', status: 'unexpected' },
    ])
  })

  it('all-good is verified; an unknown manifest is refused', () => {
    const [m] = seedRows('export_manifests', [exportManifestRow({ manifest: { files: [{ path: 'a', size: 1, sha256: 'ab' }] } })])
    expect(rpc('manifest_verify', { p_manifest: m.id, p_files: [{ path: 'a', size: 1, sha256: 'ab' }] })).toEqual({ status: 'verified', files: [{ path: 'a', status: 'verified' }] })
    expect(rpc('manifest_verify', { p_manifest: 'nope', p_files: [] })).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('document tools + extraction', () => {
  it('document_tool_request validates the tool and the inputs, then seeds a pdf.tool job', () => {
    const { caseRecord } = emptyCase()
    const [doc] = seedRows('media', [mediaRow({ case_id: caseRecord.id, type: 'document', external_url: null, storage_path: `case/${caseRecord.id}/x/a.pdf` })])
    const [other] = seedRows('media', [mediaRow({ type: 'document' })])
    expect(rpc('document_tool_request', { p_case: caseRecord.id, p_tool: 'shrink', p_inputs: { media_ids: [doc.id] } })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(rpc('document_tool_request', { p_case: caseRecord.id, p_tool: 'rotate', p_inputs: { media_ids: [] } })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(rpc('document_tool_request', { p_case: caseRecord.id, p_tool: 'rotate', p_inputs: { media_ids: [other.id] } })).toMatchObject({ ok: false, code: 'bad_request' })
    const out = rpc<{ ok: boolean; job_id: string }>('document_tool_request', { p_case: caseRecord.id, p_tool: 'rotate', p_inputs: { media_ids: [doc.id], pages: '1-2' }, p_options: { rotation: 90 } })
    expect(out.ok).toBe(true)
    const job = readRows('background_jobs').find((j) => j.id === out.job_id)!
    expect(job.kind).toBe('pdf.tool')
    expect(job.queue).toBe('pdf')
    expect(job.args).toMatchObject({ tool: 'rotate', media_ids: [doc.id] })
  })

  it('document_extract_request seeds a queued extraction + job; external rows are refused', () => {
    const { caseRecord } = emptyCase()
    const [doc] = seedRows('media', [mediaRow({ case_id: caseRecord.id, type: 'document', external_url: null, storage_path: `case/${caseRecord.id}/x/a.pdf` })])
    const [ext] = seedRows('media', [mediaRow({ case_id: caseRecord.id, type: 'document' })])
    expect(rpc('document_extract_request', { p_media: ext.id })).toMatchObject({ ok: false, code: 'bad_state' })
    const out = rpc<{ ok: boolean; job_id: string }>('document_extract_request', { p_media: doc.id })
    expect(out.ok).toBe(true)
    expect(readRows('document_extractions').filter((x) => x.media_id === doc.id)).toHaveLength(1)
    // A second request re-queues the same extraction row instead of adding one.
    rpc('document_extract_request', { p_media: doc.id })
    expect(readRows('document_extractions').filter((x) => x.media_id === doc.id)).toHaveLength(1)
    expect(readRows('background_jobs').filter((j) => j.kind === 'document.extract')).toHaveLength(2)
  })

  it('document_search matches pages within the case and marks the hit', () => {
    const { caseRecord } = emptyCase()
    const [doc] = seedRows('media', [mediaRow({ case_id: caseRecord.id, type: 'document', title: 'Lease', evidence_number: 'EV-000007' })])
    const [foreign] = seedRows('media', [mediaRow({ type: 'document', title: 'Other' })])
    seedRows('document_pages', [
      documentPageRow({ media_id: doc.id, page_no: 3, text: 'The tenant parked a black sedan, plate 8ABC123, behind the unit.' }),
      documentPageRow({ media_id: foreign.id, page_no: 1, text: 'plate 8ABC123 elsewhere' }),
    ])
    const hits = rpc<{ media_id: string; page_no: number; headline: string; evidence_number: string | null }[]>('document_search', { p_q: 'plate 8abc123', p_case: caseRecord.id })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ media_id: doc.id, page_no: 3, evidence_number: 'EV-000007' })
    expect(hits[0].headline).toContain('<b>plate 8ABC123</b>')
    expect(rpc('document_search', { p_q: '   ' })).toEqual([])
    expect(rpc<unknown[]>('document_search', { p_q: 'plate' })).toHaveLength(2)
  })
})

describe('background_job_cancel / retry', () => {
  it('the requester cancels while queued; a stranger is denied; the Owner retries', () => {
    const { caseRecord } = emptyCase()
    const [me, stranger, owner] = seedRows('profiles', [profileRow({}), profileRow({}), profileRow({ is_owner: true })])
    asUser(me.id)
    const out = rpc<{ id: string; job_id: string }>('case_packet_request', { p_case: caseRecord.id, p_type: 'full' })

    asUser(stranger.id)
    expect(() => rpc('background_job_cancel', { p_id: out.job_id, p_reason: 'x' })).toThrow(DocumentsRpcError)
    expect(() => rpc('background_job_retry', { p_id: out.job_id })).toThrow(DocumentsRpcError)

    asUser(me.id)
    expect(rpc('background_job_cancel', { p_id: out.job_id, p_reason: 'changed my mind' })).toEqual({ ok: true })
    expect(readRows('background_jobs').find((j) => j.id === out.job_id)?.status).toBe('cancelled')
    expect(readRows('case_packets').find((p) => p.id === out.id)?.status).toBe('cancelled')
    expect(rpc('background_job_cancel', { p_id: out.job_id, p_reason: 'again' })).toMatchObject({ ok: false, code: 'bad_state' })

    asUser(owner.id)
    expect(rpc('background_job_retry', { p_id: out.job_id })).toEqual({ ok: true })
    const job = readRows('background_jobs').find((j) => j.id === out.job_id)!
    expect(job.status).toBe('queued')
    expect(job.attempts).toBe(0)
    expect(readRows('case_packets').find((p) => p.id === out.id)?.status).toBe('queued')
    expect(rpc('background_job_retry', { p_id: 'nope' })).toMatchObject({ ok: false, code: 'not_found' })
  })
})

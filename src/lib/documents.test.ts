import { describe, expect, it } from 'vitest'
import type { Tables } from './database.types'
import {
  BASIC_TOOLS, DOCUMENT_TOOLS, DOCUMENT_TOOL_IDS, EXTRACTION_LABEL, canRequestExtraction, countsAsDocument, extractionState,
  groupCaseDocuments, isDocumentMedia, isEvidenceDocument, isGeneratedMedia, isPageSpec, mediaBucket, openPageUrl, splitHeadline,
  toolAvailable, toolRequestArgs,
} from './documents'

const media = (o: Partial<Tables<'media'>>): Tables<'media'> => ({
  archived_at: null, byte_size: null, case_id: 'c1', category: null, classification: null, collected_at: null, collected_by: null,
  created_at: '2026-07-01T00:00:00Z', current_custodian: null, delete_batch: null, delete_reason: null, deleted_at: null, deleted_by: null,
  derivative_service: null, derivative_service_version: null, derivative_type: null, evidence_designated_at: null, evidence_designated_by: null,
  evidence_number: null, evidence_ref: null, external_url: null, featured: false, gang_id: null, id: 'm', integrity_status: null, kind: null,
  last_integrity_check: null, location_collected: null, mime: null, narcotic_id: null, observation_id: null, original_filename: null,
  parent_media_id: null, parent_sha256: null, person_id: null, place_id: null, report_id: null, restricted: false, sealed_at: null, sealed_by: null,
  sha256: null, source: null, storage_path: 'case/c1/m/file.pdf', tags: null, title: 'Doc', type: 'document', updated_at: '2026-07-01T00:00:00Z',
  uploaded_by: null, vehicle_id: null, ...o,
})

describe('document classification', () => {
  it('type document or a document mime', () => {
    expect(isDocumentMedia(media({ type: 'document' }))).toBe(true)
    expect(isDocumentMedia(media({ type: 'image', mime: 'application/pdf' }))).toBe(true)
    expect(isDocumentMedia(media({ type: 'image', mime: 'text/plain' }))).toBe(true)
    expect(isDocumentMedia(media({ type: 'image', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))).toBe(true)
    expect(isDocumentMedia(media({ type: 'image', mime: 'image/png' }))).toBe(false)
    expect(isDocumentMedia(media({ type: 'video', mime: null }))).toBe(false)
  })

  it('generated = the derivative families; evidence document = an unarchived original', () => {
    expect(isGeneratedMedia(media({ derivative_type: 'ocr' }))).toBe(true)
    expect(isGeneratedMedia(media({ derivative_type: 'compressed' }))).toBe(true)
    expect(isGeneratedMedia(media({ derivative_type: 'thumbnail' }))).toBe(false)
    expect(isGeneratedMedia(media({ derivative_type: null }))).toBe(false)
    expect(isEvidenceDocument(media({}))).toBe(true)
    expect(isEvidenceDocument(media({ parent_media_id: 'p' }))).toBe(false)
    expect(isEvidenceDocument(media({ archived_at: '2026-07-02T00:00:00Z' }))).toBe(false)
  })

  it('the tab pill counts type=document or the four counted derivatives', () => {
    expect(countsAsDocument(media({ type: 'document' }))).toBe(true)
    expect(countsAsDocument(media({ type: 'image', derivative_type: 'redacted' }))).toBe(true)
    expect(countsAsDocument(media({ type: 'image', derivative_type: 'compressed' }))).toBe(false)
    expect(countsAsDocument(media({ type: 'image', mime: 'application/pdf' }))).toBe(false)
  })
})

describe('extraction state', () => {
  it('maps rows to the four states with labels', () => {
    expect(extractionState(null)).toBe('none')
    expect(extractionState({ status: 'ready' })).toBe('ready')
    expect(extractionState({ status: 'queued' })).toBe('queued')
    expect(extractionState({ status: 'failed' })).toBe('failed')
    expect(extractionState({ status: 'odd' })).toBe('none')
    expect(EXTRACTION_LABEL.none).toBe('Not processed')
  })

  it('Process is offered for unprocessed / failed storage-backed rows only', () => {
    expect(canRequestExtraction({ storage_path: 'x' }, 'none')).toBe(true)
    expect(canRequestExtraction({ storage_path: 'x' }, 'failed')).toBe(true)
    expect(canRequestExtraction({ storage_path: 'x' }, 'queued')).toBe(false)
    expect(canRequestExtraction({ storage_path: 'x' }, 'ready')).toBe(false)
    expect(canRequestExtraction({ storage_path: null }, 'none')).toBe(false)
  })
})

describe('document tools', () => {
  it('the nineteen tools, six of them basic', () => {
    expect(DOCUMENT_TOOL_IDS).toHaveLength(19)
    expect(DOCUMENT_TOOLS.map((t) => t.id)).toEqual([...DOCUMENT_TOOL_IDS])
    expect([...BASIC_TOOLS].sort()).toEqual(['merge', 'metadata_remove', 'page_numbers', 'rotate', 'split', 'watermark'])
    for (const t of DOCUMENT_TOOLS) {
      expect(t.label).toBeTruthy()
      expect(t.description).toBeTruthy()
      expect(t.needs).toBe(BASIC_TOOLS.has(t.id) ? 'basic' : 'stirling')
    }
  })

  it('availability follows the flag for stirling tools only', () => {
    expect(toolAvailable({ needs: 'basic' }, false)).toBe(true)
    expect(toolAvailable({ needs: 'stirling' }, false)).toBe(false)
    expect(toolAvailable({ needs: 'stirling' }, true)).toBe(true)
  })

  it('page specs', () => {
    expect(isPageSpec('1-3, 5, 8-')).toBe(true)
    expect(isPageSpec('4')).toBe(true)
    expect(isPageSpec('')).toBe(false)
    expect(isPageSpec('a-b')).toBe(false)
    expect(isPageSpec('1;2')).toBe(false)
  })

  it('builds the RPC inputs / options', () => {
    expect(toolRequestArgs('rotate', ['m1', 'm2'], { pages: ' 1-2 ', rotation: 90, watermark: '' }))
      .toEqual({ inputs: { media_ids: ['m1', 'm2'], pages: '1-2' }, options: { rotation: 90 } })
    expect(toolRequestArgs('watermark', ['m1'], { watermark: ' DRAFT ' }))
      .toEqual({ inputs: { media_ids: ['m1'] }, options: { watermark: 'DRAFT' } })
    expect(toolRequestArgs('merge', ['a', 'b'])).toEqual({ inputs: { media_ids: ['a', 'b'] }, options: {} })
  })
})

describe('headline + page links', () => {
  it('splits <b> marks into safe segments and leaves other tags literal', () => {
    expect(splitHeadline('the <b>seized</b> vehicle <b>plate</b>')).toEqual([
      { text: 'the ', hit: false }, { text: 'seized', hit: true }, { text: ' vehicle ', hit: false }, { text: 'plate', hit: true },
    ])
    expect(splitHeadline('<script>x</script> <b>y</b>')).toEqual([{ text: '<script>x</script> ', hit: false }, { text: 'y', hit: true }])
    expect(splitHeadline('plain')).toEqual([{ text: 'plain', hit: false }])
    expect(splitHeadline('')).toEqual([])
    expect(splitHeadline(null)).toEqual([])
  })

  it('openPageUrl appends #page=N and replaces an existing fragment', () => {
    expect(openPageUrl('https://x/y.pdf?token=1', 3)).toBe('https://x/y.pdf?token=1#page=3')
    expect(openPageUrl('https://x/y.pdf#page=9', 2)).toBe('https://x/y.pdf#page=2')
    expect(openPageUrl('https://x/y.pdf', 0)).toBe('https://x/y.pdf')
    expect(openPageUrl('https://x/y.pdf', null)).toBe('https://x/y.pdf')
    expect(openPageUrl('https://x/y.pdf', 2.7)).toBe('https://x/y.pdf#page=2')
  })

  it('bucket by derivative-ness', () => {
    expect(mediaBucket({ derivative_type: null, parent_media_id: null })).toBe('case-evidence')
    expect(mediaBucket({ derivative_type: 'ocr', parent_media_id: 'p' })).toBe('case-documents')
    expect(mediaBucket({ derivative_type: null, parent_media_id: 'p' })).toBe('case-documents')
  })
})

describe('groupCaseDocuments', () => {
  it('joins extractions, separates originals from derivatives, hides archived', () => {
    const original = media({ id: 'o1' })
    const failedDoc = media({ id: 'o2' })
    const archived = media({ id: 'o3', archived_at: '2026-07-02T00:00:00Z' })
    const photo = media({ id: 'p1', type: 'image', mime: 'image/png' })
    const ocr = media({ id: 'd1', type: 'document', parent_media_id: 'o1', derivative_type: 'ocr' })
    const thumb = media({ id: 'd2', type: 'image', parent_media_id: 'p1', derivative_type: 'thumbnail' })
    const extraction = (media_id: string, status: string): Tables<'document_extractions'> => ({
      created_at: '', error: null, id: `x-${media_id}`, media_id, page_count: 4, service: 'unpdf', service_version: '1', status, structure: null, tables: null, updated_at: '',
    })
    const g = groupCaseDocuments({
      reports: [], legal: [], packets: [], jobs: [],
      media: [original, failedDoc, archived, photo, ocr, thumb],
      extractions: [extraction('o1', 'ready'), extraction('o2', 'failed')],
    })
    expect(g.evidenceDocs.map((d) => [d.media.id, d.state])).toEqual([['o1', 'ready'], ['o2', 'failed']])
    expect(g.evidenceDocs[0].extraction?.page_count).toBe(4)
    expect(g.generated.map((m) => m.id)).toEqual(['d1'])
  })
})

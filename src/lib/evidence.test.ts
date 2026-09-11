import { describe, expect, it } from 'vitest'
import {
  classificationLabel, custodyEventLabel, derivativeTypeLabel, evidenceFileProblem, evidenceMimeAccepted, evidenceNumberOf,
  evidencePath, externalSrcOf, integrityFailureDetail, integrityLabel, integrityTone, isDerivative, isEvidenceRow,
  isExternalHosted, isRegisteredEvidence, isStorageHosted, jobProgressOf, manifestIncludesMedia, mediaTypeForMime,
  MAX_EVIDENCE_BYTES, sha256HexOf,
} from './evidence'

const SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('evidence — MIME acceptance mirrors the bucket', () => {
  it('accepts image/* and audio/* families, the listed video/document types', () => {
    expect(evidenceMimeAccepted('image/heic')).toBe(true)
    expect(evidenceMimeAccepted('audio/ogg')).toBe(true)
    expect(evidenceMimeAccepted('video/mp4')).toBe(true)
    expect(evidenceMimeAccepted('video/quicktime')).toBe(true)
    expect(evidenceMimeAccepted('application/pdf')).toBe(true)
    expect(evidenceMimeAccepted('text/plain')).toBe(true)
    expect(evidenceMimeAccepted('application/zip')).toBe(true)
    expect(evidenceMimeAccepted('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true)
  })

  it('refuses anything else, including an empty type', () => {
    expect(evidenceMimeAccepted('video/x-msvideo')).toBe(false)
    expect(evidenceMimeAccepted('application/x-msdownload')).toBe(false)
    expect(evidenceMimeAccepted('')).toBe(false)
  })

  it('evidenceFileProblem: empty → type → size, in that order', () => {
    expect(evidenceFileProblem({ size: 0, type: 'image/png' })).toMatch(/empty/)
    expect(evidenceFileProblem({ size: 10, type: 'application/x-msdownload' })).toMatch(/not accepted/)
    expect(evidenceFileProblem({ size: MAX_EVIDENCE_BYTES + 1, type: 'image/png' })).toMatch(/100 MB/)
    expect(evidenceFileProblem({ size: MAX_EVIDENCE_BYTES, type: 'image/png' })).toBeNull()
  })
})

describe('mediaTypeForMime — the enum has no audio member', () => {
  it('maps families onto media_type', () => {
    expect(mediaTypeForMime('image/jpeg')).toBe('image')
    expect(mediaTypeForMime('video/webm')).toBe('video')
    expect(mediaTypeForMime('audio/mpeg')).toBe('fivemanage')
    expect(mediaTypeForMime('application/pdf')).toBe('document')
    expect(mediaTypeForMime('application/zip')).toBe('document')
    expect(mediaTypeForMime('')).toBe('document')
  })
})

describe('evidencePath — case/<case_id>/<media_id>/original.<ext>', () => {
  it('sanitises and bounds the extension', () => {
    expect(evidencePath('c1', 'm1', 'scene.JPG')).toBe('case/c1/m1/original.jpg')
    expect(evidencePath('c1', 'm1', 'weird.name.t@r.gz')).toBe('case/c1/m1/original.gz')
    expect(evidencePath('c1', 'm1', 'x.abcdefghijklmnop')).toBe('case/c1/m1/original.abcdefgh')
  })
  it('falls back to .bin when the name has no extension', () => {
    expect(evidencePath('c1', 'm1', 'README')).toBe('case/c1/m1/original.bin')
    expect(evidencePath('c1', 'm1', 'trailing.')).toBe('case/c1/m1/original.bin')
  })
})

describe('host / lineage / designation predicates', () => {
  it('a bucket path is storage-hosted; a URL (either column) is external', () => {
    expect(isStorageHosted({ external_url: null, storage_path: 'case/c/m/original.png' })).toBe(true)
    expect(isExternalHosted({ external_url: null, storage_path: 'case/c/m/original.png' })).toBe(false)
    expect(isExternalHosted({ external_url: 'https://r2.fivemanage.com/x.png', storage_path: null })).toBe(true)
    expect(isExternalHosted({ external_url: null, storage_path: 'https://cdn.example/x.png' })).toBe(true)
    expect(isExternalHosted({ external_url: null, storage_path: null })).toBe(true)
  })

  it('externalSrcOf returns the direct URL only for external rows', () => {
    expect(externalSrcOf({ external_url: 'https://a/x', storage_path: null })).toBe('https://a/x')
    expect(externalSrcOf({ external_url: null, storage_path: 'https://b/y' })).toBe('https://b/y')
    expect(externalSrcOf({ external_url: null, storage_path: 'case/c/m/original.png' })).toBeNull()
  })

  it('derivative / registered / designated', () => {
    expect(isDerivative({ parent_media_id: 'p' })).toBe(true)
    expect(isDerivative({ parent_media_id: null })).toBe(false)
    expect(isRegisteredEvidence({ evidence_number: 'EV-000001' })).toBe(true)
    expect(isRegisteredEvidence({ evidence_number: null })).toBe(false)
    expect(isEvidenceRow({ evidence_number: null, evidence_ref: 'EV-ABCD1234' })).toBe(true)
    expect(isEvidenceRow({ evidence_number: null, evidence_ref: null })).toBe(false)
    expect(evidenceNumberOf({ evidence_number: 'EV-000002', evidence_ref: 'EV-OLD' })).toBe('EV-000002')
    expect(evidenceNumberOf({ evidence_number: null, evidence_ref: 'EV-OLD' })).toBe('EV-OLD')
    expect(evidenceNumberOf({ evidence_number: null, evidence_ref: null })).toBeNull()
  })

  it('sha256HexOf strips the bytea prefix', () => {
    expect(sha256HexOf({ sha256: `\\x${SHA}` })).toBe(SHA)
    expect(sha256HexOf({ sha256: null })).toBe('')
  })
})

describe('labels', () => {
  it('integrity label + tone pair — label always present', () => {
    expect(integrityLabel('verified')).toBe('VERIFIED')
    expect(integrityLabel('failed')).toBe('INTEGRITY FAILURE')
    expect(integrityLabel('unverified')).toBe('UNVERIFIED')
    expect(integrityLabel(null)).toBe('UNVERIFIED')
    expect(integrityTone('verified')).toBe('good')
    expect(integrityTone('failed')).toBe('danger')
    expect(integrityTone(undefined)).toBe('warn')
  })

  it('custody event labels cover the vocabulary and degrade gracefully', () => {
    expect(custodyEventLabel('TRANSFERRED')).toBe('Custody transferred')
    expect(custodyEventLabel('INTEGRITY_FAILURE')).toBe('Integrity failure')
    expect(custodyEventLabel('PACKET_INCLUDED')).toBe('Included in a case packet')
    expect(custodyEventLabel('SOME_NEW_KIND')).toBe('Some new kind')
    expect(custodyEventLabel(null)).toBe('Event')
  })

  it('derivative + classification labels', () => {
    expect(derivativeTypeLabel('ocr')).toBe('OCR text')
    expect(derivativeTypeLabel('mystery')).toBe('mystery')
    expect(derivativeTypeLabel(null)).toBe('Derivative')
    expect(classificationLabel('sensitive')).toBe('Sensitive')
    expect(classificationLabel(null)).toBe('Unclassified')
  })
})

describe('integrityFailureDetail — the newest failure event wins', () => {
  it('reads expected/actual out of the event metadata', () => {
    const events = [
      { event_type: 'VERIFIED', metadata: {} },
      { event_type: 'INTEGRITY_FAILURE', metadata: { expected: 'aa', actual: 'bb' } },
      { event_type: 'INTEGRITY_FAILURE', metadata: { expected: `\\x${SHA}`, actual: 'cc' } },
    ]
    expect(integrityFailureDetail(events)).toEqual({ expected: SHA, actual: 'cc' })
  })
  it('null when no failure is recorded', () => {
    expect(integrityFailureDetail([{ event_type: 'VERIFIED', metadata: {} }])).toBeNull()
    expect(integrityFailureDetail([])).toBeNull()
  })
})

describe('manifestIncludesMedia', () => {
  const manifest = {
    manifest_version: 1,
    files: [{ path: 'a.pdf', size: 1, sha256: SHA, source: { kind: 'media', id: 'm1' } }, { path: 'b', source: { kind: 'report', id: 'r1' } }],
    source_evidence_ids: ['m9'],
  }
  it('matches through files[].source.id or source_evidence_ids', () => {
    expect(manifestIncludesMedia(manifest, 'm1')).toBe(true)
    expect(manifestIncludesMedia(manifest, 'm9')).toBe(true)
    expect(manifestIncludesMedia(manifest, 'r1')).toBe(false)
    expect(manifestIncludesMedia(manifest, 'zz')).toBe(false)
  })
  it('tolerates a malformed manifest', () => {
    expect(manifestIncludesMedia(null, 'm1')).toBe(false)
    expect(manifestIncludesMedia('nope', 'm1')).toBe(false)
    expect(manifestIncludesMedia({ files: 'x' }, 'm1')).toBe(false)
  })
})

describe('jobProgressOf', () => {
  it('clamps pct and reads step/message', () => {
    expect(jobProgressOf({ progress: { pct: 140, step: 'hash', message: 'Hashing' } })).toEqual({ pct: 100, step: 'hash', message: 'Hashing' })
    expect(jobProgressOf({ progress: {} })).toEqual({ pct: null, step: null, message: null })
    expect(jobProgressOf({ progress: null as unknown as Record<string, never> })).toEqual({ pct: null, step: null, message: null })
  })
})

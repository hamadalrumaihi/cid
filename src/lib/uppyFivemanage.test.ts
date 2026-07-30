/** Pure mapping contract of the Uppy → FiveManage adapter. The full queue
 *  lifecycle (upload, retry, insert failure, cancel) runs against the MSW
 *  fivemanage handler in tests/msw/uppy-fivemanage.test.ts — these lock the
 *  routing/extraction rules the transport depends on. */
import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_FILE_TYPES, MAX_UPLOAD_BYTES,
  extractFmUrl, fmEndpointFor, fmFieldFor, fmKindOf, fmtBytes,
} from './uppyFivemanage'

describe('fmKindOf — MIME prefix → FiveManage kind, image fallback', () => {
  it('routes the three media kinds by prefix', () => {
    expect(fmKindOf('image/png')).toBe('image')
    expect(fmKindOf('image/svg+xml')).toBe('image')
    expect(fmKindOf('video/mp4')).toBe('video')
    expect(fmKindOf('video/webm')).toBe('video')
    expect(fmKindOf('audio/mpeg')).toBe('audio')
    expect(fmKindOf('audio/wav')).toBe('audio')
  })

  it('falls back to image for unknown or empty MIME (fmUpload parity)', () => {
    expect(fmKindOf('')).toBe('image')
    expect(fmKindOf('application/pdf')).toBe('image')
    expect(fmKindOf('text/plain')).toBe('image')
  })
})

describe('fmEndpointFor / fmFieldFor — path AND multipart field keyed by kind', () => {
  it('builds ${base}/api/{kind}', () => {
    expect(fmEndpointFor('image', 'https://api.fivemanage.com')).toBe('https://api.fivemanage.com/api/image')
    expect(fmEndpointFor('video', 'https://api.fivemanage.com')).toBe('https://api.fivemanage.com/api/video')
    expect(fmEndpointFor('audio', 'https://api.fivemanage.com')).toBe('https://api.fivemanage.com/api/audio')
  })

  it('defaults to the FiveManage production base', () => {
    expect(fmEndpointFor('image')).toMatch(/^https:\/\/api\.fivemanage\.com\/api\/image$/)
  })

  it('names the multipart field after the kind — never `file`', () => {
    expect(fmFieldFor('image')).toBe('image')
    expect(fmFieldFor('video')).toBe('video')
    expect(fmFieldFor('audio')).toBe('audio')
  })
})

describe('extractFmUrl — url || link || data.url, in that order', () => {
  it('reads each accepted shape', () => {
    expect(extractFmUrl({ url: 'https://a' })).toBe('https://a')
    expect(extractFmUrl({ link: 'https://b' })).toBe('https://b')
    expect(extractFmUrl({ data: { url: 'https://c' } })).toBe('https://c')
  })

  it('prefers url over link over data.url', () => {
    expect(extractFmUrl({ url: 'https://a', link: 'https://b', data: { url: 'https://c' } })).toBe('https://a')
    expect(extractFmUrl({ link: 'https://b', data: { url: 'https://c' } })).toBe('https://b')
  })

  it('rejects bodies without a usable string URL', () => {
    expect(extractFmUrl({})).toBeNull()
    expect(extractFmUrl(null)).toBeNull()
    expect(extractFmUrl(undefined)).toBeNull()
    expect(extractFmUrl('https://a')).toBeNull()
    expect(extractFmUrl({ url: 42 })).toBeNull()
    expect(extractFmUrl({ url: '' })).toBeNull()
    expect(extractFmUrl({ data: 'https://c' })).toBeNull()
  })
})

describe('restrictions + byte formatting', () => {
  it('caps single files at 100 MB and accepts only the three media families', () => {
    expect(MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024)
    expect([...ACCEPTED_FILE_TYPES]).toEqual(['image/*', 'video/*', 'audio/*'])
  })

  it('fmtBytes renders compact human sizes', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(1023)).toBe('1023 B')
    expect(fmtBytes(1024)).toBe('1.0 KB')
    expect(fmtBytes(4.2 * 1024 * 1024)).toBe('4.2 MB')
    expect(fmtBytes(MAX_UPLOAD_BYTES)).toBe('100 MB')
    expect(fmtBytes(-1)).toBe('—')
    expect(fmtBytes(Number.NaN)).toBe('—')
  })
})

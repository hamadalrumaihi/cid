import { describe, expect, it } from 'vitest'
import {
  VERIFICATION_LABEL, VERIFICATION_STATUSES, hashFiles, isManifestFile, manifestHashMatches, parseVerification,
  partitionBundleFiles, readSha256File, summarizeVerification, verificationLabel,
} from './manifest'

describe('hashFiles', () => {
  it('hashFiles yields the manifest_verify input shape', async () => {
    const f = new File([new TextEncoder().encode('abc')], 'packet.pdf', { type: 'application/pdf' })
    expect(await hashFiles([f])).toEqual([{ path: 'packet.pdf', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }])
  })
})

describe('verification vocabulary', () => {
  it('has exactly the five outcomes with their labels', () => {
    expect([...VERIFICATION_STATUSES]).toEqual(['verified', 'modified', 'missing', 'unexpected', 'hash_mismatch'])
    expect(VERIFICATION_LABEL).toEqual({
      verified: 'VERIFIED', modified: 'MODIFIED FILE', missing: 'MISSING FILE', unexpected: 'UNEXPECTED FILE', hash_mismatch: 'HASH MISMATCH',
    })
    expect(verificationLabel('modified')).toBe('MODIFIED FILE')
    expect(verificationLabel('odd')).toBe('ODD')
    expect(verificationLabel(null)).toBe('UNKNOWN')
  })
})

describe('parseVerification', () => {
  it('reads the server shape and fails closed on unknown file statuses', () => {
    const r = parseVerification({ status: 'modified', files: [{ path: 'packet.pdf', status: 'modified' }, { path: 'x', status: 'weird' }] })
    expect(r).toEqual({ status: 'modified', files: [{ path: 'packet.pdf', status: 'modified' }, { path: 'x', status: 'hash_mismatch' }] })
  })

  it('derives the overall status from the worst file when the server gives none', () => {
    expect(parseVerification({ files: [{ path: 'a', status: 'verified' }, { path: 'b', status: 'missing' }] })?.status).toBe('missing')
    expect(parseVerification({ files: [{ path: 'a', status: 'unexpected' }, { path: 'b', status: 'hash_mismatch' }] })?.status).toBe('hash_mismatch')
    expect(parseVerification({ files: [] })?.status).toBe('verified')
  })

  it('rejects non-objects', () => {
    expect(parseVerification(null)).toBeNull()
    expect(parseVerification('x')).toBeNull()
    expect(parseVerification([])).toBeNull()
  })
})

describe('summarizeVerification', () => {
  it('counts per outcome and keeps the server verdict', () => {
    const s = summarizeVerification({
      status: 'unexpected',
      files: [{ path: 'a', status: 'verified' }, { path: 'b', status: 'verified' }, { path: 'c', status: 'unexpected' }],
    })
    expect(s).toEqual({ status: 'unexpected', total: 3, counts: { verified: 2, modified: 0, missing: 0, unexpected: 1, hash_mismatch: 0 } })
  })

  it('an empty check is never VERIFIED', () => {
    expect(summarizeVerification({ status: 'verified', files: [] }).status).toBe('missing')
    expect(summarizeVerification(null)).toEqual({ status: 'missing', total: 0, counts: { verified: 0, modified: 0, missing: 0, unexpected: 0, hash_mismatch: 0 } })
  })
})

describe('manifest file helpers', () => {
  it('recognises the manifest pair regardless of case', () => {
    expect(isManifestFile('manifest.json')).toBe(true)
    expect(isManifestFile('MANIFEST.SHA256')).toBe(true)
    expect(isManifestFile('packet.pdf')).toBe(false)
  })

  it('reads sha256sum-style and bare digests', () => {
    const hex = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(readSha256File(`${hex.toUpperCase()}  manifest.json\n`)).toBe(hex)
    expect(readSha256File(hex)).toBe(hex)
    expect(readSha256File('nothing here')).toBeNull()
    expect(readSha256File('deadbeef')).toBeNull()
  })

  it('compares the stored bytea hash with a hex digest', () => {
    expect(manifestHashMatches('\\xABCD', 'abcd')).toBe(true)
    expect(manifestHashMatches('abcd', 'abce')).toBe(false)
    expect(manifestHashMatches(null, 'abcd')).toBeNull()
    expect(manifestHashMatches('abcd', null)).toBeNull()
  })

  it('partitions bundle members from the manifest pair', () => {
    const files = [{ name: 'packet.pdf' }, { name: 'manifest.json' }, { name: 'manifest.sha256' }, { name: 'EV-000001.jpg' }]
    const p = partitionBundleFiles(files)
    expect(p.members.map((f) => f.name)).toEqual(['packet.pdf', 'EV-000001.jpg'])
    expect(p.manifestJson?.name).toBe('manifest.json')
    expect(p.manifestSha?.name).toBe('manifest.sha256')
    expect(partitionBundleFiles([]).manifestJson).toBeNull()
  })
})

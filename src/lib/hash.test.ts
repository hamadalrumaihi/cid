import { describe, expect, it } from 'vitest'
import { bytesToHex, formatBytes, isSha256Hex, normalizeHex, sha256Hex, shortHash } from './hash'

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('sha256Hex — Web Crypto digest as lower-case hex', () => {
  it('matches the FIPS 180-4 vector for "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer)).toBe(ABC)
  })

  it('hashes a Blob by reading its bytes', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe(ABC)
  })

  it('hashes the empty input', async () => {
    expect(await sha256Hex(new ArrayBuffer(0))).toBe(EMPTY)
  })
})

describe('shortHash / normalizeHex / isSha256Hex', () => {
  it('shortHash takes the first 12 characters', () => {
    expect(shortHash(ABC)).toBe('ba7816bf8f01')
    expect(shortHash(ABC, 8)).toBe('ba7816bf')
  })

  it('accepts the PostgREST bytea form (\\x-prefixed) and lower-cases', () => {
    expect(normalizeHex(`\\x${ABC.toUpperCase()}`)).toBe(ABC)
    expect(shortHash(`\\x${ABC}`)).toBe('ba7816bf8f01')
  })

  it('rejects non-hex input instead of passing it through', () => {
    expect(normalizeHex('not-a-hash')).toBe('')
    expect(shortHash(null)).toBe('')
    expect(isSha256Hex(ABC)).toBe(true)
    expect(isSha256Hex(ABC.slice(1))).toBe(false)
    expect(isSha256Hex(undefined)).toBe(false)
  })

  it('bytesToHex renders every byte as two characters', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 255, 16]))).toBe('0001ff10')
  })
})

describe('formatBytes', () => {
  it('formats the unit ladder', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(4.2 * 1024 * 1024)).toBe('4.2 MB')
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB')
    expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TB')
  })

  it('renders a dash for missing or invalid sizes', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

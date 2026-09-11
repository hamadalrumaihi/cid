/** Content hashing for evidence — the client half of the integrity story.
 *
 *  The browser hashes the ORIGINAL bytes before they leave the machine, and
 *  `evidence_register` stores that digest as the reference the server's
 *  `evidence.verify` job re-computes against. SHA-256 via Web Crypto only:
 *  no polyfill, no dependency, and the same primitive the runner uses, so
 *  the two sides can never disagree on the algorithm.
 *
 *  Files are read whole (≤ 100 MB by the bucket's own limit) — streaming
 *  digests are not in Web Crypto, and a 100 MB ArrayBuffer is well inside
 *  what a phone browser handles. */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** Lower-case hex of an ArrayBuffer / typed array. */
export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let out = ''
  for (let i = 0; i < view.length; i += 1) out += HEX[view[i]]
  return out
}

/** SHA-256 of a Blob or ArrayBuffer as 64 lower-case hex characters. */
export async function sha256Hex(data: ArrayBuffer | Blob): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return bytesToHex(digest)
}

/** First 12 hex characters — the readout a card shows beside a copy button. */
export function shortHash(hex: string | null | undefined, length = 12): string {
  const clean = normalizeHex(hex)
  return clean ? clean.slice(0, length) : ''
}

/** PostgREST renders `bytea` as `\x<hex>`; accept that, bare hex, or empty. */
export function normalizeHex(value: string | null | undefined): string {
  if (!value) return ''
  const s = value.startsWith('\\x') || value.startsWith('\\X') ? value.slice(2) : value
  return /^[0-9a-fA-F]*$/.test(s) ? s.toLowerCase() : ''
}

/** True for a 64-hex SHA-256 string (either bytea or bare form). */
export const isSha256Hex = (value: string | null | undefined): boolean => normalizeHex(value).length === 64

/** Compact byte formatter (1023 B / 4.2 MB / 100 MB). Pure and locale-free:
 *  file sizes are readouts, not prose, so a fixed unit ladder is what every
 *  queue row and detail sheet shares. */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let v = n
  let i = -1
  do { v /= 1024; i += 1 } while (v >= 1024 && i < units.length - 1)
  return `${v >= 10 ? Math.round(v).toString() : v.toFixed(1)} ${units[i]}`
}

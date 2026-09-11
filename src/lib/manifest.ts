/** Export manifests + package verification (platform upgrade decision #8,
 *  "Evidence Seal" concepts, own implementation).
 *
 *  Every server-built bundle (case packet, evidence bundle, disclosure)
 *  ships `manifest.json` — `{manifest_version, bundle_id, kind, case_id,
 *  files:[{path,size,sha256,source}], …}` — and `manifest.sha256`, the hash
 *  of the manifest text as stored. The database keeps the same manifest in
 *  `export_manifests` (immutable) with `manifest_sha256`.
 *
 *  Verification is two-sided and the browser never decides alone:
 *   1. the files a reviewer drops are hashed LOCALLY (Web Crypto SHA-256;
 *      bytes never leave the machine) into `[{path,size,sha256}]`;
 *   2. `manifest_verify(p_manifest, p_files)` compares them with the stored
 *      manifest and answers per-file statuses — the five outcomes below.
 *  The manifest file itself is checked here against `manifest.sha256` and
 *  the stored `manifest_sha256`, since it is not one of the manifest's own
 *  entries. `scripts/verify-bundle.mjs` does the same offline. */
import { rpc } from './db'
import type { Json } from './database.types'
import { normalizeHex, sha256Hex } from './hash'
import { unwrapJsonRpc, type JsonRpcOutcome } from './packets'

/* ── Hashing (lib/hash — the same Web Crypto digest evidence_register uses) ── */

export interface ManifestFileInput {
  path: string
  size: number
  sha256: string
}

/** Hash dropped files into the `manifest_verify` input shape. `path` is the
 *  bare file name — bundles are flat, and a browser never exposes folders. */
export async function hashFiles(files: readonly File[]): Promise<ManifestFileInput[]> {
  const out: ManifestFileInput[] = []
  for (const f of files) {
    out.push({ path: f.name, size: f.size, sha256: await sha256Hex(f) })
  }
  return out
}

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

export const VERIFICATION_STATUSES = ['verified', 'modified', 'missing', 'unexpected', 'hash_mismatch'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

/** The five outcome labels — uppercase because they are semantic codes a
 *  reviewer reads off the screen into a report. */
export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified: 'VERIFIED',
  modified: 'MODIFIED FILE',
  missing: 'MISSING FILE',
  unexpected: 'UNEXPECTED FILE',
  hash_mismatch: 'HASH MISMATCH',
}

export type VerificationTone = 'good' | 'warn' | 'danger'
export const VERIFICATION_TONE: Record<VerificationStatus, VerificationTone> = {
  verified: 'good',
  modified: 'danger',
  missing: 'warn',
  unexpected: 'warn',
  hash_mismatch: 'danger',
}

/** Worst-first ordering used to fold per-file statuses into one verdict. */
const SEVERITY: Record<VerificationStatus, number> = { hash_mismatch: 4, modified: 3, missing: 2, unexpected: 1, verified: 0 }

export const isVerificationStatus = (s: unknown): s is VerificationStatus =>
  typeof s === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(s)

export function verificationLabel(status: string | null | undefined): string {
  return isVerificationStatus(status) ? VERIFICATION_LABEL[status] : (status ? status.toUpperCase() : 'UNKNOWN')
}

/* ── Result shape ───────────────────────────────────────────────────────── */

export interface VerificationFile {
  path: string
  status: VerificationStatus
}

export interface VerificationResult {
  status: VerificationStatus
  files: VerificationFile[]
}

/** Parse the RPC's jsonb into the typed result; unknown statuses on a file
 *  are treated as `hash_mismatch` (fail closed — never "verified" by accident). */
export function parseVerification(json: Json | null | undefined): VerificationResult | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const obj = json as Record<string, unknown>
  const rawFiles = Array.isArray(obj.files) ? obj.files : []
  const files: VerificationFile[] = rawFiles
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && !Array.isArray(f))
    .map((f) => ({
      path: typeof f.path === 'string' ? f.path : '',
      status: isVerificationStatus(f.status) ? f.status : 'hash_mismatch',
    }))
  const status = isVerificationStatus(obj.status) ? obj.status : worstOf(files.map((f) => f.status))
  return { status, files }
}

function worstOf(statuses: readonly VerificationStatus[]): VerificationStatus {
  let worst: VerificationStatus = 'verified'
  for (const s of statuses) if (SEVERITY[s] > SEVERITY[worst]) worst = s
  return worst
}

export interface VerificationSummary {
  status: VerificationStatus
  counts: Record<VerificationStatus, number>
  total: number
}

/** One verdict + per-outcome counts. The overall status is the server's
 *  when it gave one, else the worst file outcome; an empty file list is a
 *  `missing` verdict (nothing was checked) rather than a hollow VERIFIED. */
export function summarizeVerification(result: VerificationResult | null): VerificationSummary {
  const counts: Record<VerificationStatus, number> = { verified: 0, modified: 0, missing: 0, unexpected: 0, hash_mismatch: 0 }
  if (!result) return { status: 'missing', counts, total: 0 }
  for (const f of result.files) counts[f.status]++
  const status: VerificationStatus = result.files.length === 0 && result.status === 'verified' ? 'missing' : result.status
  return { status, counts, total: result.files.length }
}

/* ── manifest.json / manifest.sha256 helpers ────────────────────────────── */

export const MANIFEST_JSON = 'manifest.json'
export const MANIFEST_SHA256 = 'manifest.sha256'

/** Is this dropped file the manifest or its checksum (not a bundle member)? */
export const isManifestFile = (name: string): boolean => {
  const n = name.toLowerCase()
  return n === MANIFEST_JSON || n === MANIFEST_SHA256
}

/** The hex digest in a `manifest.sha256` file — `<hex>  manifest.json`
 *  (sha256sum style) or a bare digest; null when none is present. */
export function readSha256File(text: string): string | null {
  const m = /\b([0-9a-fA-F]{64})\b/.exec(text)
  return m ? m[1].toLowerCase() : null
}

/** Does the stored `manifest_sha256` (bytea → `\x…`) match a hex digest? */
export function manifestHashMatches(stored: string | null | undefined, hex: string | null | undefined): boolean | null {
  const a = normalizeHex(stored)
  const b = normalizeHex(hex)
  if (!a || !b) return null
  return a === b
}

/** Split the dropped files: bundle members go to the server; the manifest
 *  pair is checked locally. */
export function partitionBundleFiles<T extends { name: string }>(files: readonly T[]): { members: T[]; manifestJson: T | null; manifestSha: T | null } {
  let manifestJson: T | null = null
  let manifestSha: T | null = null
  const members: T[] = []
  for (const f of files) {
    const n = f.name.toLowerCase()
    if (n === MANIFEST_JSON) manifestJson = f
    else if (n === MANIFEST_SHA256) manifestSha = f
    else members.push(f)
  }
  return { members, manifestJson, manifestSha }
}

/* ── The RPC ────────────────────────────────────────────────────────────── */

export type VerifyOutcome = JsonRpcOutcome & { result: VerificationResult | null }

/** `manifest_verify(p_manifest, p_files)` — INVOKER, so an invisible
 *  manifest is a refusal, never a leak. */
export async function verifyManifest(manifestId: string, files: readonly ManifestFileInput[]): Promise<VerifyOutcome> {
  const res = await rpc('manifest_verify', {
    p_manifest: manifestId,
    p_files: files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })),
  })
  const folded = unwrapJsonRpc(res)
  return { ...folded, result: folded.ok ? parseVerification(res.data) : null }
}

/** Zod validation for the structured JSON payloads the DOJ build introduced
 *  (v1.14, audit Phase 1 item 3): legal form data, packet manifests,
 *  notification payloads, report signatures and reopen logs. Every parser is
 *  TOLERANT — malformed data degrades to a safe empty value instead of
 *  crashing a reviewer's screen, matching the jsonShapes philosophy (which
 *  stays in place for its existing consumers; new structured payloads land
 *  here). Validation never widens access — RLS remains the authority. */
import { z } from 'zod'
import type { Json } from './database.types'

/* ---- legal request form_data ------------------------------------------- */

/** Working/legacy form_data: string-ish values keyed by field, with the
 *  frozen `_meta` keys the version snapshots add. Unknown keys survive. */
export const legalFormDataSchema = z.record(z.string(), z.unknown())

export function parseLegalFormEntries(v: Json | null | undefined): [string, string][] {
  const parsed = legalFormDataSchema.safeParse(v)
  if (!parsed.success) return []
  return Object.entries(parsed.data)
    .filter(([k, val]) => !k.startsWith('_') && val !== null && val !== undefined && val !== '')
    .map(([k, val]) => [k, typeof val === 'string' ? val : JSON.stringify(val)])
}

/* ---- packet manifest (legal_request_versions.packet_manifest) ----------- */

export const packetManifestEntrySchema = z.object({
  exhibit_id: z.string().optional(),
  type: z.string().optional(),
  source_id: z.string().nullable().optional(),
  title: z.string().optional(),
})
export type PacketManifestEntry = z.infer<typeof packetManifestEntrySchema>

export function parsePacketManifest(v: Json | null | undefined): PacketManifestEntry[] {
  if (!Array.isArray(v)) return []
  return v
    .map((e) => packetManifestEntrySchema.safeParse(e))
    .filter((r): r is { success: true; data: PacketManifestEntry } => r.success)
    .map((r) => r.data)
}

/* ---- notification payloads ---------------------------------------------- */

export const notifPayloadSchema = z.object({
  case_id: z.string().optional(),
  case_number: z.string().optional(),
  tracker_code: z.string().optional(),
  target: z.string().optional(),
  detective: z.string().optional(),
  reason: z.string().optional(),
  title: z.string().optional(),
  request_id: z.string().optional(),
  request_number: z.string().optional(),
  request_type: z.string().optional(),
  sealed: z.boolean().optional(),
  actor_id: z.string().optional(),
  actor_name: z.string().optional(),
}).loose()
export type NotifPayload = z.infer<typeof notifPayloadSchema>

export function parseNotifPayload(v: Json | null | undefined): NotifPayload {
  const parsed = notifPayloadSchema.safeParse(v)
  return parsed.success ? parsed.data : {}
}

/* ---- report signature + reopen log (reports.signature / fields._reopen_log) */

export const reportSignatureSchema = z.object({
  officer: z.string().catch('Officer'),
  signer_id: z.string().optional(),
  badge: z.string().nullable().optional(),
  signed_at: z.string().optional(),
})
export type ReportSignature = z.infer<typeof reportSignatureSchema>

export function parseReportSignature(v: Json | null | undefined): ReportSignature | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const parsed = reportSignatureSchema.safeParse(v)
  return parsed.success ? parsed.data : null
}

export const reopenLogEntrySchema = z.object({
  at: z.string().optional(),
  by: z.string().optional(),
  prev_signature: reportSignatureSchema.nullable().optional(),
})
export type ReopenLogEntry = z.infer<typeof reopenLogEntrySchema>

export function parseReopenLog(v: Json | null | undefined): ReopenLogEntry[] {
  if (!Array.isArray(v)) return []
  return v
    .map((e) => reopenLogEntrySchema.safeParse(e))
    .filter((r): r is { success: true; data: ReopenLogEntry } => r.success)
    .map((r) => r.data)
}

/* ---- security dashboard (owner_security_overview response) -------------- */

export const securityRunSchema = z.object({
  id: z.string(),
  suite: z.string(),
  passed: z.number().catch(0),
  failed: z.number().catch(0),
  skipped: z.number().catch(0),
  total: z.number().catch(0),
  failures: z.array(z.object({
    name: z.string().catch('unnamed test'),
    expected: z.string().catch(''),
    actual: z.string().catch(''),
  })).catch([]),
  commit_sha: z.string().nullable().catch(null),
  branch: z.string().nullable().catch(null),
  release: z.string().nullable().catch(null),
  source: z.string().catch('local'),
  duration_ms: z.number().nullable().catch(null),
  created_at: z.string(),
})
export const securityOverviewSchema = z.object({
  runs: z.array(securityRunSchema).catch([]),
  fixtures: z.array(z.object({
    email: z.string(),
    present: z.boolean().catch(false),
    issues: z.array(z.string()).catch([]),
  })).catch([]),
  leftovers: z.record(z.string(), z.number()).catch({}),
})
export type SecurityOverview = z.infer<typeof securityOverviewSchema>

export function parseSecurityOverview(v: Json | null | undefined): SecurityOverview {
  const parsed = securityOverviewSchema.safeParse(v)
  return parsed.success ? parsed.data : { runs: [], fixtures: [], leftovers: {} }
}

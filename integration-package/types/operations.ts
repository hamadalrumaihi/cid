/** CID Integration Package — operation envelopes (normative).
 *
 *  The request/response shapes for every CID-lane operation named in
 *  contract/API-CONTRACT.md. Self-contained on purpose: no imports beyond
 *  this package's own types.
 *
 *  Idempotency (contract/IDEMPOTENCY.md): every MUTATING operation must
 *  carry `externalRequestId` — source-scoped, stable across retries of the
 *  same logical action. Reads carry none. A replay of a resolved request
 *  returns the stored outcome with `duplicate: true`; nothing writes twice. */

import type {
  ExternalCharge, ExternalCitizen, ExternalOfficer, ExternalProperty,
  ExternalReference, ExternalVehicle,
} from './integration'

/* ── Error vocabulary (contract/ERROR-CODES.md) ────────────────────────── */

/** Stable codes — branch on the code, never on message text. */
export type IntegrationErrorCode =
  | 'unauthorized'      // bad secret / unknown or disabled source / expired session
  | 'forbidden'         // officer (or machine identity) lacks authority, or is unmapped
  | 'not_found'         // absent OR invisible to this officer — never distinguished
  | 'conflict'          // valid request, state forbids it
  | 'duplicate'         // idempotent replay; stored outcome returned; NOT a failure
  | 'validation_failed' // malformed payload / missing field / FUTURE operation
  | 'rate_limited'      // source over its per-minute budget
  | 'internal'          // unexpected failure; retry with the same externalRequestId

export interface IntegrationError {
  error: IntegrationErrorCode
  message: string
}

/* ── The envelope ──────────────────────────────────────────────────────── */

/** Every operation name in the catalog. `interview.create` and
 *  `legal.addComment` are documented-FUTURE: routed, but they return
 *  validation_failed until the contract is revised. */
export type OperationName =
  // city-owned reads (served by your adapters)
  | 'citizens.search' | 'citizens.get'
  | 'vehicles.search' | 'vehicles.get'
  | 'properties.for' | 'properties.get'
  | 'officers.search' | 'officers.get'
  | 'penal.search'
  // CID casework (per-officer)
  | 'case.create' | 'case.setStatus' | 'case.setLead' | 'case.accessDecide'
  | 'case.get' | 'case.timeline'
  | 'case.addPerson' | 'case.addVehicle' | 'case.addCharge'
  | 'task.create' | 'report.create'
  | 'interview.create' // FUTURE
  // external references
  | 'evidence.attach' | 'storage.attach' | 'media.attach'
  // surveillance (machine lane) and legal
  | 'surveillance.ingest'
  | 'legal.create' | 'legal.update'
  | 'legal.addComment' // FUTURE

/** The request envelope every call sends. */
export interface OperationEnvelope<P = Record<string, unknown>> {
  op: OperationName
  /** Registered source id, e.g. 'fivem-main'. */
  source: string
  /** External officer id (city identity) — required for every officer-lane
   *  operation; absent on the machine lane. */
  officerId?: string
  /** Idempotency key component — REQUIRED on every mutating operation. */
  externalRequestId?: string
  payload?: P
}

/** Success wrapper. `duplicate: true` marks an idempotent replay — `result`
 *  is then the stored outcome of the original request. */
export interface OperationSuccess<R> {
  ok: true
  duplicate?: boolean
  result: R
}

export type OperationResponse<R> = OperationSuccess<R> | IntegrationError

/* ── Read payloads/results (city-owned; served by your adapters) ───────── */

export interface SearchRequest { q: string; limit?: number }
export interface GetByIdRequest { externalId: string }
export interface PropertiesForRequest { citizenExternalId: string }

export type CitizensSearchResult = ExternalCitizen[]
export type CitizenGetResult = ExternalCitizen | null
export type VehiclesSearchResult = ExternalVehicle[]
export type VehicleGetResult = ExternalVehicle | null
export type PropertiesForResult = ExternalProperty[]
export type PropertyGetResult = ExternalProperty | null
export type OfficersSearchResult = ExternalOfficer[]
export type OfficerGetResult = ExternalOfficer | null
export type PenalSearchResult = ExternalCharge[]

/* ── CID casework payloads/results ─────────────────────────────────────── */

/** Opaque CID record handle returned by mutations. CID ids are the portal's
 *  own; treat them as opaque strings and never derive meaning from them. */
export interface CidRecordRef {
  id: string
  /** Human-facing number when the record type has one (e.g. a case number). */
  displayNumber?: string
}

export interface CaseCreateRequest {
  title: string
  summary?: string
  /** Optional pointer to the city record that prompted the case (e.g. an
   *  incident id) — stored as an external reference, per EXTERNAL-IDS.md. */
  originatingReference?: ExternalReference
}

export interface CaseSetStatusRequest { caseId: string; status: string; note?: string }
export interface CaseSetLeadRequest { caseId: string; officerId: string }
export interface CaseAccessDecideRequest {
  caseId: string
  requestId: string
  decision: 'approve' | 'deny'
  note?: string
}
export interface CaseGetRequest { caseId: string }
export interface CaseTimelineRequest { caseId: string; limit?: number }

/** Timeline entries are read-only projections; shapes beyond these fields
 *  are portal-versioned and additive. */
export interface CaseTimelineEntry {
  at: string
  kind: string
  summary: string
  actor?: string
}

export interface CaseAddPersonRequest {
  caseId: string
  /** City citizen being linked; a deliberate snapshot may ride along. */
  citizen: ExternalReference
  role?: string
}
export interface CaseAddVehicleRequest { caseId: string; vehicle: ExternalReference }
export interface CaseAddChargeRequest {
  caseId: string
  /** Who the charge attaches to (a person already on the case). */
  personRef: ExternalReference
  /** The city penal charge, snapshot included (fine/jail as YOUR code says). */
  charge: ExternalCharge
  note?: string
}
export interface TaskCreateRequest {
  caseId: string
  title: string
  details?: string
  assigneeOfficerId?: string
}
export interface ReportCreateRequest {
  caseId: string
  title: string
  body: string
  reportType?: string
}

/* ── External-reference payloads ───────────────────────────────────────── */

export interface EvidenceAttachRequest {
  caseId: string
  evidence: ExternalReference   // externalType: 'evidence'
  contextNote?: string
}
export interface StorageAttachRequest {
  caseId: string
  storageItem: ExternalReference // externalType: 'storage_item'
  contextNote?: string
}
export interface MediaAttachRequest {
  caseId: string
  media: ExternalReference       // externalType: 'media'
  evidenceRef?: string
}

/* ── Surveillance (machine lane) and legal ─────────────────────────────── */

/** Machine-lane ingest — NOT an officer operation. Idempotent on
 *  (source, sourceEventId); malformed/unknown payloads are quarantined, not
 *  errored; observations enter unverified pending detective review. */
export interface SurveillanceIngestRequest {
  eventType: 'fixed_camera' | 'alpr' | 'monitored_location'
    | 'vehicle_observation' | 'person_observation' | 'meeting_event'
    | 'patrol_submission'
  sourceEventId: string
  /** When it happened IN-CITY (source clock), ISO-8601. */
  eventTime: string
  payload: {
    activity: string
    targetId: string
    location?: string
    lat?: number
    lng?: number
    plate?: string
    description?: string
  }
}
export interface SurveillanceIngestResult {
  status: 'processed' | 'duplicate' | 'quarantined'
}

export interface LegalCreateRequest {
  caseId: string
  requestType: string
  title: string
  body?: string
}
export interface LegalUpdateRequest {
  legalRequestId: string
  action: string   // the portal's legal transitions; illegal ones ⇒ conflict
  note?: string
}

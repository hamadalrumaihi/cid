/** Idempotency helpers for the future inbound-event pipeline (spec §14).
 *  Pure — no clock, no I/O, no storage — so the server-side consumer and the
 *  unit tests share one implementation. The pipeline's contract: every
 *  inbound event carries a source-scoped event id; replays of the same
 *  (source, event) pair must be detectable from the key alone. */

/** Lifecycle of a stored inbound event. `retryable`/`failed` are distinct so
 *  the pipeline can tell "try again later" from "gave up". */
export type IntegrationEventStatus =
  | 'pending' | 'processed' | 'duplicate' | 'quarantined' | 'failed' | 'retryable'

/** The identity of one inbound event. `externalRequestId` is the sender's
 *  own correlation id — kept for tracing, deliberately NOT part of the
 *  idempotency key (a resend may mint a new request id for the same event). */
export interface IdempotentRequest {
  source: string
  sourceEventId: string
  externalRequestId?: string
}

/** Matching-only normalizer for external identifiers: trim, collapse internal
 *  whitespace. Case and interior punctuation are preserved (external ids may
 *  be case-sensitive), and display values are never altered by this — same
 *  convention as the entitySearch normalizers. Blank ⇒ ''. */
export function normalizeExternalId(v: string | null | undefined): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

/** Deterministic `source:sourceEventId` key — the unique handle the pipeline
 *  stores to detect replays. Whitespace noise is normalized away so a resent
 *  event with a padded id still collides with the original. Throws on an
 *  empty component: a keyless event must fail loudly, not silently collide
 *  with every other keyless event. */
export function buildIdempotencyKey(req: IdempotentRequest): string {
  const source = normalizeExternalId(req.source)
  const eventId = normalizeExternalId(req.sourceEventId)
  if (!source || !eventId) throw new Error('buildIdempotencyKey: source and sourceEventId are required')
  return `${source}:${eventId}`
}

/** True when a stored event with this status makes an identical incoming key
 *  a replay to drop: already handled (`processed`) or already recognized as a
 *  replay (`duplicate`). `failed`/`retryable` deliberately return false — a
 *  resend of an unprocessed event is a legitimate retry — and `pending`/
 *  `quarantined` are in-flight/held, not resolved, so they don't mark
 *  duplicates either. */
export function isDuplicateStatus(status: IntegrationEventStatus): boolean {
  return status === 'processed' || status === 'duplicate'
}

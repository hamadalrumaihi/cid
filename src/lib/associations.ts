'use client'

/** Entity associations — the client model for `public.entity_associations`
 *  and its four RPCs (migration 20261106120000_org_associations_registry_intel).
 *
 *  An association is a REVIEWABLE LINK between two registry records: a
 *  subject, an object, the claim (`association`) and a workflow status that
 *  always starts at `pending_investigation`. The distinction this module
 *  exists to keep visible is the one the migration spells out — recording an
 *  observation is NOT a finding. `unconfirmed_association` asserts that two
 *  records are linked and nothing whatever about the nature of that link, so
 *  its label never says alliance, merger or control; only an investigator's
 *  decision can promote a claim, and only through `entity_association_decide`.
 *
 *  The table is SELECT-only for clients: every write below is an RPC that
 *  audits itself and re-checks authority, and reads go through
 *  `entity_associations_for`, which is SECURITY INVOKER (the RLS policy —
 *  visible only when BOTH endpoints are visible — is the wall). Nothing here
 *  decides access.
 *
 *  Pure helpers (the vocabulary label maps, the sort, the amend patch) sit at
 *  the top and are unit tested; the data functions below them go through
 *  lib/db only. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Json } from './database.types'
import { rpc, type MutationResult } from './db'
import { humanizeError } from './toast'

/* ── Vocabulary (mirrors the CHECK constraints) ─────────────────────────── */

/** The registry records an association may name (subject_kind/object_kind). */
export const ASSOCIATION_KINDS = ['gang', 'person', 'place', 'vehicle', 'narcotic', 'account', 'indicator'] as const
export type AssociationKind = (typeof ASSOCIATION_KINDS)[number]

export const ASSOCIATION_KIND_LABEL: Record<AssociationKind, string> = {
  gang: 'Organisation', person: 'Person', place: 'Place', vehicle: 'Vehicle',
  narcotic: 'Narcotic', account: 'Account', indicator: 'Indicator',
}

/** The claim. Ordered as the migration orders it: the deliberately neutral
 *  default first, then the organisation-to-organisation claims, then the
 *  three property claims in ascending order of strength. */
export const ASSOCIATION_CLAIMS = [
  'unconfirmed_association', 'alliance', 'rivalry', 'conflict',
  'shared_property', 'business_relationship', 'supplier', 'subsidiary',
  'splinter', 'successor', 'observed_at', 'operates_from', 'controls', 'other',
] as const
export type AssociationClaim = (typeof ASSOCIATION_CLAIMS)[number]

export const ASSOCIATION_CLAIM_LABEL: Record<AssociationClaim, string> = {
  unconfirmed_association: 'Unconfirmed Association',
  alliance: 'Alliance',
  rivalry: 'Rivalry',
  conflict: 'Conflict',
  shared_property: 'Shared Property',
  business_relationship: 'Business Relationship',
  supplier: 'Supplier',
  subsidiary: 'Subsidiary',
  splinter: 'Splinter',
  successor: 'Successor',
  observed_at: 'Observed At',
  operates_from: 'Operates From',
  controls: 'Controls',
  other: 'Other',
}

/** What each claim actually asserts — the tooltip copy. The first entry is
 *  the load-bearing one: an unconfirmed association must never be read as
 *  alliance, merger or control. */
export const ASSOCIATION_CLAIM_MEANING: Record<AssociationClaim, string> = {
  unconfirmed_association: 'Two records were observed linked. This asserts nothing about the nature of the link — not alliance, not merger, not control.',
  alliance: 'The two organisations act together, by an investigator’s finding.',
  rivalry: 'The two organisations are rivals.',
  conflict: 'The two organisations are in active conflict.',
  shared_property: 'Both were observed at, or tied to, the same property.',
  business_relationship: 'A commercial tie of some kind.',
  supplier: 'The subject supplies the object.',
  subsidiary: 'The subject operates under the object.',
  splinter: 'The subject broke away from the object.',
  successor: 'The subject took over from the object.',
  observed_at: 'Presence at the property was observed. The weakest of the three property claims.',
  operates_from: 'The property is used as a base of operations.',
  controls: 'The property is controlled. The strongest property claim — a finding, not an observation.',
  other: 'Something the vocabulary does not cover; read the note.',
}

/** The workflow. An observation never lands anywhere but the first. */
export const ASSOCIATION_STATUSES = ['pending_investigation', 'confirmed', 'rejected', 'historical'] as const
export type AssociationStatus = (typeof ASSOCIATION_STATUSES)[number]

export const ASSOCIATION_STATUS_LABEL: Record<AssociationStatus, string> = {
  pending_investigation: 'Pending Investigation',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  historical: 'Historical',
}

export const ASSOCIATION_CONFIDENCE = ['confirmed', 'probable', 'possible', 'unverified', 'disproven'] as const
export type AssociationConfidence = (typeof ASSOCIATION_CONFIDENCE)[number]

export const ASSOCIATION_CONFIDENCE_LABEL: Record<AssociationConfidence, string> = {
  confirmed: 'Confirmed', probable: 'Probable', possible: 'Possible',
  unverified: 'Unverified', disproven: 'Disproven',
}

export const ASSOCIATION_SOURCE_TYPES = [
  'visual_intelligence', 'field_observation', 'informant', 'surveillance',
  'document', 'digital', 'interview', 'open_source', 'other',
] as const
export type AssociationSourceType = (typeof ASSOCIATION_SOURCE_TYPES)[number]

export const ASSOCIATION_SOURCE_LABEL: Record<AssociationSourceType, string> = {
  visual_intelligence: 'Visual Intelligence',
  field_observation: 'Field Observation',
  informant: 'Informant',
  surveillance: 'Surveillance',
  document: 'Document',
  digital: 'Digital',
  interview: 'Interview',
  open_source: 'Open Source',
  other: 'Other',
}

/** The only keys `entity_association_update` accepts. */
export const AMENDABLE_FIELDS = ['note', 'confidence', 'source_type', 'first_observed', 'last_confirmed'] as const
export type AmendableField = (typeof AMENDABLE_FIELDS)[number]

/* ── Rows ───────────────────────────────────────────────────────────────── */

/** One row of `entity_associations_for(kind, id)`: the association as seen
 *  FROM one record. `direction` says which end the asked-about record is, and
 *  `other_*` is always the far end. `created_by` / `created_by_name` is the
 *  SUBMITTER — the member who recorded the observation. It is not an
 *  assignment and says nothing about who investigates it. */
export interface AssociationRow {
  id: string
  direction: 'subject' | 'object' | string
  other_kind: string
  other_id: string
  other_label: string | null
  association: string
  status: string
  confidence: string | null
  source_type: string | null
  note: string | null
  first_observed: string | null
  last_confirmed: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  decided_by: string | null
  decided_by_name: string | null
  decided_at: string | null
  decision_note: string | null
}

/* ── Pure helpers ───────────────────────────────────────────────────────── */

const humanize = (s: string): string =>
  s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const isClaim = (v: string): v is AssociationClaim => (ASSOCIATION_CLAIMS as readonly string[]).includes(v)
const isStatus = (v: string): v is AssociationStatus => (ASSOCIATION_STATUSES as readonly string[]).includes(v)
const isConfidence = (v: string): v is AssociationConfidence => (ASSOCIATION_CONFIDENCE as readonly string[]).includes(v)
const isSourceType = (v: string): v is AssociationSourceType => (ASSOCIATION_SOURCE_TYPES as readonly string[]).includes(v)

/** Label for a claim. An unknown value (a vocabulary the server grew and the
 *  client has not) humanizes rather than disappearing. */
export const claimLabel = (v: string | null | undefined): string =>
  !v ? '—' : isClaim(v) ? ASSOCIATION_CLAIM_LABEL[v] : humanize(v)

export const claimMeaning = (v: string | null | undefined): string | undefined =>
  v && isClaim(v) ? ASSOCIATION_CLAIM_MEANING[v] : undefined

export const associationStatusLabel = (v: string | null | undefined): string =>
  !v ? ASSOCIATION_STATUS_LABEL.pending_investigation : isStatus(v) ? ASSOCIATION_STATUS_LABEL[v] : humanize(v)

export const associationConfidenceLabel = (v: string | null | undefined): string =>
  !v ? '—' : isConfidence(v) ? ASSOCIATION_CONFIDENCE_LABEL[v] : humanize(v)

export const associationSourceLabel = (v: string | null | undefined): string =>
  !v ? '—' : isSourceType(v) ? ASSOCIATION_SOURCE_LABEL[v] : humanize(v)

export const associationKindLabel = (v: string | null | undefined): string =>
  !v ? '—' : (ASSOCIATION_KINDS as readonly string[]).includes(v) ? ASSOCIATION_KIND_LABEL[v as AssociationKind] : humanize(v)

/** Still awaiting an investigator's ruling — an observation, not a finding. */
export const isPendingAssociation = (row: Pick<AssociationRow, 'status'>): boolean =>
  row.status === 'pending_investigation'

/** Someone ruled on it, and the row says who and when. */
export const isDecided = (row: Pick<AssociationRow, 'decided_at'>): boolean => !!row.decided_at

/** Confirming or rejecting needs a reason — the RPC returns
 *  {ok:false, code:'bad_request'} without one, so the UI must collect it. */
export const decisionNeedsReason = (status: string): boolean =>
  status === 'confirmed' || status === 'rejected'

/** Pending first, then newest first — the server's own ORDER BY, re-applied
 *  on the client so a row amended in place cannot drift out of order. Stable
 *  and non-mutating. */
export function sortAssociations(rows: readonly AssociationRow[]): AssociationRow[] {
  return [...rows]
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const pa = isPendingAssociation(a.row) ? 0 : 1
      const pb = isPendingAssociation(b.row) ? 0 : 1
      if (pa !== pb) return pa - pb
      const at = a.row.created_at ?? ''
      const bt = b.row.created_at ?? ''
      if (at !== bt) return bt.localeCompare(at)
      return a.i - b.i
    })
    .map((x) => x.row)
}

/** The patch `entity_association_update` will accept: only the amendable
 *  keys, only the ones that actually CHANGED, with blank text normalised to
 *  null exactly as the RPC does. Null when nothing changed — the caller then
 *  skips the round trip (an empty patch is a `bad_request`). */
export function amendPatch(
  row: Pick<AssociationRow, AmendableField>,
  next: Partial<Record<AmendableField, string | null>>,
): Record<string, string | null> | null {
  const patch: Record<string, string | null> = {}
  for (const key of AMENDABLE_FIELDS) {
    if (!(key in next)) continue
    const value = (next[key] ?? '').trim() || null
    if (value === (row[key] ?? null)) continue
    patch[key] = value
  }
  return Object.keys(patch).length ? patch : null
}

/* ── RPC result shaping ─────────────────────────────────────────────────── */

export type AssociationResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

function shape<T = Record<string, unknown>>(res: MutationResult<Json>): AssociationResult<T> {
  if (res.error) return { ok: false, code: res.error.code ?? 'error', message: humanizeError(res.error.message) }
  const d = (res.data ?? {}) as { ok?: boolean; code?: string; message?: string }
  if (d && typeof d === 'object' && d.ok === false) {
    return { ok: false, code: d.code ?? 'refused', message: d.message ?? 'The server refused this change.' }
  }
  return { ok: true, data: (res.data ?? {}) as T }
}

/* ── Writes (RPC only) ──────────────────────────────────────────────────── */

export interface CreateAssociationInput {
  subjectKind: AssociationKind
  subjectId: string
  objectKind: AssociationKind
  objectId: string
  association: AssociationClaim
  note?: string | null
  confidence?: AssociationConfidence | null
  sourceType?: AssociationSourceType | null
  firstObserved?: string | null
}

/** `created:false` means an identical live pair already existed and was
 *  returned — the intake rule is append, never overwrite, never duplicate.
 *  Callers must say so rather than claiming a new record. */
export interface CreatedAssociation {
  id?: string
  created?: boolean
  status?: string
  message?: string
}

export async function createAssociation(input: CreateAssociationInput): Promise<AssociationResult<CreatedAssociation>> {
  return shape<CreatedAssociation>(await rpc('entity_association_create', {
    p_subject_kind: input.subjectKind,
    p_subject_id: input.subjectId,
    p_object_kind: input.objectKind,
    p_object_id: input.objectId,
    p_association: input.association,
    p_note: input.note?.trim() || null,
    p_confidence: input.confidence ?? null,
    p_source_type: input.sourceType ?? null,
    p_first_observed: input.firstObserved || null,
  }))
}

/** Rule on an association. The claim and the confidence may be corrected in
 *  the same movement (an "unconfirmed association" that turns out to be a
 *  business relationship becomes one). Returning it to
 *  `pending_investigation` clears the decision server-side. */
export async function decideAssociation(
  id: string,
  status: AssociationStatus,
  opts: { note?: string | null; association?: AssociationClaim | null; confidence?: AssociationConfidence | null } = {},
): Promise<AssociationResult<{ id?: string; status?: string }>> {
  return shape(await rpc('entity_association_decide', {
    p_id: id,
    p_status: status,
    p_note: opts.note?.trim() || null,
    p_association: opts.association ?? null,
    p_confidence: opts.confidence ?? null,
  }))
}

/** Amend the descriptive fields WITHOUT ruling on the association. Build the
 *  patch with amendPatch() — anything outside AMENDABLE_FIELDS is refused. */
export async function updateAssociation(
  id: string,
  patch: Record<string, string | null>,
): Promise<AssociationResult<{ id?: string }>> {
  return shape(await rpc('entity_association_update', { p_id: id, p_patch: patch as Json }))
}

/* ── Read ───────────────────────────────────────────────────────────────── */

export async function listAssociations(kind: AssociationKind, id: string): Promise<AssociationRow[]> {
  const res = await rpc('entity_associations_for', { p_kind: kind, p_id: id })
  if (res.error) throw Object.assign(new Error(humanizeError(res.error.message)), { code: res.error.code })
  return sortAssociations((res.data ?? []) as AssociationRow[])
}

export interface AssociationsState {
  rows: AssociationRow[]
  /** True during the FIRST read only — the "show a skeleton" signal. */
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/** Every association touching one registry record, both directions, pending
 *  first. Deferred first load (the useRegistry idiom) and no realtime
 *  channel: `entity_associations` is not in the realtime publication, so the
 *  section refreshes on its own writes and on remount. */
export function useAssociations(kind: AssociationKind, id: string): AssociationsState {
  const [rows, setRows] = useState<AssociationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Stale-while-revalidate, as useRegistry does it: once a read has landed,
  // a refresh after a decision must not blank the list back to a skeleton.
  const hasLoaded = useRef(false)

  const refresh = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true)
    setError(null)
    try {
      setRows(await listAssociations(kind, id))
      hasLoaded.current = true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [kind, id])

  useEffect(() => {
    // Deferred so the first paint isn't blocked (the useRegistry idiom).
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  return { rows, loading, error, refresh }
}

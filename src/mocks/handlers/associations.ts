/** Entity associations + registry intelligence attachments
 *  (migration 20261106120000_org_associations_registry_intel).
 *
 *  The CONTRACT of the five server functions, answered from the mock store —
 *  never a second implementation of the server's authority model:
 *   · `entity_associations` is SELECT-only for clients: every INSERT / UPDATE
 *     / DELETE is PostgREST's grant denial (403 / 42501), exactly as the
 *     `revoke all … grant select` in the migration leaves it. Reads fall
 *     through to postgrest.ts.
 *   · Refusal style, as everywhere else: AUTHORITY refusals RAISE through
 *     `private.perm_raise` (SQLSTATE P0403 → 400 here); VALIDATION refusals
 *     RETURN `{ok:false, code, message}`.
 *   · The three rules worth pinning, because the UI is built on them:
 *     an identical live pair is RETURNED with `created:false` rather than
 *     duplicated; confirming or rejecting without a reason is
 *     `{ok:false, code:'bad_request'}`; and an association always lands on
 *     `pending_investigation` — this mock has no path that writes any other
 *     status on create.
 *   · `registry_media_attach` reserves the media row and the object path
 *     (`registry/<kind>/<entity_id>/<media_id>/<file>`) and returns them; the
 *     row carries `kind = 'registry_intel'` and NO case, which is what keeps
 *     it out of the evidence surfaces. The bytes are then uploaded through
 *     platform.ts's storage handlers like any other private object.
 *
 *  Visibility here is deliberately shallow — "the row exists and is live" —
 *  because the real wall (`perm_registry_visible` on BOTH endpoints) is RLS,
 *  and tests/rls covers it. */
import { http } from 'msw'
import type { Database, Tables } from '@/lib/database.types'
import { supabaseBaseUrl } from '../env'
import { mediaRow } from '../fixtures/rows'
import { getDenial, getRows, mockId, seedRows, type MockRow, type MockTableName } from '../store'
import { isActive, isCommand, isOwner, live, uid } from './entity'
import { postgrestError } from './postgrest'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type Assoc = Tables<'entity_associations'>
type Refusal = { ok: false; code: string; message: string }

const str = (v: unknown): string => (v == null ? '' : String(v))
const blank = (v: unknown): string | null => str(v).trim() || null
const now = () => new Date().toISOString()

/** A server `raise` — rpc.ts turns it into PostgREST's 400 error shape.
 *  `P0403` marks an AUTHORITY refusal (private.perm_raise). */
export class AssociationRpcError extends Error {
  code: string
  constructor(message: string, code = 'P0001') { super(message); this.code = code }
}
function deny(message: string): never { throw new AssociationRpcError(message, 'P0403') }
const refuse = (code: string, message: string): Refusal => ({ ok: false, code, message })

/* ── Vocabulary (the CHECK constraints) ─────────────────────────────────── */

export const ASSOCIATION_RPC_ONLY_TABLES: readonly MockTableName[] = ['entity_associations']

export const ASSOCIATION_KINDS = ['gang', 'person', 'place', 'vehicle', 'narcotic', 'account', 'indicator'] as const
export const ASSOCIATION_CLAIMS = [
  'unconfirmed_association', 'alliance', 'rivalry', 'conflict',
  'shared_property', 'business_relationship', 'supplier', 'subsidiary',
  'splinter', 'successor', 'observed_at', 'operates_from', 'controls', 'other',
] as const
export const ASSOCIATION_STATUSES = ['pending_investigation', 'confirmed', 'rejected', 'historical'] as const
export const REGISTRY_MEDIA_KINDS = ['gang', 'person', 'place', 'vehicle', 'narcotic'] as const
/** `entity_association_update`'s allowed patch keys. */
export const ASSOCIATION_PATCH_KEYS = ['note', 'confidence', 'source_type', 'first_observed'] as const

export const ASSOCIATION_MESSAGES = {
  notActive: 'not an active member',
  notFound: 'association not found',
  recordNotFound: 'record not found',
  self: 'a record cannot be associated with itself',
  duplicate: 'this association is already recorded',
  needsReason: 'confirming or rejecting an association needs a reason',
  badStatus: 'unknown status',
  badPatch: 'only note, confidence, source_type and first_observed may be amended',
  decided: 'this association has been ruled on; change its confidence through a decision, not an amendment',
  authorOnly: 'only the author or command may amend this association',
  unknownKind: 'unknown record kind',
  titleRequired: 'a title is required',
} as const

const KIND_TABLE: Record<string, MockTableName> = {
  gang: 'gangs', person: 'persons', place: 'places', vehicle: 'vehicles',
  narcotic: 'narcotics', account: 'accounts', indicator: 'indicators',
}

/* ── Rows / labels ──────────────────────────────────────────────────────── */

const assocRows = (): MockRow[] => (getDenial('entity_associations') ? [] : getRows('entity_associations'))
const liveAssocs = (): Assoc[] => assocRows().filter((r) => r.deleted_at == null) as unknown as Assoc[]

/** private.registry_label — null when the record is not visible. */
export function registryLabel(kind: unknown, id: unknown): string | null {
  const table = KIND_TABLE[str(kind)]
  if (!table || !id) return null
  const row = live(table).find((r) => r.id === str(id))
  if (!row) return null
  return blank(row.name) ?? blank(row.plate) ?? blank(row.handle) ?? blank(row.value) ?? null
}

const visible = (kind: unknown, id: unknown): boolean => {
  const table = KIND_TABLE[str(kind)]
  return !!table && !!id && live(table).some((r) => r.id === str(id))
}

const nameOf = (id: unknown): string | null => {
  if (!id) return null
  const p = (getRows('profiles') as unknown as Tables<'profiles'>[]).find((r) => r.id === str(id))
  return p?.display_name ?? null
}

/* ── entity_association_create ──────────────────────────────────────────── */

export function entityAssociationCreate(args: Args): Fns['entity_association_create']['Returns'] {
  if (!uid() || !isActive()) deny(ASSOCIATION_MESSAGES.notActive)
  const subjectKind = str(args.p_subject_kind)
  const objectKind = str(args.p_object_kind)
  const subjectId = str(args.p_subject_id)
  const objectId = str(args.p_object_id)
  const association = str(args.p_association)
  if (!visible(subjectKind, subjectId) || !visible(objectKind, objectId)) deny(ASSOCIATION_MESSAGES.recordNotFound)
  if (subjectKind === objectKind && subjectId === objectId) return refuse('bad_request', ASSOCIATION_MESSAGES.self)

  // An existing live row for the same pair + claim is RETURNED, never
  // duplicated and never overwritten (append, do not overwrite).
  const existing = liveAssocs().find((a) => a.association === association && (
    (a.subject_kind === subjectKind && a.subject_id === subjectId && a.object_kind === objectKind && a.object_id === objectId)
    || (subjectKind === objectKind && a.subject_kind === objectKind && a.subject_id === objectId
        && a.object_kind === subjectKind && a.object_id === subjectId)))
  if (existing) {
    return { ok: true, id: existing.id, created: false, status: existing.status, message: ASSOCIATION_MESSAGES.duplicate }
  }

  const stamp = now()
  const [row] = seedRows('entity_associations', [{
    association,
    confidence: blank(args.p_confidence),
    created_at: stamp,
    created_by: uid(),
    decided_at: null,
    decided_by: null,
    decision_note: null,
    delete_batch: null,
    delete_reason: null,
    deleted_at: null,
    deleted_by: null,
    first_observed: blank(args.p_first_observed),
    id: mockId(),
    last_confirmed: null,
    note: blank(args.p_note),
    object_id: objectId,
    object_kind: objectKind,
    source_type: blank(args.p_source_type),
    status: 'pending_investigation',
    subject_id: subjectId,
    subject_kind: subjectKind,
    updated_at: stamp,
  }])
  return { ok: true, id: row.id, created: true, status: 'pending_investigation' }
}

/* ── entity_association_decide ──────────────────────────────────────────── */

export function entityAssociationDecide(args: Args): Fns['entity_association_decide']['Returns'] {
  const row = associationFor(args.p_id)
  const status = str(args.p_status)
  if (!(ASSOCIATION_STATUSES as readonly string[]).includes(status)) return refuse('bad_value', ASSOCIATION_MESSAGES.badStatus)
  const note = blank(args.p_note)
  if ((status === 'confirmed' || status === 'rejected') && !note) {
    return refuse('bad_request', ASSOCIATION_MESSAGES.needsReason)
  }
  const pending = status === 'pending_investigation'
  Object.assign(row, {
    status,
    association: blank(args.p_association) ?? row.association,
    confidence: blank(args.p_confidence) ?? row.confidence,
    decision_note: note,
    decided_by: pending ? null : uid(),
    decided_at: pending ? null : now(),
    last_confirmed: status === 'confirmed' ? now().slice(0, 10) : row.last_confirmed,
    updated_at: now(),
  })
  return { ok: true, id: row.id, status }
}

/* ── entity_association_update ──────────────────────────────────────────── */

export function entityAssociationUpdate(args: Args): Fns['entity_association_update']['Returns'] {
  const row = associationFor(args.p_id)
  if (!(row.created_by === uid() || isCommand() || isOwner())) deny(ASSOCIATION_MESSAGES.authorOnly)
  const patch = (args.p_patch ?? {}) as Record<string, unknown>
  const keys = Object.keys(patch)
  if (!keys.length || !keys.every((k) => (ASSOCIATION_PATCH_KEYS as readonly string[]).includes(k))) {
    return refuse('bad_request', ASSOCIATION_MESSAGES.badPatch)
  }
  for (const key of keys) Object.assign(row, { [key]: blank(patch[key]) })
  row.updated_at = now()
  return { ok: true, id: row.id }
}

/** private.association_for — the row a member may act on, or a refusal that
 *  says the same thing for "not yours" and "does not exist". */
function associationFor(id: unknown): Assoc {
  const row = liveAssocs().find((a) => a.id === str(id))
  if (!row || !isActive() || !visible(row.subject_kind, row.subject_id) || !visible(row.object_kind, row.object_id)) {
    deny(ASSOCIATION_MESSAGES.notFound)
  }
  return row
}

/* ── entity_associations_for ────────────────────────────────────────────── */

export function entityAssociationsFor(args: Args): Fns['entity_associations_for']['Returns'] {
  const kind = str(args.p_kind)
  const id = str(args.p_id)
  if (!isActive()) return []
  return liveAssocs()
    .filter((a) => (a.subject_kind === kind && a.subject_id === id) || (a.object_kind === kind && a.object_id === id))
    .filter((a) => visible(a.subject_kind, a.subject_id) && visible(a.object_kind, a.object_id))
    .map((a) => {
      const mine = a.subject_kind === kind && a.subject_id === id
      const otherKind = mine ? a.object_kind : a.subject_kind
      const otherId = mine ? a.object_id : a.subject_id
      return {
        id: a.id,
        direction: mine ? 'subject' : 'object',
        other_kind: otherKind,
        other_id: otherId,
        other_label: registryLabel(otherKind, otherId),
        association: a.association,
        status: a.status,
        confidence: a.confidence,
        source_type: a.source_type,
        note: a.note,
        first_observed: a.first_observed,
        last_confirmed: a.last_confirmed,
        created_by: a.created_by,
        created_by_name: nameOf(a.created_by),
        created_at: a.created_at,
        decided_by: a.decided_by,
        decided_by_name: nameOf(a.decided_by),
        decided_at: a.decided_at,
        decision_note: a.decision_note,
      }
    })
    .sort((x, y) => {
      const px = x.status === 'pending_investigation' ? 0 : 1
      const py = y.status === 'pending_investigation' ? 0 : 1
      return px - py || y.created_at.localeCompare(x.created_at)
    })
}

/* ── registry_media_attach ──────────────────────────────────────────────── */

const MEDIA_COLUMN: Record<string, 'gang_id' | 'person_id' | 'place_id' | 'vehicle_id' | 'narcotic_id'> = {
  gang: 'gang_id', person: 'person_id', place: 'place_id', vehicle: 'vehicle_id', narcotic: 'narcotic_id',
}

export function registryMediaAttach(args: Args): Fns['registry_media_attach']['Returns'] {
  if (!uid() || !isActive()) deny(ASSOCIATION_MESSAGES.notActive)
  const kind = str(args.p_kind)
  if (!(REGISTRY_MEDIA_KINDS as readonly string[]).includes(kind)) return refuse('bad_request', ASSOCIATION_MESSAGES.unknownKind)
  const entityId = str(args.p_entity_id)
  if (!visible(kind, entityId)) deny(ASSOCIATION_MESSAGES.recordNotFound)
  const title = str(args.p_title).trim().slice(0, 200)
  if (!title) return refuse('bad_request', ASSOCIATION_MESSAGES.titleRequired)

  const mediaId = mockId()
  const name = str(args.p_filename).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 120).replace(/^[-.]+|[-.]+$/g, '') || 'upload'
  const path = `registry/${kind}/${entityId}/${mediaId}/${name}`
  const mime = str(args.p_mime)
  const caption = blank(args.p_caption)
  const category = str(args.p_category)
  // No case, no EV number, no integrity columns: a registry attachment is
  // intelligence, and `kind` is what every reader keys off.
  const row = mediaRow({
    id: mediaId,
    title,
    kind: 'registry_intel',
    type: mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'document',
    case_id: null,
    external_url: null,
    storage_path: path,
    mime: blank(mime),
    byte_size: args.p_byte_size == null ? null : Number(args.p_byte_size),
    original_filename: blank(args.p_filename),
    category: (['scene', 'people', 'vehicles', 'places', 'surveillance', 'documents', 'other'] as const).includes(category as 'other') ? category : 'other',
    tags: caption ? { caption } : {},
    uploaded_by: uid(),
    created_at: now(),
    updated_at: now(),
  })
  row[MEDIA_COLUMN[kind]] = entityId
  seedRows('media', [row])
  return { ok: true, media_id: mediaId, storage_path: path, bucket: 'case-evidence' }
}

/* ── Registry ───────────────────────────────────────────────────────────── */

export const ASSOCIATION_RPCS: Record<string, (args: Args) => unknown> = {
  entity_association_create: entityAssociationCreate,
  entity_association_decide: entityAssociationDecide,
  entity_association_update: entityAssociationUpdate,
  entity_associations_for: entityAssociationsFor,
  registry_media_attach: registryMediaAttach,
}

const refuseTable = (table: MockTableName) => () =>
  postgrestError(403, '42501', `permission denied for table ${table}`)

/** Every client write to `entity_associations` is the grant denial; reads
 *  fall through to postgrest.ts. */
export const associationHandlers = ASSOCIATION_RPC_ONLY_TABLES.flatMap((table) => {
  const url = `${supabaseBaseUrl()}/rest/v1/${table}`
  return [http.post(url, refuseTable(table)), http.patch(url, refuseTable(table)), http.delete(url, refuseTable(table))]
})

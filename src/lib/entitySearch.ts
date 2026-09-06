/** Shared entity-search registry — ONE place for the per-kind suggestion
 *  queries behind pickers/link modals.
 *
 *  Phase 2 (Portal Improvements P2-02/P2-08): the registry kinds — person,
 *  vehicle, gang, place, account, case, narcotic — delegate a typed query to
 *  the SECURITY INVOKER `entity_suggest` RPC through src/lib/entity
 *  (suggestEntities → toHit): normalized fast paths (phone, plate, handle),
 *  trgm fallback, exact-normalized hits first, ≤ 50 rows, and RLS filtering
 *  hidden/sealed/merged/deleted rows server-side. The client only applies
 *  `exclude`, `limit` and (persons) the stable rankPersonRows ordering.
 *
 *  A BLANK query keeps the picker contract ('' lists the most recent ~20
 *  rows so a picker is useful before typing): one projected, bounded
 *  `list()` ordered by updated_at with the same tombstone filters — never an
 *  ilike disjunction, which is the whole point of the migration. A query
 *  under 2 characters is answered by the blank path too (entity_suggest
 *  returns nothing below 2).
 *
 *  Thumbs: a suggest row carries no mugshot, so person hits no longer ship
 *  `thumbUrl` — the picker's RecordThumb falls back to initials, and the
 *  collapsed row keeps whatever thumb the caller already holds. Pickers that
 *  need real thumbs fetch them lazily (RecordSearchPicker getThumb).
 *
 *  operation / legal_request have no RPC arm and stay on ilikeAny (the
 *  sanctioned injection boundary); member / charge filter client caches. A
 *  transient failure degrades to no suggestions ([]), never an exception. */
import { ilikeAny, list } from './db'
import { suggestEntities, toHit } from './entity/api'
import type { SuggestKind } from './entity/kinds'
import { penalSearch, penalSentence } from './penal'
import { activeProfiles } from './profiles'
import { bureauShort, roleLabel } from './roles'

export type EntityKind =
  | 'person' | 'vehicle' | 'gang' | 'place' | 'account' | 'case'
  | 'operation' | 'member' | 'charge' | 'narcotic' | 'legal_request'

/** Superset of the picker's PickedRecord ({ id, label, sublabel? }) — an
 *  EntityHit can be handed to RecordSearchPicker unchanged. */
export interface EntityHit {
  id: string
  label: string
  sublabel?: string
  thumbUrl?: string | null
  disabledReason?: string
  meta?: Record<string, string | null>
}

export interface EntitySearchOptions {
  /** Max hits returned (default 20). Queries stay bounded regardless. */
  limit?: number
  /** Ids to omit (the record being linked FROM, already-linked rows …). */
  exclude?: ReadonlySet<string>
}

const DEFAULT_LIMIT = 20
/** Fetch headroom so merged-tombstone/exclude filtering can't starve a page. */
const OVERFETCH = 8

/* ── Normalizers ─────────────────────────────────────────────────────────────
 * For MATCHING only — display values are never altered by these. Each returns
 * null for a value that normalizes to nothing, so "no usable term" and "empty
 * term" cannot be confused with a real normalized value. */

/** Lowercase, collapse internal whitespace, trim. Blank ⇒ ''. */
export function normalizeQuery(q: string | null | undefined): string {
  return String(q ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Mirror of SQL private.norm_plate: uppercase, strip non-alphanumerics.
 *  'ab-123' and 'AB 123' both normalize to 'AB123'; '' ⇒ null. */
export function normPlate(v: string | null | undefined): string | null {
  const out = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return out || null
}

/** Digits plus a leading '+' only (no SQL phone normalizer exists — this is
 *  the client-side matching convention). '' / no digits ⇒ null. */
/** Mirror of private.norm_phone: digits only, a leading country code 1 on an
 *  11-digit number dropped. entitySearch.test pins the parity cases. */
export function normPhone(v: string | null | undefined): string | null {
  const digits = String(v ?? '').replace(/\D/g, '')
  if (!digits) return null
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

/** Mirror of accounts.handle_normalized (lower(btrim)) plus a leading-@ strip
 *  so '@CoolGuy ' matches the stored 'coolguy'. '' ⇒ null. */
export function normHandle(v: string | null | undefined): string | null {
  const out = String(v ?? '').trim().replace(/^@+/, '').toLowerCase().trim()
  return out || null
}

/* ── Shared plumbing ────────────────────────────────────────────────────── */

const humanize = (s?: string | null): string =>
  s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : ''

/** roleLabel/bureauShort fall back to '—' for null — drop that from joins. */
const noDash = (s: string | null | undefined): string | null => (s && s !== '—' ? s : null)

const joinDots = (parts: Array<string | null | undefined>): string | undefined =>
  parts.filter(Boolean).join(' · ') || undefined

/** Dedupe (first occurrence wins), apply exclude, cap at limit. */
function finish(hits: EntityHit[], opts?: EntitySearchOptions): EntityHit[] {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const seen = new Set<string>()
  const out: EntityHit[] = []
  for (const h of hits) {
    if (seen.has(h.id) || opts?.exclude?.has(h.id)) continue
    seen.add(h.id)
    out.push(h)
    if (out.length >= limit) break
  }
  return out
}

/** One bounded ilikeAny query; ilikeAny returns null for a blank/stripped
 *  term, in which case its documented contract applies: most-recent rows. */
type IlikeTable = 'operations' | 'legal_requests'
async function ilikeRows<Row>(
  table: IlikeTable, select: string, searchCols: readonly string[], q: string, limit: number,
): Promise<Row[]> {
  const or = ilikeAny(searchCols, q)
  const rows = or
    ? await list(table, { select, or, limit })
    : await list(table, { select, order: 'updated_at', ascending: false, limit })
  return rows as unknown as Row[]
}

/* ── Registry kinds — entity_suggest ────────────────────────────────────── */

/** Blank-query "recent rows" projections, mirroring entity_suggest's
 *  label/sublabel shapes so a picker looks the same before and after typing. */
type RecentTable = 'persons' | 'vehicles' | 'gangs' | 'places' | 'accounts' | 'cases' | 'narcotics'
interface RecentSpec { table: RecentTable; select: string; is?: Record<string, null>; live?: (r: Record<string, unknown>) => boolean; hit: (r: Record<string, unknown>) => EntityHit }
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const RECENT: Record<SuggestKind, RecentSpec | null> = {
  person: {
    table: 'persons', select: 'id,name,alias,status,lifecycle',
    live: (r) => r.lifecycle !== 'merged',
    hit: (r) => ({ id: String(r.id), label: str(r.name) || 'Person', sublabel: joinDots([str(r.alias), str(r.status)]), meta: { kind: 'person', exact: null } }),
  },
  vehicle: {
    table: 'vehicles', select: 'id,plate,model,color',
    hit: (r) => ({ id: String(r.id), label: str(r.plate) || 'Vehicle', sublabel: joinDots([str(r.model), str(r.color)]), meta: { kind: 'vehicle', exact: null } }),
  },
  gang: {
    table: 'gangs', select: 'id,name,aliases,status',
    hit: (r) => ({ id: String(r.id), label: String(r.name), sublabel: joinDots([str(r.aliases) ? `aka ${str(r.aliases)}` : null, str(r.status)]), meta: { kind: 'gang', exact: null } }),
  },
  place: {
    table: 'places', select: 'id,name,type,area',
    hit: (r) => ({ id: String(r.id), label: String(r.name), sublabel: joinDots([str(r.type), str(r.area)]), meta: { kind: 'place', exact: null } }),
  },
  narcotic: {
    table: 'narcotics', select: 'id,name,category,status', is: { merged_into: null },
    hit: (r) => ({ id: String(r.id), label: String(r.name), sublabel: joinDots([str(r.category), str(r.status)]), meta: { kind: 'narcotic', exact: null } }),
  },
  case: {
    table: 'cases', select: 'id,case_number,title',
    hit: (r) => ({ id: String(r.id), label: String(r.case_number), sublabel: str(r.title) ?? undefined, meta: { kind: 'case', exact: null } }),
  },
  account: {
    table: 'accounts', select: 'id,platform,handle,display_name,lifecycle',
    live: (r) => r.lifecycle !== 'merged',
    hit: (r) => ({ id: String(r.id), label: `@${String(r.handle)}`, sublabel: joinDots([str(r.platform), str(r.display_name)]), meta: { kind: 'account', exact: null } }),
  },
  phone: null,
  indicator: null,
}

/** Typed query ⇒ entity_suggest (server order kept: exact-normalized hits
 *  first). Blank/short query ⇒ most-recent rows. Both bounded, both
 *  degrade to []. */
async function suggestHits(kind: SuggestKind, q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const query = q.trim()
  try {
    if (query.length < 2) {
      const spec = RECENT[kind]
      if (!spec) return []
      const rows = await list(spec.table, {
        select: spec.select, ...(spec.is ? { is: spec.is } : {}),
        order: 'updated_at', ascending: false, limit: limit + OVERFETCH,
      }) as unknown as Record<string, unknown>[]
      return finish(rows.filter((r) => !spec.live || spec.live(r)).map(spec.hit), opts)
    }
    const rows = await suggestEntities(kind, query, Math.min(limit + OVERFETCH, 50))
    return finish(rows.map(toHit), opts)
  } catch { return [] }
}

/** Stable person ordering: hits whose normalized name/alias/phone EXACTLY
 *  equals the normalized query first, then the RPC rank order, then original
 *  position. Pure — exported for the ranking unit tests; the person arm runs
 *  it as the final client-side ordering over entity_suggest's answer. */
export function rankPersonRows<T extends { id: string; name: string | null; alias: string | null; phone: string | null }>(
  rows: readonly T[], rpcOrder: ReadonlyMap<string, number>, q: string,
): T[] {
  const nq = normalizeQuery(q)
  const np = normPhone(q)
  const exact = (r: T): boolean =>
    !!nq && (normalizeQuery(r.name) === nq || normalizeQuery(r.alias) === nq
      || (np !== null && normPhone(r.phone) === np))
  return rows
    .map((r, i) => ({ r, i, e: exact(r) ? 0 : 1, o: rpcOrder.get(r.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.e - b.e || a.o - b.o || a.i - b.i)
    .map((x) => x.r)
}

export async function searchPersonHits(q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const query = q.trim()
  if (query.length < 2) return suggestHits('person', query, opts)
  try {
    const rows = await suggestEntities('person', query, Math.min(limit + OVERFETCH, 50))
    // entity_suggest already puts exact-normalized hits first; rankPersonRows
    // keeps that order stable (name/alias exactness, then server rank).
    const order = new Map(rows.map((r, i) => [r.id, i] as const))
    const ranked = rankPersonRows(
      rows.map((r) => ({ id: r.id, name: r.label, alias: r.sublabel?.split(' · ')[0] ?? null, phone: null, row: r })),
      order, query,
    )
    return finish(ranked.map((x) => toHit(x.row)), opts)
  } catch { return [] }
}

export const searchVehicleHits = (q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> => suggestHits('vehicle', q, opts)
export const searchGangHits = (q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> => suggestHits('gang', q, opts)
export const searchPlaceHits = (q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> => suggestHits('place', q, opts)
export const searchAccountHits = (q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> => suggestHits('account', q, opts)
export const searchCaseHits = (q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> => suggestHits('case', q, opts)
export const searchNarcoticHits = (q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> => suggestHits('narcotic', q, opts)

/* ── ilike-backed kinds without an RPC arm ─────────────────────────────── */

export async function searchOperationHits(q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  try {
    type Row = { id: string; name: string; description: string | null; status: string; op_type: string }
    const rows = await ilikeRows<Row>('operations', 'id,name,description,status,op_type', ['name', 'description'], q, limit + OVERFETCH)
    return finish(rows.map((o) => ({
      id: o.id,
      label: o.name,
      sublabel: joinDots([humanize(o.op_type), humanize(o.status)]),
    })), opts)
  } catch { return [] }
}

export async function searchLegalRequestHits(q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  try {
    type Row = { id: string; request_number: string; title: string }
    const rows = await ilikeRows<Row>('legal_requests', 'id,request_number,title', ['request_number', 'title'], q, limit + OVERFETCH)
    return finish(rows.map((r) => ({
      id: r.id,
      label: r.request_number,
      sublabel: r.title || undefined,
    })), opts)
  } catch { return [] }
}

/* ── Client-cache kinds (no query — the caches are already local) ───────── */

/** Roster members from the shared cache (activeProfiles — system accounts and
 *  inactive members never appear; email is command-granted and is never part
 *  of the projection or the haystack). Empty until the cache warms. */
export function searchMemberHits(q: string, opts?: EntitySearchOptions): EntityHit[] {
  const nq = normalizeQuery(q)
  return finish(activeProfiles()
    .filter((p) => !nq
      || `${p.display_name ?? ''} ${p.badge_number ?? ''} ${roleLabel(p.role)} ${bureauShort(p.division)}`.toLowerCase().includes(nq))
    .map((p) => ({
      id: p.id,
      label: p.display_name || 'Officer',
      sublabel: joinDots([p.badge_number, noDash(roleLabel(p.role)), noDash(bureauShort(p.division))]),
      thumbUrl: p.avatar_url,
      meta: { active: p.active ? 'true' : 'false', loa: p.loa ? 'true' : 'false' },
    })), opts)
}

/** Charges from the cached published penal code (penalSearch — empty until
 *  ensurePenalCode() lands; the honest answer, not "no such charge"). Hit ids
 *  are the charge row uuids (what case_charges.charge_id wants); the statute
 *  code rides in meta.code. */
export function searchChargeHits(q: string, opts?: EntitySearchOptions): EntityHit[] {
  return finish(penalSearch(q).map((c) => ({
    id: c.id,
    label: c.code ? `${c.code} · ${c.title}` : c.title,
    sublabel: joinDots([
      c.level,
      penalSentence(c.jail),
      c.fine != null ? `$${c.fine.toLocaleString('en-US')}` : c.judgeFine ? 'Fine: judge' : null,
    ]),
    meta: { code: c.code || null },
  })), opts)
}

/* ── Dispatcher ─────────────────────────────────────────────────────────── */

export function searchEntities(kind: EntityKind, q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  switch (kind) {
    case 'person': return searchPersonHits(q, opts)
    case 'vehicle': return searchVehicleHits(q, opts)
    case 'gang': return searchGangHits(q, opts)
    case 'place': return searchPlaceHits(q, opts)
    case 'account': return searchAccountHits(q, opts)
    case 'case': return searchCaseHits(q, opts)
    case 'operation': return searchOperationHits(q, opts)
    case 'legal_request': return searchLegalRequestHits(q, opts)
    case 'narcotic': return searchNarcoticHits(q, opts)
    case 'member': return Promise.resolve(searchMemberHits(q, opts))
    case 'charge': return Promise.resolve(searchChargeHits(q, opts))
  }
}

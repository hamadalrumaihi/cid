/** Shared entity-search registry — ONE place for the per-kind suggestion
 *  queries behind pickers/link modals, extracted from the copy-pasted idioms
 *  (ProfileRelations/gangModals/VehicleProfile/PersonModal person-RPC two-step,
 *  the assorted ilikeAny pickers, search.ts's member/charge cache arms).
 *
 *  Every db-backed search runs on the caller's own RLS-scoped client through
 *  ilikeAny() (the sanctioned injection boundary) or a typed RPC, projected
 *  and bounded (default 20). A transient failure degrades to no suggestions
 *  ([]), never an exception — same contract as the pickers this replaces.
 *  Merged tombstones (persons/accounts lifecycle, narcotics merged_into) are
 *  filtered so a picker can never link a dead record.
 *
 *  Blank query ⇒ most-recent rows (order updated_at desc) for db-backed kinds;
 *  member/charge filter their client caches (roster store / penal catalog) and
 *  return the whole bounded pool instead. */
import { ilikeAny, list, rpc } from './db'
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
export function normPhone(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim()
  const digits = s.replace(/\D/g, '')
  if (!digits) return null
  return (s.startsWith('+') ? '+' : '') + digits
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
type IlikeTable = 'gangs' | 'places' | 'accounts' | 'cases' | 'operations' | 'legal_requests' | 'vehicles'
async function ilikeRows<Row>(
  table: IlikeTable, select: string, searchCols: readonly string[], q: string, limit: number,
): Promise<Row[]> {
  const or = ilikeAny(searchCols, q)
  const rows = or
    ? await list(table, { select, or, limit })
    : await list(table, { select, order: 'updated_at', ascending: false, limit })
  return rows as unknown as Row[]
}

/* ── Persons — the extracted two-step RPC idiom ─────────────────────────── */

interface PersonRow {
  id: string; name: string | null; alias: string | null; dob: string | null
  phone: string | null; status: string | null; gang_id: string | null
  mugshot_url: string | null; lifecycle: string
}
const PERSON_COLS = 'id,name,alias,dob,phone,status,gang_id,mugshot_url,lifecycle'

/** Stable person ordering: hits whose normalized name/alias/phone EXACTLY
 *  equals the normalized query first, then the search_persons rank order,
 *  then original position. Pure — exported for the ranking unit tests. */
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
  try {
    let rows: PersonRow[]
    if (!query) {
      rows = await list('persons', {
        select: PERSON_COLS, order: 'updated_at', ascending: false, limit: limit + OVERFETCH,
      }) as unknown as PersonRow[]
    } else {
      // Indexed, RLS-safe search_persons → hydrate the lite projection by id →
      // re-rank (exact matches first, then RPC rank).
      const res = await rpc('search_persons', { p_q: query, p_limit: limit + OVERFETCH })
      const ids = (res.data ?? []).map((h) => h.id)
      if (res.error || !ids.length) return []
      const order = new Map(ids.map((id, i) => [id, i] as const))
      const hydrated = await list('persons', { select: PERSON_COLS, in: { id: ids } }) as unknown as PersonRow[]
      rows = rankPersonRows(hydrated, order, query)
    }
    const live = rows.filter((r) => r.lifecycle !== 'merged')
    // Gang names for the sublabel — one bounded in:{id} lookup, best-effort.
    const gangIds = [...new Set(live.map((r) => r.gang_id).filter((x): x is string => !!x))]
    const gangName = new Map<string, string>()
    if (gangIds.length) {
      const gangs = await list('gangs', { select: 'id,name', in: { id: gangIds } })
        .then((r) => r as unknown as { id: string; name: string }[])
        .catch(() => [] as { id: string; name: string }[])
      for (const g of gangs) gangName.set(g.id, g.name)
    }
    return finish(live.map((p) => ({
      id: p.id,
      label: p.name || 'Person',
      sublabel: joinDots([p.dob, humanize(p.status), p.gang_id ? gangName.get(p.gang_id) : null]),
      thumbUrl: p.mugshot_url,
    })), opts)
  } catch { return [] }
}

/* ── Vehicles — ilike arm + exact-normalized-plate arm ──────────────────── */

interface VehicleRow { id: string; plate: string; model: string | null; color: string | null; owner_id: string | null }
const VEHICLE_COLS = 'id,plate,model,color,owner_id'

export async function searchVehicleHits(q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const query = q.trim()
  try {
    let rows: VehicleRow[]
    if (!query) {
      rows = await ilikeRows<VehicleRow>('vehicles', VEHICLE_COLS, ['plate'], '', limit + OVERFETCH)
    } else {
      const plain = await ilikeRows<VehicleRow>('vehicles', VEHICLE_COLS, ['plate', 'model', 'color'], query, limit + OVERFETCH)
        .catch(() => [] as VehicleRow[])
      // Exact-normalized-plate arm: ilike can't cross separator differences
      // ('ab-123' vs the stored 'AB123' and vice versa), so probe on the first
      // two normalized characters (a bounded candidate set — standard plate
      // formats keep them adjacent either way) and client-filter on
      // normPlate equality, mirroring the UNIQUE upper(plate) key.
      let exact: VehicleRow[] = []
      const np = normPlate(query)
      if (np) {
        const probe = ilikeAny(['plate'], np.slice(0, 2))
        if (probe) {
          const candidates = await list('vehicles', { select: VEHICLE_COLS, or: probe, limit: 50 })
            .then((r) => r as unknown as VehicleRow[])
            .catch(() => [] as VehicleRow[])
          exact = candidates.filter((v) => normPlate(v.plate) === np)
        }
      }
      rows = [...exact, ...plain] // finish() dedupes; exact plates rank first
    }
    // Owner names for the sublabel — one bounded in:{id} lookup, best-effort.
    const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter((x): x is string => !!x))]
    const ownerName = new Map<string, string>()
    if (ownerIds.length) {
      const owners = await list('persons', { select: 'id,name', in: { id: ownerIds } })
        .then((r) => r as unknown as { id: string; name: string }[])
        .catch(() => [] as { id: string; name: string }[])
      for (const o of owners) ownerName.set(o.id, o.name)
    }
    return finish(rows.map((v) => ({
      id: v.id,
      label: v.plate,
      sublabel: joinDots([v.model, v.color, v.owner_id ? ownerName.get(v.owner_id) : null]),
    })), opts)
  } catch { return [] }
}

/* ── Simple ilike-backed kinds ──────────────────────────────────────────── */

export async function searchGangHits(q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  try {
    type Row = { id: string; name: string; aliases: string | null; status: string | null; threat_level: string }
    const rows = await ilikeRows<Row>('gangs', 'id,name,aliases,status,threat_level', ['name', 'aliases'], q, limit + OVERFETCH)
    return finish(rows.map((g) => ({
      id: g.id,
      label: g.name,
      sublabel: joinDots([g.aliases ? `aka ${g.aliases}` : null, humanize(g.status), g.threat_level ? `Threat: ${humanize(g.threat_level)}` : null]),
    })), opts)
  } catch { return [] }
}

export async function searchPlaceHits(q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  try {
    type Row = { id: string; name: string; type: string; area: string | null }
    const rows = await ilikeRows<Row>('places', 'id,name,type,area', ['name', 'area'], q, limit + OVERFETCH)
    return finish(rows.map((p) => ({
      id: p.id,
      label: p.name,
      sublabel: joinDots([humanize(p.type), p.area]),
    })), opts)
  } catch { return [] }
}

export async function searchAccountHits(q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const query = q.trim()
  try {
    type Row = { id: string; platform: string; handle: string; display_name: string | null; lifecycle: string }
    const cols = 'id,platform,handle,display_name,lifecycle'
    const rows = await ilikeRows<Row>('accounts', cols, ['handle', 'display_name', 'platform'], query, limit + OVERFETCH)
    // Second arm on the normalized handle so '@CoolGuy' finds 'coolguy'
    // (handle_normalized is generated lower(btrim); the strip mirrors it).
    const nh = normHandle(query)
    let normalized: Row[] = []
    if (nh && nh !== query.toLowerCase()) {
      normalized = await ilikeRows<Row>('accounts', cols, ['handle'], nh, limit + OVERFETCH).catch(() => [] as Row[])
    }
    return finish([...rows, ...normalized]
      .filter((a) => a.lifecycle !== 'merged')
      .map((a) => ({
        id: a.id,
        label: `@${a.handle}`,
        sublabel: joinDots([a.platform, a.display_name]),
      })), opts)
  } catch { return [] }
}

export async function searchCaseHits(q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  try {
    type Row = { id: string; case_number: string; title: string | null; status: string; bureau: string }
    const rows = await ilikeRows<Row>('cases', 'id,case_number,title,status,bureau', ['case_number', 'title'], q, limit + OVERFETCH)
    return finish(rows.map((c) => ({
      id: c.id,
      label: c.case_number,
      sublabel: joinDots([c.title, humanize(c.status), noDash(bureauShort(c.bureau))]),
    })), opts)
  } catch { return [] }
}

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

/* ── Narcotics — typed RPC (search_narcotics) ───────────────────────────── */

export async function searchNarcoticHits(q: string, opts?: EntitySearchOptions): Promise<EntityHit[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const query = q.trim()
  try {
    if (!query) {
      type Row = { id: string; name: string; category: string; status: string; restricted: boolean }
      const rows = await list('narcotics', {
        select: 'id,name,category,status,restricted', is: { merged_into: null },
        order: 'updated_at', ascending: false, limit: limit + OVERFETCH,
      }) as unknown as Row[]
      return finish(rows.map((n) => ({
        id: n.id,
        label: n.name,
        sublabel: joinDots([humanize(n.category), humanize(n.status)]),
        meta: { restricted: n.restricted ? 'true' : 'false' },
      })), opts)
    }
    const res = await rpc('search_narcotics', { p_query: query, p_limit: limit + OVERFETCH })
    if (res.error) return []
    return finish((res.data ?? []).map((n) => ({
      id: n.id,
      label: n.name,
      sublabel: joinDots([humanize(n.category), humanize(n.status)]),
      meta: { restricted: n.restricted ? 'true' : 'false' },
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

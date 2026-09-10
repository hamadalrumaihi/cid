import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Database, Tables, TablesInsert, TablesUpdate } from './database.types'

type TableName = keyof Database['public']['Tables']

export type DbError = { message: string; code?: string; details?: string }
export type MutationResult<T> = { data: T | null; error: DbError | null }

/** Contract carried over from the vanilla data layer:
 *  - list() THROWS on error → callers try/catch (or use the query hooks).
 *  - insert/update/remove RETURN { error } → callers check res.error.
 *  Server-authoritative flows (finalize, sign-off, roster) go through rpc()
 *  ONLY — never reimplement them client-side.
 *
 *  Implementation note: supabase-js's generated generics can't be threaded
 *  through a table-name-generic wrapper (they collapse to `never`), so the
 *  builder is used untyped INSIDE this module only. The exported signatures
 *  are fully typed against database.types.ts — this file is the single
 *  allowed any-boundary. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = () => supabase() as unknown as SupabaseClient<any, 'public', any>

const asDbError = (error: { message: string; code?: string; details?: string } | null): DbError | null =>
  error ? { message: error.message, code: error.code, details: error.details } : null

/** A definer RPC that refuses on authority raises SQLSTATE P0403 with
 *  {action, kind, id, reason} in the error DETAIL (private.perm_raise). The
 *  refusal itself rolls the server's audit row back with the statement, so
 *  the client acknowledges it once through perm_denied_ack — the server
 *  re-checks the claim before recording it. Fire-and-forget. */
function ackDenied(error: { code?: string; details?: string } | null): void {
  if (!error || error.code !== 'P0403' || !error.details) return
  try {
    const d = JSON.parse(error.details) as { action?: string; kind?: string; id?: string | null; reason?: string }
    if (!d.action || !d.kind) return
    void raw().rpc('perm_denied_ack', { p_action: d.action, p_kind: d.kind, p_id: d.id ?? null, p_reason: d.reason ?? null })
      .then(() => undefined, () => undefined)
  } catch { /* a malformed detail is not worth a second error */ }
}

export interface ListOptions<T extends TableName> {
  /** Column projection (e.g. Operations picker's slim case rows). Omitting
   *  selects '*'. A projection returns Partial rows — absent columns are
   *  simply missing, so callers narrow what they read. */
  select?: string
  order?: keyof Tables<T> & string
  ascending?: boolean
  /** Postgres NULLS FIRST on the order column (case_tasks due-date sort). */
  nullsFirst?: boolean
  eq?: Partial<Record<keyof Tables<T> & string, unknown>>
  /** SQL IS match (null / boolean) — e.g. hide archived media rows with
   *  `is: { archived_at: null }` (PostgREST `eq.null` never matches NULL). */
  is?: Partial<Record<keyof Tables<T> & string, null | boolean>>
  in?: Partial<Record<keyof Tables<T> & string, readonly unknown[]>>
  /** PostgREST or-disjunction for bounded typed pickers — build it with
   *  ilikeAny() so user input can never inject extra conditions. */
  or?: string
  limit?: number
  /** Soft-deletable registries (SOFT_DELETE_KIND) list live rows only by
   *  default; the Trash passes true to read what the caller may restore. */
  includeDeleted?: boolean
}

/** Tables that soft-delete (migrations 20261007120000 …120100 for the
 *  registries, 20261008120001 …120100 for the case tables): the value is
 *  the `kind` the soft_delete / restore_record RPCs take. list() filters
 *  these to live rows, remove() / deleteRecord() (lib/deleteRecord) route
 *  their deletes to the RPC (a client DELETE is refused by grants), and the
 *  Undo toast / the Trash call restore_record. */
export const SOFT_DELETE_KIND = {
  persons: 'person', vehicles: 'vehicle', gangs: 'gang', places: 'place', accounts: 'account',
  indicators: 'indicator', narcotics: 'narcotic', operations: 'operation', trackers: 'tracker',
  gang_members: 'gang_member', gang_turf: 'gang_turf', person_places: 'person_place',
  person_vehicles: 'person_vehicle', person_relationships: 'person_relationship', account_links: 'account_link',
  cases: 'case', reports: 'report', media: 'media', evidence: 'evidence', case_tasks: 'case_task',
  case_messages: 'case_message', case_intel_links: 'case_intel_link', case_blockers: 'case_blocker',
  rico_cases: 'rico_case', predicate_acts: 'predicate_act',
  // Phase 3 (20261021120000 / 20261022120000): authored case notes and
  // case-to-case links soft-delete like the other case children.
  case_notes: 'case_note', case_links: 'case_link',
} as const satisfies Partial<Record<TableName, string>>
export type SoftDeleteTable = keyof typeof SOFT_DELETE_KIND
/** Kinds whose soft_delete requires a reason (the parent records and the
 *  case artefacts; link rows, tasks, messages and blockers do not). The
 *  delete helper prompts for it; the Trash offers it on restore. */
export const REASON_REQUIRED: ReadonlySet<string> = new Set([
  'person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker',
  'case', 'report', 'media', 'evidence', 'rico_case',
])
const softKindOf = (table: string): string | null => (SOFT_DELETE_KIND as Record<string, string>)[table] ?? null

/** Build a PostgREST `or()` disjunction of contains-matches over `cols`
 *  (`col.ilike.*term*`). PostgREST syntax characters are stripped from the
 *  term so it can never add conditions or wildcards of its own. Returns null
 *  for a blank term (callers then list the most recent rows instead). */
export function ilikeAny(cols: readonly string[], term: string): string | null {
  const safe = term.replace(/[,()%_\\*]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!safe) return null
  return cols.map((c) => `${c}.ilike.*${safe}*`).join(',')
}

export async function list<T extends TableName>(table: T, opts: ListOptions<T> = {}): Promise<Tables<T>[]> {
  let q = raw().from(table).select(opts.select ?? '*')
  if (softKindOf(table) && !opts.includeDeleted) q = q.is('deleted_at', null)
  if (opts.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v)
  if (opts.is) for (const [k, v] of Object.entries(opts.is)) q = q.is(k, v as null)
  if (opts.in) for (const [k, v] of Object.entries(opts.in)) q = q.in(k, (v ?? []) as unknown[])
  if (opts.or) q = q.or(opts.or)
  if (opts.order) {
    const o: { ascending: boolean; nullsFirst?: boolean } = { ascending: opts.ascending ?? true }
    if (opts.nullsFirst !== undefined) o.nullsFirst = opts.nullsFirst
    q = q.order(opts.order, o)
  }
  if (opts.limit) q = q.limit(opts.limit)
  const { data, error } = await q
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return (data ?? []) as Tables<T>[]
}

/** Row count without fetching rows (HEAD + count=exact). THROWS like list().
 *  RLS applies — the caller sees the count of rows THEY can see. Powers the
 *  Owner Portal statistics; cheap even on the larger tables. Optional
 *  `filters.eq` matches list()'s eq handling, so bounded per-parent metric
 *  counts (e.g. open case_blockers for one case) never fetch rows. */
export async function countRows<T extends TableName>(
  table: T,
  filters?: {
    eq?: Partial<Record<keyof Tables<T> & string, unknown>>
    /** SQL IS match — e.g. `is: { archived_at: null }` for live-only counts. */
    is?: Partial<Record<keyof Tables<T> & string, null | boolean>>
    includeDeleted?: boolean
  },
): Promise<number> {
  let q = raw().from(table).select('*', { count: 'exact', head: true })
  if (softKindOf(table) && !filters?.includeDeleted) q = q.is('deleted_at', null)
  if (filters?.eq) for (const [k, v] of Object.entries(filters.eq)) q = q.eq(k, v)
  if (filters?.is) for (const [k, v] of Object.entries(filters.is)) q = q.is(k, v as null)
  const { count, error } = await q
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return count ?? 0
}

/** `select` narrows the returning projection — required for tables with
 *  column-grant-revoked fields (membership_requests.internal_decision_note),
 *  where the default `select('*')` returning clause 403s for clients. */
export async function insert<T extends TableName>(table: T, values: TablesInsert<T> | TablesInsert<T>[], select = '*'): Promise<MutationResult<Tables<T>[]>> {
  const { data, error } = await raw().from(table).insert(values).select(select)
  return { data: data as unknown as Tables<T>[] | null, error: asDbError(error) }
}

export async function update<T extends TableName>(table: T, id: string, patch: TablesUpdate<T>, select = '*'): Promise<MutationResult<Tables<T>[]>> {
  const { data, error } = await raw().from(table).update(patch).eq('id', id).select(select)
  return { data: data as unknown as Tables<T>[] | null, error: asDbError(error) }
}

/** Conditional update — powers compare-and-swap writes (stale-case escalation
 *  stamps) and updates keyed by non-id columns. `is` matches SQL IS (null
 *  checks); `eq` matches equality. Returns the updated rows: an empty array
 *  with no error means the predicate matched nothing (a lost CAS race). */
export async function updateWhere<T extends TableName>(
  table: T,
  match: { eq?: Partial<Record<keyof Tables<T> & string, unknown>>; is?: Partial<Record<keyof Tables<T> & string, null | boolean>> },
  patch: TablesUpdate<T>,
): Promise<MutationResult<Tables<T>[]>> {
  let q = raw().from(table).update(patch)
  if (match.eq) for (const [k, v] of Object.entries(match.eq)) q = q.eq(k, v)
  if (match.is) for (const [k, v] of Object.entries(match.is)) q = q.is(k, v as null)
  const { data, error } = await q.select()
  return { data: data as Tables<T>[] | null, error: asDbError(error) }
}

/** Update WITHOUT a returning select. Needed for profiles: the email column
 *  is granted to command only, so update().select() would be DENIED for a
 *  member saving their own row (vanilla worked because its update never
 *  returned columns). Use for any table where reading back can be narrower
 *  than writing. */
export async function updateNoSelect<T extends TableName>(table: T, id: string, patch: TablesUpdate<T>): Promise<MutationResult<null>> {
  const { error } = await raw().from(table).update(patch).eq('id', id)
  return { data: null, error: asDbError(error) }
}

/** Insert-or-update on a conflict target (e.g. a composite key like
 *  'user_id,document_id'). Returns { error } like insert(). `select` narrows
 *  the returning projection the same way insert()'s does. The former ad-hoc
 *  upserts (sops DocReader's update-then-insert fallback, useLibrary's raw
 *  client call) route through this. */
export async function upsert<T extends TableName>(
  table: T,
  values: TablesInsert<T> | TablesInsert<T>[],
  onConflict: string,
  select = '*',
): Promise<MutationResult<Tables<T>[]>> {
  const { data, error } = await raw().from(table).upsert(values, { onConflict }).select(select)
  return { data: data as unknown as Tables<T>[] | null, error: asDbError(error) }
}

export async function remove<T extends TableName>(table: T, id: string): Promise<MutationResult<null>> {
  if (softKindOf(table)) {
    const r = await softDeleteRecord(table as SoftDeleteTable, id)
    return { data: null, error: r.error }
  }
  const { error } = await raw().from(table).delete().eq('id', id)
  return { data: null, error: asDbError(error) }
}

/** The soft_delete / restore_record RPCs refuse by RETURNING {ok:false, code}
 *  (never by raising) so their PERMISSION_DENIED audit row commits; this maps
 *  that shape onto the { error } contract every mutation helper returns. */
export type SoftDeleteResult = { ok: boolean; code?: string; message?: string; cascaded?: Record<string, number>; restored?: Record<string, number> }
const mapSoftResult = (data: unknown, error: DbError | null): MutationResult<SoftDeleteResult> => {
  if (error) return { data: null, error }
  const r = (data ?? {}) as SoftDeleteResult
  if (!r.ok) return { data: r, error: { message: r.message || 'not permitted', code: r.code } }
  return { data: r, error: null }
}

/** Soft-delete one registry row (reason required for the parent kinds:
 *  persons, vehicles, gangs, places, accounts, indicators, narcotics,
 *  operations, trackers). Cascades to the row's exclusive link rows. */
export async function softDeleteRecord(table: SoftDeleteTable, id: string, reason?: string | null): Promise<MutationResult<SoftDeleteResult>> {
  const { data, error } = await raw().rpc('soft_delete', { p_kind: SOFT_DELETE_KIND[table], p_id: id, p_reason: reason ?? null })
  return mapSoftResult(data, asDbError(error))
}

/** Restore a soft-deleted registry row (a parent brings its batch back). */
export async function restoreRecord(table: SoftDeleteTable, id: string, reason?: string | null): Promise<MutationResult<SoftDeleteResult>> {
  const { data, error } = await raw().rpc('restore_record', { p_kind: SOFT_DELETE_KIND[table], p_id: id, p_reason: reason ?? null })
  return mapSoftResult(data, asDbError(error))
}

/** Conditional delete for rows keyed by non-id columns (composite-key link
 *  rows). GUARD: throws if the predicate is empty — an unscoped DELETE must
 *  be impossible to express through this helper. Returns the deleted rows
 *  ({ data: [] } with no error = the predicate matched nothing). */
export async function removeWhere<T extends TableName>(
  table: T,
  where: { eq?: Partial<Record<keyof Tables<T> & string, unknown>>; is?: Partial<Record<keyof Tables<T> & string, null | boolean>> },
): Promise<MutationResult<Tables<T>[]>> {
  const eqEntries = Object.entries(where.eq ?? {})
  const isEntries = Object.entries(where.is ?? {})
  if (!eqEntries.length && !isEntries.length) {
    throw new Error('removeWhere: refusing an unscoped delete — pass at least one predicate')
  }
  let q = raw().from(table).delete()
  for (const [k, v] of eqEntries) q = q.eq(k, v)
  for (const [k, v] of isEntries) q = q.is(k, v as null)
  const { data, error } = await q.select()
  return { data: data as Tables<T>[] | null, error: asDbError(error) }
}

type Fn = keyof Database['public']['Functions']
export async function rpc<F extends Fn>(fn: F, args: Database['public']['Functions'][F]['Args']): Promise<MutationResult<Database['public']['Functions'][F]['Returns']>> {
  const { data, error } = await raw().rpc(fn, args)
  if (fn !== 'perm_denied_ack') ackDenied(error)
  return { data: data as Database['public']['Functions'][F]['Returns'], error: asDbError(error) }
}

/** Edge-function invoke (discord-notify). Fire-and-forget friendly: resolves
 *  { error } and never throws, so a dead function can't break the caller. */
export async function invokeFunction(name: string, body: unknown): Promise<{ error: DbError | null }> {
  try {
    const { error } = await raw().functions.invoke(name, { body: body as Record<string, unknown> })
    return { error: error ? { message: error.message } : null }
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : String(e) } }
  }
}

/** One silent retry on transient (network-blip) failures — vanilla withRetry
 *  (core.js:1065). Only for reads; mutations must never auto-repeat. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 2, delay = 600): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, delay * (i + 1))) }
  }
  throw last
}

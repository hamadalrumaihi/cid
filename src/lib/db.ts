import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Database, Tables, TablesInsert, TablesUpdate } from './database.types'
import { uiConfirm } from '@/components/ui/dialog'
import { toast, undoToast } from './toast'

type TableName = keyof Database['public']['Tables']

export type DbError = { message: string; code?: string }
export type MutationResult<T> = { data: T | null; error: DbError | null }

/** Contract carried over from the vanilla data layer (spec §3.2):
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

const asDbError = (error: { message: string; code?: string } | null): DbError | null =>
  error ? { message: error.message, code: error.code } : null

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
  in?: Partial<Record<keyof Tables<T> & string, readonly unknown[]>>
  limit?: number
}

export async function list<T extends TableName>(table: T, opts: ListOptions<T> = {}): Promise<Tables<T>[]> {
  let q = raw().from(table).select(opts.select ?? '*')
  if (opts.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v)
  if (opts.in) for (const [k, v] of Object.entries(opts.in)) q = q.in(k, (v ?? []) as unknown[])
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
  filters?: { eq?: Partial<Record<keyof Tables<T> & string, unknown>> },
): Promise<number> {
  let q = raw().from(table).select('*', { count: 'exact', head: true })
  if (filters?.eq) for (const [k, v] of Object.entries(filters.eq)) q = q.eq(k, v)
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

export async function remove<T extends TableName>(table: T, id: string): Promise<MutationResult<null>> {
  const { error } = await raw().from(table).delete().eq('id', id)
  return { data: null, error: asDbError(error) }
}

type Fn = keyof Database['public']['Functions']
export async function rpc<F extends Fn>(fn: F, args: Database['public']['Functions'][F]['Args']): Promise<MutationResult<Database['public']['Functions'][F]['Returns']>> {
  const { data, error } = await raw().rpc(fn, args)
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

/* ---- deleteWithUndo (vanilla core.js:484-533) -----------------------------
 * Delete a row (or rows) with a 6s "Undo" toast that re-inserts them,
 * preserving ids so references survive. For ON DELETE CASCADE children pass
 * opts.children ([{table, column}]) — snapshotted before the delete and
 * re-inserted (after the parents) on undo. opts.setNullRefs snapshots rows
 * whose FK Postgres nulls on delete, and re-applies the value on undo. */
export interface DeleteWithUndoOptions {
  label?: string
  /** Callers that already showed their own uiConfirm pass true. */
  noConfirm?: boolean
  /** Override the confirm body with an intelligent message that names exactly
   *  what is being removed and warns about related records. Falls back to the
   *  generic "Delete {label}?" phrasing. */
  confirmMessage?: string
  /** Confirm dialog heading (e.g. "Delete task"). */
  confirmTitle?: string
  /** Confirm button label (e.g. "Delete task" instead of the generic "Delete"). */
  confirmText?: string
  after?: () => void
  children?: { table: TableName; column: string }[]
  setNullRefs?: { table: TableName; column: string }[]
}

export async function deleteWithUndo<T extends TableName>(
  table: T,
  rows: Tables<T> | Tables<T>[],
  opts: DeleteWithUndoOptions = {},
): Promise<boolean> {
  const listRows = (Array.isArray(rows) ? rows.slice() : [rows]) as (Tables<T> & { id: string })[]
  if (!listRows.length) return false
  if (!opts.noConfirm && !(await uiConfirm(
    opts.confirmMessage || `Delete ${opts.label || 'this record'}? You can undo this for a few seconds.`,
    { title: opts.confirmTitle, confirmText: opts.confirmText || 'Delete' },
  ))) return false
  const ids = listRows.map((r) => r.id)

  // Snapshot cascade children BEFORE the delete removes them. If a snapshot
  // fails, ABORT — deleting anyway would cascade-wipe children we could no
  // longer restore.
  const childSnap: { table: TableName; rows: Record<string, unknown>[] }[] = []
  for (const spec of opts.children ?? []) {
    const r = await raw().from(spec.table).select('*').in(spec.column, ids)
    if (r.error) { toast(`Delete aborted — could not snapshot related ${spec.table} for undo.`, 'danger'); return false }
    childSnap.push({ table: spec.table, rows: (r.data ?? []) as Record<string, unknown>[] })
  }
  const refSnap: { table: TableName; column: string; rows: { id: string; [k: string]: unknown }[] }[] = []
  for (const spec of opts.setNullRefs ?? []) {
    const r = await raw().from(spec.table).select(`id,${spec.column}`).in(spec.column, ids)
    if (r.error) { toast(`Delete aborted — could not snapshot ${spec.table} references for undo.`, 'danger'); return false }
    refSnap.push({ table: spec.table, column: spec.column, rows: (r.data ?? []) as unknown as { id: string }[] })
  }

  const deleted: (Tables<T> & { id: string })[] = []
  let ok = 0, fail = 0
  for (const row of listRows) {
    const r = await remove(table, row.id)
    if (r.error) fail++
    else { ok++; deleted.push(row) }
  }
  opts.after?.()
  const one = listRows.length === 1
  const noun = opts.label || (one ? 'Item' : `${listRows.length} items`)
  if (fail && !ok) { toast(`${noun} delete failed`, 'danger'); return false }

  undoToast(`${one ? noun + ' deleted' : ok + ' deleted'}${fail ? ` · ${fail} failed` : ''}`, () => {
    void (async () => {
      // Re-insert ONLY the parents that were actually deleted (never-deleted
      // rows would duplicate-key), then their snapshotted children.
      let rok = 0, rfail = 0
      for (const row of deleted) {
        const r = await insert(table, row as unknown as TablesInsert<T>)
        if (r.error) rfail++
        else rok++
      }
      let ckid = 0, cfail = 0
      for (const snap of childSnap) for (const kid of snap.rows) {
        const r = await raw().from(snap.table).insert(kid)
        if (r.error) cfail++
        else ckid++
      }
      // Re-apply nulled-out FK references now that the parent exists again.
      for (const ref of refSnap) for (const rr of ref.rows) {
        const r = await raw().from(ref.table).update({ [ref.column]: rr[ref.column] }).eq('id', rr.id)
        if (r.error) cfail++
        else ckid++
      }
      const allOk = rfail === 0 && cfail === 0
      toast(
        allOk
          ? (one ? `${noun} restored` : `${rok} restored`)
          : `Restored ${rok} of ${deleted.length}${childSnap.length ? ` (+${ckid} related${cfail ? `, ${cfail} failed` : ''})` : ''}`,
        rok || ckid ? (allOk ? 'success' : 'warn') : 'danger',
      )
      opts.after?.()
    })()
  })
  return true
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

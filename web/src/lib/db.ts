import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Database, Tables, TablesInsert, TablesUpdate } from './database.types'

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

export interface ListOptions<T extends TableName> {
  order?: keyof Tables<T> & string
  ascending?: boolean
  eq?: Partial<Record<keyof Tables<T> & string, unknown>>
  limit?: number
}

export async function list<T extends TableName>(table: T, opts: ListOptions<T> = {}): Promise<Tables<T>[]> {
  let q = raw().from(table).select('*')
  if (opts.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v)
  if (opts.order) q = q.order(opts.order, { ascending: opts.ascending ?? true })
  if (opts.limit) q = q.limit(opts.limit)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as Tables<T>[]
}

export async function insert<T extends TableName>(table: T, values: TablesInsert<T> | TablesInsert<T>[]): Promise<MutationResult<Tables<T>[]>> {
  const { data, error } = await raw().from(table).insert(values).select()
  return { data: data as Tables<T>[] | null, error: error ? { message: error.message, code: error.code } : null }
}

export async function update<T extends TableName>(table: T, id: string, patch: TablesUpdate<T>): Promise<MutationResult<Tables<T>[]>> {
  const { data, error } = await raw().from(table).update(patch).eq('id', id).select()
  return { data: data as Tables<T>[] | null, error: error ? { message: error.message, code: error.code } : null }
}

export async function remove<T extends TableName>(table: T, id: string): Promise<MutationResult<null>> {
  const { error } = await raw().from(table).delete().eq('id', id)
  return { data: null, error: error ? { message: error.message, code: error.code } : null }
}

type Fn = keyof Database['public']['Functions']
export async function rpc<F extends Fn>(fn: F, args: Database['public']['Functions'][F]['Args']): Promise<MutationResult<Database['public']['Functions'][F]['Returns']>> {
  const { data, error } = await raw().rpc(fn, args)
  return { data: data as Database['public']['Functions'][F]['Returns'], error: error ? { message: error.message, code: error.code } : null }
}

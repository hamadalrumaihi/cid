/** Entity-layer client API (Portal Improvements plan, Phase 2).
 *
 *  Thin, typed wrappers over the Phase 2 RPCs. Every function returns the
 *  server's answer as-is: reads come back as arrays (RLS already filtered —
 *  an SIB-hidden record, a sealed case, a merged tombstone are simply not
 *  there), writes come back as `{ ok, code?, message?, … }` refusal-or-
 *  result objects (the RPCs never raise for an authority refusal; they
 *  write PERMISSION_DENIED and answer `{ ok: false, code: 'denied' }`).
 *  Nothing here decides permission — `usePermissions` / `can_record` do
 *  the cosmetic gating, the server the real one. */

import { list, rpc, type DbError } from '../db'
import type { Database, Json } from '../database.types'
import type { EntityHit } from '../entitySearch'
import type { CrossrefKind, MergeKind, SuggestKind } from './kinds'

type Fns = Database['public']['Functions']

/* ── Result shapes ────────────────────────────────────────────────────────── */

export interface SuggestRow {
  id: string
  /** The table the hit lives in: for kind 'phone' this is 'person' or 'indicator'. */
  kind: string
  label: string
  sublabel: string | null
  score: number
  exact: boolean
}

export type DuplicateStrength = 'strong' | 'soft'
export interface DuplicateRow {
  id: string
  label: string
  sublabel: string | null
  /** phone | name | name+dob | alias | plate | handle | value | case_number | name+area | name~ | plate~ | handle~ | title~ */
  signal: string
  strength: DuplicateStrength
  score: number
}

export interface CrossrefRow {
  case_id: string
  case_number: string
  title: string | null
  bureau: string
  /** link | surveillance | report | legal | media | mdt | indicator | person */
  via: string
  detail: string | null
  observed_at: string | null
}

export interface Refusal { ok: false; code: string; message?: string; current?: string | null; hold_cases?: string[] }
export type RpcAnswer<T extends object> = ({ ok: true } & T) | Refusal
export type ApiResult<T extends object> = { data: RpcAnswer<T> | null; error: DbError | null }

export interface MergeVictimManifest {
  id: string
  label: string
  repointed: Record<string, number>
  repointed_ids: Record<string, string[]>
  dropped: { table: string; why: string; row: Record<string, unknown> }[]
  scalar_fill: Record<string, { from: unknown; to: unknown }>
  notes_from: string | null
  tombstone: 'lifecycle' | 'status' | 'soft_delete'
}
export interface MergeManifest {
  survivor: { id: string; label: string }
  victims: MergeVictimManifest[]
  added_aliases: string[]
}
export interface MergeResult { merge_id: string; kind: MergeKind; survivor_id: string; victim_ids: string[]; manifest: MergeManifest }
export interface MergePreviewResult { kind: MergeKind; manifest: MergeManifest }
export interface UnmergeResult { merge_id: string; kind: MergeKind; survivor_id: string; restored: number }
export interface SuggestUpdateResult { applied: boolean; suggestion_id: string; from: string | null; to: string | null; observation_id?: string }
export interface DecideResult { id: string; accepted: boolean; changed: boolean }
export interface ReconcileResult { id: string; resolution: 'link' | 'merge' | 'dismiss'; merge_id: string | null }

/* ── Duplicate payload (entity_duplicates) ────────────────────────────────── */

export interface DuplicatePayload {
  name?: string | null
  alias?: string | null
  dob?: string | null
  phone?: string | null
  plate?: string | null
  area?: string | null
  platform?: string | null
  handle?: string | null
  kind?: string | null
  value?: string | null
  case_number?: string | null
  title?: string | null
  /** The record being edited — omitted from the answer. */
  exclude_id?: string | null
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

/** `entity_suggest`: ≥ 2 characters, ≤ 50 hits, exact-normalized hits first.
 *  Errors resolve to [] — a suggestion box never throws at the officer. */
export async function suggestEntities(kind: SuggestKind, q: string, limit = 20): Promise<SuggestRow[]> {
  const term = q.trim()
  if (term.length < 2) return []
  const res = await rpc('entity_suggest', { p_kind: kind, p_q: term, p_limit: Math.min(Math.max(limit, 1), 50) })
  if (res.error || !res.data) return []
  return (res.data as Fns['entity_suggest']['Returns']).map((r) => ({ ...r, sublabel: r.sublabel ?? null }))
}

/** A suggest row as the picker's EntityHit (kind kept in meta). */
export function toHit(r: SuggestRow): EntityHit {
  return { id: r.id, label: r.label, sublabel: r.sublabel ?? undefined, meta: { kind: r.kind, exact: r.exact ? '1' : null } }
}

/** `entity_duplicates` for a record that is not saved yet (or is being
 *  edited: pass exclude_id). Strong first. Errors resolve to []. */
export async function findDuplicates(kind: SuggestKind, payload: DuplicatePayload): Promise<DuplicateRow[]> {
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(payload)) {
    if (v != null && String(v).trim() !== '') clean[k] = String(v).trim()
  }
  if (Object.keys(clean).filter((k) => k !== 'exclude_id').length === 0) return []
  const res = await rpc('entity_duplicates', { p_kind: kind, p_payload: clean as Json })
  if (res.error || !res.data) return []
  return (res.data as Fns['entity_duplicates']['Returns']).map((r) => ({
    ...r, sublabel: r.sublabel ?? null, strength: r.strength === 'strong' ? 'strong' : 'soft',
  }))
}

/** `entity_crossref`: the cases a record touches, bounded, under RLS.
 *  For kind 'phone' pass the number as `q` (id is ignored). */
export async function crossref(kind: CrossrefKind, id: string | null, opts: { limit?: number; q?: string } = {}): Promise<CrossrefRow[]> {
  const args: Fns['entity_crossref']['Args'] = { p_kind: kind, p_limit: opts.limit ?? 50 }
  if (id) args.p_id = id
  if (opts.q) args.p_q = opts.q
  const res = await rpc('entity_crossref', args)
  if (res.error || !res.data) return []
  return (res.data as Fns['entity_crossref']['Returns']).map((r) => ({ ...r, title: r.title ?? null, detail: r.detail ?? null, observed_at: r.observed_at ?? null }))
}

/** Merge ledger rows for a survivor (newest first; RLS follows the survivor). */
export function listMergeHistory(kind: MergeKind, survivorId: string) {
  return list('entity_merges', { eq: { kind, survivor_id: survivorId }, order: 'created_at', ascending: false, limit: 50 })
}

/** Pending (or all) suggestions for a record, newest first. */
export function listSuggestions(kind: MergeKind, refId: string, pendingOnly = true) {
  return list('entity_update_suggestions', {
    eq: pendingOnly ? { kind, ref_id: refId, status: 'pending' } : { kind, ref_id: refId },
    order: 'created_at', ascending: false, limit: 100,
  })
}

/** Observations recorded for a record across the cases the caller can read. */
export function listObservations(kind: MergeKind, refId: string) {
  return list('entity_field_observations', { eq: { kind, ref_id: refId }, order: 'created_at', ascending: false, limit: 200 })
}

/** The open SIB reconcile queue (RLS: SIB agents only; others get []). */
export function listReconcileQueue(includeResolved = false) {
  return list('siu_reconcile_queue', includeResolved
    ? { order: 'created_at', ascending: false, limit: 200 }
    : { is: { resolved_at: null }, order: 'created_at', ascending: false, limit: 200 })
}

/** Whether a ledger row can still be reversed (30-day window, not reversed). */
export function unmergeWindowOpen(row: { created_at: string; reversed_at: string | null }, now = Date.now()): boolean {
  if (row.reversed_at) return false
  return now - new Date(row.created_at).getTime() < 30 * 24 * 60 * 60 * 1000
}

/* ── Writes ───────────────────────────────────────────────────────────────── */

function answer<T extends object>(res: { data: Json | null; error: DbError | null }): ApiResult<T> {
  if (res.error) return { data: null, error: res.error }
  const d = res.data as unknown
  if (!d || typeof d !== 'object' || !('ok' in d)) return { data: null, error: { message: 'unexpected answer from the server' } }
  return { data: d as RpcAnswer<T>, error: null }
}

export async function previewMerge(kind: MergeKind, survivorId: string, victimIds: string[]): Promise<ApiResult<MergePreviewResult>> {
  return answer<MergePreviewResult>(await rpc('entity_merge_preview', { p_kind: kind, p_survivor: survivorId, p_victims: victimIds }))
}

export async function mergeEntities(kind: MergeKind, survivorId: string, victimIds: string[], reason: string): Promise<ApiResult<MergeResult>> {
  return answer<MergeResult>(await rpc('entity_merge', { p_kind: kind, p_survivor: survivorId, p_victims: victimIds, p_reason: reason }))
}

export async function unmergeEntities(mergeId: string, reason: string): Promise<ApiResult<UnmergeResult>> {
  return answer<UnmergeResult>(await rpc('entity_unmerge', { p_merge_id: mergeId, p_reason: reason }))
}

/** `entity_suggest_update`: SrDet+ applies now (pass expectedCurrent for the
 *  TOCTOU check → code 'stale' with `current`), a Detective queues. */
export async function suggestUpdate(
  kind: MergeKind, id: string, field: string, value: string | null, reason: string,
  opts: { expectedCurrent?: string | null; observationId?: string | null } = {},
): Promise<ApiResult<SuggestUpdateResult>> {
  const args: Fns['entity_suggest_update']['Args'] = { p_kind: kind, p_id: id, p_field: field, p_value: value ?? '', p_reason: reason }
  if (opts.expectedCurrent !== undefined && opts.expectedCurrent !== null) args.p_expected_current = opts.expectedCurrent
  if (opts.observationId) args.p_observation_id = opts.observationId
  return answer<SuggestUpdateResult>(await rpc('entity_suggest_update', args))
}

export async function decideSuggestion(id: string, accept: boolean, note?: string | null): Promise<ApiResult<DecideResult>> {
  const args: Fns['entity_suggestion_decide']['Args'] = { p_id: id, p_accept: accept }
  if (note) args.p_note = note
  return answer<DecideResult>(await rpc('entity_suggestion_decide', args))
}

export async function withdrawSuggestion(id: string): Promise<ApiResult<{ id: string }>> {
  return answer<{ id: string }>(await rpc('entity_suggestion_withdraw', { p_id: id }))
}

export async function promoteObservation(id: string, reason: string): Promise<ApiResult<SuggestUpdateResult>> {
  return answer<SuggestUpdateResult>(await rpc('promote_observation', { p_id: id, p_reason: reason }))
}

/** SIB only: link / dismiss (any agent), merge (SIB command; reason required). */
export async function resolveReconcile(id: string, resolution: 'link' | 'merge' | 'dismiss', note?: string | null): Promise<ApiResult<ReconcileResult>> {
  const args: Fns['siu_reconcile_resolve']['Args'] = { p_id: id, p_resolution: resolution }
  if (note) args.p_note = note
  return answer<ReconcileResult>(await rpc('siu_reconcile_resolve', args))
}

/** The user-facing sentence for a refusal (codes are the server's). */
export function refusalText(r: Refusal | null | undefined, fallback = 'The server refused this action.'): string {
  if (!r) return fallback
  if (r.message) return r.message
  switch (r.code) {
    case 'denied': return 'You do not have the authority for this.'
    case 'reason_required': return 'A reason is required.'
    case 'stale': return 'The record changed since you looked.'
    case 'held': return 'A linked case is under an active legal hold.'
    case 'already_merged': return 'That record is already merged.'
    case 'window_closed': return 'A merge can only be reversed within 30 days.'
    default: return fallback
  }
}

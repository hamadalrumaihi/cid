/** Field-level version history — the client mirror of the server's
 *  record_versions rules (migration 20261011120000, P1-05).
 *
 *  The database is the authority: private.version_row() writes every
 *  version and coalesces same-actor bursts inside COALESCE_WINDOW_MS; this
 *  module only reads what came back so a history panel, a diff, and the
 *  vitest pin of the coalescing rule share one vocabulary. Nothing here
 *  decides access — record_versions is read through the parent's SELECT
 *  policy and restore_version re-checks edit authority server-side. */

export const COALESCE_WINDOW_MS = 5 * 60 * 1000

export interface VersionRow {
  version_no: number
  actor_id: string | null
  old: Record<string, unknown>
  new: Record<string, unknown>
  changed_fields: string[]
  reason: string | null
  source: 'edit' | 'restore' | string
  created_at: string
  updated_at: string
}

export interface FieldChange { field: string; from: unknown; to: unknown }

/** The changes a version records, one entry per changed field, in the
 *  server's (alphabetical) order. */
export function versionChanges(v: Pick<VersionRow, 'old' | 'new' | 'changed_fields'>): FieldChange[] {
  return v.changed_fields.map((field) => ({ field, from: v.old[field] ?? null, to: v.new[field] ?? null }))
}

/** Would the server fold `next` into `prev`? Mirrors private.version_row():
 *  same actor (null counts as the same), both plain edits, and `next`
 *  arriving within the window of `prev`'s LAST update. A restore never
 *  coalesces in either direction. */
export function wouldCoalesce(
  prev: Pick<VersionRow, 'actor_id' | 'source' | 'updated_at'>,
  next: { actor_id: string | null; source: string; at: string },
): boolean {
  if (prev.source !== 'edit' || next.source !== 'edit') return false
  if ((prev.actor_id ?? null) !== (next.actor_id ?? null)) return false
  const gap = Date.parse(next.at) - Date.parse(prev.updated_at)
  return gap >= 0 && gap < COALESCE_WINDOW_MS
}

/** Newest-first display order with a burst marker: `burst` is true when the
 *  version spans more than one save (updated_at after created_at). */
export function historyRows<T extends Pick<VersionRow, 'version_no' | 'created_at' | 'updated_at'>>(rows: readonly T[]): Array<T & { burst: boolean }> {
  return [...rows]
    .sort((a, b) => b.version_no - a.version_no)
    .map((r) => ({ ...r, burst: Date.parse(r.updated_at) > Date.parse(r.created_at) }))
}

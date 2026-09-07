'use client'

/** report_entities persistence (P5-04). The table has NO client writes —
 *  everything goes through `report_entities_set(p_report, p_items)`, which
 *  REPLACES the report's whole set and refuses (jsonb `{ok:false}`) when
 *  the caller is not the author / a case-writable editor, when the report
 *  is submitted, approved or finalized, or when a ref is not readable by the
 *  caller. So every write here is read-merge-send: the current set is read
 *  under RLS, merged with the incoming items (lib/mentions mergeEntityItems)
 *  and sent back whole. Nothing here touches the source records. */
import { readJsonRpc } from '@/components/justice/dossier/rpcJson'
import type { Json, Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { mergeEntityItems, type EntityItem } from '@/lib/mentions'

export type ReportEntityRow = Tables<'report_entities'>

/** Row → RPC item shape. */
export function toEntityItem(r: Pick<ReportEntityRow, 'kind' | 'ref_id' | 'role' | 'label' | 'snapshot' | 'edited'>): EntityItem {
  const snap = r.snapshot && typeof r.snapshot === 'object' && !Array.isArray(r.snapshot) ? (r.snapshot as Record<string, unknown>) : {}
  return { kind: r.kind, ref_id: r.ref_id, role: r.role, label: r.label, snapshot: snap, edited: !!r.edited }
}

/** The report's current set (RLS-filtered: unreadable reports answer []). */
export async function loadReportEntities(reportId: string): Promise<ReportEntityRow[]> {
  return list('report_entities', { eq: { report_id: reportId }, order: 'created_at' })
}

export interface SyncReportEntitiesResult {
  ok: boolean
  message: string | null
  /** The set that was sent (merge result) — the caller's new local state. */
  items: EntityItem[]
  count: number
}

/** Read-merge-send. `mode` 'merge' (default) upserts the incoming items by
 *  key over the current set — the drawer's inserts. `mode` 'mentions'
 *  replaces the current role-'mention' rows with the incoming ones (the
 *  narrative's tokens, from lib/mentions mentionEntityRows) and keeps
 *  everything else — call it on every narrative save. */
export async function syncReportEntities(
  reportId: string,
  items: readonly EntityItem[],
  mode: 'merge' | 'mentions' | 'replace' = 'merge',
): Promise<SyncReportEntitiesResult> {
  let current: EntityItem[] = []
  try { current = (await loadReportEntities(reportId)).map(toEntityItem) }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e), items: [], count: 0 } }
  const merged = mergeEntityItems(current, items, mode)
  const payload = merged.map((it) => ({
    kind: it.kind, ref_id: it.ref_id, role: it.role, label: it.label, snapshot: it.snapshot as Json, edited: it.edited,
  }))
  const res = readJsonRpc<{ count?: number }>(await rpc('report_entities_set', { p_report: reportId, p_items: payload as unknown as Json }))
  if (!res.ok) return { ok: false, message: res.message ?? 'The server refused this change.', items: merged, count: 0 }
  return { ok: true, message: null, items: merged, count: typeof res.data?.count === 'number' ? res.data.count : merged.length }
}

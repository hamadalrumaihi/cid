/** The Trash (Phase 8, P8-02) — the client side of `public.trash_list` /
 *  `trash_count` (migration 20261102120000). The server decides what is in
 *  the Trash for the caller: a row is listed only when
 *  `private.perm_dispatch('restore', kind, id)` holds, i.e. exactly the rows
 *  the caller may restore. This module labels, groups and links those rows
 *  and routes Restore through the shared `restore_record` RPC (db.ts). It
 *  decides nothing about access; the RPCs re-check every call.
 *
 *  Also home to the Sidebar badge's count store (`useTrashCountStore`,
 *  `bumpTrash`) — it lives here rather than in the shell so the delete
 *  helper (lib/deleteRecord) can bump it without importing a component. */
import { create } from 'zustand'
import type { Database } from './database.types'
import { REASON_REQUIRED, SOFT_DELETE_KIND, restoreRecord, rpc, type SoftDeleteTable } from './db'
import { workspaceCaseHref } from './workspace/model'

export type TrashRow = Database['public']['Functions']['trash_list']['Returns'][number]

/** Human label per soft-delete kind (the 29 kinds `trash_list` walks). */
export const TRASH_KIND_LABEL: Record<string, string> = {
  case: 'Case',
  case_template: 'Case template', commendation: 'Commendation',
  report: 'Report', media: 'Media', evidence: 'Evidence item', case_task: 'Case task', case_message: 'Case message',
  case_intel_link: 'Case link (intel)', case_blocker: 'Case blocker', rico_case: 'RICO case', predicate_act: 'Predicate act',
  case_note: 'Case note', case_link: 'Related-case link',
  person: 'Person', vehicle: 'Vehicle', gang: 'Gang', place: 'Place', account: 'Account', indicator: 'Indicator',
  narcotic: 'Narcotic', operation: 'Operation', tracker: 'Tracker',
  gang_member: 'Gang member', gang_turf: 'Gang turf', person_place: 'Person–place link',
  person_vehicle: 'Person–vehicle link', person_relationship: 'Person relationship', account_link: 'Account link',
}

/** Kind → label, degrading to a readable form of the kind for anything the
 *  server adds later ('foo_bar' → "Foo bar"). */
export const trashKindLabel = (kind: string): string => {
  const known = TRASH_KIND_LABEL[kind]
  if (known) return known
  const s = kind.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export type TrashGroupId = 'cases' | 'material' | 'registry' | 'links' | 'admin'

export interface TrashGroup { id: TrashGroupId; label: string; kinds: readonly string[] }

/** The five display groups, in order. Every kind in TRASH_KIND_LABEL belongs
 *  to exactly one; unknown kinds fall into Registry. */
export const TRASH_GROUPS: readonly TrashGroup[] = [
  { id: 'cases', label: 'Cases', kinds: ['case'] },
  { id: 'admin', label: 'Administration', kinds: ['case_template', 'commendation'] },
  { id: 'material', label: 'Case material', kinds: ['report', 'media', 'evidence', 'case_task', 'case_message', 'case_blocker', 'rico_case', 'predicate_act', 'case_note'] },
  { id: 'registry', label: 'Registry', kinds: ['person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker'] },
  { id: 'links', label: 'Links', kinds: ['case_intel_link', 'case_link', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link'] },
]

export function trashGroupOf(kind: string): TrashGroupId {
  return TRASH_GROUPS.find((g) => g.kinds.includes(kind))?.id ?? 'registry'
}

/** Rows bucketed by group, in TRASH_GROUPS order, empty groups omitted; the
 *  server's newest-first order is kept inside each bucket. */
export function groupTrash(rows: readonly TrashRow[]): Array<{ group: TrashGroup; rows: TrashRow[] }> {
  const buckets = new Map<TrashGroupId, TrashRow[]>()
  for (const r of rows) {
    const g = trashGroupOf(r.kind)
    const b = buckets.get(g)
    if (b) b.push(r)
    else buckets.set(g, [r])
  }
  return TRASH_GROUPS.flatMap((group) => {
    const b = buckets.get(group.id)
    return b?.length ? [{ group, rows: b }] : []
  })
}

/** What a row is called on screen: the server's label (case number, name,
 *  plate, title, …) or, when the table has no such column, the kind plus a
 *  short id so two link rows never read identically. */
export function trashRowLabel(row: Pick<TrashRow, 'kind' | 'id' | 'label'>): string {
  const l = (row.label ?? '').trim()
  if (l && l !== row.id) return l
  return `${trashKindLabel(row.kind)} · ${row.id.slice(0, 8)}`
}

/** The table behind a kind (the inverse of SOFT_DELETE_KIND); null for a
 *  kind this client does not know. */
export function tableForKind(kind: string): SoftDeleteTable | null {
  for (const [table, k] of Object.entries(SOFT_DELETE_KIND)) if (k === kind) return table as SoftDeleteTable
  return null
}

/** Kinds whose soft delete recorded a reason — the Trash offers (never
 *  demands) one on restore for the same set. */
export const trashReasonOffered = (kind: string): boolean => REASON_REQUIRED.has(kind)

/** Case section (and record param) a case child restores into. */
const CASE_SECTION: Record<string, { tab: string; param?: 'report' | 'task' | 'evidence' }> = {
  report: { tab: 'reports', param: 'report' },
  case_task: { tab: 'tasks', param: 'task' },
  evidence: { tab: 'media', param: 'evidence' },
  media: { tab: 'media' },
  case_note: { tab: 'notes' },
  case_message: { tab: 'chat' },
  case_intel_link: { tab: 'intel' },
  case_blocker: { tab: 'overview' },
  rico_case: { tab: 'rico' },
  predicate_act: { tab: 'rico' },
  case_link: { tab: 'overview' },
}

/** Workspace tool per registry kind; `record` marks the tools whose view
 *  understands `?record=` (a record tab or a list seed — workspace/model
 *  mirrorParams translates it for the list-level tools). */
const REGISTRY_TOOL: Record<string, { tool: string; record: boolean }> = {
  person: { tool: 'persons', record: true },
  vehicle: { tool: 'vehicles', record: true },
  gang: { tool: 'gangs', record: true },
  place: { tool: 'places', record: true },
  narcotic: { tool: 'narcotics', record: true },
  account: { tool: 'accounts', record: false },
  indicator: { tool: 'indicators', record: false },
  media: { tool: 'media', record: false },
}

/** Deep link to where the row lives once restored: a case → the workspace
 *  case tab; a case child → its case section (opening the record where the
 *  section supports it); a registry row → its tool (record tab where one
 *  exists); an operation → the operations board; a template → the New Case
 *  modal, a commendation → Personnel. Link rows without a case have no
 *  address of their own (null). */
export function trashHref(row: Pick<TrashRow, 'kind' | 'id' | 'case_id'>): string | null {
  if (row.kind === 'case') return workspaceCaseHref(row.id)
  const sec = CASE_SECTION[row.kind]
  if (row.case_id && sec) {
    return workspaceCaseHref(row.case_id, sec.tab, sec.param ? { [sec.param]: row.id } : {})
  }
  if (row.kind === 'operation') return `/operations?op=${encodeURIComponent(row.id)}`
  // Templates are managed from the New Case modal; commendations from Personnel.
  if (row.kind === 'case_template') return '/cases?new=1'
  if (row.kind === 'commendation') return '/personnel'
  const tool = REGISTRY_TOOL[row.kind]
  if (tool) {
    const p = new URLSearchParams({ tool: tool.tool })
    if (tool.record) p.set('record', row.id)
    return `/workspace?${p.toString()}`
  }
  if (row.case_id) return workspaceCaseHref(row.case_id)
  return null
}

/* ── Reads and writes ────────────────────────────────────────────────────── */

/** `trash_list(kind?)` — THROWS on error like list(). */
export async function fetchTrash(kind?: string | null, limit = 300): Promise<TrashRow[]> {
  const res = await rpc('trash_list', { p_kind: kind ?? null, p_limit: limit })
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code })
  return res.data ?? []
}

export const PARENT_DELETED_MESSAGE = 'Restore the record this belongs to first.'

/** Restore one Trash row through restore_record. `parent_deleted` (a child
 *  whose case / parent is itself in the Trash) is translated into the one
 *  sentence a person needs; every other refusal is the server's message. */
export async function restoreFromTrash(kind: string, id: string, reason?: string | null): Promise<{ ok: boolean; message?: string }> {
  const table = tableForKind(kind)
  if (!table) return { ok: false, message: `Unknown record kind "${kind}".` }
  const res = await restoreRecord(table, id, reason ?? null)
  if (!res.error) return { ok: true }
  if (res.error.code === 'parent_deleted') return { ok: false, message: PARENT_DELETED_MESSAGE }
  return { ok: false, message: res.error.message }
}

/* ── Badge count ─────────────────────────────────────────────────────────── */

interface TrashCountState {
  count: number
  fetched: boolean
  refresh: () => Promise<void>
}

/** `trash_count()` for the Sidebar badge. Module-level (lib/profiles pattern)
 *  so the shell's several mounts share one fetch; `bumpTrash()` re-reads it
 *  after a delete / restore. */
export const useTrashCountStore = create<TrashCountState>((set) => ({
  count: 0,
  fetched: false,
  async refresh() {
    try {
      const res = await rpc('trash_count', {})
      if (!res.error) set({ count: typeof res.data === 'number' ? res.data : 0, fetched: true })
    } catch { /* transient — keep the previous count */ }
  },
}))

/** Re-read the Trash count (after a delete, an undo or a restore). Never
 *  throws; a failed read keeps the previous number. */
export function bumpTrash(): void {
  void useTrashCountStore.getState().refresh()
}

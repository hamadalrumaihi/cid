/** The Trash mocks (Portal Improvements plan, Phase 8 — P8-02; migration
 *  20261102120000_trash_list).
 *
 *  The CONTRACT of `public.trash_list(p_kind, p_limit)` and
 *  `public.trash_count()` (scratch p8_contract.md §1), answered from the mock
 *  DB — never a second implementation of the server's authority model:
 *   · the Trash is the union of every soft-deletable table's rows with
 *     `deleted_at is not null` (the 27 kinds of db.ts's SOFT_DELETE_KIND —
 *     the mock walks that map so the vocabulary cannot drift), newest first,
 *     `p_limit` clamped 1–500 across all kinds; `p_kind` (trimmed,
 *     lower-cased) narrows to one kind; an unknown kind RAISES 'unknown
 *     record kind'; a signed-out or inactive caller reads zero rows;
 *   · a row is kept only when the caller could RESTORE it — the server's
 *     `perm_dispatch('restore', kind, id)`: the Owner sees everything, a
 *     non-Owner needs the delete authority of the row (`canRestoreAs`, the
 *     mock's reading of `private.perm_registry_delete`): a case → command
 *     with case access; a report / media / evidence / RICO row → command
 *     with case access; a task / blocker / note / message → its author or
 *     command, with case access; an intel link / case link → case access;
 *     the registries → command (narcotics: the Owner); person–place /
 *     –vehicle / –relationship links → command or the member who created
 *     them; account links → any active member. Case access is the mock's
 *     `canReadCaseAs` evaluated as if the case were live — a deleted case's
 *     children are listed (the server lists them too) and `restore_record`
 *     is what answers `parent_deleted`;
 *   · `label` follows `private.permanent_delete_record_label`: case_number →
 *     name → plate → title → label → item_code → value → code → the id;
 *     `case_id` follows `private.soft_delete_state` (+ the P3 kinds): the
 *     case itself, the row's `case_id`, or the RICO parent's case;
 *     `case_number` from that case; `deleted_by_name` from profiles;
 *     `restorable` is always true for a returned row; `permanently_deletable`
 *     = the caller is the Owner;
 *   · a case child is listed only while the caller can still READ the case
 *     (the review fix — `private.can_read_case`); a restricted media row only
 *     for the Owner;
 *   · `trash_count()` counts to 100 (the badge shows 99+).
 *  Explicit routes (`/rest/v1/rpc/trash_list`, `/rpc/trash_count`) registered
 *  BEFORE the generic rpc catch-all in handlers/index.ts, honouring the same
 *  offline / latency / rpcResult switches. Anything richer is pinned with
 *  scenarios.rpcResult(). */
import { delay, http, HttpResponse } from 'msw'
import type { Database, Tables } from '@/lib/database.types'
import { SOFT_DELETE_KIND } from '@/lib/db'
import { supabaseBaseUrl } from '../env'
import { getDenial, getLatency, getRows, getRpcOverride, isOffline, type MockRow, type MockTableName } from '../store'
import { findRow, isActive, isCommand, profile } from './entity'
import { canReadCaseAs } from './reports'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type Profile = Tables<'profiles'>
export type TrashListRow = Fns['trash_list']['Returns'][number]

const str = (v: unknown): string => (v == null ? '' : String(v))

/** A server `raise` — the route turns it into PostgREST's 400 error shape. */
export class TrashRpcError extends Error {
  code: string
  constructor(message: string, code = 'P0001') { super(message); this.code = code }
}

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

/** kind → table, the inverse of db.ts's SOFT_DELETE_KIND (the 27 kinds the
 *  server's private.soft_delete_table answers). */
export const TRASH_TABLE_OF_KIND: Readonly<Record<string, MockTableName>> = Object.fromEntries(
  Object.entries(SOFT_DELETE_KIND).map(([table, kind]) => [kind, table as MockTableName]),
)
export const TRASH_KINDS: readonly string[] = Object.keys(TRASH_TABLE_OF_KIND)

/** The server's label fallback order (private.permanent_delete_record_label). */
export const TRASH_LABEL_COLUMNS = ['case_number', 'name', 'plate', 'title', 'label', 'item_code', 'value', 'code'] as const

export function trashLabelOf(row: MockRow): string {
  for (const col of TRASH_LABEL_COLUMNS) {
    const v = str(row[col]).trim()
    if (v) return v
  }
  return str(row.id)
}

/** Tables whose rows belong to a case through their own `case_id`
 *  (private.soft_delete_state + the Phase 3 case_note / case_link kinds). */
const CASE_ID_TABLES: ReadonlySet<MockTableName> = new Set<MockTableName>([
  'places', 'indicators', 'trackers', 'gang_members', 'reports', 'media', 'evidence', 'case_tasks', 'case_messages',
  'case_intel_links', 'case_blockers', 'rico_cases', 'case_notes', 'case_links',
])

/** The governing case of a soft-deletable row, by table. */
export function trashCaseIdOf(table: MockTableName, row: MockRow): string | null {
  if (table === 'cases') return str(row.id) || null
  if (table === 'predicate_acts') {
    const rico = findRow('rico_cases', row.rico_case_id)
    return rico ? str(rico.case_id) || null : null
  }
  if (CASE_ID_TABLES.has(table)) return str(row.case_id) || null
  return null
}

/* ── Restore authority (the mock's perm_registry_delete) ────────────────── */

const CASE_MATERIAL_COMMAND = new Set(['report', 'media', 'evidence', 'rico_case', 'predicate_act'])
const CASE_MATERIAL_AUTHOR = new Set(['case_task', 'case_blocker', 'case_note', 'case_message'])
const CASE_ACCESS_ONLY = new Set(['case_intel_link', 'case_link'])
const REGISTRY_COMMAND = new Set(['person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'operation', 'tracker', 'gang_member', 'gang_turf'])
const LINK_COMMAND_OR_CREATOR = new Set(['person_place', 'person_vehicle', 'person_relationship'])

const authorOf = (row: MockRow): string | null => str(row.created_by ?? row.author_id ?? row.uploaded_by) || null

/** Case access for a Trash row: the case as if it were live, so a deleted
 *  case's children stay listed (the server lists them and lets
 *  restore_record answer `parent_deleted`). */
function caseAccessAs(p: Profile, caseId: string | null): boolean {
  if (!caseId) return false
  const kase = findRow('cases', caseId)
  if (!kase) return false
  return canReadCaseAs(p, { ...kase, deleted_at: null })
}

/** May `p` restore this deleted row — perm_dispatch('restore', kind, id)
 *  for the mock: the Owner, or the delete authority of the row. */
export function canRestoreAs(p: Profile | null, kind: string, table: MockTableName, row: MockRow): boolean {
  if (!isActive(p)) return false
  if (p!.is_owner) return true
  const command = isCommand(p)
  const caseId = trashCaseIdOf(table, row)
  if (kind === 'case') return command && caseAccessAs(p!, caseId)
  if (kind === 'media' && row.restricted === true) return false // the Owner only (handled above)
  if (CASE_MATERIAL_COMMAND.has(kind)) return command && caseAccessAs(p!, caseId)
  if (CASE_MATERIAL_AUTHOR.has(kind)) return (command || authorOf(row) === p!.id) && caseAccessAs(p!, caseId)
  if (CASE_ACCESS_ONLY.has(kind)) return caseAccessAs(p!, caseId)
  if (kind === 'narcotic') return false // Owner-only; handled above
  if (REGISTRY_COMMAND.has(kind)) return command
  if (LINK_COMMAND_OR_CREATOR.has(kind)) return command || authorOf(row) === p!.id
  if (kind === 'account_link') return true
  return false
}

/* ── trash_list / trash_count ───────────────────────────────────────────── */

const clampLimit = (v: unknown): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 300
  return Math.min(Math.max(Math.trunc(n), 1), 500)
}

function rowOf(p: Profile, kind: string, table: MockTableName, row: MockRow): TrashListRow {
  const caseId = trashCaseIdOf(table, row)
  const kase = caseId ? findRow('cases', caseId) : undefined
  const deleter = row.deleted_by != null ? findRow('profiles', row.deleted_by) : undefined
  return {
    kind,
    id: str(row.id),
    label: trashLabelOf(row),
    case_id: caseId,
    case_number: kase ? str(kase.case_number) || null : null,
    deleted_at: str(row.deleted_at),
    deleted_by: row.deleted_by == null ? null : str(row.deleted_by),
    deleted_by_name: deleter ? str(deleter.display_name) || null : null,
    delete_reason: row.delete_reason == null ? null : str(row.delete_reason),
    delete_batch: row.delete_batch == null ? null : str(row.delete_batch),
    restorable: true,
    permanently_deletable: !!p.is_owner,
  }
}

/** trash_list(p_kind default null, p_limit default 300). */
export function trashList(args: Args = {}): TrashListRow[] {
  const raw = str(args.p_kind).trim().toLowerCase()
  const kinds = raw ? [raw] : TRASH_KINDS
  if (raw && !TRASH_TABLE_OF_KIND[raw]) throw new TrashRpcError('unknown record kind')
  const p = profile()
  if (!isActive(p)) return []
  const limit = clampLimit(args.p_limit ?? 300)
  const out: TrashListRow[] = []
  for (const kind of kinds) {
    const table = TRASH_TABLE_OF_KIND[kind]
    if (getDenial(table)) continue
    const deleted = getRows(table)
      .filter((r) => r.deleted_at != null)
      .sort((a, b) => Date.parse(str(b.deleted_at)) - Date.parse(str(a.deleted_at)))
      .filter((r) => canRestoreAs(p, kind, table, r))
      .slice(0, limit)
    for (const r of deleted) out.push(rowOf(p!, kind, table, r))
  }
  out.sort((a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at))
  return out.slice(0, limit)
}

/** trash_count() — the rows trash_list() would return, counted to 100 (the
 *  Sidebar badge shows 99+ beyond that). */
export const TRASH_COUNT_CAP = 100
export function trashCount(): Fns['trash_count']['Returns'] {
  return Math.min(trashList({ p_limit: 500 }).length, TRASH_COUNT_CAP)
}

export const TRASH_RPCS: Record<string, (args: Args) => unknown> = {
  trash_list: trashList,
  trash_count: () => trashCount(),
}

const pgError = (status: number, code: string, message: string) =>
  HttpResponse.json({ code, details: null, hint: null, message }, { status })

/** One explicit route per function, registered BEFORE the generic rpc
 *  catch-all (handlers/index.ts). */
export const trashHandlers = Object.entries(TRASH_RPCS).map(([fn, impl]) =>
  http.post(`${supabaseBaseUrl()}/rest/v1/rpc/${fn}`, async ({ request }) => {
    if (isOffline()) return HttpResponse.error()
    const ms = getLatency()
    if (ms > 0) await delay(ms)
    const override = getRpcOverride(fn)
    if (override.hit) return HttpResponse.json(override.result as Parameters<typeof HttpResponse.json>[0])
    const args = (await request.json().catch(() => ({}))) as Args
    try {
      return HttpResponse.json(impl(args) as Parameters<typeof HttpResponse.json>[0])
    } catch (e) {
      if (e instanceof TrashRpcError) return pgError(400, e.code, e.message)
      throw e
    }
  }))

/** Is this kind in the Trash vocabulary (a test helper). */
export const isTrashKind = (kind: string): boolean => kind in TRASH_TABLE_OF_KIND

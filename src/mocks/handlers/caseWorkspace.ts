/** Case-workspace RPC mocks (Portal Improvements plan, Phase 3 — P3-03 /
 *  P3-04; migrations 20261021120000 and 20261022120000).
 *
 *  The CONTRACT of the server functions, answered from the mock DB — never
 *  a second implementation of the server's audit ledger or its authority
 *  model:
 *   · case_notes SELECT shape — a note restricted to command is hidden from
 *     a session whose profile is neither command / owner nor the author
 *     (`visibleCaseNotes`, applied by the generic table handler);
 *   · case_audit_feed — rows from the seeded `audit_log` when a spec seeded
 *     one for the case, else SYNTHESIZED from the case, its notes and its
 *     links (INSERT rows with `kind` / `label`, UPDATE rows from seeded
 *     `record_versions` carrying `changed_fields`); every row re-checked
 *     with the session's note predicate; `detail` stripped of body keys;
 *     `p_before` / `p_limit` honoured; a case the session cannot see (or no
 *     session) answers [];
 *   · case_note_mention — {ok:true, sent:n} for the author (one
 *     `note_mention` notification per active recipient per note; the
 *     server's is_test suppression is out of scope here — every mock
 *     profile is is_test), {ok:false, code:'denied'} for anyone else;
 *   · record_history — the seeded `record_versions` for a kind's table,
 *     newest version first; a hidden note has no history.
 *  Refusals are RETURNED as { ok:false, code } exactly like the server
 *  (never raised). Anything richer is pinned with scenarios.rpcResult(). */
import type { Database, Json, Tables } from '@/lib/database.types'
import { getDenial, getRows, mockId, seedRows, type MockRow, type MockTableName } from '../store'
import { findRow, isActive, isCommand, uid } from './entity'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type FeedRow = Fns['case_audit_feed']['Returns'][number]

const str = (v: unknown): string => (v == null ? '' : String(v))
const nullableStr = (v: unknown): string | null => (v == null ? null : String(v))

/* ── case_notes visibility (mirror of case_notes_sel) ───────────────────── */

/** RLS: `not restricted_to_command or author_id = auth.uid() or command`.
 *  Command here is the entity layer's reading (Bureau Lead and above, or the
 *  Owner); the SIB-command arm has no mock model. */
export function caseNoteVisible(note: MockRow): boolean {
  if (!note.restricted_to_command) return true
  const me = uid()
  return (me != null && note.author_id === me) || isCommand()
}

/** The generic table handler runs case_notes reads through this. */
export const visibleCaseNotes = (rows: MockRow[]): MockRow[] => rows.filter(caseNoteVisible)

/* ── case_audit_feed ────────────────────────────────────────────────────── */

/** Keys the server strips from `detail` (v_hidden in the migration). */
const HIDDEN_DETAIL_KEYS = new Set([
  'body_md', 'notes', 'note', 'narrative', 'summary', 'fields', 'form_data', 'description', 'instructions',
])
const FEED_MAX = 200
const FEED_DEFAULT = 50
/** record_versions ↔ audit row matching window (± 2 s, as the server). */
const VERSION_WINDOW_MS = 2_000

function stripDetail(detail: unknown): Json | null {
  if (detail == null || typeof detail !== 'object' || Array.isArray(detail)) return null
  const out: Record<string, Json> = {}
  for (const [k, v] of Object.entries(detail as Record<string, Json>)) {
    if (!HIDDEN_DETAIL_KEYS.has(k)) out[k] = v
  }
  return out
}

interface Kid { table: MockTableName; kind: string; row: MockRow; label: string | null; visible: boolean }

/** The audited children of a case (the server's `kids` CTE) with the label
 *  each kind shows and the viewer's predicate for it. Soft-deleted rows stay
 *  listed — the server's perm_registry_visible does not test deleted_at for
 *  these kinds, so a trashed note's history remains in the feed. */
function childrenOf(caseId: string): Kid[] {
  const rows = (table: MockTableName) => (getDenial(table) ? [] : getRows(table).filter((r) => r.case_id === caseId))
  const kid = (table: MockTableName, kind: string, row: MockRow, label: string | null, visible = true): Kid =>
    ({ table, kind, row, label, visible })
  return [
    ...rows('reports').map((r) => kid('reports', 'report', r, nullableStr(r.template))),
    ...rows('evidence').map((r) => kid('evidence', 'evidence', r, nullableStr(r.item_code))),
    ...rows('media').map((r) => kid('media', 'media', r, nullableStr(r.title))),
    ...rows('case_tasks').map((r) => kid('case_tasks', 'case_task', r, nullableStr(r.title))),
    ...rows('case_intel_links').map((r) => kid('case_intel_links', 'case_intel_link', r, `${str(r.kind)} link`)),
    ...rows('case_blockers').map((r) => kid('case_blockers', 'case_blocker', r, nullableStr(r.title))),
    ...rows('case_assignments').map((r) => kid('case_assignments', 'case_assignment', r, null)),
    ...rows('case_access_grants').map((r) => kid('case_access_grants', 'case_access_grant', r, null)),
    ...rows('rico_cases').map((r) => kid('rico_cases', 'rico_case', r, null)),
    ...rows('raid_compensations').map((r) => kid('raid_compensations', 'raid_compensation', r, null)),
    ...rows('trackers').map((r) => kid('trackers', 'tracker', r, null)),
    ...rows('case_notes').map((r) => kid('case_notes', 'case_note', r, r.pinned ? 'pinned note' : 'note', caseNoteVisible(r))),
    ...rows('case_links').map((r) => kid('case_links', 'case_link', r, nullableStr(r.kind))),
  ]
}

const versionsOf = (table: string, id: string): Tables<'record_versions'>[] =>
  (getRows('record_versions') as unknown as Tables<'record_versions'>[])
    .filter((v) => v.table_name === table && v.record_id === id)

/** The server joins the record_versions row written in the same ± 2 s as
 *  the audit row (latest version_no wins). */
function changedFieldsNear(table: string, id: string, at: string): string[] | null {
  const t = Date.parse(at)
  const hit = versionsOf(table, id)
    .filter((v) => Math.abs(Date.parse(v.created_at) - t) <= VERSION_WINDOW_MS)
    .sort((a, b) => b.version_no - a.version_no)[0]
  return hit ? hit.changed_fields : null
}

/** Feed rows from a seeded audit_log: the case's own rows, its children's
 *  rows, and case-level actions carrying case_id in their detail. */
function feedFromLedger(caseId: string, caseNumber: string | null, kids: Kid[]): FeedRow[] {
  const out: FeedRow[] = []
  for (const a of getRows('audit_log') as unknown as Tables<'audit_log'>[]) {
    let kind: string | null = null, label: string | null = null
    if (a.entity === 'cases' && a.entity_id === caseId) {
      kind = 'case'; label = caseNumber
    } else {
      const kid = kids.find((k) => k.table === a.entity && k.row.id === a.entity_id)
      if (kid) {
        if (!kid.visible) continue
        kind = kid.kind; label = kid.label
      } else {
        const detail = a.detail as Record<string, Json> | null
        const viaDetail = detail != null && typeof detail === 'object' && !Array.isArray(detail)
          && detail.case_id === caseId && a.entity_id !== caseId
          && !['cases', 'legal_requests', 'audit_log'].includes(a.entity)
        if (!viaDetail) continue
        kind = 'case'; label = caseNumber
      }
    }
    out.push({
      id: a.id, at: a.created_at, actor_id: a.actor_id, action: a.action, entity: a.entity, entity_id: a.entity_id,
      kind, label,
      changed_fields: a.action === 'UPDATE' && a.entity_id ? changedFieldsNear(a.entity, a.entity_id, a.created_at) : null,
      detail: stripDetail(a.detail),
    })
  }
  return out
}

/** No ledger: the INSERT of the case and of each visible child (at its
 *  created_at), plus an UPDATE per seeded record_versions row. Ids are
 *  assigned in chronological order so `id desc` agrees with `at desc`. */
function synthesizeFeed(kase: MockRow, kids: Kid[]): FeedRow[] {
  type Draft = Omit<FeedRow, 'id'>
  const drafts: Draft[] = []
  const caseId = str(kase.id)
  const caseNumber = nullableStr(kase.case_number)
  const insert = (entity: string, entityId: string, at: string, actor: unknown, kind: string, label: string | null): void => {
    drafts.push({ at, actor_id: nullableStr(actor), action: 'INSERT', entity, entity_id: entityId, kind, label, changed_fields: null, detail: null })
  }
  const updates = (entity: string, entityId: string, kind: string, label: string | null): void => {
    for (const v of versionsOf(entity, entityId)) {
      drafts.push({ at: v.created_at, actor_id: v.actor_id, action: 'UPDATE', entity, entity_id: entityId, kind, label, changed_fields: v.changed_fields, detail: null })
    }
  }
  insert('cases', caseId, str(kase.created_at), kase.created_by, 'case', caseNumber)
  updates('cases', caseId, 'case', caseNumber)
  for (const k of kids) {
    if (!k.visible) continue
    const id = str(k.row.id)
    insert(k.table, id, str(k.row.created_at), k.row.author_id ?? k.row.created_by ?? k.row.uploaded_by ?? null, k.kind, k.label)
    updates(k.table, id, k.kind, k.label)
  }
  return drafts
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((d, i) => ({ id: i + 1, ...d }))
}

export function caseAuditFeed(args: Args): FeedRow[] {
  const caseId = str(args.p_case)
  const kase = caseId ? findRow('cases', caseId) : undefined
  if (!kase || !isActive()) return []
  const requested = args.p_limit == null ? FEED_DEFAULT : Number(args.p_limit)
  const limit = Math.min(Math.max(Number.isNaN(requested) ? FEED_DEFAULT : requested, 1), FEED_MAX)
  const before = args.p_before == null ? null : Date.parse(str(args.p_before))
  const kids = childrenOf(caseId)
  const ledger = feedFromLedger(caseId, nullableStr(kase.case_number), kids)
  const rows = ledger.length ? ledger : synthesizeFeed(kase, kids)
  return rows
    .filter((r) => before == null || Number.isNaN(before) || Date.parse(r.at) < before)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id)
    .slice(0, limit)
}

/* ── case_note_mention ──────────────────────────────────────────────────── */

type MentionResult = { ok: true; sent: number } | { ok: false; code: 'denied'; message: string }

export function caseNoteMention(args: Args): MentionResult {
  const me = uid()
  const note = findRow('case_notes', args.p_note)
  if (!me || !note || note.author_id !== me || !caseNoteVisible(note)) {
    return { ok: false, code: 'denied', message: "only the note's author records its mentions" }
  }
  const wanted = new Set((Array.isArray(args.p_user_ids) ? args.p_user_ids : []).map(str))
  const already = new Set(
    (getRows('notifications') as unknown as Tables<'notifications'>[])
      .filter((n) => n.type === 'note_mention' && (n.payload as Record<string, Json> | null)?.note_id === note.id)
      .map((n) => n.user_id))
  const recipients = (getRows('profiles') as unknown as Tables<'profiles'>[])
    .filter((p) => wanted.has(p.id) && p.id !== me && p.active && p.removed_at == null && !already.has(p.id))
  seedRows('notifications', recipients.map((p) => ({
    created_at: new Date().toISOString(),
    id: mockId(),
    payload: { case_id: str(note.case_id), note_id: str(note.id), author_id: me },
    read: false,
    type: 'note_mention',
    user_id: p.id,
  })))
  return { ok: true, sent: recipients.length }
}

/* ── record_history ─────────────────────────────────────────────────────── */

/** kind → versioned table (private.version_table). */
const VERSION_TABLE: Record<string, MockTableName> = {
  case: 'cases', person: 'persons', vehicle: 'vehicles', gang: 'gangs', place: 'places', account: 'accounts',
  narcotic: 'narcotics', evidence: 'evidence', report: 'reports', legal: 'legal_requests',
  field_submission: 'field_submissions', case_note: 'case_notes',
}

export function recordHistory(args: Args): Fns['record_history']['Returns'] {
  const kind = str(args.p_kind).trim().toLowerCase()
  const table = VERSION_TABLE[kind]
  const id = str(args.p_id)
  if (!table || !id) return []
  if (table === 'case_notes') {
    const note = findRow('case_notes', id)
    if (!note || !caseNoteVisible(note)) return []
  }
  return versionsOf(table, id).sort((a, b) => b.version_no - a.version_no)
}

/** fn → handler, consumed by the rpc.ts switch's default arm. */
export const CASE_WORKSPACE_RPCS: Record<string, (args: Args) => unknown> = {
  case_audit_feed: caseAuditFeed,
  case_note_mention: caseNoteMention,
  record_history: recordHistory,
}

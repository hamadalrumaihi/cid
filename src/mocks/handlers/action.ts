/** Action Center + scheduler mocks (Portal Improvements plan, Phase 7 —
 *  P7-01 / P7-03 / P7-04 / P7-07; migration 20261101120000_action_center).
 *
 *  The CONTRACT of the server functions (scratch p7_contract.md §1–§3),
 *  answered from the mock DB — never a second implementation of the server's
 *  audit ledger or its authority model. Five surfaces:
 *
 *   · Three RPC-only tables. `action_item_state` reads for its own viewer
 *     (`ais_sel`: user_id = auth.uid()); `action_escalation_rules` reads for
 *     the Owner (`aer_sel`); `action_escalations` reads with the case's own
 *     visibility (`aes_sel`: can_access_case — the ledger is the shared fact
 *     the "Escalated" badge reads). Every client INSERT / UPDATE / DELETE is
 *     PostgREST's grant denial (403 / 42501).
 *   · Per-viewer state: `action_item_set_state` / `_many` with the key-class
 *     rule (`actionKeyClass` = private.action_key_class — dismissable /
 *     decision / work from the key's shape) and the 48-hour snooze cap; a
 *     decision snooze writes ACTION_ITEM_SNOOZED. Authority refusals RAISE
 *     with SQLSTATE P0403 (private.perm_raise), validation with P0001
 *     (`ActionRpcError` → PostgREST 400 in the rpc route below).
 *   · Notifications: `notifications_mark_read` (own unread rows, stamps
 *     read_at, returns the count) and `notification_resolve` (SECURITY
 *     INVOKER — the subject resolved from the payload under the caller's own
 *     read walls; `visible=false` renders "An item you no longer have access
 *     to").
 *   · Reassignment: `action_reassign_task` / `_blocker` — the case lead or
 *     command (private.can_grant_case) on a writable case; the target active
 *     and able to see the case (private.user_can_access_case); audits
 *     TASK_REASSIGNED / BLOCKER_REASSIGNED and tells the target with a
 *     MINIMAL payload (`task_assigned` {case_id, case_number, task_id} /
 *     `blocker_assigned` {case_id, case_number, blocker_id} — never a title).
 *   · Escalation: `action_escalation_run` (Owner only, jsonb `{ok:false,
 *     code:'denied'}` like legal_sweep_run) evaluates the enabled rules —
 *     sign-off waiting past the rule's hours → the next authority, a pending
 *     access request → the bureau's leads + Deputies, an overdue task → the
 *     case lead (the bureau's leads when the lead is the assignee) — inserts
 *     ONE open ledger row per (kind, source) — `stage` records the sign-off
 *     stage it was raised at and a stage advance resolves + re-escalates —
 *     notifies `action_escalated` only when the row is (re)opened, records
 *     only the recipients actually written, audits ACTION_ESCALATED,
 *     resolves rows whose source no longer qualifies and writes the
 *     `scheduled_job_runs` row; recipients are filtered through
 *     user_can_access_case; `action_escalation_rule_set` tunes one rule
 *     (Owner only); `rls_test_escalation_run(p_case)` is the fixture-scoped
 *     runner the RLS suites use (a test caller, a fixture-created case).
 *
 *  Anything richer is pinned with scenarios.rpcResult(). */
import { delay, http, HttpResponse } from 'msw'
import type { Database, Json, Tables } from '@/lib/database.types'
import { supabaseBaseUrl } from '../env'
import { actionEscalationRow, actionEscalationRuleRow, actionItemStateRow } from '../fixtures/rows'
import { getDenial, getLatency, getRows, getRpcOverride, isOffline, mockId, seedRows, type MockRow, type MockTableName } from '../store'
import { findRow, isActive, isOwner, profile, uid } from './entity'
import { readableAs } from './intel'
import { canViewLegalRequest } from './legal'
import { canReadCaseAs } from './reports'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type Profile = Tables<'profiles'>
type StateRow = Tables<'action_item_state'>
type Rule = Tables<'action_escalation_rules'>

const HOUR = 3_600_000
const str = (v: unknown): string => (v == null ? '' : String(v))
const now = () => new Date().toISOString()

/** A server `raise` — the rpc route turns it into PostgREST's 400 error
 *  shape. `P0403` marks an AUTHORITY refusal (private.perm_raise); everything
 *  else is a plain validation raise (`P0001`). */
export class ActionRpcError extends Error {
  code: string
  constructor(message: string, code = 'P0001') { super(message); this.code = code }
}
// Function declarations (not arrow consts) so TypeScript narrows after an `if (…) raise(…)` guard.
function raise(message: string): never { throw new ActionRpcError(message) }
function deny(message: string): never { throw new ActionRpcError(message, 'P0403') }
type Denied = { ok: false; code: 'denied'; message: string }
const denied = (message: string): Denied => ({ ok: false, code: 'denied', message })

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

/** Tables no client may write (RPC-only; grants SELECT only). */
export const ACTION_RPC_ONLY_TABLES: readonly MockTableName[] = ['action_item_state', 'action_escalation_rules', 'action_escalations']

export type ActionKeyClass = 'dismissable' | 'decision' | 'work'
/** Informational — nobody is waiting on the viewer. */
export const DISMISSABLE_PREFIXES: readonly string[] = [
  'notif:', 'draft:', 'legal_hold:', 'sib_disclosure:', 'bolo:', 'document_ack:', 'document_review:', 'document_sync:',
  'surv_obs:', 'grant:', 'owner:', 'legal_comment:', 'siu_watch:',
]
/** A command / authority decision the viewer owns. */
export const DECISION_PREFIXES: readonly string[] = [
  'transfer:', 'member_transfer:', 'access:', 'membership:', 'restricted:', 'sib_access:', 'mdt_export:', 'field_access:',
  'tracker:', 'justice:', 'siu_conflict:', 'surv_tgt:', 'document_approval:', 'document_suggestion:', 'narcotic:', 'claim:',
  'legal:', 'legal_queue:', 'report:', 'gang_dup:',
]
/** private.action_key_class — the key's SHAPE decides (§2.3). `:expiry` keys
 *  and `case:%:followup` are dismissable whatever their prefix; `case:%:
 *  signoff-decide` is a decision; everything else is assigned work. */
export function actionKeyClass(key: string): ActionKeyClass {
  if (key.endsWith(':expiry')) return 'dismissable'
  if (/^case:.+:followup$/.test(key)) return 'dismissable'
  if (DISMISSABLE_PREFIXES.some((p) => key.startsWith(p))) return 'dismissable'
  if (/^case:.+:signoff-decide$/.test(key)) return 'decision'
  if (DECISION_PREFIXES.some((p) => key.startsWith(p))) return 'decision'
  return 'work'
}

const OPS = new Set(['seen', 'snooze', 'unsnooze', 'dismiss', 'undismiss'])
export const MAX_SNOOZE_HOURS = 48
export const NOT_DISMISSABLE_MESSAGE = 'this item is a decision or assigned work — decide it, finish it or snooze it'

/** The migration's seed (§1.3): `legal` disabled — the legal sweep escalates itself. */
export const ACTION_RULE_SEED: readonly Pick<Rule, 'kind' | 'after_hours' | 'target' | 'enabled'>[] = [
  { kind: 'signoff', after_hours: 72, enabled: true, target: 'the next sign-off authority (Bureau Lead stage → Deputy Directors, Deputy stage → Directors, Director stage → the Owner)' },
  { kind: 'access_request', after_hours: 48, enabled: true, target: "the case bureau's Bureau Leads and the Deputy Directors" },
  { kind: 'task_overdue', after_hours: 48, enabled: true, target: "the case lead (and the bureau's Bureau Leads when the lead is the assignee)" },
  { kind: 'legal', after_hours: 120, enabled: false, target: 'handled by the legal sweep' },
]
const ESCALATION_ENTITY: Record<string, string> = { signoff: 'cases', access_request: 'case_access_requests', task_overdue: 'case_tasks' }
const SIGNOFF_WAITING = new Set(['awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director'])

/* ── Rows / session ─────────────────────────────────────────────────────── */

const rows = <T extends MockTableName>(table: T): Tables<T>[] =>
  (getDenial(table) ? [] : getRows(table)) as unknown as Tables<T>[]
const profileOf = (id: unknown): Profile | undefined => rows('profiles').find((p) => p.id === str(id))
const caseOf = (id: unknown): MockRow | undefined => findRow('cases', id)
const canReadCase = (kase: MockRow | undefined) => canReadCaseAs(profile(), kase)

/** private.can_grant_case — the case lead, or any Bureau Lead / Deputy / Director (the Owner too). */
function canGrantCase(kase: MockRow | undefined, p = profile()): boolean {
  if (!kase || !isActive(p)) return false
  if (p!.is_owner || ['bureau_lead', 'deputy_director', 'director'].includes(p!.role ?? '')) return true
  return kase.lead_detective_id === p!.id
}
/** private.user_can_access_case(p_user, p_case) — the target-side mirror of
 *  can_access_case without auth.uid(): active and (command role, lead /
 *  creator, same bureau, JTF, or a live case_access_grants row). */
export function userCanAccessCase(target: Profile | undefined, kase: MockRow | undefined): boolean {
  if (!target || !kase || !isActive(target) || kase.deleted_at != null) return false
  if (target.role === 'bureau_lead') return true
  if (canReadCaseAs(target, kase)) return true
  const t = Date.now()
  return rows('case_access_grants').some((g) => g.case_id === kase.id && g.officer_id === target.id && Date.parse(g.expires_at) > t)
}

/** The generic table handler runs the Phase 7 tables through this. */
export function visibleActionRows(table: MockTableName, list: MockRow[]): MockRow[] {
  switch (table) {
    case 'action_item_state': return list.filter((r) => r.user_id === uid())
    case 'action_escalation_rules': ensureActionRules(); return isOwner() ? getRows(table) : []
    case 'action_escalations': return list.filter((r) => {
      const kase = caseOf(r.case_id)
      return !!r.case_id && canReadCase(kase) && (r.kind !== 'access_request' || canGrantCase(kase))
    })
    default: return list
  }
}

/** Seed the four rules the migration seeds — idempotent per kind. */
export function ensureActionRules(): void {
  const have = new Set(getRows('action_escalation_rules').map((r) => r.kind))
  const missing = ACTION_RULE_SEED.filter((r) => !have.has(r.kind))
  if (missing.length) seedRows('action_escalation_rules', missing.map((r) => actionEscalationRuleRow(r)))
}

/* ── Audit + notifications ──────────────────────────────────────────────── */

function audit(action: string, entity: string, entityId: string | null, detail: Json | null = null, actorId: string | null = uid()): void {
  seedRows('audit_log', [{
    action, actor_id: actorId, created_at: now(), detail, entity, entity_id: entityId,
    id: getRows('audit_log').length + 1, prev_hash: null, row_hash: null,
  }])
}

/** Keys a payload never carries, whatever the caller passes (AC8). */
const NEVER_IN_PAYLOAD = new Set(['summary', 'details', 'reason', 'title', 'body', 'note'])
/** The dedupe subject: coalesce(task_id, blocker_id, source_id, case_id) — a
 *  task on a case is its own subject, so two tasks on one case both notify. */
const subjectOf = (p: Record<string, unknown>): unknown => p.task_id ?? p.blocker_id ?? p.source_id ?? p.case_id ?? null

/** private.action_notify — skips null / self / no active profile; a test actor
 *  never notifies a non-test target (the sweep passes the case creator as
 *  the actor for that guard alone); one unread per (type, subject) per hour
 *  where the subject is the payload's most specific id; stamps actor_id / actor_name only when a session is set (the sweep
 *  has none — system rows carry no actor); strips the text keys. Returns
 *  true when a row was written. */
export function actionNotify(userId: unknown, kind: string, payload: Record<string, Json>, guardActor: Profile | null = profile()): boolean {
  const me = profile()
  const target = profileOf(userId)
  if (!target || !target.active || (me && target.id === me.id)) return false
  if (guardActor?.is_test && !target.is_test) return false
  const clean: Record<string, Json> = {}
  for (const [k, v] of Object.entries(payload)) if (!NEVER_IN_PAYLOAD.has(k)) clean[k] = v
  const since = Date.now() - HOUR
  const subject = subjectOf(clean)
  const dup = subject != null && rows('notifications').some((n) =>
    n.user_id === target.id && n.type === kind && !n.read && Date.parse(n.created_at) >= since
    && subjectOf((n.payload ?? {}) as Record<string, unknown>) === subject)
  if (dup) return false
  if (me) { clean.actor_id = me.id; clean.actor_name = me.display_name }
  seedRows('notifications', [{ created_at: now(), id: mockId(), payload: clean, read: false, read_at: null, type: kind, user_id: target.id }])
  return true
}

/* ── P7-01 per-viewer state ─────────────────────────────────────────────── */

function stateRow(userId: string, key: string): StateRow {
  const existing = rows('action_item_state').find((r) => r.user_id === userId && r.dedupe_key === key)
  if (existing) return existing
  const [row] = seedRows('action_item_state', [actionItemStateRow({ user_id: userId, dedupe_key: key, updated_at: now() })])
  return row
}
/** The table's CHECK constraints: 1–200 chars (the RPC's own raise) and the
 *  key shape `action_item_state_key_shape` (a violation surfaces as SQLSTATE
 *  23514 from the INSERT — a key is an identifier, never free text). */
export const KEY_SHAPE = /^[a-z_]+:[A-Za-z0-9_:.@-]+$/
const validKey = (v: unknown): string => {
  const key = str(v)
  if (key.length < 1 || key.length > 200) raise('that queue item key is not valid')
  if (!KEY_SHAPE.test(key)) throw new ActionRpcError('new row for relation "action_item_state" violates check constraint "action_item_state_key_shape"', '23514')
  return key
}
const validOp = (v: unknown): string => {
  const op = str(v)
  if (!OPS.has(op)) raise('unknown state operation')
  return op
}
/** snooze: required, in the future, at most 48 h out. */
const validUntil = (v: unknown): string => {
  const t = v == null || v === '' ? NaN : Date.parse(str(v))
  const n = Date.now()
  if (Number.isNaN(t) || t <= n || t > n + MAX_SNOOZE_HOURS * HOUR) raise('snooze for up to 48 hours')
  return new Date(t).toISOString()
}
function applyOp(row: StateRow, op: string, until: string | null): void {
  const t = now()
  if (op === 'seen') row.seen_at = t
  else if (op === 'snooze') row.snoozed_until = until
  else if (op === 'unsnooze') row.snoozed_until = null
  else if (op === 'dismiss') row.dismissed_at = t
  else if (op === 'undismiss') row.dismissed_at = null
  row.updated_at = t
}

/** action_item_set_state(p_key, p_op, p_until) → {ok, key, seen_at, snoozed_until, dismissed_at}. */
export function actionItemSetState(args: Args): Fns['action_item_set_state']['Returns'] {
  if (!isActive()) deny('your account is not active')
  const key = validKey(args.p_key)
  const op = validOp(args.p_op)
  const until = op === 'snooze' ? validUntil(args.p_until) : null
  if (op === 'dismiss' && actionKeyClass(key) !== 'dismissable') deny(NOT_DISMISSABLE_MESSAGE)
  const row = stateRow(uid()!, key)
  applyOp(row, op, until)
  if (op === 'snooze' && actionKeyClass(key) === 'decision') audit('ACTION_ITEM_SNOOZED', 'action_item', null, { key, until })
  return { ok: true, key, seen_at: row.seen_at, snoozed_until: row.snoozed_until, dismissed_at: row.dismissed_at }
}

/** action_item_set_state_many(p_keys, p_op, p_until) → {ok, applied, skipped}
 *  — a dismiss of a non-dismissable key is skipped and reported, never raised;
 *  a snooze touching a decision writes ONE audit row with the decision keys. */
export function actionItemSetStateMany(args: Args): Fns['action_item_set_state_many']['Returns'] {
  if (!isActive()) deny('your account is not active')
  const keys = Array.isArray(args.p_keys) ? (args.p_keys as unknown[]).map(validKey) : []
  if (keys.length > 100) raise('at most 100 items at a time')
  const op = validOp(args.p_op)
  const until = op === 'snooze' ? validUntil(args.p_until) : null
  const skipped: string[] = []
  const decisions: string[] = []
  let applied = 0
  for (const key of new Set(keys)) {
    const cls = actionKeyClass(key)
    if (op === 'dismiss' && cls !== 'dismissable') { skipped.push(key); continue }
    applyOp(stateRow(uid()!, key), op, until)
    applied++
    if (op === 'snooze' && cls === 'decision') decisions.push(key)
  }
  if (decisions.length) audit('ACTION_ITEM_SNOOZED', 'action_item', null, { keys: decisions, until })
  return { ok: true, applied, skipped }
}

/* ── P7-01 / P7-07 notifications ────────────────────────────────────────── */

const idList = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(str).filter(Boolean) : [])

/** notifications_mark_read(p_ids) → the number of the caller's own unread rows flipped (read_at stamped by the trigger). */
export function notificationsMarkRead(args: Args): Fns['notifications_mark_read']['Returns'] {
  const ids = idList(args.p_ids)
  if (ids.length > 500) raise('at most 500 notifications at a time')
  const me = uid()
  if (!me) raise('not authorized')
  const wanted = new Set(ids)
  const t = now()
  let count = 0
  for (const n of rows('notifications')) {
    if (n.user_id !== me || n.read || !wanted.has(n.id)) continue
    n.read = true; n.read_at = n.read_at ?? t; count++
  }
  return count
}

type Resolved = Fns['notification_resolve']['Returns'][number]
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
/** A payload id is used only when it is uuid-shaped — a malformed id is no subject, never an error. */
const uuidOf = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null)
/** The subject precedence (§2.5): report → task → blocker → submission → request → case.
 *  `visible` = the subject row is readable under the caller's RLS now (a row
 *  the caller cannot select does not exist for them); `label` null when not
 *  visible; a notification with no uuid subject is `visible=false`, kind null. */
function resolveSubject(payload: Record<string, unknown>): Omit<Resolved, 'id' | 'type'> {
  const me = profile()
  const fine = (subject_kind: string, subject_id: string, visible: boolean, label: string | null): Omit<Resolved, 'id' | 'type'> =>
    ({ subject_kind, subject_id, visible, label: visible ? label : null })
  const report = uuidOf(payload.report_id), task = uuidOf(payload.task_id), blocker = uuidOf(payload.blocker_id)
  const submission = uuidOf(payload.submission_id), request = uuidOf(payload.request_id), kase = uuidOf(payload.case_id)
  if (report) {
    const r = findRow('reports', report)
    // `reports` has no title column — the server labels a report by its kind.
    return fine('report', report, !!r && r.deleted_at == null && canReadCase(caseOf(r.case_id)), str(r?.kind) || null)
  }
  if (task) {
    const t = findRow('case_tasks', task)
    return fine('case_task', task, !!t && t.deleted_at == null && canReadCase(caseOf(t.case_id)), str(t?.title) || null)
  }
  if (blocker) {
    const b = findRow('case_blockers', blocker)
    return fine('case_blocker', blocker, !!b && b.deleted_at == null && canReadCase(caseOf(b.case_id)), str(b?.title) || null)
  }
  if (submission) {
    const s = findRow('field_submissions', submission) as Tables<'field_submissions'> | undefined
    return fine('field_submission', submission, readableAs(me, s), str(s?.submission_no) || null)
  }
  if (request) {
    const r = findRow('legal_requests', request) as Tables<'legal_requests'> | undefined
    return fine('legal', request, !!r && canViewLegalRequest(r), str(r?.request_number) || null)
  }
  if (kase) return fine('case', kase, canReadCase(caseOf(kase)), str(caseOf(kase)?.case_number) || null)
  return { subject_kind: null, subject_id: null, visible: false, label: null }
}

/** notification_resolve(p_ids) — SECURITY INVOKER: the caller's own rows only; the first 100 ids (no raise). */
export function notificationResolve(args: Args): Fns['notification_resolve']['Returns'] {
  const ids = idList(args.p_ids).slice(0, 100)
  const me = uid()
  if (!me) return []
  const wanted = new Set(ids)
  return rows('notifications')
    .filter((n) => n.user_id === me && wanted.has(n.id))
    .map((n) => ({ id: n.id, type: n.type, ...resolveSubject((n.payload ?? {}) as Record<string, unknown>) }))
}

/* ── P7-04 reassignment ─────────────────────────────────────────────────── */

/** The shared authority + target checks (§2.6 / §2.7). */
function reassignChecks(kase: MockRow | undefined, args: Args, noun: 'task' | 'blocker', currentHolder: unknown, closed: boolean, closedMessage: string): Profile {
  // Authority is answered BEFORE the row's state is described (a refused caller learns nothing about it).
  if (!canGrantCase(kase)) deny(`only the case lead or command can reassign a ${noun}`)
  if (kase!.archived_at != null) deny('that case is archived')
  if (closed) raise(closedMessage)
  if (str(args.p_reason).trim().length < 3) raise(`say why the ${noun} is being reassigned`)
  const target = profileOf(args.p_user)
  if (!userCanAccessCase(target, kase)) raise('that member cannot see this case')
  if (str(currentHolder) === target!.id) raise('already assigned to that member')
  return target!
}

/** action_reassign_task(p_task, p_user, p_reason) → void. */
export function actionReassignTask(args: Args): Fns['action_reassign_task']['Returns'] {
  const t = findRow('case_tasks', args.p_task)
  if (!t || t.deleted_at != null) raise('task not found')
  const kase = caseOf(t.case_id)
  const target = reassignChecks(kase, args, 'task', t.assignee, !!t.done || t.waived_at != null, 'that task is already closed')
  const from = (t.assignee as string | null) ?? null
  Object.assign(t, { assignee: target.id, updated_at: now() })
  audit('TASK_REASSIGNED', 'case_tasks', str(t.id), { case_id: str(t.case_id), from, to: target.id, reason: str(args.p_reason).trim() })
  actionNotify(target.id, 'task_assigned', { case_id: str(t.case_id), case_number: str(kase!.case_number), task_id: str(t.id) })
  return undefined
}

/** action_reassign_blocker(p_blocker, p_user, p_reason) → void. */
export function actionReassignBlocker(args: Args): Fns['action_reassign_blocker']['Returns'] {
  const b = findRow('case_blockers', args.p_blocker)
  if (!b || b.deleted_at != null) raise('blocker not found')
  const kase = caseOf(b.case_id)
  const target = reassignChecks(kase, args, 'blocker', b.owner_id, b.status !== 'open', 'that blocker is already resolved')
  const from = (b.owner_id as string | null) ?? null
  Object.assign(b, { owner_id: target.id, updated_at: now() })
  audit('BLOCKER_REASSIGNED', 'case_blockers', str(b.id), { case_id: str(b.case_id), from, to: target.id, reason: str(args.p_reason).trim() })
  actionNotify(target.id, 'blocker_assigned', { case_id: str(b.case_id), case_number: str(kase!.case_number), blocker_id: str(b.id) })
  return undefined
}

/* ── P7-03 escalation ───────────────────────────────────────────────────── */

const activeWith = (pred: (p: Profile) => boolean): string[] => rows('profiles').filter((p) => isActive(p) && pred(p)).map((p) => p.id)
const bureauLeads = (bureau: unknown) => activeWith((p) => p.role === 'bureau_lead' && p.division === bureau)
const deputies = () => activeWith((p) => p.role === 'deputy_director')
const directors = () => activeWith((p) => p.role === 'director')
const owners = () => activeWith((p) => !!p.is_owner)

interface Candidate { source_id: string; kase: MockRow; recipients: string[]; stage: string | null }
const accessible = (ids: string[], kase: MockRow) => ids.filter((id) => userCanAccessCase(profileOf(id), kase))
const liveCase = (c: MockRow | undefined): c is MockRow => !!c && c.deleted_at == null && c.archived_at == null
const openRow = (kind: string, sourceId: string) => rows('action_escalations').find((e) => e.kind === kind && e.source_id === sourceId && e.resolved_at == null)

/** Who qualifies right now, per kind — the sweep's SELECTs (§2.10); every
 *  recipient is filtered through the target-side access check (an SIU case
 *  never reaches CID command). */
function candidates(kind: string, afterHours: number, onlyCase: string | null): Candidate[] {
  const cutoff = Date.now() - afterHours * HOUR
  const out: Candidate[] = []
  const scoped = (caseId: unknown) => onlyCase == null || str(caseId) === onlyCase
  if (kind === 'signoff') {
    for (const c of rows('cases')) {
      if (!liveCase(c as unknown as MockRow) || !scoped(c.id) || !SIGNOFF_WAITING.has(c.signoff_status)) continue
      if (!c.signoff_submitted_at || Date.parse(c.signoff_submitted_at) >= cutoff) continue
      const kase = c as unknown as MockRow
      const pool = c.signoff_stage === 'bureau_lead' ? deputies() : c.signoff_stage === 'deputy' ? directors() : c.signoff_stage === 'director' ? owners() : [...deputies(), ...directors()]
      out.push({ source_id: c.id, kase, recipients: accessible(pool, kase), stage: c.signoff_stage })
    }
  } else if (kind === 'access_request') {
    for (const r of rows('case_access_requests')) {
      const kase = caseOf(r.case_id)
      if (r.status !== 'pending' || !kase || kase.deleted_at != null || !scoped(r.case_id) || Date.parse(r.created_at) >= cutoff) continue
      out.push({ source_id: r.id, kase, recipients: accessible([...bureauLeads(kase.bureau), ...deputies()], kase), stage: null })
    }
  } else if (kind === 'task_overdue') {
    for (const t of rows('case_tasks')) {
      if (t.done || t.waived_at != null || t.deleted_at != null || !t.due) continue
      const kase = caseOf(t.case_id)
      if (!liveCase(kase) || !scoped(t.case_id)) continue
      const due = Date.parse(t.due)
      if (Number.isNaN(due) || due >= cutoff) continue
      const lead = kase.lead_detective_id as string | null
      const pool = lead && lead !== t.assignee ? [lead] : bureauLeads(kase.bureau)
      out.push({ source_id: t.id, kase, recipients: accessible(pool, kase), stage: null })
    }
  }
  return out
}
/** The source no longer qualifies — approved / decided / done / deleted (for a
 *  sign-off row, also when the stage moved on: the next authority is told). */
function sourceClosed(e: Tables<'action_escalations'>): boolean {
  if (e.kind === 'signoff') { const c = caseOf(e.source_id); return !liveCase(c) || !SIGNOFF_WAITING.has(str(c.signoff_status)) || (c.signoff_stage ?? null) !== (e.stage ?? null) }
  if (e.kind === 'access_request') { const r = findRow('case_access_requests', e.source_id); return !r || r.status !== 'pending' || !caseOf(r.case_id) || caseOf(r.case_id)!.deleted_at != null }
  if (e.kind === 'task_overdue') { const t = findRow('case_tasks', e.source_id); return !t || !!t.done || t.waived_at != null || t.deleted_at != null || !liveCase(caseOf(t.case_id)) }
  return true
}
/** private.action_escalation_mark — insert, or re-open a resolved row (escalated_at now, resolved_at null, notified, stage). */
function escalationMark(kind: string, sourceId: string, caseId: string, notified: string[], stage: string | null): void {
  const existing = rows('action_escalations').find((e) => e.kind === kind && e.source_id === sourceId)
  if (existing) Object.assign(existing, { escalated_at: now(), resolved_at: null, notified, case_id: caseId, stage })
  else seedRows('action_escalations', [actionEscalationRow({ kind, source_id: sourceId, case_id: caseId, escalated_at: now(), notified, stage })])
}

/** private.action_escalation_sweep(p_only_case) — evaluate every enabled rule
 *  (over one case when scoped). Returns {kind: {escalated, resolved}} ×3. */
export function actionEscalationSweep(onlyCase: string | null = null): Record<string, { escalated: number; resolved: number }> {
  ensureActionRules()
  const out: Record<string, { escalated: number; resolved: number }> = {}
  const scoped = (e: Tables<'action_escalations'>) => onlyCase == null || e.case_id === onlyCase
  for (const kind of ['signoff', 'access_request', 'task_overdue']) {
    const counts = { escalated: 0, resolved: 0 }
    out[kind] = counts
    const resolve = () => {
      for (const e of rows('action_escalations')) {
        if (e.kind !== kind || e.resolved_at != null || !scoped(e) || !sourceClosed(e)) continue
        e.resolved_at = now(); counts.resolved++
      }
    }
    // A sign-off row whose stage moved on is resolved FIRST so the next authority is told below.
    if (kind === 'signoff') resolve()
    const rule = rows('action_escalation_rules').find((r) => r.kind === kind)
    if (rule?.enabled) {
      for (const c of candidates(kind, rule.after_hours, onlyCase)) {
        if (openRow(kind, c.source_id)) continue
        const creator = profileOf(c.kase.created_by) ?? null
        const notified = c.recipients.filter((r) => actionNotify(r, 'action_escalated', {
          kind, source_id: c.source_id, case_id: str(c.kase.id), case_number: str(c.kase.case_number),
        }, creator))
        escalationMark(kind, c.source_id, str(c.kase.id), notified, c.stage)
        audit('ACTION_ESCALATED', ESCALATION_ENTITY[kind], c.source_id, { kind, case_id: str(c.kase.id), notified }, null)
        counts.escalated++
      }
    }
    if (kind !== 'signoff') resolve()
  }
  return out
}

/** action_escalation_run() — Owner only; the job wrapper's ledger row + ACTION_ESCALATION_RUN. */
export function actionEscalationRun(): Fns['action_escalation_run']['Returns'] {
  if (!isOwner()) return denied('only the Owner may run the escalation sweep')
  const started = now()
  const counts = actionEscalationSweep()
  seedRows('scheduled_job_runs', [{ id: getRows('scheduled_job_runs').length + 1, job: 'action_escalation_sweep', started_at: started, finished_at: now(), status: 'ok', detail: counts }])
  audit('ACTION_ESCALATION_RUN', 'action_escalations', null, counts)
  return { ok: true, ...counts }
}

const RLS_TEST_EMAIL = /^rls-test-.*@cidportal\.test$/
/** rls_test_escalation_run(p_case) — the fixture-scoped runner: a test-fixture
 *  caller, a fixture-created case, the sweep over that ONE case. */
export function rlsTestEscalationRun(args: Args): Fns['rls_test_escalation_run']['Returns'] {
  const me = profile()
  if (!me || !RLS_TEST_EMAIL.test(me.email ?? '')) raise('rls_test_escalation_run: caller is not a test fixture')
  const kase = caseOf(args.p_case)
  const creator = kase ? profileOf(kase.created_by) : undefined
  if (!creator || !RLS_TEST_EMAIL.test(creator.email ?? '')) raise('rls_test_escalation_run: case is not fixture-owned')
  return { ok: true, ...actionEscalationSweep(str(args.p_case)) }
}

/** action_escalation_rule_set(p_kind, p_after_hours, p_enabled) — Owner only; returns {ok:true} || the row. */
export function actionEscalationRuleSet(args: Args): Fns['action_escalation_rule_set']['Returns'] {
  if (!isOwner()) return denied('only the Owner may change the escalation rules')
  ensureActionRules()
  const rule = rows('action_escalation_rules').find((r) => r.kind === str(args.p_kind))
  if (!rule) raise('unknown escalation rule')
  const hours = Number(args.p_after_hours)
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) raise('escalate after 1 to 720 hours')
  const from = { after_hours: rule.after_hours, enabled: rule.enabled }
  Object.assign(rule, { after_hours: hours, enabled: !!args.p_enabled, updated_at: now() })
  audit('ACTION_ESCALATION_RULE_SET', 'action_escalation_rules', null, { kind: rule.kind, from, to: { after_hours: hours, enabled: !!args.p_enabled } })
  return { ok: true, ...rule }
}

/* ── Registry ───────────────────────────────────────────────────────────── */

/** fn → handler. Void RPCs answer 204; a raise answers PostgREST's 400. */
export const ACTION_RPCS: Record<string, (args: Args) => unknown> = {
  action_item_set_state: actionItemSetState,
  action_item_set_state_many: actionItemSetStateMany,
  notifications_mark_read: notificationsMarkRead,
  notification_resolve: notificationResolve,
  action_reassign_task: actionReassignTask,
  action_reassign_blocker: actionReassignBlocker,
  action_escalation_run: actionEscalationRun,
  action_escalation_rule_set: actionEscalationRuleSet,
  rls_test_escalation_run: rlsTestEscalationRun,
}

const pgError = (status: number, code: string, message: string) =>
  HttpResponse.json({ code, details: null, hint: null, message }, { status })

/** The Phase 7 routes: one explicit rpc route per function (registered
 *  BEFORE the generic rpc catch-all in handlers/index.ts, honouring the same
 *  scenario switches — offline / latency / rpcResult overrides) and the
 *  grant denial on every write to the three RPC-only tables. Reads fall
 *  through to postgrest.ts (visibleActionRows). */
export const actionHandlers = [
  ...Object.entries(ACTION_RPCS).map(([fn, impl]) =>
    http.post(`${supabaseBaseUrl()}/rest/v1/rpc/${fn}`, async ({ request }) => {
      if (isOffline()) return HttpResponse.error()
      const ms = getLatency()
      if (ms > 0) await delay(ms)
      const override = getRpcOverride(fn)
      if (override.hit) return HttpResponse.json(override.result as Parameters<typeof HttpResponse.json>[0])
      const args = (await request.json().catch(() => ({}))) as Args
      try {
        const out = impl(args)
        return out === undefined ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(out as Parameters<typeof HttpResponse.json>[0])
      } catch (e) {
        if (e instanceof ActionRpcError) return pgError(400, e.code, e.message)
        throw e
      }
    })),
  ...ACTION_RPC_ONLY_TABLES.flatMap((table) => {
    const refuse = () => pgError(403, '42501', `permission denied for table ${table}`)
    const url = `${supabaseBaseUrl()}/rest/v1/${table}`
    return [http.post(url, refuse), http.patch(url, refuse), http.delete(url, refuse)]
  }),
]

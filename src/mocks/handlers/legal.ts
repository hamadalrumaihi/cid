/** Legal-workflow mocks (Portal Improvements plan, Phase 4 — P4-01 … P4-11;
 *  migrations 20261024120000_legal_tables → 20261027120000_legal_sweeps).
 *
 *  The CONTRACT of the server functions, answered from the mock DB — never
 *  a second implementation of the server's audit ledger or its authority
 *  model. Three surfaces:
 *
 *   · READS of the new tables (legal_request_charges / _comments /
 *     _comment_versions / _revision_items / _target_decisions / _reminders,
 *     legal_expiry_defaults, legal_export_log) are filtered to the requests
 *     the session can view — `canViewLegalRequest`, the mock reading of
 *     private.can_view_legal_request after P4-01 (creator, active
 *     participant, Owner, AG once submitted_to_judge_at is set, a judge for
 *     the non-sealed judicial queue, command while a request sits in CID
 *     review, any active member for a `standard` request). The generic
 *     table handler runs those tables through `visibleLegalRows`; every
 *     write to them is refused with 42501 by `legalHandlers` (RPC-only).
 *   · The routing RPCs honour the new graph: review_legal_request_as_cid
 *     approve → `submitted_to_judge`; decide_legal_request_as_judge approve
 *     with a denied target → `partially_approved` (scope frozen into the
 *     judicial version); claim_legal_request_as_judge refuses sealed rows;
 *     submit_legal_request_to_cid enforces the P4-04 warrant keys and the
 *     resubmission change summary. These RETURN the legal_requests row and
 *     RAISE (LegalRpcError → PostgREST 400) exactly where the server raises.
 *   · The jsonb RPCs (legal_set_charges, legal_comment*, legal_revision_resolve,
 *     legal_add_evidence_and_exhibit, legal_amend, legal_set_observer,
 *     legal_record_export, legal_sweep_run) answer {ok:true,…} or
 *     {ok:false, code:'denied', message} for authority refusals and raise
 *     only on hard validation errors, as the server does.
 *  Anything richer is pinned with scenarios.rpcResult(). */
import { http, HttpResponse } from 'msw'
import type { Database, Json, Tables } from '@/lib/database.types'
import { supabaseBaseUrl } from '../env'
import { getDenial, getRows, mockId, seedRows, setRows, type MockRow, type MockTableName } from '../store'
import { findRow, isActive, isCommand, isOwner, profile, uid } from './entity'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type Req = Tables<'legal_requests'>
type Denied = { ok: false; code: 'denied'; message: string }

const str = (v: unknown): string => (v == null ? '' : String(v))
const blank = (v: unknown): boolean => str(v).trim() === ''
const now = () => new Date().toISOString()
const HOUR = 3_600_000
const DAY = 24 * HOUR

/** A server `raise` — rpc.ts turns it into PostgREST's 400 error shape. */
export class LegalRpcError extends Error {
  code: string
  constructor(message: string, code = 'P0001') { super(message); this.code = code }
}
const raise = (message: string): never => { throw new LegalRpcError(message) }
const denied = (message: string): Denied => ({ ok: false, code: 'denied', message })

/* ── Vocabulary (mirrors of the migration CHECKs) ───────────────────────── */

/** RPC-only tables: no client INSERT / UPDATE / DELETE, ever. */
export const LEGAL_RPC_ONLY_TABLES: readonly MockTableName[] = [
  'legal_request_charges', 'legal_request_comments', 'legal_request_comment_versions',
  'legal_request_revision_items', 'legal_request_target_decisions', 'legal_request_reminders',
  'legal_expiry_defaults', 'legal_export_log',
]
const LEGAL_TABLES = new Set<MockTableName>(LEGAL_RPC_ONLY_TABLES)

/** private.can_edit_legal_draft — unchanged server-side (+ retired returned_* for history). */
const EDITABLE = new Set(['not_submitted', 'returned_by_cid', 'returned_by_siu_command', 'returned_by_judge',
  'returned_by_prosecutor', 'returned_by_ada', 'returned_by_da', 'returned_by_ag'])
const RETURNED = new Set([...EDITABLE].filter((s) => s !== 'not_submitted'))
const CID_REVIEW = new Set(['cid_supervisor_review', 'siu_command_review'])
const JUDGE_QUEUE = new Set(['submitted_to_judge', 'judicial_review'])
const WITHDRAW_TERMINAL = new Set(['approved', 'partially_approved', 'denied', 'withdrawn', 'declined', 'cancelled', 'superseded'])
const AMENDABLE = new Set(['approved', 'partially_approved', 'denied', 'superseded', 'withdrawn', 'cancelled'])
const STANDARDS = new Set(['probable_cause', 'reasonable_suspicion'])
const PENDING_STAGES = new Set(['cid_supervisor_review', 'siu_command_review', 'submitted_to_judge', 'judicial_review'])
const COMMAND_FALLBACK = new Set(['deputy_director', 'director'])
/** legal_expiry_defaults seed, used when a spec seeded no rows. */
const EXPIRY_SEED: Record<string, number> = { arrest_warrant: 30, search_warrant: 14 }

/* ── Session ────────────────────────────────────────────────────────────── */

/** The session's live justice role — judge | attorney_general | null. A
 *  prosecutor / ADA / DA membership is history and confers nothing (L16). */
export function justiceRole(): 'judge' | 'attorney_general' | null {
  const me = uid()
  if (!me) return null
  const m = (getRows('justice_memberships') as unknown as Tables<'justice_memberships'>[])
    .find((r) => r.user_id === me && r.active && r.ended_at == null && (!r.expires_at || Date.parse(r.expires_at) > Date.now()))
  return m?.justice_role === 'judge' || m?.justice_role === 'attorney_general' ? m.justice_role : null
}
const isJudge = () => justiceRole() === 'judge'
const isAG = () => justiceRole() === 'attorney_general'
const activeJudges = (): string[] =>
  (getRows('justice_memberships') as unknown as Tables<'justice_memberships'>[])
    .filter((r) => r.justice_role === 'judge' && r.active && r.ended_at == null).map((r) => r.user_id)
const activeAGs = (): string[] =>
  (getRows('justice_memberships') as unknown as Tables<'justice_memberships'>[])
    .filter((r) => r.justice_role === 'attorney_general' && r.active && r.ended_at == null).map((r) => r.user_id)
const activeJustice = (id: string) =>
  (getRows('justice_memberships') as unknown as Tables<'justice_memberships'>[]).some((r) => r.user_id === id && r.active && r.ended_at == null)

/* ── Rows ───────────────────────────────────────────────────────────────── */

const requestOf = (id: unknown): Req | undefined => findRow('legal_requests', id) as Req | undefined
const rows = <T extends MockTableName>(table: T): Tables<T>[] =>
  (getDenial(table) ? [] : getRows(table)) as unknown as Tables<T>[]

const activeParticipants = (requestId: string): Tables<'legal_request_participants'>[] =>
  rows('legal_request_participants').filter((p) => p.legal_request_id === requestId && p.removed_at == null)
const isParticipant = (r: Req, id = uid()) => !!id && activeParticipants(r.id).some((p) => p.user_id === id)

/** private.can_view_legal_request(p_request, auth.uid()) after P4-01. */
export function canViewLegalRequest(r: Req): boolean {
  const me = uid()
  if (!me || !r) return false
  if (r.created_by === me || isParticipant(r, me) || isOwner()) return true
  if (isAG() && r.submitted_to_judge_at != null) return true
  if (isJudge() && JUDGE_QUEUE.has(r.review_status) && r.classification !== 'sealed') return true
  if (isCommand() && CID_REVIEW.has(r.review_status)) return true
  // The entity layer has no case-access model beyond "active member".
  return r.classification === 'standard' && isActive()
}
/** private.can_approve_legal — the Bureau Lead+ / Owner pool, never the creator. */
const canApproveLegal = (r: Req) => isCommand() && r.created_by !== uid()
const canEditDraft = (r: Req) => r.created_by === uid() && EDITABLE.has(r.review_status)

/** The generic table handler runs the Phase 4 legal tables through this. */
export function visibleLegalRows(table: MockTableName, list: MockRow[]): MockRow[] {
  if (!LEGAL_TABLES.has(table)) return list
  if (table === 'legal_expiry_defaults') return isActive() ? list : []
  const viewable = (id: unknown) => { const r = requestOf(id); return !!r && canViewLegalRequest(r) }
  if (table === 'legal_request_comment_versions') {
    return list.filter((v) => { const c = findRow('legal_request_comments', v.comment_id); return !!c && viewable(c.legal_request_id) })
  }
  return list.filter((row) => viewable(row.legal_request_id))
}

/* ── Writers shared by the RPCs ─────────────────────────────────────────── */

function logAction(r: Req, action: string, from: string | null, to: string | null, note: string | null = null, versionId: string | null = null): Tables<'legal_request_actions'> {
  const [row] = seedRows('legal_request_actions', [{
    action, actor_id: uid() ?? r.created_by, created_at: now(), from_status: from, id: mockId(),
    internal_note: null, legal_request_id: r.id, public_note: note, to_status: to, version_id: versionId,
  }])
  return row
}

/** Sealed payloads carry only {request_id, sealed:true}; others stay minimal. */
function payloadFor(r: Req, extra: Record<string, Json> = {}): Json {
  return r.classification === 'sealed'
    ? { request_id: r.id, sealed: true }
    : { request_id: r.id, request_number: r.request_number, title: r.title, ...extra }
}
function notify(userIds: Iterable<string>, kind: string, payload: Json): number {
  const me = uid()
  const targets = [...new Set(userIds)].filter((id) => id && id !== me)
  seedRows('notifications', targets.map((user_id) => ({ created_at: now(), id: mockId(), payload, read: false, read_at: null, type: kind, user_id })))
  return targets.length
}
/** creator + active participants + assigned judge — the fan-out set. */
function audienceOf(r: Req): string[] {
  return [r.created_by, ...activeParticipants(r.id).map((p) => p.user_id), ...(r.assigned_judge_id ? [r.assigned_judge_id] : [])]
}
function addParticipant(r: Req, userId: string, role: string): void {
  if (activeParticipants(r.id).some((p) => p.user_id === userId && p.participant_role === role)) return
  seedRows('legal_request_participants', [{ added_at: now(), added_by: uid() ?? r.created_by, legal_request_id: r.id, participant_role: role, removed_at: null, removed_by: null, user_id: userId }])
}

/** The stage_entered_at trigger: every status change restarts the clock and
 *  clears the reminder marks. */
function setStatus(r: Req, status: string, patch: Partial<Req> = {}): void {
  Object.assign(r, { review_status: status, stage_entered_at: now(), nudged_at: null, escalated_at: null, updated_at: now(), ...patch })
}
const currentVersion = (r: Req): Tables<'legal_request_versions'> | undefined =>
  rows('legal_request_versions').find((v) => v.id === r.current_version_id)
    ?? rows('legal_request_versions').filter((v) => v.legal_request_id === r.id).sort((a, b) => b.version_number - a.version_number)[0]
function freezeVersion(r: Req, stage: string, summary: string | null, extra: Record<string, Json> = {}): Tables<'legal_request_versions'> {
  const n = rows('legal_request_versions').filter((v) => v.legal_request_id === r.id).length + 1
  const charges = rows('legal_request_charges').filter((c) => c.legal_request_id === r.id)
    .map((c) => ({ case_charge_id: c.case_charge_id, counts: c.counts, snap_code: c.snap_code, snap_offense: c.snap_offense, snap_charge_class: c.snap_charge_class }))
  const [v] = seedRows('legal_request_versions', [{
    change_summary: summary, content_hash: null, created_at: now(), created_by: uid() ?? r.created_by,
    form_data: { ...(r.form_data as Record<string, Json>), _charges: charges, ...extra },
    id: mockId(), legal_request_id: r.id, narrative: r.narrative, packet_manifest: [], returned_from: null,
    submitted_stage: stage, version_number: n,
  }])
  r.current_version_id = v.id
  return v
}
function expiryDays(subtype: string): number {
  const seeded = rows('legal_expiry_defaults').find((d) => d.subtype === subtype)
  return seeded?.days ?? EXPIRY_SEED[subtype] ?? 14
}
function insertRevisionItems(r: Req, actionId: string, items: unknown): void {
  if (!Array.isArray(items)) return
  seedRows('legal_request_revision_items', items.filter((i) => i && typeof i === 'object' && !blank((i as Args).note)).map((i) => ({
    action_id: actionId, created_at: now(), created_by: uid(), field: (i as Args).field == null ? null : str((i as Args).field),
    id: mockId(), legal_request_id: r.id, note: str((i as Args).note), resolution_note: null, resolved_at: null, resolved_by: null,
  })))
}

/* ── Routing RPCs (return the row, raise on refusal) ────────────────────── */

function requireRequest(args: Args): Req {
  const r = requestOf(args.p_request)
  if (!r || !canViewLegalRequest(r)) return raise('request not found')
  return r
}

/** submit_legal_request_to_cid(p_request, p_change_summary, p_material_change). */
export function submitLegalRequestToCid(args: Args): Req {
  const r = requestOf(args.p_request)
  if (!r) return raise('request not found')
  if (r.created_by !== uid() || !EDITABLE.has(r.review_status)) return raise('only the creator may submit an editable request')
  const form = (r.form_data ?? {}) as Record<string, Json>
  if (r.request_type === 'warrant') {
    if (!STANDARDS.has(str(form.standard_of_proof))) return raise('a warrant needs a standard of proof (probable cause or reasonable suspicion)')
    if (blank(form.pc_statement)) return raise('a warrant needs a probable-cause statement')
  }
  const from = r.review_status
  const summary = blank(args.p_change_summary) ? null : str(args.p_change_summary).trim()
  if (RETURNED.has(from) && !summary) return raise('a change summary is required when resubmitting')
  const material = args.p_material_change === true
  const siu = from === 'returned_by_siu_command' || from === 'siu_command_review'
  const gate = siu ? 'siu_command_review' : 'cid_supervisor_review'
  const fast = from === 'returned_by_judge' && !material
  const to = fast ? 'submitted_to_judge' : gate
  const v = freezeVersion(r, to, summary)
  setStatus(r, to, {
    document_status: 'finalized', submitted_to_cid_at: r.submitted_to_cid_at ?? now(),
    ...(fast ? { submitted_to_judge_at: now(), assigned_judge_id: null } : {}),
  })
  if (material) logAction(r, 'material_change_declared', from, to, summary, v.id)
  logAction(r, fast ? 'resubmitted_to_judge' : from === 'not_submitted' ? 'submitted_to_cid' : 'resubmitted_to_cid', from, to, summary, v.id)
  addParticipant(r, r.created_by, 'creator')
  return r
}

/** review_legal_request_as_cid(p_request, p_decision, p_note, p_override_reason, p_signature, p_revision_items). */
export function reviewLegalRequestAsCid(args: Args): Req {
  const r = requireRequest(args)
  if (!CID_REVIEW.has(r.review_status)) return raise('request is not awaiting CID review')
  if (!canApproveLegal(r)) return raise("only the responsible bureau's Bureau Lead (or command fallback) may decide, never the creator")
  const decision = str(args.p_decision)
  const note = blank(args.p_note) ? null : str(args.p_note)
  const from = r.review_status
  const siu = from === 'siu_command_review'
  const me = uid()!
  const reviewed = { cid_reviewed_by: me, cid_reviewed_at: now(), cid_reviewed_role: profile()?.role ?? null }
  addParticipant(r, me, siu ? 'siu_command' : 'cid_supervisor')
  if (decision === 'approve') {
    setStatus(r, 'submitted_to_judge', { ...reviewed, submitted_to_judge_at: now(), assigned_judge_id: null })
    logAction(r, siu ? 'siu_command_approved' : 'cid_approved', from, 'submitted_to_judge', note, r.current_version_id)
    logAction(r, 'submitted_to_judge', from, 'submitted_to_judge', null, r.current_version_id)
    // Fan-out: every active judge (sealed → the AG), plus AG oversight for SIB.
    notify(r.classification === 'sealed' ? activeAGs() : activeJudges(), 'legal_request', payloadFor(r))
    if (siu) notify(activeAGs(), 'legal_update', payloadFor(r))
    notify([r.created_by], 'legal_update', payloadFor(r, { stage: 'submitted_to_judge' }))
    return r
  }
  if (decision === 'return') {
    const to = siu ? 'returned_by_siu_command' : 'returned_by_cid'
    setStatus(r, to, { ...reviewed, document_status: 'reopened' })
    const a = logAction(r, siu ? 'siu_command_returned' : 'cid_returned', from, to, note, r.current_version_id)
    insertRevisionItems(r, a.id, args.p_revision_items)
    notify([r.created_by], 'legal_update', payloadFor(r, { stage: to }))
    return r
  }
  if (decision === 'deny') {
    setStatus(r, 'denied', { ...reviewed, decision: 'denied', decided_by: me, decided_at: now(), decision_note: note })
    logAction(r, siu ? 'siu_command_denied' : 'cid_denied', from, 'denied', note, r.current_version_id)
    notify([r.created_by], 'legal_decision', payloadFor(r, { decision: 'denied' }))
    return r
  }
  return raise('invalid decision')
}

/** claim_legal_request_as_judge(p_request) — sealed rows are assigned, never claimed. */
export function claimLegalRequestAsJudge(args: Args): Req {
  if (!isJudge()) return raise('only an active Judge may claim a request')
  const r = requestOf(args.p_request)
  if (!r) return raise('request not found')
  if (r.classification === 'sealed') return raise('sealed requests are assigned by the Attorney General')
  if (r.review_status !== 'submitted_to_judge') return raise('request is not awaiting judicial review')
  if (r.created_by === uid()) return raise('conflict of role: you are a party to this request')
  const me = uid()!
  setStatus(r, 'judicial_review', { assigned_judge_id: me })
  addParticipant(r, me, 'judge')
  logAction(r, 'judge_claimed', 'submitted_to_judge', 'judicial_review')
  return r
}

/** assign_judge(p_request, p_judge) — AG or Owner only. */
export function assignJudge(args: Args): Req {
  if (!isAG() && !isOwner()) return raise('only the Attorney General or the Owner may assign a judge')
  const r = requestOf(args.p_request)
  if (!r) return raise('request not found')
  const judge = str(args.p_judge)
  if (!activeJudges().includes(judge)) return raise('the assignee must be an active Judge')
  if (!JUDGE_QUEUE.has(r.review_status)) return raise('request is not awaiting judicial review')
  setStatus(r, 'judicial_review', { assigned_judge_id: judge })
  addParticipant(r, judge, 'judge')
  logAction(r, 'judge_assigned', r.review_status, 'judicial_review')
  notify([judge], 'legal_request', payloadFor(r))
  return r
}

type TargetDecision = { target_key: string; exhibit_id: string | null; decision: string; reasoning: string | null }
function parseTargets(v: unknown): TargetDecision[] {
  if (!Array.isArray(v)) return []
  return v.filter((t) => t && typeof t === 'object').map((t) => ({
    target_key: str((t as Args).target_key), exhibit_id: (t as Args).exhibit_id == null ? null : str((t as Args).exhibit_id),
    decision: str((t as Args).decision), reasoning: blank((t as Args).reasoning) ? null : str((t as Args).reasoning),
  }))
}

/** decide_legal_request_as_judge(p_request, p_decision, p_note, p_conditions,
 *  p_expires_at, p_signature, p_target_decisions, p_revision_items). */
export function decideLegalRequestAsJudge(args: Args): Req {
  const r = requestOf(args.p_request)
  if (!r) return raise('request not found')
  if (r.review_status !== 'judicial_review' || r.assigned_judge_id !== uid() || !isJudge()) return raise('only the assigned judge may decide a request under judicial review')
  const note = blank(args.p_note) ? null : str(args.p_note)
  if (!note) return raise('a judicial decision requires recorded reasoning')
  const decision = str(args.p_decision)
  const me = uid()!
  const from = r.review_status
  if (decision === 'approve') {
    const targets = parseTargets(args.p_target_decisions)
    for (const t of targets) if (t.decision !== 'approved' && t.decision !== 'denied') return raise('target decisions are approved or denied')
    const anyDenied = targets.some((t) => t.decision === 'denied')
    if (anyDenied && !targets.some((t) => t.decision === 'approved')) return raise('deny the request instead of denying every target')
    const to = anyDenied ? 'partially_approved' : 'approved'
    const v = freezeVersion(r, to, null, { _target_decisions: targets as unknown as Json })
    seedRows('legal_request_target_decisions', targets.map((t) => ({
      decided_at: now(), decided_by: me, decision: t.decision, exhibit_id: t.exhibit_id, id: mockId(),
      legal_request_id: r.id, reasoning: t.reasoning, target_key: t.target_key, version_id: v.id,
    })))
    const expires = r.request_type === 'warrant'
      ? (blank(args.p_expires_at) ? new Date(Date.now() + expiryDays(r.subtype) * DAY).toISOString() : str(args.p_expires_at))
      : r.expires_at
    setStatus(r, to, {
      decision: to, decided_by: me, decided_at: now(), decision_note: note,
      judicial_conditions: blank(args.p_conditions) ? null : str(args.p_conditions), expires_at: expires,
    })
    logAction(r, anyDenied ? 'partially_approved' : 'judge_approved', from, to, note, v.id)
    notify([r.created_by], 'legal_decision', payloadFor(r, { decision: to }))
    return r
  }
  if (decision === 'deny') {
    setStatus(r, 'denied', { decision: 'denied', decided_by: me, decided_at: now(), decision_note: note })
    logAction(r, 'judge_denied', from, 'denied', note, r.current_version_id)
    notify([r.created_by], 'legal_decision', payloadFor(r, { decision: 'denied' }))
    return r
  }
  if (decision === 'return') {
    setStatus(r, 'returned_by_judge', { document_status: 'reopened', assigned_judge_id: null })
    const a = logAction(r, 'judge_returned', from, 'returned_by_judge', note, r.current_version_id)
    insertRevisionItems(r, a.id, args.p_revision_items)
    notify([r.created_by], 'legal_update', payloadFor(r, { stage: 'returned_by_judge' }))
    return r
  }
  return raise('invalid decision')
}

/** withdraw_legal_request(p_request, p_note) — creator, pre-decision only. */
export function withdrawLegalRequest(args: Args): Req {
  const r = requestOf(args.p_request)
  if (!r || r.created_by !== uid()) return raise('only the creator may withdraw a request')
  if (WITHDRAW_TERMINAL.has(r.review_status)) return raise('the request has already been decided or closed')
  const from = r.review_status
  setStatus(r, 'withdrawn')
  logAction(r, 'withdrawn', from, 'withdrawn', blank(args.p_note) ? null : str(args.p_note))
  return r
}

/* ── jsonb RPCs ({ok} / {ok:false, code} — raise only on hard validation) ── */

export function legalSetCharges(args: Args): Fns['legal_set_charges']['Returns'] {
  const r = requestOf(args.p_request)
  if (!r || !canEditDraft(r)) return denied('only the creator may set charges on an editable request')
  const items = Array.isArray(args.p_items) ? args.p_items as Args[] : []
  const picked: Tables<'legal_request_charges'>[] = []
  for (const item of items) {
    const cc = rows('case_charges').find((c) => c.id === str(item.case_charge_id))
    if (!cc || cc.case_id !== r.case_id) return raise("every charge must belong to the request's case")
    const counts = Number(item.counts ?? 1)
    if (!Number.isInteger(counts) || counts < 1 || counts > 999) return raise('counts must be between 1 and 999')
    if (picked.some((p) => p.case_charge_id === cc.id)) continue
    picked.push({
      added_by: uid(), case_charge_id: cc.id, counts, created_at: now(), id: mockId(), legal_request_id: r.id,
      snap_charge_class: cc.snap_charge_class, snap_code: cc.snap_code, snap_offense: cc.snap_offense, snap_penal_title: cc.snap_penal_title,
    })
  }
  setRows('legal_request_charges', getRows('legal_request_charges').filter((c) => c.legal_request_id !== r.id))
  seedRows('legal_request_charges', picked)
  logAction(r, 'charges_set', r.review_status, r.review_status, `${picked.length} charge(s)`)
  return { ok: true, count: picked.length }
}

/** Who may comment: creator, active participant, the approver pool, AG when visible, Owner. */
function canComment(r: Req): boolean {
  if (!canViewLegalRequest(r)) return false
  return r.created_by === uid() || isParticipant(r) || canApproveLegal(r) || isAG() || isOwner()
}
export function legalComment(args: Args): Fns['legal_comment']['Returns'] {
  const r = requestOf(args.p_request)
  if (!r || !canComment(r)) return denied('you may not comment on this request')
  if (blank(args.p_body)) return raise('a comment needs a body')
  let parent: string | null = null
  if (args.p_parent != null) {
    const p = findRow('legal_request_comments', args.p_parent)
    if (!p || p.legal_request_id !== r.id) return raise('parent comment not found on this request')
    parent = str(p.id)
  }
  const [c] = seedRows('legal_request_comments', [{
    author_id: uid()!, body: str(args.p_body).trim(), created_at: now(), deleted_at: null, deleted_by: null,
    edited_at: null, id: mockId(), legal_request_id: r.id, parent_id: parent,
  }])
  notify(audienceOf(r), 'legal_comment', payloadFor(r, { comment_id: c.id }))
  return { ok: true, id: c.id }
}
function fileVersion(c: MockRow): void {
  seedRows('legal_request_comment_versions', [{ body: str(c.body), comment_id: str(c.id), edited_at: now(), edited_by: uid(), id: mockId() }])
}
export function legalCommentEdit(args: Args): Fns['legal_comment_edit']['Returns'] {
  const c = findRow('legal_request_comments', args.p_comment)
  if (!c || c.author_id !== uid() || c.deleted_at != null) return denied('only the author may edit a comment')
  if (blank(args.p_body)) return raise('a comment needs a body')
  fileVersion(c)
  Object.assign(c, { body: str(args.p_body).trim(), edited_at: now() })
  return { ok: true }
}
export function legalCommentDelete(args: Args): Fns['legal_comment_delete']['Returns'] {
  const c = findRow('legal_request_comments', args.p_comment)
  if (!c || c.deleted_at != null || !(c.author_id === uid() || isAG() || isOwner())) return denied('only the author, the Attorney General or the Owner may delete a comment')
  fileVersion(c)
  Object.assign(c, { body: '', deleted_at: now(), deleted_by: uid() })
  return { ok: true }
}

export function legalRevisionResolve(args: Args): Fns['legal_revision_resolve']['Returns'] {
  const item = findRow('legal_request_revision_items', args.p_item)
  const r = item ? requestOf(item.legal_request_id) : undefined
  if (!item || !r || !canEditDraft(r)) return denied('only the creator may resolve a revision item on an editable request')
  Object.assign(item, { resolved_at: now(), resolved_by: uid(), resolution_note: blank(args.p_note) ? null : str(args.p_note) })
  return { ok: true }
}

export function legalAddEvidenceAndExhibit(args: Args): Fns['legal_add_evidence_and_exhibit']['Returns'] {
  const r = requestOf(args.p_request)
  if (!r || !canEditDraft(r)) return denied('only the creator may add evidence to an editable request')
  if (blank(args.p_title) || blank(args.p_external_url)) return raise('a title and a media URL are required')
  const [m] = seedRows('media', [{
    archived_at: null, case_id: r.case_id, category: blank(args.p_category) ? null : str(args.p_category), created_at: now(),
    delete_batch: null, delete_reason: null, deleted_at: null, deleted_by: null, evidence_designated_at: null, evidence_designated_by: null,
    evidence_ref: null, external_url: str(args.p_external_url), featured: false, gang_id: null, id: mockId(), kind: 'legal_upload',
    narcotic_id: null, observation_id: null, person_id: null, place_id: null, report_id: null, restricted: false, storage_path: null,
    tags: [], title: str(args.p_title), type: str(args.p_type) as Tables<'media'>['type'], updated_at: now(), uploaded_by: uid(), vehicle_id: null,
  }])
  const [ex] = seedRows('legal_request_exhibits', [{
    added_by: uid()!, created_at: now(), display_title: m.title ?? 'Evidence', exhibit_type: 'case_media', id: mockId(),
    legal_request_id: r.id, rationale: blank(args.p_rationale) ? null : str(args.p_rationale),
    snapshot_metadata: { url: m.external_url, type: m.type }, source_id: m.id, version_id: null,
  }])
  logAction(r, 'evidence_added', r.review_status, r.review_status, m.title)
  return { ok: true, media_id: m.id, exhibit_id: ex.id }
}

export function legalAmend(args: Args): Fns['legal_amend']['Returns'] {
  const src = requestOf(args.p_request)
  if (!src || !canViewLegalRequest(src) || !isActive()) return denied('you may not amend this request')
  if (!AMENDABLE.has(src.review_status)) return raise('only a decided, superseded, withdrawn or cancelled request can be amended')
  if (blank(args.p_reason)) return raise('a reason is required to amend a request')
  const form = Object.fromEntries(Object.entries((src.form_data ?? {}) as Record<string, Json>).filter(([k]) => !k.startsWith('_')))
  const n = getRows('legal_requests').length + 1
  const [dup] = seedRows('legal_requests', [{
    ...src, id: mockId(), request_number: `LR-26-${String(n).padStart(4, '0')}`, created_by: uid()!, created_at: now(), updated_at: now(),
    amends_request_id: src.id, review_status: 'not_submitted', document_status: 'draft', fulfilment_status: 'unissued',
    form_data: form, current_version_id: null, decision: null, decided_by: null, decided_at: null, decision_note: null,
    judicial_conditions: null, expires_at: null, issued_at: null, issued_by: null, assigned_judge_id: null, assigned_prosecutor_id: null,
    cid_reviewed_at: null, cid_reviewed_by: null, cid_reviewed_role: null, submitted_to_cid_at: null, submitted_to_judge_at: null,
    submitted_to_doj_at: null, stage_entered_at: now(), nudged_at: null, escalated_at: null, superseded_by_id: null,
    closed_at: null, closed_by: null, close_note: null, response_deadline: null,
  }])
  seedRows('legal_request_exhibits', rows('legal_request_exhibits').filter((e) => e.legal_request_id === src.id)
    .map((e) => ({ ...e, id: mockId(), legal_request_id: dup.id, version_id: null, created_at: now() })))
  seedRows('legal_request_charges', rows('legal_request_charges').filter((c) => c.legal_request_id === src.id)
    .map((c) => ({ ...c, id: mockId(), legal_request_id: dup.id, created_at: now() })))
  logAction(dup, 'amended_from', null, 'not_submitted', str(args.p_reason))
  return { ok: true, id: dup.id, request_number: dup.request_number }
}

export function legalSetObserver(args: Args): Fns['legal_set_observer']['Returns'] {
  const r = requestOf(args.p_request)
  if (!r || !(isAG() || isOwner() || canApproveLegal(r) || r.created_by === uid())) return denied('you may not manage observers on this request')
  const target = str(args.p_user)
  const prof = (getRows('profiles') as unknown as Tables<'profiles'>[]).find((p) => p.id === target)
  if (!(prof && prof.active && prof.removed_at == null) && !activeJustice(target)) return raise('the observer must be an active member or justice member')
  const active = args.p_active !== false
  const existing = activeParticipants(r.id).find((p) => p.user_id === target && p.participant_role === 'observer')
  if (active) {
    if (!existing) {
      addParticipant(r, target, 'observer')
      logAction(r, 'observer_added', r.review_status, r.review_status, blank(args.p_reason) ? null : str(args.p_reason))
      notify([target], 'legal_observer', payloadFor(r))
    }
  } else if (existing) {
    Object.assign(existing, { removed_at: now(), removed_by: uid() })
    logAction(r, 'observer_removed', r.review_status, r.review_status, blank(args.p_reason) ? null : str(args.p_reason))
  }
  return { ok: true }
}

/** Deterministic 10-char code. The server uses upper(left(md5(version||request),10));
 *  the mock only guarantees the SHAPE and stability for a version. */
function verificationCode(seed: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  let h2 = 0x9e3779b9
  for (let i = seed.length - 1; i >= 0; i--) { h2 ^= seed.charCodeAt(i); h2 = Math.imul(h2, 0x85ebca6b) >>> 0 }
  return (h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 10).toUpperCase()
}
export function legalRecordExport(args: Args): Fns['legal_record_export']['Returns'] {
  const format = str(args.p_format), kind = str(args.p_kind)
  if (format !== 'pdf' && format !== 'docx') return raise('format must be pdf or docx')
  if (kind !== 'instrument' && kind !== 'packet') return raise('kind must be instrument or packet')
  const r = requestOf(args.p_request)
  if (!r || !canViewLegalRequest(r)) return denied('you may not export this request')
  if (kind === 'instrument' && r.review_status !== 'approved' && r.review_status !== 'partially_approved') return raise('only an approved request has an instrument to export')
  const v = currentVersion(r)
  const code = verificationCode(`${v?.id ?? ''}${r.id}`)
  const [row] = seedRows('legal_export_log', [{ exported_at: now(), exported_by: uid(), format, id: mockId(), kind, legal_request_id: r.id, verification_code: code, version_id: v?.id ?? null }])
  logAction(r, 'exported', r.review_status, r.review_status, `${kind} (${format})`, v?.id ?? null)
  return { ok: true, id: row.id, version_id: v?.id ?? null, verification_code: code }
}

/* ── Sweeps (P4-10) ─────────────────────────────────────────────────────── */

const commandOf = (bureau: string | null, roles: Set<string>): string[] =>
  (getRows('profiles') as unknown as Tables<'profiles'>[])
    .filter((p) => p.active && p.removed_at == null && roles.has(p.role ?? '') && (!bureau || p.division === bureau || roles.has('director')))
    .map((p) => p.id)
/** The party a nudge goes to (contract §8). */
function responsibleFor(r: Req): string[] {
  switch (r.review_status) {
    case 'cid_supervisor_review': return commandOf(r.responsible_bureau, new Set(['bureau_lead']))
    case 'submitted_to_judge': return r.classification === 'sealed' ? activeAGs() : activeJudges()
    case 'judicial_review': return r.assigned_judge_id ? [r.assigned_judge_id] : []
    default: return []
  }
}
/** The next authority an escalation goes to (+ the creator). */
function escalationFor(r: Req): string[] {
  const owners = (getRows('profiles') as unknown as Tables<'profiles'>[]).filter((p) => p.is_owner && p.active).map((p) => p.id)
  switch (r.review_status) {
    case 'cid_supervisor_review': return commandOf(null, COMMAND_FALLBACK)
    case 'siu_command_review': return activeAGs()
    default: return [...activeAGs(), ...owners]
  }
}
function remind(r: Req, kind: string, stage: string | null, recipients: string[], notifKind: string): boolean {
  const dup = rows('legal_request_reminders').some((x) => x.legal_request_id === r.id && x.kind === kind && (x.stage ?? null) === stage)
  if (dup) return false
  const sent = [...new Set(recipients)]
  seedRows('legal_request_reminders', [{ id: mockId(), kind, legal_request_id: r.id, recipients: sent, sent_at: now(), stage }])
  notify(sent, notifKind, payloadFor(r, { kind }))
  return true
}

/** legal_sweep_run() — Owner only; both sweeps, idempotent per (request, kind, stage). */
export function legalSweepRun(): Fns['legal_sweep_run']['Returns'] {
  if (!isOwner()) return denied('only the Owner may run the legal sweeps')
  const counts = { nudged: 0, escalated: 0, unissued: 0, expiring: 0, expired: 0, deadline_passed: 0 }
  const t = Date.now()
  for (const r of getRows('legal_requests') as unknown as Req[]) {
    const stage = r.review_status
    if (PENDING_STAGES.has(stage) && r.stage_entered_at) {
      const age = t - Date.parse(r.stage_entered_at)
      if (age > 48 * HOUR && remind(r, 'nudge', stage, responsibleFor(r), 'legal_nudge')) {
        r.nudged_at = now(); counts.nudged++; logAction(r, 'nudged', stage, stage)
      }
      if (age > 5 * DAY && remind(r, 'escalate', stage, [...escalationFor(r), r.created_by], 'legal_escalated')) {
        r.escalated_at = now(); counts.escalated++; logAction(r, 'escalated', stage, stage)
      }
    }
    if ((stage === 'approved' || stage === 'partially_approved') && r.fulfilment_status === 'unissued' && r.decided_at
      && t - Date.parse(r.decided_at) > 7 * DAY && remind(r, 'unissued', null, [r.created_by], 'legal_unissued')) counts.unissued++
    if (r.request_type === 'warrant' && r.fulfilment_status === 'issued' && r.expires_at) {
      const left = Date.parse(r.expires_at) - t
      const who = [r.created_by, ...(r.issued_by ? [r.issued_by] : [])]
      if (left < 0) {
        r.fulfilment_status = 'expired'; r.updated_at = now()
        logAction(r, 'expired', stage, stage)
        if (remind(r, 'expired', null, who, 'legal_expired')) counts.expired++
      } else if (left < 72 * HOUR && remind(r, 'expiring', null, who, 'legal_expiring')) counts.expiring++
    }
    if (r.request_type === 'subpoena' && r.response_deadline && Date.parse(r.response_deadline) < t
      && ['issued', 'served', 'compliance_pending'].includes(r.fulfilment_status)
      && remind(r, 'deadline_passed', null, [r.created_by], 'legal_deadline_passed')) counts.deadline_passed++
  }
  const { nudged, escalated, unissued, expiring, expired, deadline_passed } = counts
  return { ok: true, reminders: { nudged, escalated, unissued, expiring }, expiry: { expired, deadline_passed } }
}

/* ── Registry ───────────────────────────────────────────────────────────── */

/** fn → handler, consumed by the rpc.ts switch's default arm. */
export const LEGAL_RPCS: Record<string, (args: Args) => unknown> = {
  submit_legal_request_to_cid: submitLegalRequestToCid,
  review_legal_request_as_cid: reviewLegalRequestAsCid,
  claim_legal_request_as_judge: claimLegalRequestAsJudge,
  assign_judge: assignJudge,
  decide_legal_request_as_judge: decideLegalRequestAsJudge,
  withdraw_legal_request: withdrawLegalRequest,
  legal_set_charges: legalSetCharges,
  legal_comment: legalComment,
  legal_comment_edit: legalCommentEdit,
  legal_comment_delete: legalCommentDelete,
  legal_revision_resolve: legalRevisionResolve,
  legal_add_evidence_and_exhibit: legalAddEvidenceAndExhibit,
  legal_amend: legalAmend,
  legal_set_observer: legalSetObserver,
  legal_record_export: legalRecordExport,
  legal_sweep_run: legalSweepRun,
}

/** Writes to the RPC-only legal tables answer PostgREST's grant denial
 *  (42501) before the generic table handler can touch the store. Reads fall
 *  through to postgrest.ts, which filters them with visibleLegalRows. */
export const legalHandlers = LEGAL_RPC_ONLY_TABLES.flatMap((table) => {
  const refuse = () => HttpResponse.json({ code: '42501', details: null, hint: null, message: `permission denied for table ${table}` }, { status: 403 })
  const url = `${supabaseBaseUrl()}/rest/v1/${table}`
  return [http.post(url, refuse), http.patch(url, refuse), http.delete(url, refuse)]
})

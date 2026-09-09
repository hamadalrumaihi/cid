/** Intelligence-triage mocks (Portal Improvements plan, Phase 6 — P6-01 …
 *  P6-07; migrations 20261030120000_intel_triage → 20261031120000_intel_groups_convert).
 *
 *  The CONTRACT of the server functions (scratch p6_contract.md), answered
 *  from the mock DB — never a second implementation of the server's audit
 *  ledger or its authority model. Five surfaces:
 *
 *   · The read wall. `private.field_submission_readable`: the author, or an
 *     active member (every jurisdiction since 20261004120000) unless the
 *     record is `siu_sensitive` — then only an SIB agent (the Owner stands
 *     in for SIB standing here, as in entity.ts), the referrer or the
 *     assignee. The shadow table, the groups, the notes and the thread read
 *     through it (`visibleIntelRows`).
 *   · The intel RPCs keep the existing `field_submission_*` style: void (or
 *     the new row's id) and RAISE on refusal (`IntelRpcError` → PostgREST
 *     400). An AUTHORITY refusal raises with SQLSTATE `P0403` (the server's
 *     `private.perm_raise`; no audit row — it would roll back); a
 *     validation refusal is a plain `P0001`. `field_submission_convert` and
 *     `intel_group_suggest` answer jsonb — convert's authority refusal is
 *     `{ok:false, code:'denied', message}`, its duplicate answer
 *     `{ok:false, code:'duplicate', matches}`.
 *   · Notifications (`private.intel_notify`): MINIMAL payloads — never the
 *     summary, details, reason or a claim; never the actor; a test actor
 *     never reaches a real target; the same unread kind for the same record
 *     is not repeated. `intel_new` on a send, `intel_assigned` on assign,
 *     `intel_question` on ask (the ONLY kind a submitter receives),
 *     `intel_reply` on the officer's reply, `intel_referred` on an SIB referral.
 *   · The realtime shadow `field_submission_events` (status / assigned_to /
 *     siu_state / updated_at; drafts and deleted rows are never mirrored) is
 *     maintained by `afterFieldSubmissionChange` — the mock's AFTER trigger.
 *   · The client-facing guard `private.block_direct_intel_review_columns`
 *     is mirrored by `fieldSubmissionPatch` for a direct PATCH (a SENT
 *     record is never edited by a client session — every change is a review
 *     action; a draft is the author's editor and its review / SIB / grade
 *     columns are RPC-only) and by `stampFieldSubmission` for a direct
 *     INSERT (a record starts without review state). The reject reason and
 *     the validation note are NOT row columns: the text lives only in the
 *     reviewer-private note and the audit row. The four new tables and the
 *     reviewer notes take NO client writes (42501); the officer thread's
 *     INSERT is the author's own reply while a question is open.
 *
 *  Anything richer is pinned with scenarios.rpcResult(). */
import { http, HttpResponse } from 'msw'
import type { Database, Json, Tables } from '@/lib/database.types'
import { CREATE_FIELDS, MERGE_TABLE, isMergeKind, type MergeKind } from '@/lib/entity/kinds'
import { supabaseBaseUrl } from '../env'
import {
  fieldClaimLinkRow, fieldClaimVerdictRow, fieldSubmissionEventRow, fieldSubmissionMessageRow,
  fieldSubmissionReviewRow, fieldSubmissionRow, intelGroupCaseRow, intelGroupMemberRow, intelGroupRow,
} from '../fixtures/rows'
import { getDenial, getRows, mockId, seedRows, setRows, type MockRow, type MockTableName } from '../store'
import { entityDuplicates, findRow, isActive, isCommand, isOwner, profile, uid } from './entity'
import { canReadCaseAs } from './reports'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type Sub = Tables<'field_submissions'>
type Group = Tables<'intel_groups'>
type Profile = Tables<'profiles'>

const str = (v: unknown): string => (v == null ? '' : String(v))
const trim = (v: unknown): string => str(v).trim()
const blank = (v: unknown): boolean => trim(v) === ''
const now = () => new Date().toISOString()

/** A server `raise` — rpc.ts turns it into PostgREST's 400 error shape.
 *  `P0403` marks an AUTHORITY refusal (private.perm_raise); everything else
 *  is a plain validation raise (`P0001`). */
export class IntelRpcError extends Error {
  code: string
  constructor(message: string, code = 'P0001') { super(message); this.code = code }
}
const raise = (message: string): never => { throw new IntelRpcError(message) }
const deny = (message: string): never => { throw new IntelRpcError(message, 'P0403') }

/* ── Vocabulary (mirrors of the migration CHECKs) ───────────────────────── */

/** private.field_submission_transition_ok — rejected is terminal for a reviewer; a restore brings it back to reviewing. */
const TRANSITIONS: Record<string, readonly string[]> = {
  draft: [],
  new: ['reviewing', 'reviewed', 'actionable', 'archived', 'rejected'],
  reviewing: ['needs_info', 'reviewed', 'actionable', 'archived', 'rejected'],
  needs_info: ['reviewing', 'reviewed', 'actionable', 'archived', 'rejected'],
  reviewed: ['reviewing', 'actionable', 'archived', 'rejected'],
  actionable: ['reviewing', 'reviewed', 'archived', 'rejected'],
  archived: ['reviewing'],
  rejected: ['reviewing'],
}
export const transitionOk = (from: string, to: string): boolean => (TRANSITIONS[from] ?? []).includes(to)

/** Tables no client may write (RPC-only; grants SELECT only). */
export const INTEL_RPC_ONLY_TABLES: readonly MockTableName[] = [
  'field_submission_events', 'intel_groups', 'intel_group_members', 'intel_group_cases',
]
/** field_submissions columns the guard trigger refuses from a client session (review state, SIB handling, the grade). */
const GUARDED_COLUMNS = [
  'rejected_at', 'rejected_by', 'validated_at', 'validated_by',
  'assigned_to', 'assigned_at', 'siu_state', 'siu_category', 'siu_reason', 'siu_referred_by', 'siu_referred_at',
  'siu_assigned_to', 'siu_assigned_at', 'siu_sensitive', 'siu_case_id', 'reliability',
] as const
export const GUARD_MESSAGE = 'the review state only changes through the review actions'
export const SENT_GUARD_MESSAGE = 'that record has already been sent; the review state only changes through the review actions'
export const INSERT_GUARD_MESSAGE = 'a record starts without review state — the review actions set it'
/** The intel_new storm cap: after this many unread intel_new from one actor the rest are folded away. */
const INTEL_NEW_CAP = 10

const REVIEWER_ROLES = new Set(['bureau_lead', 'deputy_director', 'director'])
const VERDICTS = new Set(['verified', 'unverified', 'disputed', 'rejected'])
const URGENCIES = new Set(['low', 'medium', 'high', 'critical'])
const RELIABILITIES = new Set(['confirmed', 'probable', 'possible', 'unverified', 'disproven'])
const SIU_CATEGORIES = new Set(['organized_crime', 'gang_enterprise', 'narcotics_trafficking', 'firearms_trafficking', 'public_corruption', 'fugitive', 'major_crime', 'cross_jurisdiction', 'other'])

/** Claim kinds → their table and the column a link row keys them by (an
 *  item claim links to a narcotic / indicator since P6-04). */
export type ClaimKind = 'person' | 'vehicle' | 'org' | 'location' | 'item'
const CLAIM_TABLE: Record<ClaimKind, MockTableName> = {
  person: 'field_submission_persons', vehicle: 'field_submission_vehicles', org: 'field_submission_orgs',
  location: 'field_submission_locations', item: 'field_submission_items',
}
const CLAIM_LINK_COLUMN: Record<ClaimKind, keyof Tables<'field_claim_links'>> = {
  person: 'claim_person_id', vehicle: 'claim_vehicle_id', org: 'claim_org_id', location: 'claim_location_id', item: 'claim_item_id',
}
const CLAIM_VERDICT_COLUMN: Record<ClaimKind, keyof Tables<'field_claim_verdicts'>> = {
  person: 'person_id', vehicle: 'vehicle_id', org: 'org_id', location: 'location_id', item: 'item_id',
}
export type TargetKind = 'person' | 'vehicle' | 'gang' | 'place' | 'narcotic' | 'account' | 'indicator'
const TARGET_TABLE: Record<TargetKind, MockTableName> = {
  person: 'persons', vehicle: 'vehicles', gang: 'gangs', place: 'places', narcotic: 'narcotics', account: 'accounts', indicator: 'indicators',
}
const TARGET_LINK_COLUMN: Record<TargetKind, keyof Tables<'field_claim_links'>> = {
  person: 'person_id', vehicle: 'vehicle_id', gang: 'gang_id', place: 'place_id', narcotic: 'narcotic_id', account: 'account_id', indicator: 'indicator_id',
}
/** The allowed claim → target pairs (P6-04). */
export const LINK_PAIRS: Record<ClaimKind, readonly TargetKind[]> = {
  person: ['person', 'account', 'indicator'],
  vehicle: ['vehicle', 'indicator'],
  org: ['gang', 'account', 'indicator'],
  location: ['place', 'indicator'],
  item: ['narcotic', 'indicator'],
}
const isClaimKind = (k: unknown): k is ClaimKind => typeof k === 'string' && k in CLAIM_TABLE
const isTargetKind = (k: unknown): k is TargetKind => typeof k === 'string' && k in TARGET_TABLE

/* ── Session / the read wall ────────────────────────────────────────────── */

const rows = <T extends MockTableName>(table: T): Tables<T>[] =>
  (getDenial(table) ? [] : getRows(table)) as unknown as Tables<T>[]
const profileOf = (id: unknown): Profile | undefined => rows('profiles').find((p) => p.id === str(id))
/** SIB agent standing — the Owner in the mock (entity.ts convention). */
const isAgent = (p = profile()) => isOwner(p)

export const submissionOf = (id: unknown): Sub | undefined => findRow('field_submissions', id) as Sub | undefined

/** private.field_submission_readable for an arbitrary profile. */
export function readableAs(p: Profile | null | undefined, s: Sub | undefined): boolean {
  if (!s || !p) return false
  if (s.deleted_at != null && !isOwner(p)) return false
  if (s.officer_id === p.id) return true
  if (!isActive(p)) return false
  if (!s.siu_sensitive) return true
  return isAgent(p) || s.siu_referred_by === p.id || s.assigned_to === p.id
}
export const readable = (s: Sub | undefined): boolean => readableAs(profile(), s)

/** The SELECT policy: the author sees their own drafts; nobody else sees a draft. */
const selectable = (s: Sub): boolean => readable(s) && (s.officer_id === uid() || s.status !== 'draft')

const groupOf = (id: unknown): Group | undefined => findRow('intel_groups', id) as Group | undefined
const groupReadable = (g: Group | undefined): boolean => !!g && isActive() && readable(submissionOf(g.lead_submission_id))
const liveMembers = (groupId: string) => rows('intel_group_members').filter((m) => m.group_id === groupId && m.removed_at == null)
const liveCases = (groupId: string) => rows('intel_group_cases').filter((c) => c.group_id === groupId && c.unlinked_at == null)

/** The generic table handler runs the intel tables through this. */
export function visibleIntelRows(table: MockTableName, list: MockRow[]): MockRow[] {
  switch (table) {
    case 'field_submissions': return list.filter((r) => selectable(r as Sub))
    case 'field_submission_events': return list.filter((r) => readable(submissionOf(r.submission_id)))
    case 'intel_groups': return list.filter((r) => groupReadable(r as Group))
    case 'intel_group_members': return list.filter((r) => groupReadable(groupOf(r.group_id)) && readable(submissionOf(r.submission_id)))
    case 'intel_group_cases': return list.filter((r) => groupReadable(groupOf(r.group_id)))
    case 'field_submission_reviews': case 'field_claim_verdicts': case 'field_claim_links': case 'field_assignments':
      return isActive() ? list.filter((r) => readable(submissionOf(r.submission_id))) : []
    case 'field_submission_messages':
      return list.filter((r) => { const s = submissionOf(r.submission_id); return !!s && (s.officer_id === uid() || (isActive() && readable(s))) })
    default: return list
  }
}

/* ── Audit + notifications ──────────────────────────────────────────────── */

function audit(action: string, entity: string, entityId: string, detail: Json | null = null): void {
  seedRows('audit_log', [{
    action, actor_id: uid(), created_at: now(), detail, entity, entity_id: entityId,
    id: getRows('audit_log').length + 1, prev_hash: null, row_hash: null,
  }])
}
const note = (s: Sub, text: string) => seedRows('field_submission_reviews', [fieldSubmissionReviewRow({ submission_id: s.id, author_id: uid(), note: text, created_at: now() })])

/** Keys a payload never carries, whatever the caller passes. */
const NEVER_IN_PAYLOAD = new Set(['summary', 'details', 'reason', 'title'])

/** private.intel_notify — minimal payload, never the actor, test → real
 *  suppressed, one unread per kind per record. Returns true when a row was written. */
export function intelNotify(userId: unknown, s: Sub, kind: string, extra: Record<string, Json> = {}): boolean {
  const me = profile()
  const target = profileOf(userId)
  if (!target || !me || target.id === me.id) return false
  if (me.is_test && !target.is_test) return false
  const unread = rows('notifications').filter((n) => n.user_id === target.id && n.type === kind && !n.read)
  if (unread.some((n) => (n.payload as Record<string, unknown> | null)?.submission_id === s.id)) return false
  if (kind === 'intel_new' && unread.filter((n) => (n.payload as Record<string, unknown> | null)?.actor_id === me.id).length >= INTEL_NEW_CAP) return false
  const payload: Record<string, Json> = {
    submission_id: s.id, submission_no: s.submission_no, jurisdiction: s.jurisdiction, actor_id: me.id, actor_name: me.display_name,
  }
  for (const [k, v] of Object.entries(extra)) if (!NEVER_IN_PAYLOAD.has(k)) payload[k] = v
  seedRows('notifications', [{ created_at: now(), id: mockId(), payload, read: false, read_at: null, type: kind, user_id: target.id }])
  return true
}
/** private.intel_reviewers — active command (Bureau Lead / DD / Director) and the Owner inside the record's wall, never the actor. */
export function intelReviewers(s: Sub): string[] {
  return rows('profiles')
    .filter((p) => p.id !== uid() && isActive(p) && (p.is_owner || REVIEWER_ROLES.has(p.role ?? '')) && readableAs(p, s))
    .map((p) => p.id)
}

/* ── The shadow table + the BEFORE / AFTER triggers ─────────────────────── */

/** private.field_submission_after_change: upsert / remove the shadow row (a
 *  soft-deleted record stays as status 'deleted' — a realtime DELETE event
 *  would hand its key to every subscriber); announce a send. */
export function afterFieldSubmissionChange(row: MockRow, prevStatus: string | null): void {
  const s = row as Sub
  const others = getRows('field_submission_events').filter((e) => e.submission_id !== s.id)
  setRows('field_submission_events', others)
  if (s.status !== 'draft') {
    seedRows('field_submission_events', [fieldSubmissionEventRow({ submission_id: s.id, status: s.deleted_at != null ? 'deleted' : s.status, assigned_to: s.assigned_to, siu_state: s.siu_state, updated_at: now() })])
  }
  if (s.status === 'new' && (prevStatus === null || prevStatus === 'draft')) {
    for (const r of intelReviewers(s)) intelNotify(r, s, 'intel_new')
  }
}
const nextSubmissionNo = (): string => `FI-26-${String(rows('field_submissions').filter((s) => s.submission_no).length + 1).padStart(4, '0')}`

/** The client-facing INSERT guard + private.field_submission_before_insert
 *  (the investigator branch — field officers are not modelled): a record
 *  starts without review state, the author is the session, a record starts
 *  as a draft or as new, the number is issued on send. Returns a COMPLETE row. */
export function stampFieldSubmission(row: MockRow): MockRow {
  const me = profile()
  const status = str(row.status || 'draft')
  if (status === 'rejected' || GUARDED_COLUMNS.some((c) => row[c] != null && row[c] !== false)) return raise(INSERT_GUARD_MESSAGE)
  if (!isActive(me)) return raise('only an appointed field officer or an active investigator may create intelligence')
  if (status !== 'draft' && status !== 'new') return raise(`a record starts as a draft or as new, not as ${status}`)
  if (row.source_type === 'confidential') return raise('register the confidential source on the record first')
  const base = fieldSubmissionRow({ officer_id: me!.id, id: str(row.id) || mockId() })
  return {
    ...base, ...row, status,
    officer_id: me!.id, created_by: me!.id,
    snap_agency: me!.division ?? 'CID', snap_callsign: me!.badge_number, snap_rank: me!.role, snap_unit: null, snap_officer_name: me!.display_name,
    source_type: !row.source_type || row.source_type === 'patrol' ? 'detective' : row.source_type, source_codename: null,
    assigned_to: null, assigned_at: null,
    submission_no: status === 'new' ? nextSubmissionNo() : null, submitted_at: status === 'new' ? now() : null,
    archived_at: null, archived_by: null, archive_reason: null, deleted_at: null, deleted_by: null, delete_reason: null,
    rejected_at: null, rejected_by: null, validated_at: null, validated_by: null, reliability: null,
    created_at: now(), updated_at: now(),
  }
}

/** The two BEFORE UPDATE triggers for a direct client PATCH: the guard
 *  (`block_direct_intel_review_columns` — a sent record is never edited by
 *  a client session; a draft's review / SIB / grade columns are RPC-only)
 *  and the definer editor rule (a draft is the author's; a send is
 *  numbered). Returns the refusal message or the row to store. */
export function fieldSubmissionPatch(row: MockRow, patch: MockRow): { refusal: string } | { row: MockRow } {
  const changed = (col: string) => col in patch && JSON.stringify(patch[col]) !== JSON.stringify(row[col])
  if (row.status !== 'draft') return { refusal: SENT_GUARD_MESSAGE }
  if (changed('status') && patch.status === 'rejected') return { refusal: GUARD_MESSAGE }
  for (const col of GUARDED_COLUMNS) if (changed(col)) return { refusal: GUARD_MESSAGE }
  if (changed('officer_id') || changed('created_by') || changed('created_at')) return { refusal: 'the reporting officer on a record cannot be changed' }
  if (row.officer_id !== uid()) return { refusal: 'that record has not been sent yet' }
  const next: MockRow = { ...row, ...patch, updated_at: now() }
  if (next.status === 'new') { next.submission_no = nextSubmissionNo(); next.submitted_at = now() }
  else if (next.status !== 'draft') return { refusal: `a draft can only be saved or sent; ${str(next.status)} is a review decision` }
  return { row: next }
}

/** The narrowed `field_submission_messages_ins`: the author's own reply while a question is open. */
export function messageInsertGuard(row: MockRow): string | null {
  const s = submissionOf(row.submission_id)
  if (!s || s.officer_id !== uid() || s.status !== 'needs_info') return 'new row violates row-level security policy for table "field_submission_messages"'
  return null
}
/** private.field_message_before_insert + _after_insert: stamp the author and tell the reviewer. */
export function stampFieldMessage(row: MockRow): MockRow {
  return { ...fieldSubmissionMessageRow({ submission_id: str(row.submission_id), id: str(row.id) || mockId() }), ...row, author_id: uid(), from_reviewer: isActive(), created_at: now() }
}
export function afterFieldMessageInsert(row: MockRow): void {
  if (row.from_reviewer) return
  const s = submissionOf(row.submission_id)
  if (!s) return
  const to = s.assigned_to ?? rows('field_submission_messages')
    .filter((m) => m.submission_id === s.id && m.from_reviewer && m.id !== row.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.author_id
  intelNotify(to, s, 'intel_reply')
}

/* ── Shared preamble ────────────────────────────────────────────────────── */

/** active → found → readable, in the server's order and with its wording. */
function reviewable(id: unknown, notFound = 'no such record', wall = 'that record is not in your jurisdiction'): Sub {
  if (!isActive()) return deny('not authorized')
  const s = submissionOf(id)
  if (!s || s.deleted_at != null) return raise(notFound)
  if (!readable(s)) return deny(wall)
  return s
}
const notDraft = (s: Sub, msg = 'that record has not been sent yet') => { if (s.status === 'draft') raise(msg) }
const update = (s: Sub, patch: Partial<Sub>): Sub => {
  const prev = s.status
  Object.assign(s, patch, { updated_at: now() })
  afterFieldSubmissionChange(s as unknown as MockRow, prev)
  return s
}

/* ── P6-01 reject / restore ─────────────────────────────────────────────── */

/** field_submission_reject(p_submission, p_reason). NO notification to the submitter (IT3). */
export function fieldSubmissionReject(args: Args): Fns['field_submission_reject']['Returns'] {
  if (!isActive()) return deny('not authorized')
  if (blank(args.p_reason)) return raise('say why this is being rejected')
  const s = reviewable(args.p_submission)
  notDraft(s)
  if (s.status === 'rejected') return raise('that record is already rejected')
  if (!transitionOk(s.status, 'rejected')) return raise(`a submission cannot go from ${s.status} to rejected`)
  const from = s.status
  update(s, { status: 'rejected', rejected_at: now(), rejected_by: uid() })
  note(s, `Rejected: ${trim(args.p_reason)}`)
  audit('FIELD_SUBMISSION_REJECTED', 'field_submissions', s.id, { submission_no: s.submission_no, from_status: from, reason: trim(args.p_reason) })
  return undefined
}

/** field_submission_restore(p_submission, p_reason) — from the archive any reviewer; from rejected command only. */
export function fieldSubmissionRestore(args: Args): Fns['field_submission_restore']['Returns'] {
  const s = reviewable(args.p_submission)
  if (s.status !== 'archived' && s.status !== 'rejected') return raise('that record is not archived')
  if (s.status === 'rejected' && !isCommand()) return deny('only a Bureau Lead or above can restore a rejected record')
  const from = s.status, reason = blank(args.p_reason) ? null : trim(args.p_reason)
  update(s, { status: 'reviewing', archived_at: null, archived_by: null, rejected_at: null, rejected_by: null })
  note(s, `${from === 'rejected' ? 'Restored after rejection' : 'Restored from the archive'}${reason ? `: ${reason}` : ''}`)
  audit('FIELD_SUBMISSION_RESTORED', 'field_submissions', s.id, { submission_no: s.submission_no, from_status: from, reason })
  return undefined
}

/* ── P6-02 comment ──────────────────────────────────────────────────────── */

/** field_submission_comment(p_submission, p_body, p_visible_to_officer) → the note's / message's id. */
export function fieldSubmissionComment(args: Args): Fns['field_submission_comment']['Returns'] {
  if (!isActive()) return deny('not authorized')
  const body = trim(args.p_body)
  if (!body) return raise('write the comment first')
  if (body.length > 4000) return raise('a comment is at most 4000 characters')
  const s = reviewable(args.p_submission)
  notDraft(s)
  const visible = args.p_visible_to_officer === true
  const id = visible
    ? seedRows('field_submission_messages', [fieldSubmissionMessageRow({ submission_id: s.id, author_id: uid(), from_reviewer: true, body, created_at: now() })])[0].id
    : note(s, body)[0].id
  audit('FIELD_SUBMISSION_COMMENTED', 'field_submissions', s.id, { submission_no: s.submission_no, visible_to_officer: visible, comment_id: id })
  return id
}

/* ── P6-05 validation ───────────────────────────────────────────────────── */

const claimsOf = (submissionId: string) =>
  (Object.keys(CLAIM_TABLE) as ClaimKind[]).flatMap((k) => (getDenial(CLAIM_TABLE[k]) ? [] : getRows(CLAIM_TABLE[k]))
    .filter((c) => c.submission_id === submissionId).map((c) => ({ kind: k, id: str(c.id) })))
/** private.field_validation_state — claims over the five tables, verdict rows, the source grade. */
export function validationState(s: Sub): { claims: number; decided: number; graded: boolean } {
  return { claims: claimsOf(s.id).length, decided: rows('field_claim_verdicts').filter((v) => v.submission_id === s.id).length, graded: s.reliability != null }
}

/** field_submission_validate(p_submission, p_note, p_clear). */
export function fieldSubmissionValidate(args: Args): Fns['field_submission_validate']['Returns'] {
  if (!isActive()) return deny('not authorized')
  const text = trim(args.p_note)
  if (!text) return raise('say why')
  if (text.length > 2000) return raise('a note is at most 2000 characters')
  const s = reviewable(args.p_submission)
  notDraft(s)
  if (s.status === 'archived' || s.status === 'rejected') return raise('that record is closed')
  if (args.p_clear === true) {
    if (s.validated_at == null) return raise('that record is not validated')
    const prevBy = s.validated_by
    update(s, { validated_at: null, validated_by: null })
    note(s, `Validation withdrawn: ${text}`)
    audit('FIELD_SUBMISSION_UNVALIDATED', 'field_submissions', s.id, { submission_no: s.submission_no, note: text, previously_by: prevBy })
    return undefined
  }
  if (s.validated_at != null) return raise('that record is already validated')
  const st = validationState(s)
  if (st.claims === 0 || st.decided < st.claims || !st.graded) {
    return raise(`validate every claim and grade the source first (${st.decided} of ${st.claims} claims decided${st.graded ? '' : ', source ungraded'})`)
  }
  update(s, { validated_at: now(), validated_by: uid() })
  note(s, `Validated: ${text}`)
  audit('FIELD_SUBMISSION_VALIDATED', 'field_submissions', s.id, { submission_no: s.submission_no, note: text, claims: st.claims })
  return undefined
}

/** field_submission_counts() — invoker: the rows the caller can select, plus the derived flag. */
export function fieldSubmissionCounts(): Fns['field_submission_counts']['Returns'] {
  const count = (table: MockTableName, id: string) => (getDenial(table) ? [] : getRows(table)).filter((r) => r.submission_id === id).length
  return rows('field_submissions').filter(selectable).map((s) => {
    const st = validationState(s)
    return {
      submission_id: s.id,
      persons: count('field_submission_persons', s.id), vehicles: count('field_submission_vehicles', s.id), orgs: count('field_submission_orgs', s.id),
      locations: count('field_submission_locations', s.id), items: count('field_submission_items', s.id), evidence: count('field_submission_evidence', s.id),
      claims: st.claims, decided: st.decided, validated: st.claims > 0 && st.decided >= st.claims && st.graded,
    }
  })
}

/* ── The existing RPCs the validation and notification legs need ────────── */

/** field_claim_decide(p_kind, p_claim, p_verdict, p_note) — one verdict per claim, upserted. */
export function fieldClaimDecide(args: Args): Fns['field_claim_decide']['Returns'] {
  if (!isActive()) return raise('not authorized')
  const verdict = str(args.p_verdict)
  if (!VERDICTS.has(verdict)) return raise(`unknown verdict: ${verdict}`)
  const kind = args.p_kind
  const claim = isClaimKind(kind) ? findRow(CLAIM_TABLE[kind], args.p_claim) : undefined
  if (!isClaimKind(kind) || !claim) return raise(`no such claim: ${str(kind)} ${str(args.p_claim)}`)
  const s = submissionOf(claim.submission_id)!
  notDraft(s, 'that report has not been sent yet')
  const col = CLAIM_VERDICT_COLUMN[kind]
  const existing = rows('field_claim_verdicts').find((v) => v[col] === claim.id)
  const text = blank(args.p_note) ? null : trim(args.p_note)
  if (existing) Object.assign(existing, { verdict, note: text, decided_by: uid(), decided_at: now() })
  else seedRows('field_claim_verdicts', [fieldClaimVerdictRow({ submission_id: s.id, [col]: str(claim.id), verdict, note: text, decided_by: uid(), decided_at: now() })])
  audit('FIELD_CLAIM_DECIDED', 'field_claim_verdicts', s.id, { claim_kind: kind, claim_id: str(claim.id), from_verdict: existing?.verdict ?? null, to_verdict: verdict })
  return undefined
}

/** field_submission_grade(p_submission, p_urgency, p_reliability). */
export function fieldSubmissionGrade(args: Args): Fns['field_submission_grade']['Returns'] {
  if (!isActive()) return raise('not authorized')
  const s = reviewable(args.p_submission)
  notDraft(s)
  if (args.p_urgency != null && !URGENCIES.has(str(args.p_urgency))) return raise('unknown urgency')
  if (args.p_reliability != null && !RELIABILITIES.has(str(args.p_reliability))) return raise('unknown reliability')
  update(s, { urgency: args.p_urgency == null ? s.urgency : str(args.p_urgency), reliability: args.p_reliability == null ? s.reliability : str(args.p_reliability) })
  audit('FIELD_SUBMISSION_GRADED', 'field_submissions', s.id, { submission_no: s.submission_no, urgency: (args.p_urgency as Json) ?? null, reliability: (args.p_reliability as Json) ?? null })
  return undefined
}

/** field_submission_decide(p_submission, p_status, p_note) — the plain transitions (never into rejected: that is reject's). */
export function fieldSubmissionDecide(args: Args): Fns['field_submission_decide']['Returns'] {
  if (!isActive()) return raise('not authorized')
  const s = reviewable(args.p_submission, 'no such submission', 'that report is not in your jurisdiction')
  const to = str(args.p_status)
  if (!transitionOk(s.status, to)) return raise(`a submission cannot go from ${s.status} to ${to}`)
  const from = s.status
  update(s, { status: to })
  if (!blank(args.p_note)) note(s, trim(args.p_note))
  audit('FIELD_SUBMISSION_DECIDED', 'field_submissions', s.id, { submission_no: s.submission_no, from_status: from, to_status: to })
  return undefined
}

/** field_submission_assign(p_submission, p_user, p_reason) — command; notifies the assignee (intel_assigned). */
export function fieldSubmissionAssign(args: Args): Fns['field_submission_assign']['Returns'] {
  if (!isCommand()) return raise('only a Bureau Lead or above can assign a record')
  const s = submissionOf(args.p_submission)
  if (!s) return raise('no such record')
  if (!readable(s)) return raise('that record is not in your jurisdiction')
  notDraft(s)
  if (args.p_user == null) return raise('choose an investigator')
  const target = profileOf(args.p_user)
  if (s.assigned_to === str(args.p_user)) return raise('that record is already assigned to them')
  if (!isActive(target)) return raise('that investigator cannot see records from this jurisdiction')
  const action = s.assigned_to == null ? 'assigned' : 'reassigned'
  const reason = blank(args.p_reason) ? null : trim(args.p_reason)
  if (action === 'reassigned' && !reason) return raise('say why you are taking it off the current investigator')
  const from = s.assigned_to
  seedRows('field_assignments', [{ action, actor_id: uid()!, created_at: now(), from_user: from, id: mockId(), reason, submission_id: s.id, to_user: target!.id }])
  update(s, { assigned_to: target!.id, assigned_at: now(), status: s.status === 'new' ? 'reviewing' : s.status })
  audit(action === 'assigned' ? 'FIELD_SUBMISSION_ASSIGNED' : 'FIELD_SUBMISSION_REASSIGNED', 'field_submissions', s.id, { submission_no: s.submission_no, from_user: from, to_user: target!.id, reason })
  intelNotify(target!.id, s, 'intel_assigned', { assigned_by: uid(), action })
  return undefined
}

/** field_submission_ask(p_submission, p_question) — the question opens the thread; the submitter is told (intel_question). */
export function fieldSubmissionAsk(args: Args): Fns['field_submission_ask']['Returns'] {
  if (!isActive()) return raise('not authorized')
  if (blank(args.p_question)) return raise('ask an actual question')
  const s = submissionOf(args.p_submission)
  if (!s) return raise('no such submission')
  if (!readable(s)) return raise('that report is not in your jurisdiction')
  notDraft(s, 'that report has not been sent yet')
  if (!transitionOk(s.status, 'needs_info') && s.status !== 'needs_info') return raise(`a submission cannot go from ${s.status} to needs_info`)
  seedRows('field_submission_messages', [fieldSubmissionMessageRow({ submission_id: s.id, author_id: uid(), from_reviewer: true, body: trim(args.p_question), created_at: now() })])
  const from = s.status
  update(s, { status: 'needs_info' })
  audit('FIELD_SUBMISSION_INFO_REQUESTED', 'field_submissions', s.id, { submission_no: s.submission_no, from_status: from })
  intelNotify(s.officer_id, s, 'intel_question')
  return undefined
}

/** field_submission_siu_refer(p_submission, p_category, p_reason) — public_corruption restricts at once; every SIB agent is told (intel_referred). */
export function fieldSubmissionSiuRefer(args: Args): Fns['field_submission_siu_refer']['Returns'] {
  if (!isActive()) return raise('not authorized')
  const s = submissionOf(args.p_submission)
  if (!s || !readable(s)) return raise('that report is not yours to read')
  if (blank(args.p_reason)) return raise('say why this needs SIB')
  const category = str(args.p_category)
  if (!SIU_CATEGORIES.has(category)) return raise('choose one of the SIB categories')
  notDraft(s, 'that report has not been sent yet')
  if (s.siu_state === 'referred' || s.siu_state === 'accepted') return raise('that report is already with SIB')
  update(s, { siu_state: 'referred', siu_category: category, siu_reason: trim(args.p_reason), siu_referred_by: uid(), siu_referred_at: now(), siu_sensitive: s.siu_sensitive || category === 'public_corruption' })
  audit('FIELD_SIU_REFERRED', 'field_submissions', s.id, { submission_no: s.submission_no, category, reason: trim(args.p_reason) })
  for (const p of rows('profiles')) if (p.id !== uid() && isActive(p) && isAgent(p)) intelNotify(p.id, s, 'intel_referred', { category })
  return undefined
}

/* ── P6-07 SIB cross-link ───────────────────────────────────────────────── */

/** siu_referred_submissions() — SIB agents only (zero rows for anyone else, oversight included); never the summary. */
export function siuReferredSubmissions(): Fns['siu_referred_submissions']['Returns'] {
  if (!isAgent()) return []
  return rows('field_submissions')
    .filter((s) => s.deleted_at == null && (s.siu_state === 'referred' || s.siu_state === 'accepted'))
    .map((s) => ({
      id: s.id, submission_no: s.submission_no, siu_category: s.siu_category, siu_state: s.siu_state, siu_referred_at: s.siu_referred_at,
      siu_referred_by: s.siu_referred_by, siu_assigned_to: s.siu_assigned_to, siu_case_id: s.siu_case_id, jurisdiction: s.jurisdiction,
    }))
}

/* ── P6-03 groups ───────────────────────────────────────────────────────── */

/** private.intel_group_member_ok: found, readable, sent (plain raises — the wall here is not perm_raise'd). */
function memberRecord(id: unknown): Sub {
  const s = submissionOf(id)
  if (!s || s.deleted_at != null) return raise('no such record')
  if (!readable(s)) return raise('that record is not in your jurisdiction')
  notDraft(s)
  return s
}
/** An unreadable group is indistinguishable from a missing one. */
function readableGroup(id: unknown, allowClosed = true): Group {
  if (!isActive()) return deny('not authorized')
  const g = groupOf(id)
  if (!g || !groupReadable(g)) return raise('no such group')
  if (!allowClosed && g.closed_at != null) raise('that group is closed')
  return g
}
const groupAudit = (action: string, g: Group, detail: Json) => audit(action, 'intel_groups', g.id, detail)

/** intel_group_create(p_title, p_lead, p_members, p_note) → the group id. The lead is always a member. */
export function intelGroupCreate(args: Args): Fns['intel_group_create']['Returns'] {
  if (!isActive()) return deny('not authorized')
  const title = trim(args.p_title)
  if (!title) return raise('give the group a title')
  if (title.length > 200) return raise('a title is at most 200 characters')
  const lead = memberRecord(args.p_lead)
  const members = [...new Set([lead.id, ...(Array.isArray(args.p_members) ? args.p_members.map(str) : [])])]
  for (const id of members) memberRecord(id)
  const [g] = seedRows('intel_groups', [intelGroupRow({ lead_submission_id: lead.id, title, note: blank(args.p_note) ? null : trim(args.p_note), created_by: uid(), created_at: now(), updated_at: now() })])
  seedRows('intel_group_members', members.map((submission_id) => intelGroupMemberRow({ group_id: g.id, submission_id, added_by: uid(), added_at: now() })))
  groupAudit('INTEL_GROUP_CREATED', g, { title, lead: lead.id, members })
  return g.id
}

/** intel_group_add(p_group, p_submission, p_note) — re-adding a removed member clears removed_*. */
export function intelGroupAdd(args: Args): Fns['intel_group_add']['Returns'] {
  const g = readableGroup(args.p_group, false)
  const s = memberRecord(args.p_submission)
  const existing = rows('intel_group_members').find((m) => m.group_id === g.id && m.submission_id === s.id)
  if (existing && existing.removed_at == null) return raise('that record is already in this group')
  const text = blank(args.p_note) ? null : trim(args.p_note)
  if (existing) Object.assign(existing, { removed_at: null, removed_by: null, remove_reason: null, added_by: uid(), added_at: now(), note: text })
  else seedRows('intel_group_members', [intelGroupMemberRow({ group_id: g.id, submission_id: s.id, added_by: uid(), added_at: now(), note: text })])
  g.updated_at = now()
  groupAudit('INTEL_GROUP_MEMBER_ADDED', g, { submission_id: s.id, submission_no: s.submission_no, note: text })
  return undefined
}

/** intel_group_remove(p_group, p_submission, p_reason) — reason required; the lead never leaves. */
export function intelGroupRemove(args: Args): Fns['intel_group_remove']['Returns'] {
  if (!isActive()) return deny('not authorized')
  if (blank(args.p_reason)) return raise('say why')
  const g = readableGroup(args.p_group, false)
  const s = memberRecord(args.p_submission)
  if (s.id === g.lead_submission_id) return raise('the lead record stays in its group — close the group instead')
  const m = liveMembers(g.id).find((x) => x.submission_id === s.id)
  if (!m) return raise('that record is not in this group')
  Object.assign(m, { removed_at: now(), removed_by: uid(), remove_reason: trim(args.p_reason) })
  g.updated_at = now()
  groupAudit('INTEL_GROUP_MEMBER_REMOVED', g, { submission_id: s.id, submission_no: s.submission_no, reason: trim(args.p_reason) })
  return undefined
}

const visibleCase = (id: unknown): MockRow | undefined => {
  const c = findRow('cases', id)
  return c && c.deleted_at == null && canReadCaseAs(profile(), c) ? c : undefined
}
/** intel_group_link_case(p_group, p_case, p_note) → the link id (private.field_case_visible). */
export function intelGroupLinkCase(args: Args): Fns['intel_group_link_case']['Returns'] {
  const g = readableGroup(args.p_group, false)
  const c = visibleCase(args.p_case)
  if (!c) return raise('no such case, or it is not one you have access to')
  if (liveCases(g.id).some((x) => x.case_id === c.id)) return raise('that group is already linked to that case')
  const [row] = seedRows('intel_group_cases', [intelGroupCaseRow({ group_id: g.id, case_id: str(c.id), linked_by: uid(), linked_at: now(), note: blank(args.p_note) ? null : trim(args.p_note) })])
  g.updated_at = now()
  groupAudit('INTEL_GROUP_CASE_LINKED', g, { case_id: str(c.id), case_number: str(c.case_number) })
  return row.id
}

/** intel_group_unlink_case(p_group, p_case, p_reason). */
export function intelGroupUnlinkCase(args: Args): Fns['intel_group_unlink_case']['Returns'] {
  if (!isActive()) return deny('not authorized')
  if (blank(args.p_reason)) return raise('say why')
  const g = readableGroup(args.p_group)
  const link = liveCases(g.id).find((x) => x.case_id === str(args.p_case))
  if (!link) return raise('that group is not linked to that case')
  Object.assign(link, { unlinked_at: now(), unlinked_by: uid(), unlink_reason: trim(args.p_reason) })
  g.updated_at = now()
  groupAudit('INTEL_GROUP_CASE_UNLINKED', g, { case_id: link.case_id, reason: trim(args.p_reason) })
  return undefined
}

const creatorOrCommand = (g: Group) => g.created_by === uid() || isCommand()
/** intel_group_close(p_group, p_reason) — the creator or command. */
export function intelGroupClose(args: Args): Fns['intel_group_close']['Returns'] {
  if (!isActive()) return deny('not authorized')
  if (blank(args.p_reason)) return raise('say why')
  const g = readableGroup(args.p_group)
  if (g.closed_at != null) return raise('that group is already closed')
  if (!creatorOrCommand(g)) return deny("only the group's creator or a Bureau Lead or above can close it")
  Object.assign(g, { closed_at: now(), closed_by: uid(), close_reason: trim(args.p_reason), updated_at: now() })
  groupAudit('INTEL_GROUP_CLOSED', g, { reason: trim(args.p_reason) })
  return undefined
}
/** intel_group_reopen(p_group, p_reason). */
export function intelGroupReopen(args: Args): Fns['intel_group_reopen']['Returns'] {
  if (!isActive()) return deny('not authorized')
  if (blank(args.p_reason)) return raise('say why')
  const g = readableGroup(args.p_group)
  if (g.closed_at == null) return raise('that group is not closed')
  if (!creatorOrCommand(g)) return deny("only the group's creator or a Bureau Lead or above can reopen it")
  Object.assign(g, { closed_at: null, closed_by: null, close_reason: null, updated_at: now() })
  groupAudit('INTEL_GROUP_REOPENED', g, { reason: trim(args.p_reason) })
  return undefined
}

/** The repeat signals of a record: named (a person / alias / plate / org name
 *  shared with another readable record) and linked (a claim link on the same
 *  registry target). Mirrors field_submission_repeats' keys. */
function signalsOf(s: Sub): Map<string, string[]> {
  const norm = (v: unknown) => trim(v).toLowerCase()
  const mine = new Map<string, string>()
  for (const p of rows('field_submission_persons').filter((x) => x.submission_id === s.id)) {
    if (trim(p.full_name).length > 1) mine.set(`person:${norm(p.full_name)}`, trim(p.full_name))
    if (trim(p.alias).length > 1) mine.set(`person:${norm(p.alias)}`, trim(p.alias))
  }
  for (const v of rows('field_submission_vehicles').filter((x) => x.submission_id === s.id)) if (trim(v.plate).length > 1) mine.set(`vehicle:${norm(v.plate)}`, trim(v.plate))
  for (const o of rows('field_submission_orgs').filter((x) => x.submission_id === s.id)) if (trim(o.name).length > 1) mine.set(`organisation:${norm(o.name)}`, trim(o.name))
  for (const l of rows('field_claim_links').filter((x) => x.submission_id === s.id)) {
    for (const k of Object.keys(TARGET_LINK_COLUMN) as TargetKind[]) {
      const ref = l[TARGET_LINK_COLUMN[k]]
      if (ref) mine.set(`link:${k}:${ref}`, str(findRow(TARGET_TABLE[k], ref)?.name ?? findRow(TARGET_TABLE[k], ref)?.plate ?? 'a matched record'))
    }
  }
  const out = new Map<string, string[]>()
  const hit = (other: string, key: string) => { if (mine.has(key)) out.set(other, [...new Set([...(out.get(other) ?? []), mine.get(key)!])]) }
  for (const p of rows('field_submission_persons')) if (p.submission_id !== s.id) { hit(p.submission_id, `person:${norm(p.full_name)}`); hit(p.submission_id, `person:${norm(p.alias)}`) }
  for (const v of rows('field_submission_vehicles')) if (v.submission_id !== s.id) hit(v.submission_id, `vehicle:${norm(v.plate)}`)
  for (const o of rows('field_submission_orgs')) if (o.submission_id !== s.id) hit(o.submission_id, `organisation:${norm(o.name)}`)
  for (const l of rows('field_claim_links')) if (l.submission_id !== s.id) {
    for (const k of Object.keys(TARGET_LINK_COLUMN) as TargetKind[]) { const ref = l[TARGET_LINK_COLUMN[k]]; if (ref) hit(l.submission_id, `link:${k}:${ref}`) }
  }
  return out
}

/** intel_group_suggest(p_submission) → {groups, submissions}: readable records sharing a signal and the live groups any of them is in; never a summary. An inactive caller gets the empty shape. */
export function intelGroupSuggest(args: Args): Fns['intel_group_suggest']['Returns'] {
  if (!isActive()) return { groups: [], submissions: [] }
  const s = submissionOf(args.p_submission)
  if (!s || !readable(s)) return raise('that record is not in your jurisdiction')
  const shared = signalsOf(s)
  const submissions = [...shared.entries()]
    .map(([id, labels]) => ({ s: submissionOf(id), labels }))
    .filter((x): x is { s: Sub; labels: string[] } => !!x.s && x.s.deleted_at == null && x.s.status !== 'draft' && readable(x.s))
    .slice(0, 20)
  const groups = rows('intel_groups')
    .filter((g) => g.closed_at == null && groupReadable(g))
    .map((g) => {
      const members = liveMembers(g.id)
      const labels = [...new Set(members.flatMap((m) => shared.get(m.submission_id) ?? []))]
      return { g, members: members.length, labels }
    })
    .filter((x) => x.labels.length > 0 && !liveMembers(x.g.id).some((m) => m.submission_id === s.id))
    .slice(0, 20)
  return {
    groups: groups.map((x) => ({ id: x.g.id, title: x.g.title, lead_submission_no: submissionOf(x.g.lead_submission_id)?.submission_no ?? null, members: x.members, shared: x.labels })),
    submissions: submissions.map((x) => ({ id: x.s.id, submission_no: x.s.submission_no, status: x.s.status, shared: x.labels })),
  }
}

/** intel_group_summary(p_group) — null for a group the caller cannot read; readable members carry a number; hidden = the ones the caller cannot read; cases the caller can see. */
export function intelGroupSummary(args: Args): Fns['intel_group_summary']['Returns'] {
  const g = groupOf(args.p_group)
  if (!g || !groupReadable(g)) return null
  const members = liveMembers(g.id).map((m) => ({ m, s: submissionOf(m.submission_id) })).filter((x): x is { m: Tables<'intel_group_members'>; s: Sub } => !!x.s)
  const seen = members.filter((x) => readable(x.s))
  let claims = 0, decided = 0
  for (const x of seen) { const st = validationState(x.s); claims += st.claims; decided += st.decided }
  return {
    id: g.id, title: g.title, note: g.note, lead_submission_id: g.lead_submission_id,
    created_by: g.created_by, created_at: g.created_at, closed_at: g.closed_at, close_reason: g.close_reason,
    members: seen.map((x) => ({ submission_id: x.s.id, submission_no: x.s.submission_no, status: x.s.status, added_at: x.m.added_at, note: x.m.note })),
    hidden: members.length - seen.length, claims, decided,
    cases: liveCases(g.id).flatMap((c) => { const k = visibleCase(c.case_id); return k ? [{ case_id: str(k.id), case_number: str(k.case_number) || null, title: str(k.title) || null }] : [] }),
  }
}

/* ── P6-04 extended links + convert ─────────────────────────────────────── */

function claimOf(kind: unknown, id: unknown): { kind: ClaimKind; claim: MockRow; s: Sub } {
  const claim = isClaimKind(kind) ? findRow(CLAIM_TABLE[kind], id) : undefined
  if (!isClaimKind(kind) || !claim) return raise(`no such claim: ${str(kind)} ${str(id)}`)
  return { kind, claim, s: submissionOf(claim.submission_id)! }
}
/** The target must exist and be live; an indicator must sit on a case the caller can see. */
function liveTarget(kind: TargetKind, id: unknown): MockRow {
  const t = findRow(TARGET_TABLE[kind], id)
  if (!t || t.deleted_at != null || t.merged_into != null) return raise(`no such ${kind}: ${str(id)}`)
  if (kind === 'indicator' && !visibleCase(t.case_id)) return raise('no such indicator, or it is on a case you cannot see')
  return t
}
function linkClaim(kind: ClaimKind, claim: MockRow, s: Sub, targetKind: TargetKind, target: MockRow): Tables<'field_claim_links'> {
  const claimCol = CLAIM_LINK_COLUMN[kind], targetCol = TARGET_LINK_COLUMN[targetKind]
  const dup = rows('field_claim_links').some((l) => l.submission_id === s.id && l[targetCol] === target.id && l[claimCol] === claim.id)
  if (dup) return raise('already linked')
  const [row] = seedRows('field_claim_links', [fieldClaimLinkRow({ submission_id: s.id, [claimCol]: str(claim.id), [targetCol]: str(target.id), linked_by: uid(), linked_at: now() })])
  audit('FIELD_CLAIM_LINKED', 'field_claim_links', s.id, { claim_kind: kind, claim_id: str(claim.id), target_kind: targetKind, target_id: str(target.id) })
  return row
}

/** field_claim_link(p_kind, p_claim, p_target_kind, p_target) — the pair rule, a live target, no duplicate. */
export function fieldClaimLink(args: Args): Fns['field_claim_link']['Returns'] {
  if (!isActive()) return raise('not authorized')
  const { kind, claim, s } = claimOf(args.p_kind, args.p_claim)
  if (!readable(s)) return deny('that record is not in your jurisdiction')
  notDraft(s, 'that report has not been sent yet')
  const targetKind = args.p_target_kind
  if (!isTargetKind(targetKind)) return raise(`unknown target kind: ${str(targetKind)}`)
  if (!LINK_PAIRS[kind].includes(targetKind)) return raise(`a ${kind} claim cannot be linked to a ${targetKind}`)
  linkClaim(kind, claim, s, targetKind, liveTarget(targetKind, args.p_target))
  return undefined
}

type ConvertResult = { ok: true; id: string; kind: MergeKind } | { ok: false; code: 'denied' | 'duplicate'; message: string; matches?: Json[] }
/** field_submission_convert(p_kind, p_claim_kind, p_claim, p_payload, p_reason) — jsonb. */
export function fieldSubmissionConvert(args: Args): ConvertResult {
  if (!isActive()) return { ok: false, code: 'denied', message: 'not authorized' }
  const kind = str(args.p_kind)
  if (!isMergeKind(kind)) return raise(`unknown kind: ${kind}`)
  const { kind: claimKind, claim, s } = claimOf(args.p_claim_kind, args.p_claim)
  if (!readable(s)) return { ok: false, code: 'denied', message: 'that record is not in your jurisdiction' }
  notDraft(s, 'that report has not been sent yet')
  if (!LINK_PAIRS[claimKind].includes(kind)) return raise(`a ${claimKind} claim cannot become a ${kind}`)
  if (args.p_payload == null || typeof args.p_payload !== 'object' || Array.isArray(args.p_payload)) return raise('payload must be an object')
  const payload = args.p_payload as Record<string, unknown>
  const fields = CREATE_FIELDS[kind]
  for (const k of Object.keys(payload)) {
    if (!fields.some((f) => f.key === k)) return raise(`unknown field for a ${kind}: ${k}`)
    if (payload[k] != null && typeof payload[k] !== 'string') return raise(`field ${k} must be a string`)
  }
  for (const f of fields) if (f.required && blank(payload[f.key])) return raise(`field ${f.key} is required for a ${kind}`)
  const reason = blank(args.p_reason) ? null : trim(args.p_reason)
  const strong = entityDuplicates({ p_kind: kind, p_payload: payload }).filter((d) => d.strength === 'strong')
  if (strong.length && !reason) {
    return { ok: false, code: 'duplicate', matches: strong.map((d) => ({ id: d.id, label: d.label, sublabel: d.sublabel, signal: d.signal })), message: 'a record like this already exists — link it, or create anyway with a reason' }
  }
  const noteCol = kind === 'account' || kind === 'narcotic' ? 'summary' : 'notes'
  const existingNote = trim(payload[noteCol])
  const appended = reason && strong.length ? `Created despite a possible duplicate: ${reason}` : ''
  const row: MockRow = {
    id: mockId(), ...payload, created_by: uid(), created_at: now(), updated_at: now(), deleted_at: null, deleted_by: null, delete_reason: null, delete_batch: null,
    source_submission_id: s.id,
    [noteCol]: [existingNote, appended].filter(Boolean).join('\n') || null,
  }
  setRows(MERGE_TABLE[kind], [...getRows(MERGE_TABLE[kind]), row])
  linkClaim(claimKind, claim, s, kind, row)
  audit('FIELD_CLAIM_CONVERTED', 'field_submissions', s.id, { claim_kind: claimKind, claim_id: str(claim.id), kind, record_id: str(row.id), submission_no: s.submission_no })
  return { ok: true, id: str(row.id), kind }
}

/* ── Registry ───────────────────────────────────────────────────────────── */

/** fn → handler, consumed by the rpc.ts switch's default arm. */
export const INTEL_RPCS: Record<string, (args: Args) => unknown> = {
  field_submission_reject: fieldSubmissionReject,
  field_submission_restore: fieldSubmissionRestore,
  field_submission_comment: fieldSubmissionComment,
  field_submission_validate: fieldSubmissionValidate,
  field_submission_counts: fieldSubmissionCounts,
  field_submission_decide: fieldSubmissionDecide,
  field_submission_grade: fieldSubmissionGrade,
  field_submission_assign: fieldSubmissionAssign,
  field_submission_ask: fieldSubmissionAsk,
  field_submission_siu_refer: fieldSubmissionSiuRefer,
  field_claim_decide: fieldClaimDecide,
  field_claim_link: fieldClaimLink,
  field_submission_convert: fieldSubmissionConvert,
  intel_group_create: intelGroupCreate,
  intel_group_add: intelGroupAdd,
  intel_group_remove: intelGroupRemove,
  intel_group_link_case: intelGroupLinkCase,
  intel_group_unlink_case: intelGroupUnlinkCase,
  intel_group_close: intelGroupClose,
  intel_group_reopen: intelGroupReopen,
  intel_group_suggest: intelGroupSuggest,
  intel_group_summary: intelGroupSummary,
  siu_referred_submissions: siuReferredSubmissions,
}

/** Writes to the RPC-only intel tables answer PostgREST's grant denial
 *  (42501) before the generic table handler can touch the store; the
 *  reviewer notes lost their INSERT policy (the RPC writes them; command may
 *  still DELETE). Reads fall through to postgrest.ts (visibleIntelRows). */
export const intelHandlers = [
  ...INTEL_RPC_ONLY_TABLES.flatMap((table) => {
    const refuse = () => HttpResponse.json({ code: '42501', details: null, hint: null, message: `permission denied for table ${table}` }, { status: 403 })
    const url = `${supabaseBaseUrl()}/rest/v1/${table}`
    return [http.post(url, refuse), http.patch(url, refuse), http.delete(url, refuse)]
  }),
  http.post(`${supabaseBaseUrl()}/rest/v1/field_submission_reviews`, () =>
    HttpResponse.json({ code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "field_submission_reviews"' }, { status: 403 })),
]

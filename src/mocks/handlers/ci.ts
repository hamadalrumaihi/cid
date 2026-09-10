/** Confidential Informant compartment mocks (migration
 *  20261103120000_confidential_informants; scratch ci_contract.md §1–§4).
 *
 *  The CONTRACT of the CI server functions, answered from the mock DB — never
 *  a second implementation of the server's authority model. One rule
 *  everywhere: **canAccessCI = hasFullCIAccess(user) || isAssignedHandler(user, ci)**.
 *  A caller who is not authorized gets NOTHING — null, zero rows, "not found"
 *  — never a placeholder, a lock, a count or a "no permission" text.
 *
 *   · Fourteen RPC-only tables (`CI_RPC_ONLY_TABLES`): SELECT policies only,
 *     re-read here through `visibleCiRows` (the generic table handler runs the
 *     CI tables through it); every client INSERT / UPDATE / DELETE is
 *     PostgREST's grant denial (403 / 42501).
 *   · `private.has_full_ci_access` = active + (Owner, Bureau Lead / Deputy
 *     Director / Director, or an active non-oversight SIB member);
 *     `ci_is_active_handler` = a live `ci_handlers` row; `can_access_ci` = the
 *     disjunction (a deleted CI only for full access); capacity = 6 unless a
 *     live `ci_handler_capacity.limit_override`; `ci_active_count` = active,
 *     non-deleted CIs the user handles that count toward capacity.
 *   · Refusal style: AUTHORITY refusals raise through `private.perm_raise`
 *     (SQLSTATE P0403 — `CiRpcError` → PostgREST 400 in the route below);
 *     VALIDATION refusals return `{ok:false, code, message}`; unauthorized
 *     READS return null / zero rows and never raise (a raise would confirm
 *     existence). An unauthorized write and a write against a CI that does
 *     not exist answer the same P0403 wording.
 *   · Audit goes to `ci_audit_events` — NEVER `audit_log` (which feeds
 *     `case_audit_feed`); realtime is the ids-only `ci_events` shadow;
 *     notifications go through `actionNotify` (ids only — the text keys are
 *     stripped, one per kind + subject per hour, a fixture never notifies a
 *     real member) with the `informants` kinds that the registry marks
 *     `destination: 'portal'`.
 *  Anything richer is pinned with scenarios.rpcResult(). */
import { delay, http, HttpResponse } from 'msw'
import type { Database, Json, Tables } from '@/lib/database.types'
import { supabaseBaseUrl } from '../env'
import {
  caseIntelReleaseRow, ciAssessmentRow, ciAuditEventRow, ciCaseLinkRow, ciContactRow, ciEventRow, ciHandlerCapacityRow, ciHandlerRow,
  ciIntelligenceLinkRow, ciIntelligenceRow, ciPaymentRow, ciReleaseRow, ciCapacityRequestRow, confidentialInformantRow,
} from '../fixtures/rows'
import { getDenial, getLatency, getRows, getRpcOverride, isOffline, seedRows, type MockRow, type MockTableName } from '../store'
import { actionNotify } from './action'
import { findRow, isActive, isOwner, profile, uid } from './entity'
import { canReadCaseAs } from './reports'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type Profile = Tables<'profiles'>
type Ci = Tables<'confidential_informants'>
type Handler = Tables<'ci_handlers'>
type Intel = Tables<'ci_intelligence'>
type Contact = Tables<'ci_contacts'>
type Payment = Tables<'ci_payments'>
type Request = Tables<'ci_capacity_requests'>
type Bureau = Database['public']['Enums']['bureau']
type Refusal = { ok: false; code: string; message: string }
type Ok = { ok: true } & Record<string, Json | undefined>

const HOUR = 3_600_000
const DAY = 24 * HOUR
const str = (v: unknown): string => (v == null ? '' : String(v))
const blank = (v: unknown): string | null => str(v).trim() || null
const now = () => new Date().toISOString()

/** A server `raise` — the rpc route turns it into PostgREST's 400 error
 *  shape. `P0403` marks an AUTHORITY refusal (private.perm_raise). */
export class CiRpcError extends Error {
  code: string
  constructor(message: string, code = 'P0001') { super(message); this.code = code }
}
function deny(message: string): never { throw new CiRpcError(message, 'P0403') }
const refuse = (code: string, message: string): Refusal => ({ ok: false, code, message })

/* ── Vocabulary (§2) ────────────────────────────────────────────────────── */

/** The fourteen tables no client may write — every write is a definer RPC. */
export const CI_RPC_ONLY_TABLES: readonly MockTableName[] = [
  'confidential_informants', 'ci_handlers', 'ci_handler_capacity', 'ci_capacity_requests', 'ci_intelligence', 'ci_intelligence_links',
  'ci_contacts', 'ci_assessments', 'ci_payments', 'ci_case_links', 'case_intel_releases', 'ci_releases', 'ci_audit_events', 'ci_events',
]
export const CI_STATUSES = ['candidate', 'active', 'dormant', 'suspended', 'compromised', 'retired', 'terminated'] as const
export const CI_MOTIVES = ['money', 'political', 'religious', 'patriotism', 'revenge', 'personal_benefit', 'protection', 'leniency', 'rivalry', 'ideological', 'safety', 'other'] as const
export const CI_RELIABILITY = ['unknown', 'low', 'moderate', 'high', 'proven'] as const
export const CI_RISK = ['low', 'medium', 'high', 'critical'] as const
export const CI_CORROBORATION = ['unverified', 'partially_corroborated', 'corroborated', 'contradicted', 'unable_to_verify'] as const
export const CI_SENSITIVITY = ['routine', 'sensitive', 'highly_sensitive'] as const
export const CI_CONTACT_METHODS = ['in_person', 'phone', 'message', 'other'] as const
export const CI_ASSESSMENT_SCALE = ['unknown', 'low', 'moderate', 'high'] as const
export const CI_HANDLING = ['official_use', 'law_enforcement_sensitive', 'court_disclosable'] as const
export const CI_LINK_KINDS = ['person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'media'] as const
export const CI_DEFAULT_CAPACITY = 6
export const CI_MAX_CAPACITY = 30
const BUREAUS: readonly string[] = ['major_crimes', 'street_crimes', 'JTF']
const COMMAND = new Set(['bureau_lead', 'deputy_director', 'director'])

/** The contract's fixed wordings (§3). */
export const CI_MESSAGES = {
  unavailable: 'This person cannot be designated right now.',
  capacitySelf: (n: number, c: number) => `You are at capacity (${n} / ${c}). Request additional capacity or an assignment.`,
  capacityFull: (name: string, n: number, c: number) => `${name} is at capacity (${n} / ${c}). Confirm the override with a reason.`,
  primaryRequired: 'Assign a new primary handler first',
  unsanitized: 'The text names the source — remove the CI number, name, alias or handler.',
  notActive: 'your account is not active',
  noAccess: 'that source is not available to you',
  fullOnly: {
    set_status: 'only CI command can change a source status',
    assign_handler: 'only CI command can assign or remove handlers',
    decide: 'only CI command can decide CI requests',
    capacity: 'only CI command can set handler capacity',
    release: 'only CI command can release source intelligence',
    stats: 'only CI command can read the roster statistics',
  },
  sweepDenied: 'only the Owner may run the CI contact sweep',
} as const

const LINK_TABLE: Record<string, MockTableName> = {
  person: 'persons', vehicle: 'vehicles', gang: 'gangs', place: 'places', narcotic: 'narcotics', evidence: 'evidence', media: 'media',
}

/* ── Rows / session ─────────────────────────────────────────────────────── */

const rows = <T extends MockTableName>(table: T): Tables<T>[] =>
  (getDenial(table) ? [] : getRows(table)) as unknown as Tables<T>[]
const profileOf = (id: unknown): Profile | undefined => rows('profiles').find((p) => p.id === str(id))
const nameOf = (id: unknown): string | null => profileOf(id)?.display_name ?? null
const caseOf = (id: unknown): MockRow | undefined => findRow('cases', id)
const ciOf = (id: unknown): Ci | undefined => rows('confidential_informants').find((c) => c.id === str(id))
const liveHandlers = (ciId: string): Handler[] => rows('ci_handlers').filter((h) => h.ci_id === ciId && h.ended_at == null)

/* ── §1 helpers ─────────────────────────────────────────────────────────── */

/** private.has_full_ci_access — the Owner, Bureau Lead / Deputy Director /
 *  Director, or an active non-oversight SIB member; never an inactive or
 *  removed profile. */
export function hasFullCiAccessAs(p: Profile | null = profile()): boolean {
  if (!isActive(p)) return false
  if (p!.is_owner || COMMAND.has(p!.role ?? '')) return true
  return rows('siu_memberships').some((m) => m.user_id === p!.id && m.active && m.ended_at == null && !m.oversight_only)
}
/** private.ci_is_active_handler — a live ci_handlers row for an active profile. */
export function ciIsActiveHandlerAs(ciId: string, p: Profile | null = profile()): boolean {
  return isActive(p) && liveHandlers(ciId).some((h) => h.user_id === p!.id)
}
/** private.can_access_ci — the canonical rule; a deleted CI only for full access. */
export function canAccessCiAs(ciId: unknown, p: Profile | null = profile()): boolean {
  const ci = ciOf(ciId)
  if (!ci || !isActive(p)) return false
  if (hasFullCiAccessAs(p)) return true
  return ci.deleted_at == null && ciIsActiveHandlerAs(ci.id, p)
}
/** private.ci_is_handler — handles at least one non-deleted CI right now. */
export function ciIsHandlerAs(p: Profile | null = profile()): boolean {
  if (!isActive(p)) return false
  return rows('ci_handlers').some((h) => h.user_id === p!.id && h.ended_at == null && ciOf(h.ci_id)?.deleted_at == null)
}
/** private.ci_capacity — 6 unless a live override. */
export function ciCapacityOf(userId: string): number {
  const o = rows('ci_handler_capacity').find((c) => c.user_id === userId)
  if (!o) return CI_DEFAULT_CAPACITY
  if (o.expires_at != null && Date.parse(o.expires_at) <= Date.now()) return CI_DEFAULT_CAPACITY
  return o.limit_override
}
/** private.ci_active_count — active, non-deleted CIs the user handles that count toward capacity. */
export function ciActiveCountOf(userId: string): number {
  return rows('ci_handlers').filter((h) => {
    if (h.user_id !== userId || h.ended_at != null || !h.counts_toward_capacity) return false
    const ci = ciOf(h.ci_id)
    return !!ci && ci.status === 'active' && ci.deleted_at == null
  }).length
}
/** private.ci_next_number — 'CI-' || lpad(nextval, 4, '0'); the mock derives the sequence from the rows. */
export function ciNextNumber(): string {
  const max = getRows('confidential_informants').reduce((m, r) => Math.max(m, Number(str(r.ci_number).replace(/^CI-/, '')) || 0), 0)
  return `CI-${String(max + 1).padStart(4, '0')}`
}
/** private.ci_audit — ci_audit_events, NEVER audit_log. */
function ciAudit(ciId: string | null, action: string, entity: string, entityId: string | null, detail: Json | null = null): void {
  seedRows('ci_audit_events', [ciAuditEventRow({
    id: getRows('ci_audit_events').length + 1, action, entity, entity_id: entityId, ci_id: ciId, actor_id: uid(), detail, created_at: now(),
  })])
}
/** private.ci_event — the ids-only realtime shadow. */
function ciEvent(ciId: string | null, kind: string, userId: string | null = null): void {
  seedRows('ci_events', [ciEventRow({ id: getRows('ci_events').length + 1, kind, ci_id: ciId, user_id: userId, at: now() })])
}
/** private.ci_reviewers — the bureau's leads, every active Deputy / Director, the SIB special agent in charge. */
export function ciReviewers(bureau: string | null): string[] {
  const out = new Set<string>()
  for (const p of rows('profiles')) {
    if (!isActive(p)) continue
    if (p.role === 'deputy_director' || p.role === 'director') out.add(p.id)
    if (p.role === 'bureau_lead' && (bureau == null || p.division === bureau)) out.add(p.id)
  }
  for (const m of rows('siu_memberships')) if (m.active && m.ended_at == null && m.siu_role === 'special_agent_in_charge' && isActive(profileOf(m.user_id) ?? null)) out.add(m.user_id)
  return [...out]
}
/** private.ci_notify_full_access — the same audience, notified; returns the rows written. */
function ciNotifyFullAccess(bureau: string | null, kind: string, payload: Record<string, Json>): number {
  return ciReviewers(bureau).filter((id) => actionNotify(id, kind, payload)).length
}
/** private.ci_sanitized — false when the text names the CI number, the person's name or alias, the CI alias, or a handler. */
export function ciSanitized(ciId: string, text: string): boolean {
  const ci = ciOf(ciId)
  if (!ci) return true
  const hay = text.toLowerCase()
  const person = findRow('persons', ci.person_id)
  const names = [ci.ci_number, ci.alias, person?.name, person?.alias, ...liveHandlers(ci.id).map((h) => nameOf(h.user_id))]
  return !names.some((n) => { const s = str(n).trim().toLowerCase(); return s.length > 0 && hay.includes(s) })
}
/** private.perm_registry_visible for a link / person target in the mock: a live, unmerged row the caller can see. */
function targetVisible(kind: string, id: unknown): boolean {
  const table = LINK_TABLE[kind]
  if (!table) return false
  const r = findRow(table, id)
  if (!r || r.deleted_at != null || r.lifecycle === 'merged' || r.merged_into != null) return false
  if (r.siu_hidden_flag === true && !isOwner()) return false
  if (table === 'evidence' || table === 'media') return canReadCaseAs(profile(), caseOf(r.case_id))
  return true
}

/* ── The SELECT policies (§2) — visibleCiRows ────────────────────────────── */

const CI_TABLES: ReadonlySet<MockTableName> = new Set(CI_RPC_ONLY_TABLES)
/** The generic table handler runs the fourteen CI tables through this. */
export function visibleCiRows(table: MockTableName, list: MockRow[]): MockRow[] {
  if (!CI_TABLES.has(table)) return list
  const p = profile()
  if (!isActive(p)) return []
  const full = hasFullCiAccessAs(p)
  const me = p!.id
  switch (table) {
    case 'confidential_informants': return list.filter((r) => canAccessCiAs(r.id, p))
    case 'ci_handler_capacity': return list.filter((r) => r.user_id === me || full)
    case 'ci_capacity_requests': return list.filter((r) => r.requester_id === me || full)
    case 'ci_intelligence_links': return list.filter((r) => { const i = findRow('ci_intelligence', r.intel_id); return !!i && canAccessCiAs(i.ci_id, p) })
    case 'case_intel_releases': return list.filter((r) => canReadCaseAs(p, caseOf(r.case_id)) && (r.revoked_at == null || full))
    case 'ci_audit_events': return list.filter((r) => (r.ci_id != null ? canAccessCiAs(r.ci_id, p)
      : full || r.actor_id === me || ((r.detail as Record<string, unknown> | null)?.requester_id === me)))
    case 'ci_events': return list.filter((r) => (r.ci_id != null ? canAccessCiAs(r.ci_id, p) : r.user_id === me || full))
    default: return list.filter((r) => canAccessCiAs(r.ci_id, p)) // handlers, intelligence, contacts, assessments, payments, case links, releases
  }
}

/* ── Shared guards ──────────────────────────────────────────────────────── */

const activeOrDeny = (): Profile => { const p = profile(); if (!isActive(p)) deny(CI_MESSAGES.notActive); return p! }
/** The CI the caller may act on, or the one P0403 wording (missing and unauthorized are indistinguishable). */
function accessibleCi(id: unknown): Ci {
  const ci = ciOf(id)
  if (!ci || !canAccessCiAs(ci.id)) deny(CI_MESSAGES.noAccess)
  return ci!
}
const fullOrDeny = (message: string): Profile => { const p = activeOrDeny(); if (!hasFullCiAccessAs(p)) deny(message); return p }
const inSet = (set: readonly string[], v: unknown): boolean => set.includes(str(v))
const RLS_TEST_EMAIL = /^rls-test-.*@cidportal\.test$/
const isFixture = (p: Profile | undefined | null) => !!p && (p.is_test || RLS_TEST_EMAIL.test(p.email ?? ''))

/** A handler target: active, not removed, not a fixture unless the caller is. */
function handlerTarget(id: unknown, caller: Profile): Profile | Refusal {
  const t = profileOf(id)
  if (!t || !isActive(t)) return refuse('bad_handler', 'that member cannot be assigned as a handler')
  if (isFixture(t) && !isFixture(caller)) return refuse('bad_handler', 'that member cannot be assigned as a handler')
  return t
}
const isRefusal = (v: unknown): v is Refusal => typeof v === 'object' && v !== null && (v as Refusal).ok === false

/** The capacity rule of ci_create / ci_handler_set for an ACTIVE CI: at
 *  capacity → a non-full caller is refused with the self wording, a full
 *  caller without a reason with the named wording; with a reason the
 *  override is audited and the handler's limit raised to the new count. */
type Deferred = (ciId: string) => void
function capacityGate(handler: Profile, caller: Profile, full: boolean, overrideReason: unknown, deferred: Deferred[]): Refusal | null {
  const n = ciActiveCountOf(handler.id)
  const c = ciCapacityOf(handler.id)
  if (n < c) return null
  if (!full) return refuse('capacity', CI_MESSAGES.capacitySelf(n, c))
  const reason = blank(overrideReason)
  if (!reason) return refuse('capacity', CI_MESSAGES.capacityFull(handler.display_name, n, c))
  const limit = Math.min(n + 1, CI_MAX_CAPACITY)
  const existing = rows('ci_handler_capacity').find((r) => r.user_id === handler.id)
  if (existing) Object.assign(existing, { limit_override: limit, reason, approved_by: caller.id, approved_at: now(), expires_at: null })
  else seedRows('ci_handler_capacity', [ciHandlerCapacityRow({ user_id: handler.id, approved_by: caller.id, limit_override: limit, reason })])
  // The audit row carries the CI it was raised for — written once the CI exists (ci_create) or right away (ci_handler_set).
  deferred.push((ciId) => ciAudit(ciId, 'CI_CAPACITY_OVERRIDE', 'ci_handler_capacity', handler.id, { handler_id: handler.id, from: c, to: limit, reason }))
  return null
}

/* ── Projections ────────────────────────────────────────────────────────── */

type ListRow = Fns['ci_list']['Returns'][number]
function listRow(ci: Ci): ListRow {
  const hs = liveHandlers(ci.id)
  const primary = hs.find((h) => h.role === 'primary')
  const secondary = hs.find((h) => h.role === 'secondary')
  const person = findRow('persons', ci.person_id)
  return {
    id: ci.id, ci_number: ci.ci_number, alias: ci.alias, person_id: ci.person_id, person_name: str(person?.name),
    status: ci.status, bureau: ci.bureau, motive_primary: ci.motive_primary, motive_secondary: ci.motive_secondary,
    reliability: ci.reliability, risk: ci.risk, last_contact_at: ci.last_contact_at, next_contact_at: ci.next_contact_at,
    primary_handler_id: primary?.user_id ?? null, primary_handler_name: primary ? nameOf(primary.user_id) : null,
    secondary_handler_id: secondary?.user_id ?? null, secondary_handler_name: secondary ? nameOf(secondary.user_id) : null,
    linked_cases: rows('ci_case_links').filter((l) => l.ci_id === ci.id && l.unlinked_at == null).length,
    open_followups: rows('ci_intelligence').filter((i) => i.ci_id === ci.id && i.deleted_at == null && i.follow_up_required && i.follow_up_done_at == null).length,
    deleted_at: ci.deleted_at,
  }
}
const STATUS_ORDER: Record<string, number> = Object.fromEntries(CI_STATUSES.map((s, i) => [s, i]))
const byStatusThenNext = (a: ListRow, b: ListRow) => {
  const s = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
  if (s) return s
  if (a.next_contact_at == null) return b.next_contact_at == null ? 0 : 1
  if (b.next_contact_at == null) return -1
  return Date.parse(a.next_contact_at) - Date.parse(b.next_contact_at)
}
/** The CIs the caller can access (non-deleted unless include_deleted with full access). */
function accessibleCis(includeDeleted = false): Ci[] {
  const p = profile()
  if (!isActive(p)) return []
  const full = hasFullCiAccessAs(p)
  return rows('confidential_informants').filter((c) => (c.deleted_at == null || (includeDeleted && full)) && canAccessCiAs(c.id, p))
}

/* ── §3 read RPCs ───────────────────────────────────────────────────────── */

/** ci_context() → {full_access, is_handler, active_count, capacity, pending_requests, contacts_due, followups_due};
 *  a non-involved member gets exactly {full_access:false, is_handler:false}. Never errors. */
export function ciContext(): Fns['ci_context']['Returns'] {
  const p = profile()
  if (!isActive(p)) return { full_access: false, is_handler: false }
  const full = hasFullCiAccessAs(p)
  const handler = ciIsHandlerAs(p)
  if (!full && !handler) return { full_access: false, is_handler: false }
  const mine = accessibleCis()
  const t = Date.now()
  const pending = full
    ? rows('ci_capacity_requests').filter((r) => r.status === 'pending').length
    : rows('ci_capacity_requests').filter((r) => r.status === 'pending' && r.requester_id === p!.id).length
  return {
    full_access: full, is_handler: handler,
    active_count: ciActiveCountOf(p!.id), capacity: ciCapacityOf(p!.id), pending_requests: pending,
    contacts_due: mine.filter((c) => c.status === 'active' && c.next_contact_at != null && Date.parse(c.next_contact_at) < t).length,
    followups_due: rows('ci_intelligence').filter((i) => i.deleted_at == null && i.follow_up_required && i.follow_up_done_at == null && mine.some((c) => c.id === i.ci_id)).length,
  }
}

/** ci_list(p_filters, p_limit) — the rows the caller can access, filtered; ordered status, next_contact_at nulls last. */
export function ciList(args: Args = {}): ListRow[] {
  const f = (args.p_filters ?? {}) as Record<string, unknown>
  const limit = Math.min(Math.max(Number(args.p_limit) || 200, 1), 1000)
  let out = accessibleCis(f.include_deleted === true).map(listRow)
  if (Array.isArray(f.status) && f.status.length) out = out.filter((r) => (f.status as unknown[]).map(str).includes(r.status))
  if (f.handler) out = out.filter((r) => r.primary_handler_id === str(f.handler) || r.secondary_handler_id === str(f.handler))
  if (f.bureau) out = out.filter((r) => r.bureau === str(f.bureau))
  if (f.motive) out = out.filter((r) => r.motive_primary === str(f.motive) || r.motive_secondary.includes(str(f.motive)))
  if (f.reliability) out = out.filter((r) => r.reliability === str(f.reliability))
  if (f.risk) out = out.filter((r) => r.risk === str(f.risk))
  if (f.case_id) out = out.filter((r) => rows('ci_case_links').some((l) => l.ci_id === r.id && l.case_id === str(f.case_id) && l.unlinked_at == null))
  if (f.q) { const q = str(f.q).toLowerCase(); out = out.filter((r) => [r.ci_number, r.alias, r.person_name].some((v) => str(v).toLowerCase().includes(q))) }
  const t = Date.now()
  if (f.contact === 'overdue') out = out.filter((r) => r.next_contact_at != null && Date.parse(r.next_contact_at) < t)
  if (f.contact === 'due_7d') out = out.filter((r) => r.next_contact_at != null && Date.parse(r.next_contact_at) < t + 7 * DAY)
  if (f.followups === true) out = out.filter((r) => r.open_followups > 0)
  return out.sort(byStatusThenNext).slice(0, limit)
}

/** ci_get(p_ci) → the row + handlers[] + handler_history[] (full only) + latest assessment + readable cases[] + counts; null otherwise. */
export function ciGet(args: Args): Fns['ci_get']['Returns'] {
  const p = profile()
  const ci = ciOf(args.p_ci)
  if (!ci || !canAccessCiAs(ci.id, p)) return null
  const full = hasFullCiAccessAs(p)
  const handler = (h: Handler): Json => ({ ...h, name: nameOf(h.user_id) })
  const assessments = rows('ci_assessments').filter((a) => a.ci_id === ci.id).sort((a, b) => Date.parse(b.assessed_at) - Date.parse(a.assessed_at))
  const cases: Json[] = rows('ci_case_links')
    .filter((l) => l.ci_id === ci.id && l.unlinked_at == null)
    .map((l) => ({ l, kase: caseOf(l.case_id) }))
    .filter(({ kase }) => canReadCaseAs(p, kase))
    .map(({ l, kase }) => ({ case_id: l.case_id, case_number: str(kase!.case_number), title: str(kase!.title), linked_at: l.linked_at }))
  return {
    ...ci, person_name: str(findRow('persons', ci.person_id)?.name),
    handlers: liveHandlers(ci.id).map(handler),
    handler_history: full ? rows('ci_handlers').filter((h) => h.ci_id === ci.id && h.ended_at != null).map(handler) : [],
    assessment: (assessments[0] as Json | undefined) ?? null,
    cases,
    counts: {
      intel: rows('ci_intelligence').filter((i) => i.ci_id === ci.id && i.deleted_at == null).length,
      contacts: rows('ci_contacts').filter((c) => c.ci_id === ci.id && c.deleted_at == null).length,
      payments: rows('ci_payments').filter((c) => c.ci_id === ci.id && c.deleted_at == null).length,
      releases: rows('ci_releases').filter((r) => r.ci_id === ci.id).length,
    },
  }
}

/** ci_stats() — full only, else null. */
export function ciStats(): Fns['ci_stats']['Returns'] {
  const p = profile()
  if (!hasFullCiAccessAs(p)) return null
  const live = rows('confidential_informants').filter((c) => c.deleted_at == null)
  const t = Date.now()
  const handlerIds = [...new Set(rows('ci_handlers').filter((h) => h.ended_at == null && ciOf(h.ci_id)?.deleted_at == null).map((h) => h.user_id))]
  const handlers = handlerIds.map((id) => ({
    user_id: id, name: nameOf(id), active_count: ciActiveCountOf(id), capacity: ciCapacityOf(id),
    ci_ids: rows('ci_handlers').filter((h) => h.user_id === id && h.ended_at == null && ciOf(h.ci_id)?.deleted_at == null).map((h) => h.ci_id),
  }))
  return {
    active: live.filter((c) => c.status === 'active').length,
    dormant: live.filter((c) => c.status === 'dormant').length,
    high_risk: live.filter((c) => c.risk === 'high' || c.risk === 'critical').length,
    compromised: live.filter((c) => c.status === 'compromised').length,
    contacts_overdue: live.filter((c) => c.status === 'active' && c.next_contact_at != null && Date.parse(c.next_contact_at) < t).length,
    handlers_at_capacity: handlers.filter((h) => h.active_count >= h.capacity).length,
    pending_requests: rows('ci_capacity_requests').filter((r) => r.status === 'pending').length,
    handlers,
  }
}

/* ── §3 write RPCs — the CI ─────────────────────────────────────────────── */

/** ci_create(...) — full access, or the caller is p_primary_handler with no secondary (self-recruitment). */
export function ciCreate(args: Args): Fns['ci_create']['Returns'] {
  const me = activeOrDeny()
  const full = hasFullCiAccessAs(me)
  const primaryId = str(args.p_primary_handler)
  const secondaryId = blank(args.p_secondary_handler)
  if (!full && !(primaryId === me.id && secondaryId == null)) deny('only CI command can designate a source for another handler')
  // The person: live, unmerged, visible, and not already a live CI — ONE wording for every failure and every caller.
  const person = findRow('persons', args.p_person)
  if (!person || !targetVisible('person', args.p_person)) return refuse('unavailable', CI_MESSAGES.unavailable)
  const personId = str(person.id)
  if (rows('confidential_informants').some((c) => c.person_id === personId && c.deleted_at == null)) return refuse('unavailable', CI_MESSAGES.unavailable)
  const status = str(args.p_status ?? 'candidate')
  const reliability = str(args.p_reliability ?? 'unknown')
  const risk = str(args.p_risk ?? 'medium')
  const motive = blank(args.p_motive_primary)
  const secondaryMotives = Array.isArray(args.p_motive_secondary) ? (args.p_motive_secondary as unknown[]).map(str) : []
  if (!inSet(CI_STATUSES, status)) return refuse('invalid', 'unknown source status')
  if (!inSet(BUREAUS, args.p_bureau)) return refuse('invalid', 'unknown bureau')
  if (!inSet(CI_RELIABILITY, reliability) || !inSet(CI_RISK, risk)) return refuse('invalid', 'unknown reliability or risk')
  if (motive != null && !inSet(CI_MOTIVES, motive)) return refuse('invalid', 'unknown motive')
  if (secondaryMotives.some((m) => !inSet(CI_MOTIVES, m))) return refuse('invalid', 'unknown motive')
  const primary = handlerTarget(primaryId, me)
  if (isRefusal(primary)) return primary
  const secondary = secondaryId ? handlerTarget(secondaryId, me) : null
  if (isRefusal(secondary)) return secondary
  if (secondary && secondary.id === primary.id) return refuse('invalid', 'the primary and secondary handler must differ')
  const overrides: Deferred[] = []
  if (status === 'active') {
    for (const h of [primary, secondary]) {
      if (!h) continue
      const gate = capacityGate(h, me, full, args.p_override_reason, overrides)
      if (gate) return gate
    }
  }
  const [ci] = seedRows('confidential_informants', [confidentialInformantRow({
    person_id: personId, ci_number: ciNextNumber(), alias: blank(args.p_alias), bureau: str(args.p_bureau) as Bureau, status,
    motive_primary: motive, motive_secondary: secondaryMotives, motive_explanation: blank(args.p_motive_explanation),
    recruitment_notes: blank(args.p_recruitment_notes), reliability, risk, recruited_at: blank(args.p_recruited_at) ?? now().slice(0, 10),
    recruited_by: me.id, created_by: me.id, created_at: now(), updated_at: now(), status_changed_at: now(),
  })])
  ciAudit(ci.id, 'CI_CREATED', 'confidential_informants', ci.id, { ci_number: ci.ci_number, status, bureau: ci.bureau })
  ciAudit(ci.id, 'CI_PERSON_DESIGNATED', 'confidential_informants', ci.id, { person_id: personId })
  for (const write of overrides) write(ci.id)
  for (const [h, role] of [[primary, 'primary'], [secondary, 'secondary']] as const) {
    if (!h) continue
    const [row] = seedRows('ci_handlers', [ciHandlerRow({ ci_id: ci.id, user_id: h.id, role, assigned_by: me.id, assigned_at: now() })])
    ciAudit(ci.id, 'CI_HANDLER_ASSIGNED', 'ci_handlers', row.id, { user_id: h.id, role })
    if (h.id !== me.id) actionNotify(h.id, 'ci_assigned', { ci_id: ci.id })
  }
  ciEvent(ci.id, 'created', me.id)
  return { ok: true, id: ci.id, ci_number: ci.ci_number }
}

const UPDATE_KEYS = new Set(['alias', 'motive_primary', 'motive_secondary', 'motive_explanation', 'recruitment_notes', 'next_contact_at', 'reliability', 'risk', 'bureau', 'supervising_lead_id'])
/** ci_update(p_ci, p_patch) — can_access_ci; bureau / supervising_lead_id only with full access. */
export function ciUpdate(args: Args): Fns['ci_update']['Returns'] {
  activeOrDeny()
  const ci = accessibleCi(args.p_ci)
  const patch = (args.p_patch ?? {}) as Record<string, unknown>
  const keys = Object.keys(patch).filter((k) => UPDATE_KEYS.has(k))
  if (!keys.length) return refuse('invalid', 'nothing to update')
  if ((keys.includes('bureau') || keys.includes('supervising_lead_id')) && !hasFullCiAccessAs()) deny('only CI command can change a source bureau or supervising lead')
  if ('bureau' in patch && !inSet(BUREAUS, patch.bureau)) return refuse('invalid', 'unknown bureau')
  if ('reliability' in patch && !inSet(CI_RELIABILITY, patch.reliability)) return refuse('invalid', 'unknown reliability')
  if ('risk' in patch && !inSet(CI_RISK, patch.risk)) return refuse('invalid', 'unknown risk')
  if ('motive_primary' in patch && patch.motive_primary != null && !inSet(CI_MOTIVES, patch.motive_primary)) return refuse('invalid', 'unknown motive')
  if ('motive_secondary' in patch && (!Array.isArray(patch.motive_secondary) || (patch.motive_secondary as unknown[]).some((m) => !inSet(CI_MOTIVES, m)))) return refuse('invalid', 'unknown motive')
  for (const k of keys) (ci as unknown as MockRow)[k] = patch[k] ?? null
  ci.updated_at = now()
  ciAudit(ci.id, 'CI_UPDATED', 'confidential_informants', ci.id, { keys })
  ciEvent(ci.id, 'updated', uid())
  return { ok: true, id: ci.id }
}

/** ci_set_status(p_ci, p_status, p_reason) — full only; reason ≥ 3 chars; compromised notifies. Never declassifies anything. */
export function ciSetStatus(args: Args): Fns['ci_set_status']['Returns'] {
  const me = fullOrDeny(CI_MESSAGES.fullOnly.set_status)
  const ci = accessibleCi(args.p_ci)
  const status = str(args.p_status)
  const reason = blank(args.p_reason)
  if (!inSet(CI_STATUSES, status)) return refuse('invalid', 'unknown source status')
  if (!reason || reason.length < 3) return refuse('reason', 'say why the status is changing')
  if (ci.status === status) return refuse('unchanged', 'the source already has that status')
  const from = ci.status
  Object.assign(ci, { status, status_changed_at: now(), status_reason: reason, updated_at: now() })
  ciAudit(ci.id, 'CI_STATUS_CHANGED', 'confidential_informants', ci.id, { from, to: status })
  if (status === 'compromised') {
    for (const h of liveHandlers(ci.id)) actionNotify(h.user_id, 'ci_compromised', { ci_id: ci.id })
    if (ci.supervising_lead_id) actionNotify(ci.supervising_lead_id, 'ci_compromised', { ci_id: ci.id })
    ciNotifyFullAccess(ci.bureau, 'ci_compromised', { ci_id: ci.id })
  }
  ciEvent(ci.id, 'status', me.id)
  return { ok: true, id: ci.id, status }
}

/** ci_handler_set(p_ci, p_user, p_role, p_reason, p_override_reason, p_counts) — full only. */
export function ciHandlerSet(args: Args): Fns['ci_handler_set']['Returns'] {
  const me = fullOrDeny(CI_MESSAGES.fullOnly.assign_handler)
  const ci = accessibleCi(args.p_ci)
  const role = str(args.p_role)
  if (role !== 'primary' && role !== 'secondary') return refuse('invalid', 'the handler role is primary or secondary')
  const reason = blank(args.p_reason)
  if (!reason || reason.length < 3) return refuse('reason', 'say why the handler is changing')
  const target = handlerTarget(args.p_user, me)
  if (isRefusal(target)) return target
  const counts = args.p_counts !== false
  const current = liveHandlers(ci.id).find((h) => h.role === role)
  if (current && current.user_id === target.id) return refuse('unchanged', 'that member already holds that role')
  if (ci.status === 'active' && counts) {
    const overrides: Deferred[] = []
    const gate = capacityGate(target, me, true, args.p_override_reason, overrides)
    if (gate) return gate
    for (const write of overrides) write(ci.id)
  }
  const ended: Handler[] = []
  for (const h of liveHandlers(ci.id)) {
    if (h.role === role || h.user_id === target.id) { Object.assign(h, { ended_at: now(), ended_by: me.id, end_reason: reason }); ended.push(h) }
  }
  const [row] = seedRows('ci_handlers', [ciHandlerRow({ ci_id: ci.id, user_id: target.id, role, reason, assigned_by: me.id, assigned_at: now(), counts_toward_capacity: counts })])
  ciAudit(ci.id, current ? 'CI_HANDLER_CHANGED' : 'CI_HANDLER_ASSIGNED', 'ci_handlers', row.id, { user_id: target.id, role, from: current?.user_id ?? null, reason })
  if (target.id !== me.id) actionNotify(target.id, 'ci_assigned', { ci_id: ci.id })
  for (const h of ended) if (h.user_id !== target.id) actionNotify(h.user_id, 'ci_handler_removed', { ci_id: ci.id })
  for (const h of liveHandlers(ci.id)) if (h.user_id !== target.id) actionNotify(h.user_id, 'ci_handler_changed', { ci_id: ci.id })
  if (ci.supervising_lead_id && ci.supervising_lead_id !== target.id) actionNotify(ci.supervising_lead_id, 'ci_handler_changed', { ci_id: ci.id })
  ciEvent(ci.id, 'handlers', me.id)
  return { ok: true, id: row.id, ci_id: ci.id, user_id: target.id, role }
}

/** ci_handler_remove(p_ci, p_user, p_reason) — full only; the primary of an active / candidate CI stays until replaced. */
export function ciHandlerRemove(args: Args): Fns['ci_handler_remove']['Returns'] {
  const me = fullOrDeny(CI_MESSAGES.fullOnly.assign_handler)
  const ci = accessibleCi(args.p_ci)
  const reason = blank(args.p_reason)
  if (!reason || reason.length < 3) return refuse('reason', 'say why the handler is being removed')
  const h = liveHandlers(ci.id).find((x) => x.user_id === str(args.p_user))
  if (!h) return refuse('not_handler', 'that member does not handle this source')
  if (h.role === 'primary' && (ci.status === 'active' || ci.status === 'candidate')) return refuse('primary_required', CI_MESSAGES.primaryRequired)
  Object.assign(h, { ended_at: now(), ended_by: me.id, end_reason: reason })
  ciAudit(ci.id, 'CI_HANDLER_REMOVED', 'ci_handlers', h.id, { user_id: h.user_id, role: h.role, reason })
  actionNotify(h.user_id, 'ci_handler_removed', { ci_id: ci.id })
  ciEvent(ci.id, 'handlers', me.id)
  return { ok: true, id: h.id }
}

/* ── §3 capacity requests ───────────────────────────────────────────────── */

/** ci_capacity_request_submit(...) — any active member for 'assignment'; a current handler for 'capacity'. */
export function ciCapacityRequestSubmit(args: Args): Fns['ci_capacity_request_submit']['Returns'] {
  const me = activeOrDeny()
  const kind = str(args.p_kind)
  if (kind !== 'capacity' && kind !== 'assignment') return refuse('invalid', 'the request kind is capacity or assignment')
  if (kind === 'capacity' && !ciIsHandlerAs(me)) deny('only a current handler can request additional capacity')
  const reason = blank(args.p_reason)
  if (!reason || reason.length < 3) return refuse('reason', 'say why you are requesting this')
  const current = ciActiveCountOf(me.id)
  const capacity = ciCapacityOf(me.id)
  let requested: number | null = null
  if (kind === 'capacity') {
    requested = Number(args.p_requested_capacity)
    if (!Number.isInteger(requested) || requested <= capacity || requested > CI_MAX_CAPACITY) return refuse('invalid', `request more than your current capacity (${capacity}) and at most ${CI_MAX_CAPACITY}`)
  }
  if (rows('ci_capacity_requests').some((r) => r.requester_id === me.id && r.kind === kind && r.status === 'pending')) return refuse('pending', 'you already have a pending request of that kind')
  if (args.p_case && !canReadCaseAs(me, caseOf(args.p_case))) return refuse('bad_case', 'that case is not available to you')
  if (kind === 'assignment' && args.p_proposed_person && !targetVisible('person', args.p_proposed_person)) return refuse('unavailable', CI_MESSAGES.unavailable)
  const bureau = (blank(args.p_bureau) ?? me.division) as Bureau | null
  const [req] = seedRows('ci_capacity_requests', [ciCapacityRequestRow({
    requester_id: me.id, kind, bureau, current_count: current, requested_capacity: requested, reason,
    operational_need: blank(args.p_operational_need), case_id: blank(args.p_case), proposed_person_id: blank(args.p_proposed_person),
    proposed_motive: blank(args.p_proposed_motive), estimated_risk: blank(args.p_estimated_risk), expected_usefulness: blank(args.p_expected_usefulness),
    comments: blank(args.p_comments), created_at: now(), updated_at: now(),
  })])
  ciAudit(null, kind === 'capacity' ? 'CI_CAPACITY_REQUESTED' : 'CI_ASSIGNMENT_REQUESTED', 'ci_capacity_requests', req.id, { requester_id: me.id, request_id: req.id, kind })
  ciNotifyFullAccess(bureau, 'ci_capacity_request', { request_id: req.id })
  ciEvent(null, 'request', me.id)
  return { ok: true, id: req.id, status: 'pending' }
}

/** ci_capacity_request_decide(p_request, p_decision, p_note, p_new_capacity, p_expires_at) — full only. */
export function ciCapacityRequestDecide(args: Args): Fns['ci_capacity_request_decide']['Returns'] {
  const me = fullOrDeny(CI_MESSAGES.fullOnly.decide)
  const req = rows('ci_capacity_requests').find((r) => r.id === str(args.p_request))
  if (!req) return refuse('not_found', 'request not found')
  if (req.status !== 'pending') return refuse('not_pending', 'that request has already been decided')
  const decision = str(args.p_decision)
  if (!['approved', 'denied', 'returned'].includes(decision)) return refuse('invalid', 'the decision is approved, denied or returned')
  const note = blank(args.p_note)
  if (decision !== 'approved' && !note) return refuse('note', 'a note is required to deny or return a request')
  let createdCi: string | null = null
  if (decision === 'approved' && req.kind === 'capacity') {
    const limit = Number(args.p_new_capacity ?? req.requested_capacity)
    if (!Number.isInteger(limit) || limit < 1 || limit > CI_MAX_CAPACITY) return refuse('invalid', `capacity is between 1 and ${CI_MAX_CAPACITY}`)
    const existing = rows('ci_handler_capacity').find((r) => r.user_id === req.requester_id)
    const from = ciCapacityOf(req.requester_id)
    const patch = { limit_override: limit, reason: `Approved request ${req.id}`, approved_by: me.id, approved_at: now(), expires_at: blank(args.p_expires_at), request_id: req.id }
    if (existing) Object.assign(existing, patch)
    else seedRows('ci_handler_capacity', [ciHandlerCapacityRow({ user_id: req.requester_id, ...patch })])
    ciAudit(null, 'CI_CAPACITY_CHANGED', 'ci_handler_capacity', req.requester_id, { requester_id: req.requester_id, from, to: limit, request_id: req.id })
  }
  if (decision === 'approved' && req.kind === 'assignment' && req.proposed_person_id) {
    const requester = profileOf(req.requester_id)
    const atCapacity = !!requester && ciActiveCountOf(requester.id) >= ciCapacityOf(requester.id)
    const created = ciCreate({
      p_person: req.proposed_person_id, p_bureau: req.bureau ?? me.division, p_primary_handler: req.requester_id, p_status: 'active',
      p_motive_primary: req.proposed_motive, p_risk: req.estimated_risk ?? 'medium', p_recruitment_notes: req.operational_need,
      p_override_reason: atCapacity ? `Approved assignment request ${req.id}` : null,
    }) as Record<string, unknown>
    if (created.ok !== true) return created as Refusal
    createdCi = str(created.id)
  }
  Object.assign(req, { status: decision, decided_by: me.id, decided_at: now(), decision_note: note, created_ci_id: createdCi, updated_at: now() })
  ciAudit(null, 'CI_CAPACITY_REQUEST_DECIDED', 'ci_capacity_requests', req.id, { requester_id: req.requester_id, request_id: req.id, decision })
  actionNotify(req.requester_id, 'ci_request_decided', { request_id: req.id })
  ciEvent(null, 'request', req.requester_id)
  return { ok: true, id: req.id, status: decision, created_ci_id: createdCi }
}

/** ci_capacity_request_withdraw(p_request) — the requester, while pending. */
export function ciCapacityRequestWithdraw(args: Args): Fns['ci_capacity_request_withdraw']['Returns'] {
  const me = activeOrDeny()
  const req = rows('ci_capacity_requests').find((r) => r.id === str(args.p_request))
  if (!req || req.requester_id !== me.id) return refuse('not_found', 'request not found')
  if (req.status !== 'pending') return refuse('not_pending', 'that request has already been decided')
  Object.assign(req, { status: 'withdrawn', updated_at: now() })
  ciEvent(null, 'request', me.id)
  return { ok: true, id: req.id, status: 'withdrawn' }
}

/** ci_capacity_set(p_user, p_limit, p_reason, p_expires_at) — full only; null → back to 6. */
export function ciCapacitySet(args: Args): Fns['ci_capacity_set']['Returns'] {
  const me = fullOrDeny(CI_MESSAGES.fullOnly.capacity)
  const target = profileOf(args.p_user)
  if (!target) return refuse('not_found', 'member not found')
  const reason = blank(args.p_reason)
  if (!reason || reason.length < 3) return refuse('reason', 'say why the capacity is changing')
  const from = ciCapacityOf(target.id)
  const list = getRows('ci_handler_capacity')
  if (args.p_limit == null) {
    const idx = list.findIndex((r) => r.user_id === target.id)
    if (idx >= 0) list.splice(idx, 1)
    ciAudit(null, 'CI_CAPACITY_CHANGED', 'ci_handler_capacity', target.id, { handler_id: target.id, from, to: CI_DEFAULT_CAPACITY, reason })
    return { ok: true, user_id: target.id, capacity: CI_DEFAULT_CAPACITY }
  }
  const limit = Number(args.p_limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > CI_MAX_CAPACITY) return refuse('invalid', `capacity is between 1 and ${CI_MAX_CAPACITY}`)
  const existing = rows('ci_handler_capacity').find((r) => r.user_id === target.id)
  const patch = { limit_override: limit, reason, approved_by: me.id, approved_at: now(), expires_at: blank(args.p_expires_at), request_id: null }
  if (existing) Object.assign(existing, patch)
  else seedRows('ci_handler_capacity', [ciHandlerCapacityRow({ user_id: target.id, ...patch })])
  ciAudit(null, 'CI_CAPACITY_CHANGED', 'ci_handler_capacity', target.id, { handler_id: target.id, from, to: limit, reason })
  return { ok: true, user_id: target.id, capacity: limit }
}

/* ── §3 contacts / assessments ──────────────────────────────────────────── */

/** ci_contact_log(...) — can_access_ci; handler_id = caller; updates last / next contact. */
export function ciContactLog(args: Args): Fns['ci_contact_log']['Returns'] {
  const me = activeOrDeny()
  const ci = accessibleCi(args.p_ci)
  const method = str(args.p_method)
  if (!inSet(CI_CONTACT_METHODS, method)) return refuse('invalid', 'unknown contact method')
  const summary = blank(args.p_summary)
  if (!summary) return refuse('invalid', 'a contact needs a summary')
  const occurred = blank(args.p_occurred_at)
  if (!occurred || Number.isNaN(Date.parse(occurred))) return refuse('invalid', 'when did the contact happen?')
  if (args.p_case && !canReadCaseAs(me, caseOf(args.p_case))) return refuse('bad_case', 'that case is not available to you')
  const [c] = seedRows('ci_contacts', [ciContactRow({
    ci_id: ci.id, handler_id: me.id, occurred_at: new Date(occurred).toISOString(), method, summary, location: blank(args.p_location),
    follow_up_required: args.p_follow_up_required === true, next_contact_at: blank(args.p_next_contact_at), case_id: blank(args.p_case),
    restricted_notes: blank(args.p_restricted_notes), created_by: me.id, created_at: now(), updated_at: now(),
  })])
  if (ci.last_contact_at == null || Date.parse(ci.last_contact_at) < Date.parse(c.occurred_at)) ci.last_contact_at = c.occurred_at
  if (c.next_contact_at) ci.next_contact_at = c.next_contact_at
  ci.updated_at = now()
  ciAudit(ci.id, 'CI_CONTACT_LOGGED', 'ci_contacts', c.id, { method })
  ciEvent(ci.id, 'contact', me.id)
  return { ok: true, id: c.id }
}

const contactOf = (id: unknown): Contact | undefined => rows('ci_contacts').find((c) => c.id === str(id) && c.deleted_at == null)
/** The logging handler or full access; a contact on an inaccessible CI answers the one wording. */
function ownedContact(id: unknown): Contact {
  const c = contactOf(id)
  if (!c || !canAccessCiAs(c.ci_id)) deny(CI_MESSAGES.noAccess)
  if (c!.handler_id !== uid() && !hasFullCiAccessAs()) deny('only the logging handler or CI command can change a contact')
  return c!
}
const CONTACT_KEYS = new Set(['occurred_at', 'method', 'summary', 'location', 'follow_up_required', 'next_contact_at', 'case_id', 'restricted_notes'])
export function ciContactUpdate(args: Args): Fns['ci_contact_update']['Returns'] {
  activeOrDeny()
  const c = ownedContact(args.p_contact)
  const patch = (args.p_patch ?? {}) as Record<string, unknown>
  const keys = Object.keys(patch).filter((k) => CONTACT_KEYS.has(k))
  if (!keys.length) return refuse('invalid', 'nothing to update')
  if ('method' in patch && !inSet(CI_CONTACT_METHODS, patch.method)) return refuse('invalid', 'unknown contact method')
  if ('case_id' in patch && patch.case_id != null && !canReadCaseAs(profile(), caseOf(patch.case_id))) return refuse('bad_case', 'that case is not available to you')
  for (const k of keys) (c as unknown as MockRow)[k] = patch[k] ?? null
  c.updated_at = now()
  ciAudit(c.ci_id, 'CI_CONTACT_EDITED', 'ci_contacts', c.id, { keys })
  return { ok: true, id: c.id }
}
export function ciContactDelete(args: Args): Fns['ci_contact_delete']['Returns'] {
  const me = activeOrDeny()
  const c = ownedContact(args.p_contact)
  Object.assign(c, { deleted_at: now(), deleted_by: me.id, delete_reason: blank(args.p_reason), updated_at: now() })
  ciAudit(c.ci_id, 'CI_CONTACT_DELETED', 'ci_contacts', c.id, { reason: blank(args.p_reason) })
  ciEvent(c.ci_id, 'contact', me.id)
  return { ok: true, id: c.id }
}

/** ci_assess(...) — can_access_ci; copies reliability / risk onto the CI. */
export function ciAssess(args: Args): Fns['ci_assess']['Returns'] {
  const me = activeOrDeny()
  const ci = accessibleCi(args.p_ci)
  const scale = (v: unknown) => v == null || inSet(CI_ASSESSMENT_SCALE, v)
  if (args.p_reliability != null && !inSet(CI_RELIABILITY, args.p_reliability)) return refuse('invalid', 'unknown reliability')
  if (args.p_risk != null && !inSet(CI_RISK, args.p_risk)) return refuse('invalid', 'unknown risk')
  if (![args.p_credibility, args.p_access, args.p_compromise_likelihood, args.p_usefulness].every(scale)) return refuse('invalid', 'assessment values are unknown, low, moderate or high')
  const [a] = seedRows('ci_assessments', [ciAssessmentRow({
    ci_id: ci.id, assessed_by: me.id, assessed_at: now(), reliability: blank(args.p_reliability), credibility: blank(args.p_credibility),
    access: blank(args.p_access), risk: blank(args.p_risk), compromise_likelihood: blank(args.p_compromise_likelihood),
    usefulness: blank(args.p_usefulness), note: blank(args.p_note),
  })])
  if (a.reliability) ci.reliability = a.reliability
  if (a.risk) ci.risk = a.risk
  ci.updated_at = now()
  ciAudit(ci.id, 'CI_ASSESSED', 'ci_assessments', a.id, { reliability: a.reliability, risk: a.risk })
  ciEvent(ci.id, 'assessed', me.id)
  return { ok: true, id: a.id }
}

/* ── §3 intelligence ────────────────────────────────────────────────────── */

type LinkIn = { kind: string; target_id: string; note: string | null }
/** Parse `[{kind, target_id, note}]`; every target must be visible to the caller, else `bad_link`. */
function parseLinks(v: unknown): LinkIn[] | Refusal {
  if (v == null) return []
  if (!Array.isArray(v)) return refuse('bad_link', 'links are a list of {kind, target_id}')
  const out: LinkIn[] = []
  for (const raw of v as Record<string, unknown>[]) {
    const kind = str(raw?.kind)
    if (!inSet(CI_LINK_KINDS, kind) || !targetVisible(kind, raw?.target_id)) return refuse('bad_link', 'a linked record is not available to you')
    out.push({ kind, target_id: str(raw.target_id), note: blank(raw.note) })
  }
  return out
}
function ensureCaseLink(ci: Ci, caseId: string, by: string): void {
  if (rows('ci_case_links').some((l) => l.ci_id === ci.id && l.case_id === caseId && l.unlinked_at == null)) return
  const [l] = seedRows('ci_case_links', [ciCaseLinkRow({ ci_id: ci.id, case_id: caseId, linked_by: by, linked_at: now() })])
  ciAudit(ci.id, 'CI_CASE_LINKED', 'ci_case_links', l.id, { case_id: caseId })
}
const intelOf = (id: unknown): Intel | undefined => rows('ci_intelligence').find((i) => i.id === str(id) && i.deleted_at == null)
/** The author handler or full access; an intel row on an inaccessible CI answers the one wording. */
function ownedIntel(id: unknown): Intel {
  const i = intelOf(id)
  if (!i || !canAccessCiAs(i.ci_id)) deny(CI_MESSAGES.noAccess)
  if (i!.handler_id !== uid() && !hasFullCiAccessAs()) deny('only the author or CI command can change source intelligence')
  return i!
}

/** ci_intel_create(...) — can_access_ci; the case readable; auto case link; visible link targets; the other handlers told. */
export function ciIntelCreate(args: Args): Fns['ci_intel_create']['Returns'] {
  const me = activeOrDeny()
  const ci = accessibleCi(args.p_ci)
  const summary = blank(args.p_summary)
  if (!summary) return refuse('invalid', 'intelligence needs a summary')
  const reliability = str(args.p_reliability ?? 'unknown'), corroboration = str(args.p_corroboration ?? 'unverified'), sensitivity = str(args.p_sensitivity ?? 'sensitive')
  if (!inSet(CI_RELIABILITY, reliability) || !inSet(CI_CORROBORATION, corroboration) || !inSet(CI_SENSITIVITY, sensitivity)) return refuse('invalid', 'unknown reliability, corroboration or sensitivity')
  const caseId = blank(args.p_case)
  if (caseId && !canReadCaseAs(me, caseOf(caseId))) return refuse('bad_case', 'that case is not available to you')
  const links = parseLinks(args.p_links)
  if (isRefusal(links)) return links
  if (caseId) ensureCaseLink(ci, caseId, me.id)
  const [i] = seedRows('ci_intelligence', [ciIntelligenceRow({
    ci_id: ci.id, handler_id: me.id, received_at: blank(args.p_received_at) ?? now(), case_id: caseId, summary, body: blank(args.p_body),
    reliability, corroboration, sensitivity, follow_up_required: args.p_follow_up_required === true, handler_notes: blank(args.p_handler_notes),
    created_by: me.id, created_at: now(), updated_at: now(),
  })])
  for (const l of links) seedRows('ci_intelligence_links', [ciIntelligenceLinkRow({ intel_id: i.id, kind: l.kind, target_id: l.target_id, note: l.note, created_at: now() })])
  ciAudit(ci.id, 'CI_INTEL_CREATED', 'ci_intelligence', i.id, { case_id: caseId, links: links.length })
  for (const h of liveHandlers(ci.id)) if (h.user_id !== me.id) actionNotify(h.user_id, 'ci_intel_added', { ci_id: ci.id, intel_id: i.id })
  ciEvent(ci.id, 'intel', me.id)
  return { ok: true, id: i.id }
}

const INTEL_KEYS = new Set(['summary', 'body', 'received_at', 'reliability', 'sensitivity', 'follow_up_required', 'follow_up_done_at', 'handler_notes', 'case_id'])
/** ci_intel_update(p_intel, p_patch) — the author or full. */
export function ciIntelUpdate(args: Args): Fns['ci_intel_update']['Returns'] {
  const me = activeOrDeny()
  const i = ownedIntel(args.p_intel)
  const patch = (args.p_patch ?? {}) as Record<string, unknown>
  const keys = Object.keys(patch).filter((k) => INTEL_KEYS.has(k))
  if (!keys.length) return refuse('invalid', 'nothing to update')
  if ('reliability' in patch && !inSet(CI_RELIABILITY, patch.reliability)) return refuse('invalid', 'unknown reliability')
  if ('sensitivity' in patch && !inSet(CI_SENSITIVITY, patch.sensitivity)) return refuse('invalid', 'unknown sensitivity')
  if ('case_id' in patch && patch.case_id != null) {
    if (!canReadCaseAs(me, caseOf(patch.case_id))) return refuse('bad_case', 'that case is not available to you')
    ensureCaseLink(ciOf(i.ci_id)!, str(patch.case_id), me.id)
  }
  for (const k of keys) (i as unknown as MockRow)[k] = patch[k] ?? null
  i.updated_at = now()
  ciAudit(i.ci_id, 'CI_INTEL_EDITED', 'ci_intelligence', i.id, { keys })
  ciEvent(i.ci_id, 'intel', me.id)
  return { ok: true, id: i.id }
}
/** ci_intel_set_corroboration(p_intel, p_corroboration, p_note) — can_access_ci. */
export function ciIntelSetCorroboration(args: Args): Fns['ci_intel_set_corroboration']['Returns'] {
  const me = activeOrDeny()
  const i = intelOf(args.p_intel)
  if (!i || !canAccessCiAs(i.ci_id)) deny(CI_MESSAGES.noAccess)
  const c = str(args.p_corroboration)
  if (!inSet(CI_CORROBORATION, c)) return refuse('invalid', 'unknown corroboration state')
  const from = i!.corroboration
  Object.assign(i!, { corroboration: c, corroboration_note: blank(args.p_note), updated_at: now() })
  ciAudit(i!.ci_id, 'CI_INTEL_CORROBORATION', 'ci_intelligence', i!.id, { from, to: c })
  ciEvent(i!.ci_id, 'intel', me.id)
  return { ok: true, id: i!.id, corroboration: c }
}
/** ci_intel_links_set(p_intel, p_links) — the author or full; replace-all. */
export function ciIntelLinksSet(args: Args): Fns['ci_intel_links_set']['Returns'] {
  activeOrDeny()
  const i = ownedIntel(args.p_intel)
  const links = parseLinks(args.p_links)
  if (isRefusal(links)) return links
  const list = getRows('ci_intelligence_links')
  for (let k = list.length - 1; k >= 0; k--) if (list[k].intel_id === i.id) list.splice(k, 1)
  for (const l of links) seedRows('ci_intelligence_links', [ciIntelligenceLinkRow({ intel_id: i.id, kind: l.kind, target_id: l.target_id, note: l.note, created_at: now() })])
  ciAudit(i.ci_id, 'CI_INTEL_LINKS_SET', 'ci_intelligence', i.id, { links: links.length })
  return { ok: true, id: i.id, links: links.length }
}
/** ci_intel_delete(p_intel, p_reason) — the author or full; soft. */
export function ciIntelDelete(args: Args): Fns['ci_intel_delete']['Returns'] {
  const me = activeOrDeny()
  const i = ownedIntel(args.p_intel)
  Object.assign(i, { deleted_at: now(), deleted_by: me.id, delete_reason: blank(args.p_reason), updated_at: now() })
  ciAudit(i.ci_id, 'CI_INTEL_ARCHIVED', 'ci_intelligence', i.id, { reason: blank(args.p_reason) })
  ciEvent(i.ci_id, 'intel', me.id)
  return { ok: true, id: i.id }
}

type CaseIntelRow = Fns['ci_case_intel']['Returns'][number]
/** ci_case_intel(p_case, p_limit) — intel on that case the caller can_access_ci AND can_read_case; zero rows otherwise. */
export function ciCaseIntel(args: Args): CaseIntelRow[] {
  const p = profile()
  const caseId = str(args.p_case)
  if (!isActive(p) || !canReadCaseAs(p, caseOf(caseId))) return []
  if (!hasFullCiAccessAs(p) && !ciIsHandlerAs(p)) return []
  const limit = Math.min(Math.max(Number(args.p_limit) || 100, 1), 500)
  return rows('ci_intelligence')
    .filter((i) => i.case_id === caseId && i.deleted_at == null && canAccessCiAs(i.ci_id, p))
    .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))
    .slice(0, limit)
    .map((i) => ({
      id: i.id, ci_id: i.ci_id, ci_number: str(ciOf(i.ci_id)?.ci_number), handler_id: i.handler_id, handler_name: nameOf(i.handler_id),
      received_at: i.received_at, case_id: i.case_id, summary: i.summary, body: i.body, reliability: i.reliability, corroboration: i.corroboration,
      corroboration_note: i.corroboration_note, sensitivity: i.sensitivity, follow_up_required: i.follow_up_required, follow_up_done_at: i.follow_up_done_at,
      handler_notes: i.handler_notes, links: rows('ci_intelligence_links').filter((l) => l.intel_id === i.id) as unknown as Json,
      release_count: rows('ci_releases').filter((r) => r.intel_id === i.id).length, created_at: i.created_at, updated_at: i.updated_at,
    }))
}

/** ci_case_counts(p_cases) → (case_id, n) with n > 0 only; nothing at all for a non-involved caller. */
export function ciCaseCounts(args: Args): Fns['ci_case_counts']['Returns'] {
  const p = profile()
  if (!isActive(p) || (!hasFullCiAccessAs(p) && !ciIsHandlerAs(p))) return []
  const ids = Array.isArray(args.p_cases) ? (args.p_cases as unknown[]).map(str) : []
  const out: Fns['ci_case_counts']['Returns'] = []
  for (const caseId of new Set(ids)) {
    if (!canReadCaseAs(p, caseOf(caseId))) continue
    const intel = rows('ci_intelligence').filter((i) => i.case_id === caseId && i.deleted_at == null && canAccessCiAs(i.ci_id, p)).length
    const linked = rows('ci_case_links').filter((l) => l.case_id === caseId && l.unlinked_at == null && canAccessCiAs(l.ci_id, p)).length
    if (intel + linked > 0) out.push({ case_id: caseId, n: intel + linked })
  }
  return out
}

/** ci_case_link / ci_case_unlink — can_access_ci + can_read_case. */
export function ciCaseLink(args: Args): Fns['ci_case_link']['Returns'] {
  const me = activeOrDeny()
  const ci = accessibleCi(args.p_ci)
  const caseId = str(args.p_case)
  if (!canReadCaseAs(me, caseOf(caseId))) return refuse('bad_case', 'that case is not available to you')
  if (rows('ci_case_links').some((l) => l.ci_id === ci.id && l.case_id === caseId && l.unlinked_at == null)) return refuse('linked', 'the source is already linked to that case')
  const [l] = seedRows('ci_case_links', [ciCaseLinkRow({ ci_id: ci.id, case_id: caseId, linked_by: me.id, linked_at: now(), note: blank(args.p_note) })])
  ciAudit(ci.id, 'CI_CASE_LINKED', 'ci_case_links', l.id, { case_id: caseId })
  ciEvent(ci.id, 'cases', me.id)
  return { ok: true, id: l.id }
}
export function ciCaseUnlink(args: Args): Fns['ci_case_unlink']['Returns'] {
  const me = activeOrDeny()
  const ci = accessibleCi(args.p_ci)
  const caseId = str(args.p_case)
  if (!canReadCaseAs(me, caseOf(caseId))) return refuse('bad_case', 'that case is not available to you')
  const l = rows('ci_case_links').find((x) => x.ci_id === ci.id && x.case_id === caseId && x.unlinked_at == null)
  if (!l) return refuse('not_linked', 'the source is not linked to that case')
  Object.assign(l, { unlinked_at: now(), unlinked_by: me.id, unlink_reason: blank(args.p_reason) })
  ciAudit(ci.id, 'CI_CASE_UNLINKED', 'ci_case_links', l.id, { case_id: caseId })
  ciEvent(ci.id, 'cases', me.id)
  return { ok: true, id: l.id }
}

/* ── §3 sanitize / release ──────────────────────────────────────────────── */

/** ci_release(p_intel, p_title, p_body, p_handling) — full only; the intel must have a case; the text must be sanitized. */
export function ciRelease(args: Args): Fns['ci_release']['Returns'] {
  const me = fullOrDeny(CI_MESSAGES.fullOnly.release)
  const i = intelOf(args.p_intel)
  if (!i || !canAccessCiAs(i.ci_id, me)) deny(CI_MESSAGES.noAccess)
  if (!i!.case_id) return refuse('no_case', 'link the intelligence to a case before releasing it')
  const title = blank(args.p_title), body = blank(args.p_body)
  if (!title || !body) return refuse('invalid', 'a release needs a title and a body')
  const handling = str(args.p_handling ?? 'law_enforcement_sensitive')
  if (!inSet(CI_HANDLING, handling)) return refuse('invalid', 'unknown handling')
  if (!ciSanitized(i!.ci_id, `${title} ${body}`)) return refuse('unsanitized', CI_MESSAGES.unsanitized)
  const [rel] = seedRows('case_intel_releases', [caseIntelReleaseRow({ case_id: i!.case_id, title, body, handling, released_by: me.id, released_at: now() })])
  seedRows('ci_releases', [ciReleaseRow({ intel_id: i!.id, ci_id: i!.ci_id, case_release_id: rel.id, released_by: me.id, released_at: now() })])
  ciAudit(i!.ci_id, 'CI_INTEL_RELEASED', 'ci_intelligence', i!.id, { case_id: i!.case_id, release_id: rel.id, handling })
  const lead = caseOf(i!.case_id)?.lead_detective_id
  if (lead) actionNotify(lead, 'case_intel_released', { case_id: i!.case_id, release_id: rel.id })
  ciEvent(i!.ci_id, 'release', me.id)
  return { ok: true, id: rel.id, case_id: i!.case_id }
}
/** ci_release_revoke(p_release, p_reason) — full only. */
export function ciReleaseRevoke(args: Args): Fns['ci_release_revoke']['Returns'] {
  const me = fullOrDeny(CI_MESSAGES.fullOnly.release)
  const rel = rows('case_intel_releases').find((r) => r.id === str(args.p_release))
  if (!rel) return refuse('not_found', 'release not found')
  if (rel.revoked_at != null) return refuse('revoked', 'that release is already revoked')
  const reason = blank(args.p_reason)
  if (!reason || reason.length < 3) return refuse('reason', 'say why the release is being revoked')
  Object.assign(rel, { revoked_at: now(), revoked_by: me.id, revoke_reason: reason })
  const link = rows('ci_releases').find((r) => r.case_release_id === rel.id)
  ciAudit(link?.ci_id ?? null, 'CI_RELEASE_REVOKED', 'case_intel_releases', rel.id, { case_id: rel.case_id, reason })
  return { ok: true, id: rel.id }
}

/* ── §3 payments ────────────────────────────────────────────────────────── */

export function ciPaymentRecord(args: Args): Fns['ci_payment_record']['Returns'] {
  const me = activeOrDeny()
  const ci = accessibleCi(args.p_ci)
  const amount = Number(args.p_amount)
  if (!Number.isFinite(amount) || amount < 0) return refuse('invalid', 'the amount must be zero or more')
  const reason = blank(args.p_reason)
  if (!reason) return refuse('reason', 'say what the payment was for')
  const paidAt = blank(args.p_paid_at)
  if (!paidAt) return refuse('invalid', 'when was it paid?')
  if (args.p_case && !canReadCaseAs(me, caseOf(args.p_case))) return refuse('bad_case', 'that case is not available to you')
  const full = hasFullCiAccessAs(me)
  const [p] = seedRows('ci_payments', [ciPaymentRow({
    ci_id: ci.id, handler_id: me.id, amount, paid_at: paidAt, reason, intel_id: blank(args.p_intel), case_id: blank(args.p_case), notes: blank(args.p_notes),
    approved_by: full ? me.id : null, approved_at: full ? now() : null, created_by: me.id, created_at: now(),
  })])
  ciAudit(ci.id, 'CI_PAYMENT_RECORDED', 'ci_payments', p.id, { amount })
  ciEvent(ci.id, 'payment', me.id)
  return { ok: true, id: p.id, approved: full }
}
export function ciPaymentApprove(args: Args): Fns['ci_payment_approve']['Returns'] {
  const me = fullOrDeny('only CI command can approve a payment')
  const p = rows('ci_payments').find((x) => x.id === str(args.p_payment) && x.deleted_at == null) as Payment | undefined
  if (!p || !canAccessCiAs(p.ci_id, me)) deny(CI_MESSAGES.noAccess)
  if (p!.approved_at != null) return refuse('approved', 'that payment is already approved')
  Object.assign(p!, { approved_by: me.id, approved_at: now() })
  ciAudit(p!.ci_id, 'CI_PAYMENT_APPROVED', 'ci_payments', p!.id, null)
  return { ok: true, id: p!.id }
}

/* ── §3 export / search / person / audit ────────────────────────────────── */

/** ci_export(p_ci, p_scope) — can_access_ci(p_ci); p_ci null → the roster, full only; null otherwise. Audits CI_EXPORTED. */
export function ciExport(args: Args): Fns['ci_export']['Returns'] {
  const p = profile()
  if (!isActive(p)) return null
  const scope = str(args.p_scope ?? 'profile')
  if (args.p_ci == null) {
    if (!hasFullCiAccessAs(p)) return null
    const roster = ciList({ p_limit: 1000 })
    ciAudit(null, 'CI_EXPORTED', 'confidential_informants', null, { scope: 'roster', rows: roster.length })
    return { scope: 'roster', exported_at: now(), rows: roster as unknown as Json }
  }
  const ci = ciOf(args.p_ci)
  if (!ci || !canAccessCiAs(ci.id, p)) return null
  const profileJson = ciGet({ p_ci: ci.id })
  const intel = rows('ci_intelligence').filter((i) => i.ci_id === ci.id && i.deleted_at == null)
  const contacts = rows('ci_contacts').filter((c) => c.ci_id === ci.id && c.deleted_at == null)
  const payments = rows('ci_payments').filter((c) => c.ci_id === ci.id && c.deleted_at == null)
  ciAudit(ci.id, 'CI_EXPORTED', 'confidential_informants', ci.id, { scope, rows: { intel: intel.length, contacts: contacts.length, payments: payments.length } })
  return {
    scope, exported_at: now(), profile: profileJson,
    intelligence: intel as unknown as Json, contacts: contacts as unknown as Json, payments: payments as unknown as Json,
  }
}

/** ci_search(p_q, p_limit) — the caller's accessible CIs by number / alias / person name. */
export function ciSearch(args: Args): Fns['ci_search']['Returns'] {
  const q = str(args.p_q).trim().toLowerCase()
  if (!q) return []
  const limit = Math.min(Math.max(Number(args.p_limit) || 10, 1), 50)
  return accessibleCis().map(listRow)
    .filter((r) => [r.ci_number, r.alias, r.person_name].some((v) => str(v).toLowerCase().includes(q)))
    .slice(0, limit)
    .map((r) => ({ id: r.id, ci_number: r.ci_number, alias: r.alias, person_name: r.person_name, status: r.status }))
}

/** ci_person_status(p_person) → {ci_id, ci_number, status} when the caller can access that person's live CI; null otherwise
 *  (indistinguishable from "not a CI"). */
export function ciPersonStatus(args: Args): Fns['ci_person_status']['Returns'] {
  const p = profile()
  const ci = rows('confidential_informants').find((c) => c.person_id === str(args.p_person) && c.deleted_at == null)
  if (!ci || !canAccessCiAs(ci.id, p)) return null
  return { ci_id: ci.id, ci_number: ci.ci_number, status: ci.status }
}

/** ci_audit_list(p_ci, p_limit) — SECURITY INVOKER over ci_audit_events' own policy. */
export function ciAuditList(args: Args): Fns['ci_audit_list']['Returns'] {
  const limit = Math.min(Math.max(Number(args.p_limit) || 100, 1), 500)
  const visible = visibleCiRows('ci_audit_events', getRows('ci_audit_events')) as unknown as Tables<'ci_audit_events'>[]
  return visible
    .filter((a) => args.p_ci == null || a.ci_id === str(args.p_ci))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
    .map((a) => ({ ...a, actor_name: nameOf(a.actor_id), detail: a.detail ?? {} }))
}

/* ── The sweep ──────────────────────────────────────────────────────────── */

/** private.ci_sweep(p_only_ci): overdue `next_contact_at` → the active handlers (once per CI per 24 h);
 *  an active CI silent for 30 days → handlers + the supervising lead (detail 'silent_30d'); `ci_event('overdue')`. */
export function ciSweep(onlyCi: string | null = null): { overdue: number; silent: number } {
  const t = Date.now()
  let overdue = 0, silent = 0
  const recentlyTold = (ciId: string) => rows('notifications').some((n) =>
    n.type === 'ci_contact_overdue' && Date.parse(n.created_at) >= t - DAY && (n.payload as Record<string, unknown> | null)?.ci_id === ciId)
  for (const ci of rows('confidential_informants')) {
    if (ci.deleted_at != null || ci.status !== 'active' || (onlyCi != null && ci.id !== onlyCi)) continue
    const creator = profileOf(ci.created_by) ?? profile()
    const isOverdue = ci.next_contact_at != null && Date.parse(ci.next_contact_at) < t
    const last = ci.last_contact_at ?? ci.created_at
    const isSilent = Date.parse(last) < t - 30 * DAY
    if (!isOverdue && !isSilent) continue
    if (recentlyTold(ci.id)) continue
    const recipients = new Set(liveHandlers(ci.id).map((h) => h.user_id))
    if (isSilent && ci.supervising_lead_id) recipients.add(ci.supervising_lead_id)
    const payload: Record<string, Json> = isSilent ? { ci_id: ci.id, detail: 'silent_30d' } : { ci_id: ci.id }
    for (const r of recipients) actionNotify(r, 'ci_contact_overdue', payload, creator)
    if (isOverdue) overdue++
    if (isSilent) silent++
    ciEvent(ci.id, 'overdue')
  }
  return { overdue, silent }
}
/** ci_sweep_run() — Owner only, the jsonb denial style. */
export function ciSweepRun(): Fns['ci_sweep_run']['Returns'] {
  if (!isOwner()) return { ok: false, code: 'denied', message: CI_MESSAGES.sweepDenied }
  const started = now()
  const counts = ciSweep()
  seedRows('scheduled_job_runs', [{ id: getRows('scheduled_job_runs').length + 1, job: 'ci_contact_sweep', started_at: started, finished_at: now(), status: 'ok', detail: counts }])
  return { ok: true, ...counts }
}
/** rls_test_ci_sweep(p_ci) — a fixture caller, a fixture-owned CI, the sweep over that ONE CI. */
export function rlsTestCiSweep(args: Args): Fns['rls_test_ci_sweep']['Returns'] {
  const me = profile()
  if (!me || !RLS_TEST_EMAIL.test(me.email ?? '')) throw new CiRpcError('rls_test_ci_sweep: caller is not a test fixture')
  const ci = ciOf(args.p_ci)
  const creator = ci ? profileOf(ci.created_by) : undefined
  if (!ci || !creator || !RLS_TEST_EMAIL.test(creator.email ?? '')) throw new CiRpcError('rls_test_ci_sweep: CI is not fixture-owned')
  return { ok: true, ...ciSweep(ci.id) }
}

/* ── Registry ───────────────────────────────────────────────────────────── */

/** fn → handler: every RPC of §3. */
export const CI_RPCS: Record<string, (args: Args) => unknown> = {
  ci_context: () => ciContext(),
  ci_list: ciList,
  ci_get: ciGet,
  ci_stats: () => ciStats(),
  ci_create: ciCreate,
  ci_update: ciUpdate,
  ci_set_status: ciSetStatus,
  ci_handler_set: ciHandlerSet,
  ci_handler_remove: ciHandlerRemove,
  ci_capacity_request_submit: ciCapacityRequestSubmit,
  ci_capacity_request_decide: ciCapacityRequestDecide,
  ci_capacity_request_withdraw: ciCapacityRequestWithdraw,
  ci_capacity_set: ciCapacitySet,
  ci_contact_log: ciContactLog,
  ci_contact_update: ciContactUpdate,
  ci_contact_delete: ciContactDelete,
  ci_assess: ciAssess,
  ci_intel_create: ciIntelCreate,
  ci_intel_update: ciIntelUpdate,
  ci_intel_set_corroboration: ciIntelSetCorroboration,
  ci_intel_links_set: ciIntelLinksSet,
  ci_intel_delete: ciIntelDelete,
  ci_case_intel: ciCaseIntel,
  ci_case_counts: ciCaseCounts,
  ci_case_link: ciCaseLink,
  ci_case_unlink: ciCaseUnlink,
  ci_release: ciRelease,
  ci_release_revoke: ciReleaseRevoke,
  ci_payment_record: ciPaymentRecord,
  ci_payment_approve: ciPaymentApprove,
  ci_export: ciExport,
  ci_search: ciSearch,
  ci_person_status: ciPersonStatus,
  ci_audit_list: ciAuditList,
  ci_sweep_run: () => ciSweepRun(),
  rls_test_ci_sweep: rlsTestCiSweep,
}

const pgError = (status: number, code: string, message: string) =>
  HttpResponse.json({ code, details: null, hint: null, message }, { status })

/** The CI routes: one explicit rpc route per function (registered BEFORE the
 *  generic rpc catch-all in handlers/index.ts, honouring the same scenario
 *  switches) and the grant denial on every write to the fourteen RPC-only
 *  tables. Reads fall through to postgrest.ts (visibleCiRows). */
export const ciHandlers = [
  ...Object.entries(CI_RPCS).map(([fn, impl]) =>
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
        if (e instanceof CiRpcError) return pgError(400, e.code, e.message)
        throw e
      }
    })),
  ...CI_RPC_ONLY_TABLES.flatMap((table) => {
    const refuseWrite = () => pgError(403, '42501', `permission denied for table ${table}`)
    const url = `${supabaseBaseUrl()}/rest/v1/${table}`
    return [http.post(url, refuseWrite), http.patch(url, refuseWrite), http.delete(url, refuseWrite)]
  }),
]


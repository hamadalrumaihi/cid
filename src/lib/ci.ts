'use client'

/** Confidential Informant compartment — the ONE CI client module (§6.2).
 *
 *  Access rule everywhere: canAccessCI = hasFullCIAccess(user) ||
 *  isAssignedHandler(user, ci). The server (RLS on every `ci_*` table, definer
 *  RPCs) is the authority; this module is thin typed plumbing plus the shared
 *  context store the nav, the queue, the palette and the dossier read.
 *
 *  Compartment discipline this module enforces on the client side:
 *   - `useCiContext()` is ONE `ci_context()` per session (module-level store,
 *     the useSiu pattern), refetched when `ci_events` moves or the user
 *     changes; ANY error collapses to NO_CI so an unauthorized caller never
 *     sees an error state that would confirm the compartment exists.
 *   - Reads return null / [] on refusal — never throw, never toast.
 *   - Writes return a `CiResult`; the caller toasts the SERVER's message
 *     (`ciRefused`). P0403 is acknowledged by db.ts's rpc() wrapper.
 *   - Nothing here touches recents / pins — CI visits leave no trail. */

import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import { useAuth } from './auth'
import type { Database, Json, Tables } from './database.types'
import { list, rpc } from './db'
import { useTableVersion } from './realtime'
import { toast } from './toast'
import { parseCiResult, type CiFailure, type CiResult } from './ciModel'

export * from './ciModel'

type Bureau = Database['public']['Enums']['bureau']

/* ── Context store ────────────────────────────────────────────────────────── */

export interface CiContext {
  full_access: boolean
  is_handler: boolean
  active_count?: number
  capacity?: number
  pending_requests?: number
  contacts_due?: number
  followups_due?: number
}

/** The answer for everyone outside the compartment — and for every error. */
export const NO_CI: CiContext = { full_access: false, is_handler: false }

export const ciInvolved = (c: CiContext | null | undefined): boolean =>
  !!c && (c.full_access || c.is_handler)

interface CiStore {
  ctx: CiContext
  ready: boolean
  /** The user the current `ctx` was resolved for (null = nobody / reset). */
  uid: string | null
}

const useCiStore = create<CiStore>(() => ({ ctx: NO_CI, ready: false, uid: null }))

// The last (uid, ci_events version, manual refresh tick) the store was loaded
// for — every mounted consumer shares ONE request per key.
let loadedKey: string | null = null
let inflight: Promise<void> | null = null
let refreshTick = 0

function shapeContext(data: unknown): CiContext {
  if (!data || typeof data !== 'object') return NO_CI
  const d = data as Record<string, unknown>
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const ctx: CiContext = { full_access: d.full_access === true, is_handler: d.is_handler === true }
  if (!ciInvolved(ctx)) return NO_CI
  const ac = num(d.active_count), cap = num(d.capacity), pr = num(d.pending_requests), cd = num(d.contacts_due), fd = num(d.followups_due)
  if (ac !== undefined) ctx.active_count = ac
  if (cap !== undefined) ctx.capacity = cap
  if (pr !== undefined) ctx.pending_requests = pr
  if (cd !== undefined) ctx.contacts_due = cd
  if (fd !== undefined) ctx.followups_due = fd
  return ctx
}

function loadContext(uid: string, key: string): Promise<void> {
  if (loadedKey === key && inflight) return inflight
  loadedKey = key
  inflight = (async () => {
    let ctx = NO_CI
    try {
      const res = await rpc('ci_context', {})
      ctx = res.error ? NO_CI : shapeContext(res.data)
    } catch {
      ctx = NO_CI
    }
    // A sign-out / user switch that raced this request must not repopulate.
    if (loadedKey === key) useCiStore.setState({ ctx, ready: true, uid })
  })()
  return inflight
}

function resetContext(): void {
  loadedKey = null
  inflight = null
  useCiStore.setState({ ctx: NO_CI, ready: false, uid: null })
}

/** Non-hook getter for imperative code (the action queue's fetch gate). Reads
 *  whatever the store holds — NO_CI until the first consumer resolved it. */
export function getCiContext(): CiContext {
  return useCiStore.getState().ctx
}

/** Force a refetch (after a mutation that changes counts, e.g. ci_create). */
export function refreshCiContext(): void {
  refreshTick++
  const uid = useCiStore.getState().uid
  if (uid) void loadContext(uid, `${uid}:${refreshTick}:manual`)
}

export function useCiContext(): { ctx: CiContext; ready: boolean; refresh: () => void } {
  const { state, profile } = useAuth()
  const uid = state === 'in' ? profile?.id ?? null : null
  const version = useTableVersion('ci_events')
  const ctx = useCiStore((s) => s.ctx)
  const ready = useCiStore((s) => s.ready && s.uid === uid)

  useEffect(() => {
    // Deferred so the effect body never sets store state synchronously
    // (the ShiftsView / useSiu idiom).
    const t = window.setTimeout(() => {
      if (!uid) { if (useCiStore.getState().uid !== null || loadedKey !== null) resetContext(); return }
      void loadContext(uid, `${uid}:${refreshTick}:${version}`)
    }, 0)
    return () => window.clearTimeout(t)
  }, [uid, version])

  const refresh = useCallback(() => { refreshCiContext() }, [])
  return { ctx: uid ? ctx : NO_CI, ready: uid ? ready : true, refresh }
}

/* ── Hrefs ────────────────────────────────────────────────────────────────── */

export type CiSection = 'overview' | 'handlers' | 'contacts' | 'intelligence' | 'assessments' | 'payments' | 'cases' | 'audit'
export const CI_SECTIONS: readonly CiSection[] = ['overview', 'handlers', 'contacts', 'intelligence', 'assessments', 'payments', 'cases', 'audit']

export const ciHref = (id: string, section?: string): string =>
  `/informants?ci=${encodeURIComponent(id)}${section ? `&s=${encodeURIComponent(section)}` : ''}`

/* ── Row types ────────────────────────────────────────────────────────────── */

type Fns = Database['public']['Functions']
export type CiListRow = Fns['ci_list']['Returns'][number]
export type CiSearchRow = Fns['ci_search']['Returns'][number]
export type CiCaseIntelRow = Fns['ci_case_intel']['Returns'][number]
export type CiAuditRow = Fns['ci_audit_list']['Returns'][number]
export type CiRequestRow = Tables<'ci_capacity_requests'>
export type CiContactRow = Tables<'ci_contacts'>
export type CiIntelRow = Tables<'ci_intelligence'>
export type CiIntelLinkRow = Tables<'ci_intelligence_links'>
export type CiAssessmentRow = Tables<'ci_assessments'>
export type CiPaymentRow = Tables<'ci_payments'>

export interface CiHandler {
  id?: string
  user_id: string
  name: string | null
  role: 'primary' | 'secondary' | string
  counts_toward_capacity?: boolean
  assigned_at?: string | null
  assigned_by?: string | null
  assigned_by_name?: string | null
  reason?: string | null
  ended_at?: string | null
  ended_by?: string | null
  end_reason?: string | null
}

export interface CiCaseLink {
  case_id: string
  case_number: string | null
  title?: string | null
  linked_at?: string | null
  note?: string | null
}

export interface CiCounts { intel: number; contacts: number; payments: number; releases: number }

/** `ci_get` — the row plus its aggregates. Optional members are the ones the
 *  server only sends to full access (handler_history) or when they exist. */
export interface CiDetail extends Tables<'confidential_informants'> {
  person_name: string | null
  handlers: CiHandler[]
  handler_history?: CiHandler[]
  latest_assessment: CiAssessmentRow | null
  cases: CiCaseLink[]
  counts: CiCounts
  supervising_lead_name?: string | null
  recruited_by_name?: string | null
}

export interface CiStatsHandler {
  user_id: string
  name: string | null
  active_count: number
  capacity: number
  ci_ids: string[]
}

/** `ci_stats` — full access only (null for everyone else). */
export interface CiStats {
  active: number
  dormant: number
  high_risk: number
  compromised: number
  contacts_overdue: number
  handlers_at_capacity: number
  pending_requests: number
  handlers: CiStatsHandler[]
}

export interface CiListFilters {
  status?: string[]
  handler?: string
  bureau?: string
  motive?: string
  reliability?: string
  risk?: string
  case_id?: string
  q?: string
  contact?: 'overdue' | 'due_7d'
  followups?: boolean
  include_deleted?: boolean
}

export interface CiPersonStatus { ci_id: string; ci_number: string; status: string }

/* ── Reads (null / [] on refusal — never throw) ───────────────────────────── */

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** Strip empty filter values so the server sees only real constraints. */
function cleanFilters(f: CiListFilters): Json {
  const out: Record<string, Json> = {}
  if (f.status?.length) out.status = f.status
  if (f.handler) out.handler = f.handler
  if (f.bureau) out.bureau = f.bureau
  if (f.motive) out.motive = f.motive
  if (f.reliability) out.reliability = f.reliability
  if (f.risk) out.risk = f.risk
  if (f.case_id) out.case_id = f.case_id
  if (f.q?.trim()) out.q = f.q.trim()
  if (f.contact) out.contact = f.contact
  if (f.followups) out.followups = true
  if (f.include_deleted) out.include_deleted = true
  return out
}

export async function fetchCiList(filters: CiListFilters = {}, limit = 200): Promise<CiListRow[]> {
  const res = await rpc('ci_list', { p_filters: cleanFilters(filters), p_limit: limit })
  return res.error ? [] : (res.data ?? [])
}

export async function fetchCi(id: string): Promise<CiDetail | null> {
  const res = await rpc('ci_get', { p_ci: id })
  if (res.error || !res.data || typeof res.data !== 'object' || Array.isArray(res.data)) return null
  const d = res.data as Record<string, unknown>
  if (typeof d.id !== 'string') return null
  const counts = (d.counts && typeof d.counts === 'object' ? d.counts : {}) as Record<string, unknown>
  return {
    ...(d as unknown as Tables<'confidential_informants'>),
    person_name: typeof d.person_name === 'string' ? d.person_name : null,
    handlers: arr<CiHandler>(d.handlers),
    handler_history: Array.isArray(d.handler_history) ? (d.handler_history as CiHandler[]) : undefined,
    latest_assessment: (d.latest_assessment && typeof d.latest_assessment === 'object' ? d.latest_assessment : null) as CiAssessmentRow | null,
    cases: arr<CiCaseLink>(d.cases),
    counts: { intel: num(counts.intel), contacts: num(counts.contacts), payments: num(counts.payments), releases: num(counts.releases) },
    supervising_lead_name: typeof d.supervising_lead_name === 'string' ? d.supervising_lead_name : null,
    recruited_by_name: typeof d.recruited_by_name === 'string' ? d.recruited_by_name : null,
  }
}

export async function fetchCiStats(): Promise<CiStats | null> {
  const res = await rpc('ci_stats', {})
  if (res.error || !res.data || typeof res.data !== 'object' || Array.isArray(res.data)) return null
  const d = res.data as Record<string, unknown>
  return {
    active: num(d.active), dormant: num(d.dormant), high_risk: num(d.high_risk), compromised: num(d.compromised),
    contacts_overdue: num(d.contacts_overdue), handlers_at_capacity: num(d.handlers_at_capacity),
    pending_requests: num(d.pending_requests),
    handlers: arr<Record<string, unknown>>(d.handlers).map((h) => ({
      user_id: String(h.user_id ?? ''),
      name: typeof h.name === 'string' ? h.name : null,
      active_count: num(h.active_count),
      capacity: num(h.capacity, 6),
      ci_ids: arr<string>(h.ci_ids),
    })),
  }
}

export async function fetchCiCaseIntel(caseId: string, limit = 100): Promise<CiCaseIntelRow[]> {
  const res = await rpc('ci_case_intel', { p_case: caseId, p_limit: limit })
  return res.error ? [] : (res.data ?? [])
}

export async function fetchCiCaseCounts(caseIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!caseIds.length) return out
  const res = await rpc('ci_case_counts', { p_cases: caseIds })
  if (res.error) return out
  for (const r of res.data ?? []) out.set(r.case_id, r.n)
  return out
}

export async function ciSearch(q: string, limit = 10): Promise<CiSearchRow[]> {
  const term = q.trim()
  if (!term) return []
  const res = await rpc('ci_search', { p_q: term, p_limit: limit })
  return res.error ? [] : (res.data ?? [])
}

/** Null is indistinguishable from "not a CI" — by design (§3). */
export async function fetchCiPersonStatus(personId: string): Promise<CiPersonStatus | null> {
  const res = await rpc('ci_person_status', { p_person: personId })
  if (res.error || !res.data || typeof res.data !== 'object' || Array.isArray(res.data)) return null
  const d = res.data as Record<string, unknown>
  if (typeof d.ci_id !== 'string' || typeof d.ci_number !== 'string') return null
  return { ci_id: d.ci_id, ci_number: d.ci_number, status: typeof d.status === 'string' ? d.status : 'unknown' }
}

export async function fetchCiAudit(ciId?: string | null, limit = 100): Promise<CiAuditRow[]> {
  const res = await rpc('ci_audit_list', { p_ci: ciId ?? null, p_limit: limit })
  return res.error ? [] : (res.data ?? [])
}

/* RLS-scoped child lists for the profile sections. The CI tables are not in
 * db.ts's SOFT_DELETE_KIND (their deletes are RPC'd), so live-row filtering is
 * explicit here. A refused read is an empty list, never an error. */
const safeList = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => { try { return await fn() } catch { return [] } }

export const fetchCiContacts = (ciId: string): Promise<CiContactRow[]> =>
  safeList(() => list('ci_contacts', { eq: { ci_id: ciId }, is: { deleted_at: null }, order: 'occurred_at', ascending: false, limit: 200 }))
export const fetchCiIntel = (ciId: string): Promise<CiIntelRow[]> =>
  safeList(() => list('ci_intelligence', { eq: { ci_id: ciId }, is: { deleted_at: null }, order: 'received_at', ascending: false, limit: 200 }))
export const fetchCiIntelLinks = (intelIds: string[]): Promise<CiIntelLinkRow[]> =>
  intelIds.length ? safeList(() => list('ci_intelligence_links', { in: { intel_id: intelIds } })) : Promise.resolve([])
export const fetchCiAssessments = (ciId: string): Promise<CiAssessmentRow[]> =>
  safeList(() => list('ci_assessments', { eq: { ci_id: ciId }, order: 'assessed_at', ascending: false, limit: 100 }))
export const fetchCiPayments = (ciId: string): Promise<CiPaymentRow[]> =>
  safeList(() => list('ci_payments', { eq: { ci_id: ciId }, is: { deleted_at: null }, order: 'paid_at', ascending: false, limit: 200 }))
export const fetchCiRequests = (): Promise<CiRequestRow[]> =>
  safeList(() => list('ci_capacity_requests', { order: 'created_at', ascending: false, limit: 200 }))

/* ── Writes (CiResult; the caller toasts the server's message) ────────────── */

type Fn = keyof Fns
async function call<T extends object = Record<string, never>, F extends Fn = Fn>(fn: F, args: Fns[F]['Args']): Promise<CiResult<T>> {
  const res = await rpc(fn, args)
  return parseCiResult<T>(res.data, res.error)
}

/** Toast a refusal with the server's own words. Returns true when refused so
 *  callers can `if (ciRefused(r)) return`. */
export function ciRefused<T extends object>(r: CiResult<T>): r is CiFailure {
  if (!r.ok) toast(r.message || 'The request was refused.', 'danger')
  return !r.ok
}

export interface CiCreateInput {
  person: string
  alias?: string | null
  bureau: Bureau
  primaryHandler: string
  secondaryHandler?: string | null
  status?: string
  motivePrimary?: string | null
  motiveSecondary?: string[]
  motiveExplanation?: string | null
  recruitmentNotes?: string | null
  reliability?: string
  risk?: string
  recruitedAt?: string | null
  overrideReason?: string | null
}

export const ciCreate = (i: CiCreateInput) => call<{ id: string; ci_number: string }>('ci_create', {
  p_person: i.person, p_alias: i.alias ?? null, p_bureau: i.bureau, p_primary_handler: i.primaryHandler,
  p_secondary_handler: i.secondaryHandler ?? null, p_status: i.status ?? 'candidate',
  p_motive_primary: i.motivePrimary ?? null, p_motive_secondary: i.motiveSecondary ?? [],
  p_motive_explanation: i.motiveExplanation ?? null, p_recruitment_notes: i.recruitmentNotes ?? null,
  p_reliability: i.reliability ?? 'unknown', p_risk: i.risk ?? 'medium', p_recruited_at: i.recruitedAt ?? null,
  p_override_reason: i.overrideReason ?? null,
})

export const ciUpdate = (ci: string, patch: Record<string, Json>) => call('ci_update', { p_ci: ci, p_patch: patch })
export const ciSetStatus = (ci: string, status: string, reason: string) => call('ci_set_status', { p_ci: ci, p_status: status, p_reason: reason })
export const ciHandlerSet = (ci: string, user: string, role: 'primary' | 'secondary', reason: string, overrideReason?: string | null, counts = true) =>
  call('ci_handler_set', { p_ci: ci, p_user: user, p_role: role, p_reason: reason, p_override_reason: overrideReason ?? null, p_counts: counts })
export const ciHandlerRemove = (ci: string, user: string, reason: string) => call('ci_handler_remove', { p_ci: ci, p_user: user, p_reason: reason })

export interface CiRequestInput {
  kind: 'capacity' | 'assignment'
  reason: string
  requestedCapacity?: number | null
  operationalNeed?: string | null
  caseId?: string | null
  proposedPerson?: string | null
  proposedMotive?: string | null
  estimatedRisk?: string | null
  expectedUsefulness?: string | null
  bureau?: Bureau | null
  comments?: string | null
}
export const ciRequestSubmit = (i: CiRequestInput) => call<{ id: string }>('ci_capacity_request_submit', {
  p_kind: i.kind, p_reason: i.reason, p_requested_capacity: i.requestedCapacity ?? null,
  p_operational_need: i.operationalNeed ?? null, p_case: i.caseId ?? null, p_proposed_person: i.proposedPerson ?? null,
  p_proposed_motive: i.proposedMotive ?? null, p_estimated_risk: i.estimatedRisk ?? null,
  p_expected_usefulness: i.expectedUsefulness ?? null, p_bureau: i.bureau ?? null, p_comments: i.comments ?? null,
})
export const ciRequestDecide = (request: string, decision: 'approved' | 'denied' | 'returned', note?: string | null, newCapacity?: number | null, expiresAt?: string | null) =>
  call<{ created_ci_id?: string | null }>('ci_capacity_request_decide', {
    p_request: request, p_decision: decision, p_note: note ?? null, p_new_capacity: newCapacity ?? null, p_expires_at: expiresAt ?? null,
  })
export const ciRequestWithdraw = (request: string) => call('ci_capacity_request_withdraw', { p_request: request })
export const ciCapacitySet = (user: string, limit: number | null, reason: string, expiresAt?: string | null) =>
  call('ci_capacity_set', { p_user: user, p_limit: limit, p_reason: reason, p_expires_at: expiresAt ?? null })

export interface CiContactInput {
  occurredAt: string
  method: string
  summary: string
  location?: string | null
  followUpRequired?: boolean
  nextContactAt?: string | null
  caseId?: string | null
  restrictedNotes?: string | null
}
export const ciContactLog = (ci: string, i: CiContactInput) => call<{ id: string }>('ci_contact_log', {
  p_ci: ci, p_occurred_at: i.occurredAt, p_method: i.method, p_summary: i.summary, p_location: i.location ?? null,
  p_follow_up_required: i.followUpRequired ?? false, p_next_contact_at: i.nextContactAt ?? null,
  p_case: i.caseId ?? null, p_restricted_notes: i.restrictedNotes ?? null,
})
export const ciContactDelete = (contact: string, reason?: string | null) => call('ci_contact_delete', { p_contact: contact, p_reason: reason ?? null })

export interface CiAssessInput {
  reliability?: string | null
  credibility?: string | null
  access?: string | null
  risk?: string | null
  compromiseLikelihood?: string | null
  usefulness?: string | null
  note?: string | null
}
export const ciAssess = (ci: string, i: CiAssessInput) => call<{ id: string }>('ci_assess', {
  p_ci: ci, p_reliability: i.reliability ?? null, p_credibility: i.credibility ?? null, p_access: i.access ?? null,
  p_risk: i.risk ?? null, p_compromise_likelihood: i.compromiseLikelihood ?? null, p_usefulness: i.usefulness ?? null, p_note: i.note ?? null,
})

export interface CiIntelLinkInput { kind: string; target_id: string; note?: string | null }
export interface CiIntelInput {
  summary: string
  body?: string | null
  caseId?: string | null
  receivedAt?: string | null
  reliability?: string
  corroboration?: string
  sensitivity?: string
  followUpRequired?: boolean
  handlerNotes?: string | null
  links?: CiIntelLinkInput[]
}
const linksJson = (links: CiIntelLinkInput[] | undefined): Json =>
  (links ?? []).map((l) => ({ kind: l.kind, target_id: l.target_id, note: l.note ?? null }))

export const ciIntelCreate = (ci: string, i: CiIntelInput) => call<{ id: string }>('ci_intel_create', {
  p_ci: ci, p_summary: i.summary, p_body: i.body ?? null, p_case: i.caseId ?? null, p_received_at: i.receivedAt ?? null,
  p_reliability: i.reliability ?? 'unknown', p_corroboration: i.corroboration ?? 'unverified',
  p_sensitivity: i.sensitivity ?? 'sensitive', p_follow_up_required: i.followUpRequired ?? false,
  p_handler_notes: i.handlerNotes ?? null, p_links: linksJson(i.links),
})
export const ciIntelUpdate = (intel: string, patch: Record<string, Json>) => call('ci_intel_update', { p_intel: intel, p_patch: patch })
export const ciIntelSetCorroboration = (intel: string, corroboration: string, note?: string | null) =>
  call('ci_intel_set_corroboration', { p_intel: intel, p_corroboration: corroboration, p_note: note ?? null })
export const ciIntelLinksSet = (intel: string, links: CiIntelLinkInput[]) => call('ci_intel_links_set', { p_intel: intel, p_links: linksJson(links) })
export const ciIntelDelete = (intel: string, reason?: string | null) => call('ci_intel_delete', { p_intel: intel, p_reason: reason ?? null })

export const ciCaseLink = (ci: string, caseId: string, note?: string | null) => call('ci_case_link', { p_ci: ci, p_case: caseId, p_note: note ?? null })
export const ciCaseUnlink = (ci: string, caseId: string, reason?: string | null) => call('ci_case_unlink', { p_ci: ci, p_case: caseId, p_reason: reason ?? null })

export const ciRelease = (intel: string, title: string, body: string, handling = 'law_enforcement_sensitive') =>
  call<{ release_id: string }>('ci_release', { p_intel: intel, p_title: title, p_body: body, p_handling: handling })
export const ciReleaseRevoke = (release: string, reason: string) => call('ci_release_revoke', { p_release: release, p_reason: reason })

export interface CiPaymentInput {
  amount: number
  paidAt: string
  reason: string
  intelId?: string | null
  caseId?: string | null
  notes?: string | null
}
export const ciPaymentRecord = (ci: string, i: CiPaymentInput) => call<{ id: string }>('ci_payment_record', {
  p_ci: ci, p_amount: i.amount, p_paid_at: i.paidAt, p_reason: i.reason, p_intel: i.intelId ?? null,
  p_case: i.caseId ?? null, p_notes: i.notes ?? null,
})
export const ciPaymentApprove = (payment: string) => call('ci_payment_approve', { p_payment: payment })

/** `ci_export` — the server audits CI_EXPORTED; the answer is the document
 *  body (profile or, with no id, the full-access roster). */
export async function ciExport(ci: string | null, scope: 'profile' | 'roster' = ci ? 'profile' : 'roster'): Promise<CiResult<{ doc: Record<string, Json> }>> {
  const r = await call<Record<string, Json>>('ci_export', { p_ci: ci, p_scope: scope })
  if (!r.ok) return r
  const doc: Record<string, Json> = {}
  for (const [k, v] of Object.entries(r)) if (k !== 'ok') doc[k] = v as Json
  return { ok: true, doc }
}

/** Soft-delete a CI through the standard `soft_delete` RPC (kind 'ci' is
 *  registered server-side; full access only). db.ts's SOFT_DELETE_KIND does
 *  not carry the CI tables, so the kind is spelled here. */
export const ciSoftDelete = (ci: string, reason: string) => call('soft_delete', { p_kind: 'ci', p_id: ci, p_reason: reason })

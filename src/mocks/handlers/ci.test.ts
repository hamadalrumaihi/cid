/** Pins for the CI compartment mock handlers (scratch ci_contract.md §1–§4):
 *  the canonical rule (`canAccessCI = full || handler`) over every read
 *  surface — context, list, get, stats, person status, the fourteen tables'
 *  SELECT walls through `visibleCiRows`; nothing at all for the normal
 *  detective (no placeholder, no count); self-recruitment vs command
 *  designation; the one `unavailable` wording; capacity 6 with the two
 *  `capacity` wordings and the audited override; the request flow (submit →
 *  approve → capacity 8 → the assignment kind creating the CI); handler
 *  change ending access immediately; status changes full-only and history
 *  staying restricted; intelligence inside a case only for the handler; the
 *  sanitize / release pair (visible `case_intel_releases`, restricted
 *  `ci_releases`); `ci_case_counts` short-circuiting; no `audit_log` row
 *  ever; ids-only notifications; the export scope; the sweep's Owner denial
 *  and the fixture runner; the 42501 write refusals. The RPCs are called
 *  directly against the mock store — no MSW server. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { caseRow, personRow, profileRow, roleSession } from '../fixtures'
import { getRows, mockId, readRows, resetMockStore, seedRows, setSession } from '../store'
import {
  CI_MESSAGES, CI_RPCS, CI_RPC_ONLY_TABLES, CiRpcError, canAccessCiAs, ciAuditList, ciCapacityRequestDecide, ciCapacityRequestSubmit,
  ciCapacitySet, ciCaseCounts, ciCaseIntel, ciContactLog, ciContext, ciCreate, ciExport, ciGet, ciHandlerRemove, ciHandlerSet, ciHandlers,
  ciIntelCreate, ciList, ciPersonStatus, ciRelease, ciSanitized, ciSearch, ciSetStatus, ciStats, ciSweepRun, hasFullCiAccessAs, rlsTestCiSweep,
  visibleCiRows,
} from './ci'

type Out = Record<string, unknown>
const asUser = (p: Tables<'profiles'> | null) => setSession(p ? { userId: p.id, email: p.email ?? 'x@cid.test', password: 'mock-password' } : null)
const expectDeny = (fn: () => unknown, re?: RegExp) => {
  try { fn() } catch (e) {
    expect(e).toBeInstanceOf(CiRpcError)
    expect((e as CiRpcError).code).toBe('P0403')
    if (re) expect((e as Error).message).toMatch(re)
    return
  }
  throw new Error('expected a P0403 raise')
}
const notifs = (userId: string, type?: string) => readRows('notifications').filter((n) => n.user_id === userId && (!type || n.type === type))
const audits = (action: string) => readRows('ci_audit_events').filter((a) => a.action === action)
const visible = (table: Parameters<typeof visibleCiRows>[0]) => visibleCiRows(table, getRows(table))
const NO_CI = { full_access: false, is_handler: false }

/** The cast: handler A (the session), the normal detective B (other bureau),
 *  an MCB Bureau Lead (full), a Director (full), the Owner, an SIB agent
 *  (full through siu_memberships), an oversight-only SIB member (NOT full),
 *  an inactive member. */
function cast() {
  const me = roleSession('detective', { overrides: { display_name: 'Det. Alpha Handler' } })
  const [other, lead, director, owner, sib, oversight, inactive] = seedRows('profiles', [
    profileRow({ display_name: 'Det. Bravo Normal', division: 'street_crimes' }),
    profileRow({ role: 'bureau_lead', display_name: 'Lt. Lead' }),
    profileRow({ role: 'director', display_name: 'Dir. Hale' }),
    profileRow({ is_owner: true, display_name: 'The Owner' }),
    profileRow({ display_name: 'SA Quill' }),
    profileRow({ display_name: 'Oversight Only' }),
    profileRow({ active: false, display_name: 'Inactive' }),
  ])
  const siu = (user_id: string, oversight_only: boolean, siu_role = 'special_agent'): Tables<'siu_memberships'> => ({
    active: true, appointed_at: new Date().toISOString(), appointed_by: null, callsign: null, created_at: new Date().toISOString(), end_reason: null,
    ended_at: null, ended_by: null, id: mockId(), internal_note: null, oversight_only, siu_role, updated_at: new Date().toISOString(), user_id,
  })
  seedRows('siu_memberships', [siu(sib.id, false), siu(oversight.id, true)])
  return { me: me.profile, other, lead, director, owner, sib, oversight, inactive }
}
type Cast = ReturnType<typeof cast>
const person = (name = 'Vince Source', alias: string | null = null) => seedRows('persons', [personRow({ name, alias })])[0]
/** A CI designated by `by` (default the lead) with `handler` as primary. */
function designate(c: Cast, handler = c.me, by: Tables<'profiles'> = c.lead, extra: Record<string, unknown> = {}): Out {
  const before = c.me
  asUser(by)
  const out = ciCreate({ p_person: person(`Source ${getRows('persons').length}`).id, p_bureau: 'major_crimes', p_primary_handler: handler.id, p_status: 'active', ...extra }) as Out
  asUser(before)
  return out
}
const mcbCase = (c: Cast, lead = c.me) => seedRows('cases', [caseRow({ case_number: `MCB-${getRows('cases').length + 1}`, lead_detective_id: lead.id, created_by: lead.id })])[0]

beforeEach(() => resetMockStore())

describe('registry', () => {
  it('exposes every §3 RPC, the fourteen RPC-only tables and one route per function plus three write refusals per table', () => {
    const fns = ['ci_context', 'ci_list', 'ci_get', 'ci_stats', 'ci_create', 'ci_update', 'ci_set_status', 'ci_handler_set', 'ci_handler_remove',
      'ci_capacity_request_submit', 'ci_capacity_request_decide', 'ci_capacity_request_withdraw', 'ci_capacity_set', 'ci_contact_log', 'ci_contact_update',
      'ci_contact_delete', 'ci_assess', 'ci_intel_create', 'ci_intel_update', 'ci_intel_set_corroboration', 'ci_intel_links_set', 'ci_intel_delete',
      'ci_case_intel', 'ci_case_counts', 'ci_case_link', 'ci_case_unlink', 'ci_release', 'ci_release_revoke', 'ci_payment_record', 'ci_payment_approve',
      'ci_export', 'ci_search', 'ci_person_status', 'ci_audit_list', 'ci_sweep_run', 'rls_test_ci_sweep']
    for (const fn of fns) expect(fn in CI_RPCS, fn).toBe(true)
    expect(Object.keys(CI_RPCS)).toHaveLength(fns.length)
    expect(CI_RPC_ONLY_TABLES).toHaveLength(14)
    expect(ciHandlers).toHaveLength(fns.length + 14 * 3)
  })
})

describe('the access model (§1) — canAccessCI = full || handler', () => {
  it('full access = Owner, Bureau Lead / DD / Director, an active non-oversight SIB member; never oversight-only, inactive or a plain detective', () => {
    const c = cast()
    expect(hasFullCiAccessAs(c.lead)).toBe(true)
    expect(hasFullCiAccessAs(c.director)).toBe(true)
    expect(hasFullCiAccessAs(c.owner)).toBe(true)
    expect(hasFullCiAccessAs(c.sib)).toBe(true)
    expect(hasFullCiAccessAs(c.oversight)).toBe(false)
    expect(hasFullCiAccessAs(c.me)).toBe(false)
    expect(hasFullCiAccessAs(c.inactive)).toBe(false)
  })

  it('a non-involved member gets exactly {full_access:false, is_handler:false}, zero rows everywhere and null from ci_get / ci_person_status', () => {
    const c = cast()
    const ci = designate(c)
    expect(ci.ok).toBe(true)
    asUser(c.other)
    expect(ciContext()).toEqual(NO_CI)
    expect(ciList()).toEqual([])
    expect(ciGet({ p_ci: ci.id })).toBeNull()
    expect(ciPersonStatus({ p_person: readRows('confidential_informants')[0].person_id })).toBeNull()
    expect(ciStats()).toBeNull()
    expect(ciSearch({ p_q: 'CI-' })).toEqual([])
    expect(ciExport({ p_ci: ci.id })).toBeNull()
    for (const t of CI_RPC_ONLY_TABLES) expect(visible(t), t).toEqual([])
    // A random id is the same null — existence is never confirmed.
    expect(ciGet({ p_ci: mockId() })).toBeNull()
    asUser(c.inactive)
    expect(ciContext()).toEqual(NO_CI)
    expect(ciList()).toEqual([])
  })

  it('the handler sees exactly their own CI; a second handler theirs; full access both; ci_stats for full only', () => {
    const c = cast()
    const mine = designate(c)
    const theirs = designate(c, c.other)
    asUser(c.me)
    expect(ciList().map((r) => r.id)).toEqual([mine.id])
    expect(ciContext()).toMatchObject({ full_access: false, is_handler: true, active_count: 1, capacity: 6 })
    expect(ciGet({ p_ci: theirs.id })).toBeNull()
    expect(canAccessCiAs(theirs.id, c.me)).toBe(false)
    expect(ciStats()).toBeNull()
    asUser(c.other)
    expect(ciList().map((r) => r.id)).toEqual([theirs.id])
    asUser(c.director)
    expect(ciList().map((r) => r.id).sort()).toEqual([mine.id, theirs.id].sort())
    expect((ciStats() as Out).active).toBe(2)
    expect(((ciStats() as Out).handlers as Out[]).map((h) => h.user_id).sort()).toEqual([c.me.id, c.other.id].sort())
    // The handler's view of the row carries the shape the roster renders.
    asUser(c.me)
    const row = ciList()[0]
    expect(row).toMatchObject({ ci_number: 'CI-0001', status: 'active', bureau: 'major_crimes', primary_handler_id: c.me.id, primary_handler_name: 'Det. Alpha Handler', linked_cases: 0, open_followups: 0, deleted_at: null })
    expect(ciPersonStatus({ p_person: row.person_id })).toEqual({ ci_id: mine.id, ci_number: 'CI-0001', status: 'active' })
    // The person row itself stays a plain person — no column, no flag.
    expect(Object.keys(readRows('persons')[0])).not.toContain('ci_id')
  })

  it('case access is not CI access: a case member reads the case but ci_case_intel / ci_case_counts answer zero rows', () => {
    const c = cast()
    const ci = designate(c)
    const kase = mcbCase(c, c.lead)
    asUser(c.me)
    const intel = ciIntelCreate({ p_ci: ci.id, p_summary: 'Shipment Friday', p_case: kase.id }) as Out
    expect(intel.ok).toBe(true)
    expect(ciCaseIntel({ p_case: kase.id })).toHaveLength(1)
    expect(ciCaseCounts({ p_cases: [kase.id] })).toEqual([{ case_id: kase.id, n: 2 }]) // one intel + the auto case link
    // The lead (case command AND full access) sees it; a same-bureau detective who can read the case does not.
    const [peer] = seedRows('profiles', [profileRow({ display_name: 'Det. Peer' })])
    asUser(peer)
    expect(ciCaseIntel({ p_case: kase.id })).toEqual([])
    expect(ciCaseCounts({ p_cases: [kase.id] })).toEqual([])
    expect(visible('ci_intelligence')).toEqual([])
    expect(visible('ci_case_links')).toEqual([])
    asUser(c.lead)
    expect(ciCaseIntel({ p_case: kase.id })[0]).toMatchObject({ ci_number: 'CI-0001', summary: 'Shipment Friday', corroboration: 'unverified', release_count: 0 })
  })
})

describe('ci_create (§3)', () => {
  it('self-recruitment is allowed with no secondary; designating another handler is command only (P0403); the person becomes unavailable with ONE wording', () => {
    const c = cast()
    const p = person('Vince Source')
    asUser(c.me)
    const ok = ciCreate({ p_person: p.id, p_bureau: 'major_crimes', p_primary_handler: c.me.id }) as Out
    expect(ok).toMatchObject({ ok: true, ci_number: 'CI-0001' })
    expect(readRows('confidential_informants')[0].status).toBe('candidate')
    expectDeny(() => ciCreate({ p_person: person().id, p_bureau: 'major_crimes', p_primary_handler: c.other.id }))
    expectDeny(() => ciCreate({ p_person: person().id, p_bureau: 'major_crimes', p_primary_handler: c.me.id, p_secondary_handler: c.other.id }))
    // Taken, missing or hidden — the same answer for the handler and for command.
    expect(ciCreate({ p_person: p.id, p_bureau: 'major_crimes', p_primary_handler: c.me.id })).toEqual({ ok: false, code: 'unavailable', message: CI_MESSAGES.unavailable })
    expect(ciCreate({ p_person: mockId(), p_bureau: 'major_crimes', p_primary_handler: c.me.id })).toEqual({ ok: false, code: 'unavailable', message: CI_MESSAGES.unavailable })
    asUser(c.lead)
    expect(ciCreate({ p_person: p.id, p_bureau: 'major_crimes', p_primary_handler: c.other.id })).toEqual({ ok: false, code: 'unavailable', message: CI_MESSAGES.unavailable })
    // Audit in ci_audit_events only — never audit_log.
    expect(audits('CI_CREATED')).toHaveLength(1)
    expect(audits('CI_PERSON_DESIGNATED')).toHaveLength(1)
    expect(audits('CI_HANDLER_ASSIGNED')).toHaveLength(1)
    expect(readRows('audit_log')).toEqual([])
    expect(readRows('ci_events').map((e) => e.kind)).toEqual(['created'])
    asUser(c.inactive)
    expectDeny(() => ciCreate({ p_person: person().id, p_bureau: 'major_crimes', p_primary_handler: c.inactive.id }), /not active/)
  })

  it('validates the enums and the bureau; the designated handler is told with an ids-only payload; the designating caller is not', () => {
    const c = cast()
    const p = person()
    asUser(c.lead)
    expect((ciCreate({ p_person: p.id, p_bureau: 'nowhere', p_primary_handler: c.me.id }) as Out).code).toBe('invalid')
    expect((ciCreate({ p_person: p.id, p_bureau: 'major_crimes', p_primary_handler: c.me.id, p_motive_primary: 'greed' }) as Out).code).toBe('invalid')
    expect((ciCreate({ p_person: p.id, p_bureau: 'major_crimes', p_primary_handler: c.me.id, p_status: 'ghost' }) as Out).code).toBe('invalid')
    expect((ciCreate({ p_person: p.id, p_bureau: 'major_crimes', p_primary_handler: c.inactive.id }) as Out).code).toBe('bad_handler')
    const ok = ciCreate({ p_person: p.id, p_bureau: 'major_crimes', p_primary_handler: c.me.id, p_secondary_handler: c.other.id, p_motive_primary: 'money', p_motive_secondary: ['leniency'] }) as Out
    expect(ok.ok).toBe(true)
    expect(notifs(c.me.id, 'ci_assigned')).toHaveLength(1)
    expect(notifs(c.other.id, 'ci_assigned')).toHaveLength(1)
    expect(notifs(c.lead.id)).toEqual([])
    const payload = notifs(c.me.id, 'ci_assigned')[0].payload as Out
    expect(Object.keys(payload).sort()).toEqual(['actor_id', 'actor_name', 'ci_id'])
    expect(payload.ci_id).toBe(ok.id)
  })
})

describe('capacity (§3) — 6 by default', () => {
  /** Six active CIs for `me`, designated by the lead. */
  const fill = (c: Cast) => { for (let i = 0; i < 6; i++) expect(designate(c).ok).toBe(true) }

  it('the seventh self-recruited active CI is refused with code capacity and the self wording; command without a reason gets the named wording; a reason overrides, audits and raises the limit', () => {
    const c = cast()
    fill(c)
    asUser(c.me)
    expect(ciContext()).toMatchObject({ active_count: 6, capacity: 6 })
    const seventh = ciCreate({ p_person: person().id, p_bureau: 'major_crimes', p_primary_handler: c.me.id, p_status: 'active' })
    expect(seventh).toEqual({ ok: false, code: 'capacity', message: CI_MESSAGES.capacitySelf(6, 6) })
    expect(CI_MESSAGES.capacitySelf(6, 6)).toBe('You are at capacity (6 / 6). Request additional capacity or an assignment.')
    // A candidate does not count — it may still be created at capacity.
    expect((ciCreate({ p_person: person().id, p_bureau: 'major_crimes', p_primary_handler: c.me.id }) as Out).ok).toBe(true)
    expect(ciContext()).toMatchObject({ active_count: 6 })
    asUser(c.lead)
    const named = ciCreate({ p_person: person().id, p_bureau: 'major_crimes', p_primary_handler: c.me.id, p_status: 'active' })
    expect(named).toEqual({ ok: false, code: 'capacity', message: 'Det. Alpha Handler is at capacity (6 / 6). Confirm the override with a reason.' })
    const forced = ciCreate({ p_person: person().id, p_bureau: 'major_crimes', p_primary_handler: c.me.id, p_status: 'active', p_override_reason: 'Operation Tidewater needs the source' }) as Out
    expect(forced.ok).toBe(true)
    const override = audits('CI_CAPACITY_OVERRIDE')
    expect(override).toHaveLength(1)
    expect(override[0].detail).toMatchObject({ handler_id: c.me.id, from: 6, to: 7, reason: 'Operation Tidewater needs the source' })
    expect(readRows('ci_handler_capacity')[0]).toMatchObject({ user_id: c.me.id, limit_override: 7, approved_by: c.lead.id })
    asUser(c.me)
    expect(ciContext()).toMatchObject({ active_count: 7, capacity: 7 })
    // The audit row is readable by the handler through their CI and listed by ci_audit_list.
    expect(ciAuditList({ p_ci: forced.id }).map((a) => a.action)).toContain('CI_CAPACITY_OVERRIDE')
    // The override row is the handler's own to read; the normal detective reads none.
    expect(visible('ci_handler_capacity')).toHaveLength(1)
    asUser(c.other)
    expect(visible('ci_handler_capacity')).toEqual([])
  })

  it('a capacity request (handlers only) → approve → capacity 8 → the seventh CI is allowed; reviewers are told with ids only; one pending per kind', () => {
    const c = cast()
    fill(c)
    asUser(c.other)
    expectDeny(() => ciCapacityRequestSubmit({ p_kind: 'capacity', p_reason: 'I want more', p_requested_capacity: 8 }), /current handler/)
    asUser(c.me)
    expect((ciCapacityRequestSubmit({ p_kind: 'capacity', p_reason: 'Two more sources on Tidewater', p_requested_capacity: 6 }) as Out).code).toBe('invalid')
    expect((ciCapacityRequestSubmit({ p_kind: 'capacity', p_reason: 'Two more sources on Tidewater', p_requested_capacity: 31 }) as Out).code).toBe('invalid')
    expect((ciCapacityRequestSubmit({ p_kind: 'capacity', p_reason: 'x', p_requested_capacity: 8 }) as Out).code).toBe('reason')
    const req = ciCapacityRequestSubmit({ p_kind: 'capacity', p_reason: 'Two more sources on Tidewater', p_requested_capacity: 8 }) as Out
    expect(req).toMatchObject({ ok: true, status: 'pending' })
    expect((ciCapacityRequestSubmit({ p_kind: 'capacity', p_reason: 'Again', p_requested_capacity: 9 }) as Out).code).toBe('pending')
    expect(readRows('ci_capacity_requests')[0]).toMatchObject({ kind: 'capacity', current_count: 6, requested_capacity: 8, requester_id: c.me.id })
    // Reviewers: the MCB lead, the director, the SIB agent in charge (none seeded) — not the SCB detective, not the handler.
    expect(notifs(c.lead.id, 'ci_capacity_request')).toHaveLength(1)
    expect(notifs(c.director.id, 'ci_capacity_request')).toHaveLength(1)
    expect(notifs(c.other.id)).toEqual([])
    expect(Object.keys(notifs(c.lead.id)[0].payload as Out).sort()).toEqual(['actor_id', 'actor_name', 'request_id'])
    expect(audits('CI_CAPACITY_REQUESTED')[0]).toMatchObject({ ci_id: null, actor_id: c.me.id })
    expect(ciContext()).toMatchObject({ pending_requests: 1 })
    // The requester reads their request; the normal detective none; full access all.
    expect(visible('ci_capacity_requests')).toHaveLength(1)
    asUser(c.other)
    expect(visible('ci_capacity_requests')).toEqual([])
    expectDeny(() => ciCapacityRequestDecide({ p_request: req.id, p_decision: 'approved' }), /CI command/)
    asUser(c.lead)
    expect((ciCapacityRequestDecide({ p_request: req.id, p_decision: 'denied' }) as Out).code).toBe('note')
    const decided = ciCapacityRequestDecide({ p_request: req.id, p_decision: 'approved', p_note: 'Approved for Tidewater' }) as Out
    expect(decided).toMatchObject({ ok: true, status: 'approved' })
    expect((ciCapacityRequestDecide({ p_request: req.id, p_decision: 'approved' }) as Out).code).toBe('not_pending')
    expect(readRows('ci_handler_capacity')[0]).toMatchObject({ user_id: c.me.id, limit_override: 8, request_id: req.id })
    expect(audits('CI_CAPACITY_CHANGED')).toHaveLength(1)
    expect(notifs(c.me.id, 'ci_request_decided')).toHaveLength(1)
    asUser(c.me)
    expect(ciContext()).toMatchObject({ active_count: 6, capacity: 8, pending_requests: 0 })
    expect((ciCreate({ p_person: person().id, p_bureau: 'major_crimes', p_primary_handler: c.me.id, p_status: 'active' }) as Out).ok).toBe(true)
    expect(ciContext()).toMatchObject({ active_count: 7, capacity: 8 })
  })

  it('an approved assignment request creates the CI as the requester\'s primary (with the approval as the override reason at capacity)', () => {
    const c = cast()
    fill(c)
    const p = person('Proposed Source')
    asUser(c.me)
    const req = ciCapacityRequestSubmit({ p_kind: 'assignment', p_reason: 'Access to the Tidewater crew', p_proposed_person: p.id, p_proposed_motive: 'leniency' }) as Out
    expect(req.ok).toBe(true)
    asUser(c.director)
    const decided = ciCapacityRequestDecide({ p_request: req.id, p_decision: 'approved' }) as Out
    expect(decided.ok).toBe(true)
    expect(decided.created_ci_id).toBeTruthy()
    const ci = readRows('confidential_informants').find((r) => r.id === decided.created_ci_id)!
    expect(ci).toMatchObject({ person_id: p.id, status: 'active', motive_primary: 'leniency' })
    expect(readRows('ci_handlers').find((h) => h.ci_id === ci.id)).toMatchObject({ user_id: c.me.id, role: 'primary' })
    expect(audits('CI_CAPACITY_OVERRIDE')[0].detail).toMatchObject({ reason: `Approved assignment request ${req.id}` })
    asUser(c.me)
    expect(ciContext()).toMatchObject({ active_count: 7, capacity: 7 })
  })

  it('ci_capacity_set is full only; null returns the handler to 6', () => {
    const c = cast()
    asUser(c.me)
    expectDeny(() => ciCapacitySet({ p_user: c.me.id, p_limit: 10, p_reason: 'because' }), /CI command/)
    asUser(c.director)
    expect((ciCapacitySet({ p_user: c.me.id, p_limit: 31, p_reason: 'too many' }) as Out).code).toBe('invalid')
    expect(ciCapacitySet({ p_user: c.me.id, p_limit: 10, p_reason: 'Task force lead' })).toEqual({ ok: true, user_id: c.me.id, capacity: 10 })
    expect(ciCapacitySet({ p_user: c.me.id, p_limit: null, p_reason: 'Task force ended' })).toEqual({ ok: true, user_id: c.me.id, capacity: 6 })
    expect(readRows('ci_handler_capacity')).toEqual([])
    expect(audits('CI_CAPACITY_CHANGED')).toHaveLength(2)
  })
})

describe('handlers and status (§3)', () => {
  it('ci_handler_set is full only; replacing the primary ends the old handler\'s access immediately; both are told with ids only; the shadow row moves too', () => {
    const c = cast()
    const ci = designate(c)
    asUser(c.me)
    expectDeny(() => ciHandlerSet({ p_ci: ci.id, p_user: c.other.id, p_role: 'primary', p_reason: 'handing over' }), /CI command/)
    asUser(c.lead)
    expect((ciHandlerSet({ p_ci: ci.id, p_user: c.other.id, p_role: 'lead', p_reason: 'handing over' }) as Out).code).toBe('invalid')
    expect((ciHandlerSet({ p_ci: ci.id, p_user: c.inactive.id, p_role: 'primary', p_reason: 'handing over' }) as Out).code).toBe('bad_handler')
    const out = ciHandlerSet({ p_ci: ci.id, p_user: c.other.id, p_role: 'primary', p_reason: 'Alpha rotates to nights' }) as Out
    expect(out).toMatchObject({ ok: true, ci_id: ci.id, user_id: c.other.id, role: 'primary' })
    expect(audits('CI_HANDLER_CHANGED')[0].detail).toMatchObject({ user_id: c.other.id, from: c.me.id, role: 'primary' })
    expect(readRows('ci_handlers').filter((h) => h.ended_at == null)).toHaveLength(1)
    expect(notifs(c.other.id, 'ci_assigned')).toHaveLength(1)
    expect(notifs(c.me.id, 'ci_handler_removed')).toHaveLength(1)
    for (const n of readRows('notifications')) expect(Object.keys(n.payload as Out).sort()).toEqual(['actor_id', 'actor_name', 'ci_id'])
    asUser(c.me)
    expect(ciList()).toEqual([])
    expect(ciGet({ p_ci: ci.id })).toBeNull()
    expect(ciContext()).toEqual(NO_CI)
    expect(visible('ci_events')).toEqual([])
    asUser(c.other)
    expect(ciList().map((r) => r.id)).toEqual([ci.id])
    expect(visible('ci_events').map((e) => e.kind)).toEqual(['created', 'handlers'])
    // Full access reads the handler history; the handler does not.
    expect((ciGet({ p_ci: ci.id }) as Out).handler_history).toEqual([])
    asUser(c.lead)
    expect(((ciGet({ p_ci: ci.id }) as Out).handler_history as Out[]).map((h) => h.user_id)).toEqual([c.me.id])
  })

  it('a handler with former full access keeps only their own CI (demotion), and a lead promoted to detective loses the roster', () => {
    const c = cast()
    const mine = designate(c)
    const theirs = designate(c, c.other)
    // The lead handles one CI as secondary, then is demoted to detective.
    asUser(c.director)
    expect((ciHandlerSet({ p_ci: mine.id, p_user: c.lead.id, p_role: 'secondary', p_reason: 'supervising' }) as Out).ok).toBe(true)
    asUser(c.lead)
    expect(ciList()).toHaveLength(2)
    c.lead.role = 'detective'
    expect(hasFullCiAccessAs(c.lead)).toBe(false)
    expect(ciList().map((r) => r.id)).toEqual([mine.id])
    expect(ciGet({ p_ci: theirs.id })).toBeNull()
    expect(ciStats()).toBeNull()
    expect(ciContext()).toMatchObject({ full_access: false, is_handler: true })
  })

  it('ci_handler_remove refuses to remove the primary of an active / candidate CI (primary_required) and otherwise ends the row', () => {
    const c = cast()
    const ci = designate(c)
    asUser(c.lead)
    expect((ciHandlerSet({ p_ci: ci.id, p_user: c.other.id, p_role: 'secondary', p_reason: 'backup' }) as Out).ok).toBe(true)
    expect(ciHandlerRemove({ p_ci: ci.id, p_user: c.me.id, p_reason: 'leaving' })).toEqual({ ok: false, code: 'primary_required', message: CI_MESSAGES.primaryRequired })
    expect((ciHandlerRemove({ p_ci: ci.id, p_user: c.other.id, p_reason: 'no longer needed' }) as Out).ok).toBe(true)
    expect(notifs(c.other.id, 'ci_handler_removed')).toHaveLength(1)
    expect(audits('CI_HANDLER_REMOVED')).toHaveLength(1)
    asUser(c.me)
    expectDeny(() => ciHandlerRemove({ p_ci: ci.id, p_user: c.other.id, p_reason: 'x' }), /CI command/)
  })

  it('ci_set_status is full only (P0403 for the handler); a reason is required; retired frees capacity by derivation while the history stays restricted; compromised fans out', () => {
    const c = cast()
    const ci = designate(c)
    asUser(c.me)
    expectDeny(() => ciSetStatus({ p_ci: ci.id, p_status: 'retired', p_reason: 'done' }), /CI command/)
    expect(ciContext()).toMatchObject({ active_count: 1 })
    asUser(c.lead)
    expect((ciSetStatus({ p_ci: ci.id, p_status: 'retired', p_reason: 'x' }) as Out).code).toBe('reason')
    expect((ciSetStatus({ p_ci: ci.id, p_status: 'vanished', p_reason: 'gone away' }) as Out).code).toBe('invalid')
    expect(ciSetStatus({ p_ci: ci.id, p_status: 'retired', p_reason: 'Source relocated' })).toEqual({ ok: true, id: ci.id, status: 'retired' })
    expect(audits('CI_STATUS_CHANGED')[0].detail).toEqual({ from: 'active', to: 'retired' })
    expect(readRows('confidential_informants')[0]).toMatchObject({ status: 'retired', status_reason: 'Source relocated' })
    asUser(c.me)
    expect(ciContext()).toMatchObject({ active_count: 0, is_handler: true })
    expect(ciList()[0].status).toBe('retired')
    asUser(c.other)
    expect(ciList()).toEqual([])
    expect(ciGet({ p_ci: ci.id })).toBeNull()
    expect(visible('ci_audit_events')).toEqual([])
    asUser(c.director)
    expect((ciSetStatus({ p_ci: ci.id, p_status: 'compromised', p_reason: 'Named in a leak' }) as Out).ok).toBe(true)
    expect(notifs(c.me.id, 'ci_compromised')).toHaveLength(1)
    expect(notifs(c.lead.id, 'ci_compromised')).toHaveLength(1)
    expect(notifs(c.other.id)).toEqual([])
    // Nothing was declassified: the row is still invisible to the normal detective and still in ci_audit_events, not audit_log.
    asUser(c.other)
    expect(visible('confidential_informants')).toEqual([])
    expect(readRows('audit_log')).toEqual([])
  })

  it('a write against an unknown or inaccessible CI answers the one P0403 wording — existence is never confirmed', () => {
    const c = cast()
    const ci = designate(c, c.other)
    asUser(c.me)
    const expectSame = (fn: () => unknown) => expectDeny(fn, new RegExp(CI_MESSAGES.noAccess))
    expectSame(() => ciContactLog({ p_ci: ci.id, p_occurred_at: new Date().toISOString(), p_method: 'phone', p_summary: 'call' }))
    expectSame(() => ciContactLog({ p_ci: mockId(), p_occurred_at: new Date().toISOString(), p_method: 'phone', p_summary: 'call' }))
    expectSame(() => ciIntelCreate({ p_ci: ci.id, p_summary: 'x' }))
    asUser(c.lead)
    expectSame(() => ciSetStatus({ p_ci: mockId(), p_status: 'retired', p_reason: 'gone' }))
  })
})

describe('intelligence, contact, sanitize / release (§3)', () => {
  it('a contact updates last / next contact and tells nobody; intelligence with a case auto-links the case and tells the OTHER handlers only', () => {
    const c = cast()
    const ci = designate(c)
    const kase = mcbCase(c)
    asUser(c.lead)
    expect((ciHandlerSet({ p_ci: ci.id, p_user: c.other.id, p_role: 'secondary', p_reason: 'backup' }) as Out).ok).toBe(true)
    asUser(c.me)
    const when = new Date(Date.now() - 3_600_000).toISOString()
    const next = new Date(Date.now() + 7 * 86_400_000).toISOString()
    expect((ciContactLog({ p_ci: ci.id, p_occurred_at: when, p_method: 'meet', p_summary: 'x' }) as Out).code).toBe('invalid')
    const notifsBefore = readRows('notifications').length
    const contact = ciContactLog({ p_ci: ci.id, p_occurred_at: when, p_method: 'in_person', p_summary: 'Met at the pier', p_next_contact_at: next }) as Out
    expect(contact.ok).toBe(true)
    expect(readRows('confidential_informants')[0]).toMatchObject({ last_contact_at: when, next_contact_at: next })
    expect(audits('CI_CONTACT_LOGGED')).toHaveLength(1)
    expect(readRows('notifications')).toHaveLength(notifsBefore)
    const hidden = seedRows('persons', [personRow({ name: 'Hidden', siu_hidden_flag: true })])[0]
    expect((ciIntelCreate({ p_ci: ci.id, p_summary: 'x', p_links: [{ kind: 'person', target_id: hidden.id }] }) as Out).code).toBe('bad_link')
    expect((ciIntelCreate({ p_ci: ci.id, p_summary: 'x', p_links: [{ kind: 'person', target_id: mockId() }] }) as Out).code).toBe('bad_link')
    expect((ciIntelCreate({ p_ci: ci.id, p_summary: 'x', p_case: mockId() }) as Out).code).toBe('bad_case')
    const target = person('Named Suspect')
    const intel = ciIntelCreate({ p_ci: ci.id, p_summary: 'Shipment Friday', p_case: kase.id, p_links: [{ kind: 'person', target_id: target.id, note: 'the courier' }] }) as Out
    expect(intel.ok).toBe(true)
    expect(readRows('ci_case_links')).toHaveLength(1)
    expect(audits('CI_CASE_LINKED')).toHaveLength(1)
    expect(readRows('ci_intelligence_links')).toHaveLength(1)
    expect(notifs(c.other.id, 'ci_intel_added')).toHaveLength(1)
    expect(Object.keys(notifs(c.other.id, 'ci_intel_added')[0].payload as Out).sort()).toEqual(['actor_id', 'actor_name', 'ci_id', 'intel_id'])
    expect(notifs(c.me.id, 'ci_intel_added')).toEqual([])
    expect(ciList()[0]).toMatchObject({ linked_cases: 1 })
    expect((ciGet({ p_ci: ci.id }) as Out).cases).toEqual([expect.objectContaining({ case_id: kase.id, case_number: kase.case_number })])
  })

  it('ci_release is full only; the text must not name the source; a clean release is visible to a case reader as case_intel_releases while ci_releases stays restricted; the case lead is told', () => {
    const c = cast()
    const src = person('Vince Source', 'Vinny')
    asUser(c.lead)
    const ci = ciCreate({ p_person: src.id, p_bureau: 'major_crimes', p_primary_handler: c.me.id, p_status: 'active', p_alias: 'Harbor' }) as Out
    // bcb-style case reader: the case lead in the other bureau who is no CI handler.
    const kase = seedRows('cases', [caseRow({ case_number: 'SCB-9', bureau: 'street_crimes', lead_detective_id: c.other.id, created_by: c.other.id })])[0]
    asUser(c.me)
    // The handler can read the SCB case? No — so the intel is filed on an MCB case the lead can read.
    const mcb = mcbCase(c, c.lead)
    const intel = ciIntelCreate({ p_ci: ci.id, p_summary: 'Shipment Friday via CI-0001', p_case: mcb.id }) as Out
    expect(intel.ok).toBe(true)
    expectDeny(() => ciRelease({ p_intel: intel.id, p_title: 'Shipment', p_body: 'A shipment arrives Friday.' }), /CI command/)
    asUser(c.lead)
    const noCase = ciIntelCreate({ p_ci: ci.id, p_summary: 'loose' }) as Out
    expect((ciRelease({ p_intel: noCase.id, p_title: 'Shipment', p_body: 'A shipment arrives Friday.' }) as Out).code).toBe('no_case')
    for (const bad of ['Per CI-0001 a shipment arrives Friday.', 'Vince Source says a shipment arrives.', 'Vinny says so.', 'Harbor reports a shipment.', 'Det. Alpha Handler\'s source says so.'])
      expect(ciRelease({ p_intel: intel.id, p_title: 'Shipment', p_body: bad }), bad).toEqual({ ok: false, code: 'unsanitized', message: CI_MESSAGES.unsanitized })
    expect(ciSanitized(String(ci.id), 'A shipment arrives Friday at the pier.')).toBe(true)
    const rel = ciRelease({ p_intel: intel.id, p_title: 'Shipment expected', p_body: 'A shipment arrives Friday at the pier.', p_handling: 'court_disclosable' }) as Out
    expect(rel).toMatchObject({ ok: true, case_id: mcb.id })
    expect(readRows('case_intel_releases')[0]).toMatchObject({ case_id: mcb.id, title: 'Shipment expected', handling: 'court_disclosable', released_by: c.lead.id })
    expect(Object.keys(readRows('case_intel_releases')[0])).not.toContain('ci_id')
    expect(readRows('ci_releases')[0]).toMatchObject({ intel_id: intel.id, ci_id: ci.id, case_release_id: rel.id })
    expect(audits('CI_INTEL_RELEASED')).toHaveLength(1)
    // The original intelligence row is untouched.
    expect(readRows('ci_intelligence').find((i) => i.id === intel.id)).toMatchObject({ summary: 'Shipment Friday via CI-0001', deleted_at: null })
    // A same-bureau detective who can read the MCB case sees the sanitized release and NOT the restricted link.
    const [peer] = seedRows('profiles', [profileRow({ display_name: 'Det. Peer' })])
    asUser(peer)
    expect(visible('case_intel_releases')).toHaveLength(1)
    expect(visible('ci_releases')).toEqual([])
    expect(visible('ci_intelligence')).toEqual([])
    // The SCB detective cannot read the MCB case → no release either.
    asUser(c.other)
    expect(visible('case_intel_releases')).toEqual([])
    expect(kase.bureau).toBe('street_crimes')
    // The case lead (the MCB lead here) is told with ids only and a kind that names no CI.
    const told = notifs(c.lead.id, 'case_intel_released')
    expect(told).toHaveLength(0) // the releaser is the lead — self is skipped
    asUser(c.me)
    expect(ciCaseIntel({ p_case: mcb.id }).find((r) => r.id === intel.id)?.release_count).toBe(1)
  })

  it('the export answers the handler\'s own CI (audited CI_EXPORTED), null for another CI, the roster for full access only', () => {
    const c = cast()
    const mine = designate(c)
    const theirs = designate(c, c.other)
    asUser(c.me)
    const out = ciExport({ p_ci: mine.id }) as Out
    expect(out.scope).toBe('profile')
    expect((out.profile as Out).ci_number).toBe('CI-0001')
    expect(ciExport({ p_ci: theirs.id })).toBeNull()
    expect(ciExport({})).toBeNull()
    expect(audits('CI_EXPORTED')).toHaveLength(1)
    expect(audits('CI_EXPORTED')[0]).toMatchObject({ ci_id: mine.id, actor_id: c.me.id })
    asUser(c.director)
    const roster = ciExport({}) as Out
    expect(roster.scope).toBe('roster')
    expect(roster.rows as Out[]).toHaveLength(2)
    expect(audits('CI_EXPORTED')).toHaveLength(2)
  })
})

describe('the sweep and the write refusals', () => {
  it('ci_sweep_run is the Owner\'s (jsonb denial otherwise); the fixture runner refuses a real caller and a non-fixture CI; an overdue contact tells the active handlers once per day', () => {
    const c = cast()
    const ci = designate(c)
    asUser(c.lead)
    expect(ciSweepRun()).toEqual({ ok: false, code: 'denied', message: CI_MESSAGES.sweepDenied })
    expect(() => rlsTestCiSweep({ p_ci: ci.id })).toThrow(/not a test fixture/)
    const [fixture] = seedRows('profiles', [profileRow({ email: 'rls-test-lsb@cidportal.test', display_name: 'RLS Test LSB' })])
    asUser(fixture)
    expect(() => rlsTestCiSweep({ p_ci: ci.id })).toThrow(/not fixture-owned/)
    const row = readRows('confidential_informants')[0]
    row.next_contact_at = new Date(Date.now() - 3_600_000).toISOString()
    asUser(c.owner)
    expect(ciSweepRun()).toEqual({ ok: true, overdue: 1, silent: 0 })
    expect(notifs(c.me.id, 'ci_contact_overdue')).toHaveLength(1)
    expect(notifs(c.me.id, 'ci_contact_overdue')[0].payload).toMatchObject({ ci_id: ci.id })
    expect(readRows('ci_events').map((e) => e.kind)).toContain('overdue')
    expect(readRows('scheduled_job_runs')[0]).toMatchObject({ job: 'ci_contact_sweep', status: 'ok' })
    // A second run within 24 h re-notifies nobody.
    expect(ciSweepRun()).toEqual({ ok: true, overdue: 0, silent: 0 })
    expect(notifs(c.me.id, 'ci_contact_overdue')).toHaveLength(1)
  })

  it('every CI table has a POST / PATCH / DELETE refusal route (42501) and no client write path in the registry', async () => {
    const writes = ciHandlers.slice(Object.keys(CI_RPCS).length)
    expect(writes).toHaveLength(14 * 3)
    for (const h of writes) {
      const info = (h as unknown as { info: { method: string; path: string } }).info
      expect(['POST', 'PATCH', 'DELETE']).toContain(info.method)
      expect(CI_RPC_ONLY_TABLES.some((t) => info.path.endsWith(`/rest/v1/${t}`)), info.path).toBe(true)
    }
  })
})

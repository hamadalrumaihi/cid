/** v1.91b — Confidential Informants: handler capacity (migration
 *  20261103120000_confidential_informants; scratch ci_contract.md §1, §3).
 *  Security cases 7–12.
 *
 *  What the CID fixtures prove (lsb — the MCB detective, the handler who
 *  self-recruits; bcb — the SCB detective, the normal detective who reads
 *  none of it; lead — the MCB Bureau Lead, full access, the reviewer):
 *   · #7 capacity is 6 by default: after six self-recruited ACTIVE CIs
 *     `ci_context()` answers `{active_count: 6, capacity: 6}` and
 *     `ci_stats().handlers[lsb]` (the lead) says the same; a `candidate` does
 *     not count;
 *   · #8 the seventh active CI is refused — the handler with `{ok:false,
 *     code:'capacity', message:'You are at capacity (6 / 6). Request
 *     additional capacity or an assignment.'}`, the lead without a reason
 *     with `'<name> is at capacity (6 / 6). Confirm the override with a
 *     reason.'` — and nothing is created;
 *   · #9 `ci_capacity_request_submit('capacity', 8)`: only a current handler
 *     (bcb → P0403); requested must exceed the current capacity and stay ≤ 30;
 *     one pending per requester + kind; `current_count` 6 is stored; the row
 *     is readable by the requester and the lead, not by bcb; the lead is told
 *     (`ci_capacity_request`, payload ids only) and bcb is not; the audit row
 *     (`ci_id` null) is the requester's to read;
 *   · #10 `ci_capacity_request_decide(approved)` is full-only (lsb → P0403); a
 *     denial needs a note; approval writes `ci_handler_capacity` (limit 8,
 *     `request_id`), `CI_CAPACITY_CHANGED`, `ci_request_decided` to the
 *     requester, and `ci_context().capacity` becomes 8;
 *   · #11 CIs #7 and #8 are created (`active_count` 8), #9 is refused with
 *     `(8 / 8)`;
 *   · #12 the lead's override with `p_override_reason` at 8 / 8 succeeds,
 *     `CI_CAPACITY_OVERRIDE` carries the reason in `ci_audit_list(ci)` (the
 *     handler reads it), the limit is raised to 9; `ci_capacity_set` is
 *     full-only and `p_limit` null returns the handler to 6.
 *
 *  Fixtures: nine persons inserted by lsb (`[rls-test] v191b <tag> …`); the
 *  CIs are lsb's own (self-recruitment). `rls_test_cleanup` (spliced by
 *  20261103120000) sweeps the CIs, the capacity request and the override. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v191b] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>
const SELF_AT_CAPACITY = (n: number, c: number) => `You are at capacity (${n} / ${c}). Request additional capacity or an assignment.`
const NAMED_AT_CAPACITY = (n: number, c: number) => new RegExp(`^.+ is at capacity \\(${n} / ${c}\\)\\. Confirm the override with a reason\\.$`)

describe.skipIf(!enabled)('v1.91b — Confidential Informants: capacity 6, the request, the approval, the override', () => {
  let lsb: C, bcb: C, lead: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v191b ${tag}`
  const persons: string[] = []   // nine persons, consumed in order
  const cis: string[] = []       // lsb's CIs in creation order
  let requestId = ''

  const ctx = async (c: C): Promise<Json> => {
    const r = await c.rpc('ci_context')
    expect(r.error, r.error?.message).toBeNull()
    return r.data as Json
  }
  const jsonRpc = async (c: C, fn: string, args: Json): Promise<Json> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn}: ${r.error?.message}`).toBeNull()
    return r.data as Json
  }
  const expectP0403 = async (c: C, fn: string, args: Json) => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn} should raise`).not.toBeNull()
    expect(r.error!.code, `${fn}: ${r.error!.message}`).toBe('P0403')
  }
  /** lsb self-recruits an ACTIVE CI for the next person. */
  const recruit = (c: C = lsb, extra: Json = {}) =>
    jsonRpc(c, 'ci_create', { p_person: persons[cis.length], p_bureau: 'major_crimes', p_primary_handler: ids.lsb, p_status: 'active', p_alias: `${tag}-${cis.length + 1}`, ...extra })

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    for (let i = 1; i <= 10; i++) {
      const p = await lsb.from('persons').insert({ name: `${stamp} person ${i}` }).select('id').single()
      if (p.error) throw new Error(`person ${i}: ${p.error.message}`)
      persons.push(p.data!.id)
    }
    // A clean slate: the handler starts with no active CI and the default capacity.
    const start = await lsb.rpc('ci_context')
    if (start.error) throw new Error(`ci_context: ${start.error.message}`)
    const s = start.data as Json
    if (s.is_handler === true && Number(s.active_count) > 0) throw new Error(`lsb already handles ${s.active_count} active CI(s) — cleanup did not run`)
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v191b] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #7 six is the default ============ */

  it('#7 six self-recruited active CIs fill the default capacity: ci_context() says 6 / 6, the lead\'s ci_stats() agrees, a candidate does not count', async () => {
    for (let i = 0; i < 6; i++) {
      const out = await recruit()
      expect(out.ok, `CI #${i + 1}: ${JSON.stringify(out)}`).toBe(true)
      cis.push(String(out.id))
      expect(String(out.ci_number)).toMatch(/^CI-\d{4}$/)
    }
    expect(await ctx(lsb)).toMatchObject({ full_access: false, is_handler: true, active_count: 6, capacity: 6 })
    const stats = await jsonRpc(lead, 'ci_stats', {})
    const me = (stats.handlers as Json[]).find((h) => h.user_id === ids.lsb)
    expect(me).toMatchObject({ active_count: 6, capacity: 6 })
    expect(stats.handlers_at_capacity as number).toBeGreaterThanOrEqual(1)
    // A candidate is not counted toward capacity and may still be designated.
    const candidate = await recruit(lsb, { p_status: 'candidate' })
    expect(candidate.ok, JSON.stringify(candidate)).toBe(true)
    cis.push(String(candidate.id))
    expect(await ctx(lsb)).toMatchObject({ active_count: 6, capacity: 6 })
    // The normal detective still reads nothing.
    expect(await ctx(bcb)).toEqual({ full_access: false, is_handler: false })
    const rows = await bcb.from('confidential_informants').select('id')
    expect(rows.error, rows.error?.message).toBeNull()
    expect(rows.data ?? []).toEqual([])
  })

  /* ============ #8 the seventh is refused ============ */

  it('#8 the seventh active CI is refused with code capacity — the self wording for the handler, the named wording for the lead without a reason — and nothing is created', async () => {
    const before = (await jsonRpc(lead, 'ci_list', { p_filters: { handler: ids.lsb } }) as unknown as Json[]).length
    const self = await recruit()
    expect(self).toEqual({ ok: false, code: 'capacity', message: SELF_AT_CAPACITY(6, 6) })
    const named = await recruit(lead)
    expect(named.ok).toBe(false)
    expect(named.code).toBe('capacity')
    expect(String(named.message)).toMatch(NAMED_AT_CAPACITY(6, 6))
    const after = (await jsonRpc(lead, 'ci_list', { p_filters: { handler: ids.lsb } }) as unknown as Json[]).length
    expect(after).toBe(before)
    expect(await ctx(lsb)).toMatchObject({ active_count: 6, capacity: 6 })
    // The person offered for the refused CI is still free — it can be designated later in this suite.
  })

  /* ============ #9 the request ============ */

  it('#9 a capacity request: handlers only, above the current capacity and ≤ 30, one pending per kind; readable by the requester and the lead, not bcb; the lead is told with ids only', async () => {
    await expectP0403(bcb, 'ci_capacity_request_submit', { p_kind: 'capacity', p_reason: `${stamp} not a handler`, p_requested_capacity: 8 })
    const tooLow = await jsonRpc(lsb, 'ci_capacity_request_submit', { p_kind: 'capacity', p_reason: `${stamp} same as now`, p_requested_capacity: 6 })
    expect(tooLow.ok).toBe(false)
    const tooHigh = await jsonRpc(lsb, 'ci_capacity_request_submit', { p_kind: 'capacity', p_reason: `${stamp} too many`, p_requested_capacity: 31 })
    expect(tooHigh.ok).toBe(false)
    const out = await jsonRpc(lsb, 'ci_capacity_request_submit', { p_kind: 'capacity', p_reason: `${stamp} two more sources on Tidewater`, p_requested_capacity: 8, p_operational_need: `${stamp} operational need` })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    requestId = String(out.id)
    const dup = await jsonRpc(lsb, 'ci_capacity_request_submit', { p_kind: 'capacity', p_reason: `${stamp} again`, p_requested_capacity: 9 })
    expect(dup.ok).toBe(false)
    expect(await ctx(lsb)).toMatchObject({ pending_requests: 1 })
    const mine = await lsb.from('ci_capacity_requests').select('id, kind, status, current_count, requested_capacity, requester_id').eq('id', requestId).maybeSingle()
    expect(mine.error, mine.error?.message).toBeNull()
    expect(mine.data).toMatchObject({ kind: 'capacity', status: 'pending', current_count: 6, requested_capacity: 8, requester_id: ids.lsb })
    const forLead = await lead.from('ci_capacity_requests').select('id').eq('id', requestId).maybeSingle()
    expect(forLead.error, forLead.error?.message).toBeNull()
    expect(forLead.data?.id).toBe(requestId)
    const forBcb = await bcb.from('ci_capacity_requests').select('id').eq('id', requestId)
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data ?? []).toEqual([])
    // The reviewer (the MCB Bureau Lead) is told; the payload is ids only.
    const told = await lead.from('notifications').select('type, payload').eq('type', 'ci_capacity_request').order('created_at', { ascending: false }).limit(10)
    expect(told.error, told.error?.message).toBeNull()
    const n = (told.data ?? []).find((x) => (x.payload as Json)?.request_id === requestId)
    expect(n, 'ci_capacity_request to the Bureau Lead').toBeTruthy()
    for (const k of Object.keys(n!.payload as Json)) expect(['request_id', 'actor_id', 'actor_name']).toContain(k)
    const notBcb = await bcb.from('notifications').select('id').eq('type', 'ci_capacity_request')
    expect(notBcb.error, notBcb.error?.message).toBeNull()
    expect(notBcb.data ?? []).toEqual([])
    // The audit row (ci_id null) is the requester's to read.
    const audit = await lsb.rpc('ci_audit_list', {})
    expect(audit.error, audit.error?.message).toBeNull()
    expect(((audit.data ?? []) as Json[]).some((a) => a.action === 'CI_CAPACITY_REQUESTED' && a.entity_id === requestId)).toBe(true)
  })

  /* ============ #10 the approval ============ */

  it('#10 deciding is full-only; a denial needs a note; approval writes the override (8, request_id), audits CI_CAPACITY_CHANGED, tells the requester, and ci_context().capacity is 8', async () => {
    await expectP0403(lsb, 'ci_capacity_request_decide', { p_request: requestId, p_decision: 'approved' })
    await expectP0403(bcb, 'ci_capacity_request_decide', { p_request: requestId, p_decision: 'approved' })
    const noNote = await jsonRpc(lead, 'ci_capacity_request_decide', { p_request: requestId, p_decision: 'denied' })
    expect(noNote.ok).toBe(false)
    const out = await jsonRpc(lead, 'ci_capacity_request_decide', { p_request: requestId, p_decision: 'approved', p_note: `${stamp} approved for Tidewater` })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    const again = await jsonRpc(lead, 'ci_capacity_request_decide', { p_request: requestId, p_decision: 'approved' })
    expect(again.ok).toBe(false)
    const req = await lsb.from('ci_capacity_requests').select('status, decided_by, decision_note').eq('id', requestId).single()
    expect(req.error, req.error?.message).toBeNull()
    expect(req.data).toMatchObject({ status: 'approved', decided_by: ids.lead })
    const cap = await lsb.from('ci_handler_capacity').select('user_id, limit_override, request_id, approved_by').eq('user_id', ids.lsb).maybeSingle()
    expect(cap.error, cap.error?.message).toBeNull()
    expect(cap.data).toMatchObject({ user_id: ids.lsb, limit_override: 8, request_id: requestId, approved_by: ids.lead })
    const forBcb = await bcb.from('ci_handler_capacity').select('user_id')
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data ?? []).toEqual([])
    expect(await ctx(lsb)).toMatchObject({ active_count: 6, capacity: 8, pending_requests: 0 })
    const told = await lsb.from('notifications').select('type, payload').eq('type', 'ci_request_decided').order('created_at', { ascending: false }).limit(10)
    expect(told.error, told.error?.message).toBeNull()
    expect((told.data ?? []).some((x) => (x.payload as Json)?.request_id === requestId)).toBe(true)
    const audit = await lsb.rpc('ci_audit_list', {})
    expect(audit.error, audit.error?.message).toBeNull()
    const actions = ((audit.data ?? []) as Json[]).map((a) => a.action)
    expect(actions).toContain('CI_CAPACITY_CHANGED')
    expect(actions).toContain('CI_CAPACITY_REQUEST_DECIDED')
  })

  /* ============ #11 seven and eight ============ */

  it('#11 with capacity 8 the handler recruits #7 and #8; #9 is refused with (8 / 8)', async () => {
    for (let i = 0; i < 2; i++) {
      const out = await recruit()
      expect(out.ok, JSON.stringify(out)).toBe(true)
      cis.push(String(out.id))
    }
    expect(await ctx(lsb)).toMatchObject({ active_count: 8, capacity: 8 })
    const ninth = await recruit()
    expect(ninth).toEqual({ ok: false, code: 'capacity', message: SELF_AT_CAPACITY(8, 8) })
    const named = await recruit(lead)
    expect(named.code).toBe('capacity')
    expect(String(named.message)).toMatch(NAMED_AT_CAPACITY(8, 8))
  })

  /* ============ #12 the override ============ */

  it('#12 the lead\'s override with p_override_reason at 8 / 8 succeeds, CI_CAPACITY_OVERRIDE carries the reason in ci_audit_list, the limit is 9; ci_capacity_set is full-only and null returns the handler to 6', async () => {
    const reason = `${stamp} Operation Tidewater needs the ninth source`
    // The handler cannot override themselves — the reason is ignored for a non-full caller.
    const self = await recruit(lsb, { p_override_reason: reason })
    expect(self).toEqual({ ok: false, code: 'capacity', message: SELF_AT_CAPACITY(8, 8) })
    const out = await recruit(lead, { p_override_reason: reason })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    const ninth = String(out.id)
    cis.push(ninth)
    expect(await ctx(lsb)).toMatchObject({ active_count: 9, capacity: 9 })
    const cap = await lsb.from('ci_handler_capacity').select('limit_override, reason, approved_by').eq('user_id', ids.lsb).single()
    expect(cap.error, cap.error?.message).toBeNull()
    expect(cap.data).toMatchObject({ limit_override: 9, approved_by: ids.lead })
    const audit = await lsb.rpc('ci_audit_list', { p_ci: ninth })
    expect(audit.error, audit.error?.message).toBeNull()
    const override = ((audit.data ?? []) as Json[]).find((a) => a.action === 'CI_CAPACITY_OVERRIDE')
    expect(override, 'CI_CAPACITY_OVERRIDE recorded for the ninth CI').toBeTruthy()
    expect(JSON.stringify(override!.detail)).toContain(reason)
    expect(override!.actor_id).toBe(ids.lead)
    // The normal detective reads none of this.
    const forBcb = await bcb.rpc('ci_audit_list', { p_ci: ninth })
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data ?? []).toEqual([])
    // Direct capacity setting is command's; null is "back to the default".
    await expectP0403(lsb, 'ci_capacity_set', { p_user: ids.lsb, p_limit: 12, p_reason: `${stamp} self-serve` })
    const reset = await jsonRpc(lead, 'ci_capacity_set', { p_user: ids.lsb, p_limit: null, p_reason: `${stamp} leg done` })
    expect(reset.ok, JSON.stringify(reset)).toBe(true)
    expect(await ctx(lsb)).toMatchObject({ active_count: 9, capacity: 6 })
    // A client INSERT into the override table is refused (42501).
    const forged = await lsb.from('ci_handler_capacity').insert({ user_id: ids.lsb, limit_override: 30, reason: stamp, approved_by: ids.lsb }).select('user_id')
    expect(forged.error).not.toBeNull()
    expect(forged.error!.code).toBe('42501')
  })
})

/** v1.38 — Joint / JTF Operations: operation-scoped joint access
 *  (migration 20260810120000_jtf_operations).
 *
 *  The wall under test: a case linked to an ACTIVE JTF operation is readable
 *  (and child rows with it) by active members of the operation's
 *  participating bureaus — and by NOBODY else, for NO other case. One new
 *  branch in private.can_access_case/can_access_case_row
 *  (private.has_op_joint_access); link/unlink is validated + historized by
 *  the trg_sync_case_operation_link trigger; JTF lifecycle is RPC-only.
 *
 *  Pins (§authorization matrix):
 *   - baseline: an unlinked MCB case is invisible to the SCB detective;
 *   - direct inserts are guarded: a detective-created operation is stamped
 *     normal + creator's bureau, and op_type/lead_bureau cannot be set or
 *     changed by direct writes (column freeze);
 *   - operation_convert_to_jtf is command-only (detective call rejected);
 *   - after conversion (MCB lead, MCB+SCB participants) and the creator
 *     linking their case: the SCB detective CAN read the linked MCB case and
 *     its reports — and still CANNOT read the unlinked sibling MCB case;
 *   - a same-bureau NON-managing detective (target, MCB) cannot link a case
 *     they neither lead nor created (trigger rejects);
 *   - the SCB detective links their OWN SCB case (creator authority) without
 *     any lead-bureau involvement;
 *   - search_all follows the wall (SECURITY INVOKER): the linked case is
 *     findable by the SCB detective, the unlinked one is not;
 *   - RESOLUTION: status → resolved ends SCB's access but KEEPS
 *     cases.operation_id, the active link rows, and was_jtf (historical
 *     joint marker survives closure);
 *   - MANUAL REMOVAL (after reactivation): unlinking stamps removed_at/by
 *     and access ends, but the was_jtf history row remains;
 *   - STRICTER WALLS: a legal-request draft on the linked case stays
 *     invisible to the op-joint SCB viewer (can_view_legal_request is its
 *     own wall — JTF access never overrides it).
 *
 *  Fixtures (tests/rls/README.md): lsb (MCB detective, case creator), bcb
 *  (SCB detective), target (throwaway MCB detective — the non-managing
 *  linker), lead (MCB bureau_lead), director (major_crimes director — command for
 *  conversion/lifecycle). rls_test_cleanup() runs at start AND teardown; the
 *  20260810120000 re-emit sweeps test-created operations too (bureau/link
 *  children cascade). Requires migration 20260810120000 applied. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  target: process.env.RLS_TEST_PASSWORD_TARGET,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.target)
if (!enabled) console.warn('[rls:v138] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.38 — JTF operations: operation-scoped joint access (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, target: C
  let targetId = ''
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let opId = ''       // the operation under test (director-created)
  let caseAId = ''    // MCB case, linked to the op
  let caseBId = ''    // MCB case, NEVER linked — the isolation control
  let caseCId = ''    // SCB case, linked by its own creator
  let reportId = ''   // report on case A — child-resource pin
  let legalId = ''    // legal draft on case A — stricter-wall pin

  const resetTarget = (role: string, division: string) =>
    director.rpc('rls_test_reset_member', {
      p_target: targetId, p_role: role, p_division: division, p_active: true,
    })

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); target = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [target, 'rls-test-target@cidportal.test', PW.target, 'target'],
    ] as const) {
      const id = await signInWithRetry(client, email, pw!)
      if (key === 'target') targetId = id
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const base = await resetTarget('detective', 'major_crimes')
    if (base.error) throw new Error(`target baseline failed: ${base.error.message}`)

    // Fixture cases: two MCB (creator: lsb), one SCB (creator: bcb).
    const a = await lsb.from('cases')
      .insert({ case_number: `V138A-${tag}`, title: '[rls-test] v138 linked case', bureau: 'major_crimes' })
      .select('id')
    if (a.error) throw new Error(`case A: ${a.error.message}`)
    caseAId = a.data![0].id
    const b = await lsb.from('cases')
      .insert({ case_number: `V138B-${tag}`, title: '[rls-test] v138 unlinked case', bureau: 'major_crimes' })
      .select('id')
    if (b.error) throw new Error(`case B: ${b.error.message}`)
    caseBId = b.data![0].id
    const c = await bcb.from('cases')
      .insert({ case_number: `V138C-${tag}`, title: '[rls-test] v138 bcb case', bureau: 'street_crimes' })
      .select('id')
    if (c.error) throw new Error(`case C: ${c.error.message}`)
    caseCId = c.data![0].id

    // A child report on case A (author: lsb) for the child-resource pin.
    const r = await lsb.from('reports')
      .insert({ case_id: caseAId, template: 'incident', fields: { note: '[rls-test] v138' } })
      .select('id')
    if (r.error) throw new Error(`report: ${r.error.message}`)
    reportId = r.data![0].id

    // The operation under test — director-created, then converted.
    const o = await director.from('operations')
      .insert({ name: `[rls-test] v138 Black Cross ${tag}`, description: 'JTF wall test' })
      .select('id, op_type, bureau')
    if (o.error) throw new Error(`operation: ${o.error.message}`)
    opId = o.data![0].id
  })

  afterAll(async () => {
    if (!lsb) return
    if (director && targetId) await resetTarget('detective', 'major_crimes')
    // Cleanup sweeps rls-test cases AND operations (20260810120000 re-emit);
    // operation_bureaus / operation_case_links cascade with their parents.
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v138] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, director, target].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── 0. baseline + direct-write guards ─────────────────────────────────── */

  it('baseline: the SCB detective cannot see either MCB case', async () => {
    for (const id of [caseAId, caseBId]) {
      const r = await bcb.from('cases').select('id').eq('id', id)
      expect(r.error).toBeNull()
      expect(r.data ?? []).toHaveLength(0)
    }
  })

  it('a detective-created operation is stamped normal + creator bureau; jtf fields cannot be set directly', async () => {
    const ins = await lsb.from('operations')
      .insert({ name: `[rls-test] v138 det op ${tag}`, op_type: 'jtf', lead_bureau: 'major_crimes' })
      .select('id, op_type, bureau, lead_bureau')
    expect(ins.error).toBeNull()
    // Guard: direct insert can never mint a JTF op or a lead bureau.
    expect(ins.data![0]).toMatchObject({ op_type: 'normal', bureau: 'major_crimes', lead_bureau: null })
  })

  it('operation_convert_to_jtf is command-only', async () => {
    const r = await lsb.rpc('operation_convert_to_jtf', {
      p_op: opId, p_lead: 'major_crimes', p_bureaus: ['major_crimes', 'street_crimes'],
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/command/i)
  })

  /* ── 1. conversion + linking ───────────────────────────────────────────── */

  it('director converts to JTF (MCB lead, MCB+SCB); participation rows appear', async () => {
    const r = await director.rpc('operation_convert_to_jtf', {
      p_op: opId, p_lead: 'major_crimes', p_bureaus: ['major_crimes', 'street_crimes'],
    })
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ op_type: 'jtf', lead_bureau: 'major_crimes' })
    const parts = await lsb.from('operation_bureaus')
      .select('bureau, left_at').eq('operation_id', opId).is('left_at', null)
    expect(parts.error).toBeNull()
    expect((parts.data ?? []).map((x) => x.bureau).sort()).toEqual(['street_crimes', 'major_crimes'])
  })

  it('a non-managing same-bureau detective cannot link someone else’s case', async () => {
    // target is an MCB detective with bureau access to case B, but is neither
    // its lead nor creator nor command — the sync trigger rejects the link.
    const r = await target.from('cases').update({ operation_id: opId }).eq('id', caseBId).select('id')
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/joint-case management authority/i)
  })

  it('the case creator links case A; the link row is active and was_jtf', async () => {
    const r = await lsb.from('cases').update({ operation_id: opId }).eq('id', caseAId).select('id, operation_id')
    expect(r.error).toBeNull()
    expect(r.data![0].operation_id).toBe(opId)
    const l = await lsb.from('operation_case_links')
      .select('was_jtf, removed_at').eq('operation_id', opId).eq('case_id', caseAId)
    expect(l.error).toBeNull()
    expect(l.data).toHaveLength(1)
    expect(l.data![0]).toMatchObject({ was_jtf: true, removed_at: null })
  })

  /* ── 2. the wall: operation-scoped access ──────────────────────────────── */

  it('the SCB detective now reads the LINKED case A — and its reports', async () => {
    const r = await bcb.from('cases').select('id, case_number, bureau').eq('id', caseAId)
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(1)
    expect(r.data![0].bureau).toBe('major_crimes') // ownership never moved
    const rep = await bcb.from('reports').select('id').eq('id', reportId)
    expect(rep.error).toBeNull()
    expect(rep.data).toHaveLength(1)
  })

  it('the unlinked sibling case B stays invisible (never bureau-wide)', async () => {
    const r = await bcb.from('cases').select('id').eq('id', caseBId)
    expect(r.error).toBeNull()
    expect(r.data ?? []).toHaveLength(0)
  })

  it('search_all follows the same wall for the SCB viewer', async () => {
    const hitA = await bcb.rpc('search_all', { q: `V138A-${tag}` })
    expect(hitA.error).toBeNull()
    expect((hitA.data ?? []).some((x: { kind: string; id: string }) => x.kind === 'case' && x.id === caseAId)).toBe(true)
    const hitB = await bcb.rpc('search_all', { q: `V138B-${tag}` })
    expect(hitB.error).toBeNull()
    expect((hitB.data ?? []).some((x: { id: string }) => x.id === caseBId)).toBe(false)
  })

  it('the SCB creator adds their OWN case without lead-bureau involvement', async () => {
    const r = await bcb.from('cases').update({ operation_id: opId }).eq('id', caseCId).select('id, operation_id')
    expect(r.error).toBeNull()
    expect(r.data![0].operation_id).toBe(opId)
    // Now the MCB detective (participating bureau) can read the SCB case.
    const x = await lsb.from('cases').select('id').eq('id', caseCId)
    expect(x.error).toBeNull()
    expect(x.data).toHaveLength(1)
  })

  /* ── 3. stricter walls stay stricter ───────────────────────────────────── */

  it('a legal-request draft on the linked case stays invisible to the op-joint viewer', async () => {
    const d = await lsb.rpc('create_legal_request', {
      p_case: caseAId, p_request_type: 'warrant', p_subtype: 'search_warrant',
      p_title: `[rls-test] v138 draft ${tag}`, p_priority: 'Medium',
      p_narrative: 'JTF must not widen the legal wall.',
      p_form: { search_targets: 'RLS test locker 138' },
    })
    expect(d.error).toBeNull()
    legalId = d.data!.id as string
    const r = await bcb.from('legal_requests').select('id').eq('id', legalId)
    expect(r.error).toBeNull()
    expect(r.data ?? []).toHaveLength(0)
  })

  /* ── 4. closure: access ends, history survives ─────────────────────────── */

  it('resolving the operation ends cross-bureau access but keeps links + markers', async () => {
    const up = await director.from('operations').update({ status: 'resolved' }).eq('id', opId).select('status, resolved_at')
    expect(up.error).toBeNull()
    expect(up.data![0].status).toBe('resolved')
    expect(up.data![0].resolved_at).not.toBeNull()

    // Access OFF for the participating-bureau viewer…
    const r = await bcb.from('cases').select('id').eq('id', caseAId)
    expect(r.error).toBeNull()
    expect(r.data ?? []).toHaveLength(0)

    // …but the relationship + historical joint marker are UNTOUCHED.
    const c = await lsb.from('cases').select('operation_id').eq('id', caseAId)
    expect(c.data![0].operation_id).toBe(opId)
    const l = await lsb.from('operation_case_links')
      .select('was_jtf, removed_at').eq('operation_id', opId).eq('case_id', caseAId)
    expect(l.data).toHaveLength(1)
    expect(l.data![0]).toMatchObject({ was_jtf: true, removed_at: null })
  })

  it('no NEW links while resolved; reactivation restores access', async () => {
    const no = await lsb.from('cases').update({ operation_id: opId }).eq('id', caseBId).select('id')
    expect(no.error).not.toBeNull()
    expect(no.error!.message).toMatch(/active/i)

    const up = await director.from('operations').update({ status: 'active' }).eq('id', opId).select('status')
    expect(up.error).toBeNull()
    const r = await bcb.from('cases').select('id').eq('id', caseAId)
    expect(r.data).toHaveLength(1)
  })

  /* ── 5. manual removal: access ends, participation history survives ────── */

  it('unlinking stamps the history row and ends operation-derived access', async () => {
    const un = await lsb.from('cases').update({ operation_id: null }).eq('id', caseAId).select('operation_id')
    expect(un.error).toBeNull()
    expect(un.data![0].operation_id).toBeNull()

    const l = await lsb.from('operation_case_links')
      .select('was_jtf, removed_at, removed_by').eq('operation_id', opId).eq('case_id', caseAId)
    expect(l.data).toHaveLength(1)
    expect(l.data![0].was_jtf).toBe(true)         // permanent historical marker
    expect(l.data![0].removed_at).not.toBeNull()  // participation window closed
    expect(l.data![0].removed_by).not.toBeNull()

    const r = await bcb.from('cases').select('id').eq('id', caseAId)
    expect(r.error).toBeNull()
    expect(r.data ?? []).toHaveLength(0)
  })

  /* ── 6. lifecycle guard rails ──────────────────────────────────────────── */

  it('direct updates cannot flip a JTF operation back to normal (column freeze)', async () => {
    const up = await director.from('operations').update({ op_type: 'normal', lead_bureau: 'street_crimes' }).eq('id', opId).select('op_type, lead_bureau')
    expect(up.error).toBeNull()
    expect(up.data![0]).toMatchObject({ op_type: 'jtf', lead_bureau: 'major_crimes' })
  })

  it('a plain detective cannot update a JTF operation at all (RLS)', async () => {
    const up = await lsb.from('operations').update({ description: 'detective edit' }).eq('id', opId).select('id')
    expect(up.error).toBeNull()
    expect(up.data ?? []).toHaveLength(0) // policy filtered — nothing updated
  })

  it('removing a bureau with linked cases is refused; after unlink it succeeds and history stays', async () => {
    const no = await director.rpc('operation_remove_bureau', { p_op: opId, p_bureau: 'street_crimes' })
    expect(no.error).not.toBeNull()
    expect(no.error!.message).toMatch(/linked case/i)

    const un = await bcb.from('cases').update({ operation_id: null }).eq('id', caseCId)
    expect(un.error).toBeNull()
    const ok = await director.rpc('operation_remove_bureau', { p_op: opId, p_bureau: 'street_crimes', p_reason: 'v138 teardown' })
    expect(ok.error).toBeNull()
    const hist = await lsb.from('operation_bureaus')
      .select('bureau, left_at').eq('operation_id', opId).eq('bureau', 'street_crimes')
    expect(hist.error).toBeNull()
    expect(hist.data).toHaveLength(1)
    expect(hist.data![0].left_at).not.toBeNull() // history kept, not deleted
  })
})

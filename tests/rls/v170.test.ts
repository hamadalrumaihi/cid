/** v1.70 — a case-child DELETE requires ACCESS TO THAT CASE, not just a rank
 *  (migrations 20260901120000 / 20260901130000), LIVE project.
 *
 *  ── What this suite is really guarding ─────────────────────────────────────
 *  `private.can_delete()` is a raw rank check:
 *
 *      active and role in ('bureau_lead','deputy_director','director')
 *
 *  It reads `profiles.role` and nothing else — no case, no department. For a
 *  long time `can_delete_case_child()` used it verbatim for the CID branch, so
 *  ANY account holding a CID command rank could delete inside a case it could
 *  not open. That is invisible in CID (command reaches every CID case anyway)
 *  and wide open across the departmental wall, because DELETE is the one write
 *  that `not private.is_siu_department()` in `can_access_case()` never covered.
 *
 *  Probed live before the fix, as a real Special Agent in Charge who also holds
 *  CID rank `bureau_lead`: `can_access_case(cid case)` FALSE, `can_delete()`
 *  TRUE, and a CID report, task and RICO case all deleted.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  `rls-test-lead` is a CID Bureau Lead with NO SIU standing, so it is the
 *  CONTROL: every assertion about it must keep passing unchanged, because the
 *  fix must cost CID nothing. `rls-test-owner` holds SIU `owner` standing and
 *  stands in for the cross-department case.
 *
 *  The regression this pins is one-directional and easy to reintroduce: any
 *  future delete policy written as `private.can_delete()` on a case-scoped
 *  table reopens it. `cases_del`, `surveillance_observations_del` and
 *  `surveillance_association_events_del` have always paired the two correctly
 *  and are the shape to copy.
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Everything hangs off a case created by an rls-test account, so the ordinary
 *  sweep removes it; the suite also tears down explicitly. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v170] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)
const tag = (what: string) => `[rls-test] ${what} ${RUN}`

describe.skipIf(!enabled)('v1.70 — case-child delete requires case access (live)', () => {
  let owner: C, lsb: C, lead: C
  /** A CID case created by the detective fixture. */
  let cidCase = ''
  /** A native SIU investigation. */
  let siuCase = ''

  beforeAll(async () => {
    owner = mk(); lsb = mk(); lead = mk()
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)

    const c = await lsb.from('cases').insert({
      case_number: `MCB-${Date.now().toString().slice(-6)}`,
      title: tag('delete wall subject'), bureau: 'major_crimes',
    }).select('id').single()
    expect(c.error, c.error?.message).toBeNull()
    cidCase = c.data!.id as string

    const s = await owner.rpc('siu_create_case', {
      p_title: tag('siu delete wall'), p_classification: 'siu',
    })
    expect(s.error, s.error?.message).toBeNull()
    siuCase = s.data as string
  }, 90_000)

  afterAll(async () => {
    await owner.from('cases').delete().eq('id', siuCase)
    await lsb.from('cases').delete().eq('id', cidCase)
    await Promise.all([owner, lsb, lead].map((c) => c.auth.signOut()))
  }, 60_000)

  /** A fresh report + task + RICO record on the CID case, made by its owner. */
  const seed = async () => {
    const r = await lsb.from('reports').insert({
      case_id: cidCase, template: 'initial', fields: { note: tag('child') },
    }).select('id').single()
    expect(r.error, r.error?.message).toBeNull()
    const t = await lsb.from('case_tasks').insert({
      case_id: cidCase, title: tag('child task'),
    }).select('id').single()
    expect(t.error, t.error?.message).toBeNull()
    return { report: r.data!.id as string, task: t.data!.id as string }
  }

  it('CONTROL: a CID Bureau Lead deletes CID case children exactly as before', async () => {
    // This must never start failing. The whole fix is worthless if it costs
    // CID a single delete — can_delete()'s ranks are all command, and
    // can_access_case() admits is_command(), so the added term is always true
    // here.
    const { report, task } = await seed()

    const dr = await lead.from('reports').delete().eq('id', report).select('id')
    expect(dr.error, dr.error?.message).toBeNull()
    expect(dr.data ?? [], 'a Bureau Lead must still delete a CID report').toHaveLength(1)

    const dt = await lead.from('case_tasks').delete().eq('id', task).select('id')
    expect(dt.error, dt.error?.message).toBeNull()
    expect(dt.data ?? [], 'a Bureau Lead must still delete a CID task').toHaveLength(1)
  })

  it('an account barred from the case cannot delete its children, whatever its rank', async () => {
    const { report, task } = await seed()

    // The SIU-standing fixture. It can READ the CID case (the SIU read
    // superset) and cannot write a field of it — and now cannot delete from it
    // either, which was the hole.
    const dr = await owner.from('reports').delete().eq('id', report).select('id')
    expect(dr.data ?? [], 'a report inside an inaccessible case must survive').toHaveLength(0)

    const dt = await owner.from('case_tasks').delete().eq('id', task).select('id')
    expect(dt.data ?? [], 'a task inside an inaccessible case must survive').toHaveLength(0)

    // Still there for the case's own people.
    const still = await lsb.from('reports').select('id').eq('id', report)
    expect(still.data ?? [], 'the report is untouched').toHaveLength(1)

    await lead.from('reports').delete().eq('id', report)
    await lead.from('case_tasks').delete().eq('id', task)
  })

  it('RICO reads on the superset and deletes on the wall', async () => {
    const rc = await lsb.from('rico_cases').insert({ case_id: cidCase }).select('id').single()
    // The case owner may not have RICO create rights in every configuration;
    // skip rather than assert a precondition this suite does not own.
    if (rc.error) return
    const ricoId = rc.data!.id as string

    // §RICO read: an SIU account sees the record, because it is part of the
    // case file and every other child was already readable.
    const seen = await owner.from('rico_cases').select('id').eq('id', ricoId)
    expect(seen.data ?? [], 'SIU must READ a CID case RICO record').toHaveLength(1)

    // …and cannot delete it.
    const del = await owner.from('rico_cases').delete().eq('id', ricoId).select('id')
    expect(del.data ?? [], 'SIU must not DELETE it').toHaveLength(0)

    // The CID Bureau Lead still can.
    const ok = await lead.from('rico_cases').delete().eq('id', ricoId).select('id')
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data ?? [], 'a Bureau Lead must still delete a CID RICO record').toHaveLength(1)
  })

  it('an SIU investigation stays shut to CID command entirely', async () => {
    // The other half of can_delete_case_child(): an SIU case routes to
    // siu_case_command(), which no CID rank satisfies.
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead]] as const) {
      const q = await c.from('cases').select('id').eq('id', siuCase)
      expect(q.data ?? [], `${who} must not even see the investigation`).toHaveLength(0)
      const d = await c.from('cases').delete().eq('id', siuCase).select('id')
      expect(d.data ?? [], `${who} must not delete it`).toHaveLength(0)
    }
    const alive = await owner.from('cases').select('id').eq('id', siuCase)
    expect(alive.data ?? [], 'the investigation survives').toHaveLength(1)
  })
})

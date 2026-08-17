/** v1.73 — an unpublished Penal Code draft is not readable by the force
 *  (migrations 20260904130000 / 20260904140000), LIVE project.
 *
 *  ── What was actually wrong ────────────────────────────────────────────────
 *  20260904120000 gated penal_charges on version status and, by omission,
 *  gated nothing else. The three reference tables carried
 *
 *      using (private.is_active() or private.penal_is_admin())
 *
 *  with no version test at all. While those tables were empty the gap had
 *  nothing to leak and read exactly like a working gate; importing the 2026
 *  code filled them, and a role-simulation probe as an ordinary detective
 *  returned charges=0 -- correct -- next to schedules=3, rules=36, limits=1
 *  from the same unpublished draft.
 *
 *  This is a disclosure, not an inconvenience. These tables sit on PostgREST
 *  like any other, so the UI declining to render a draft proves nothing; the
 *  rules carry the plea, court and hard-limit text and the schedules say which
 *  substance sits in which tier, which is the input to a narcotics charging
 *  decision. A draft is law that is not in force, and an officer charging from
 *  one has charged from something that is not the law.
 *
 *  ── The rules worth a regression test ──────────────────────────────────────
 *    * A draft version is invisible to an ordinary member across ALL FOUR
 *      content tables, not just charges. Asserting only charges is what let
 *      this through the first time.
 *    * The gate OPENS on publish. A gate that never opens is a different bug
 *      wearing the same green tick, so the published case is asserted too.
 *    * A charge whose own lifecycle is 'draft' stays out of the selector even
 *      from a published version -- that is what holds the two codeless
 *      possession charges back until a code is assigned.
 *    * penal_current_charges() and penal_current_reference() are the read
 *      surface and must agree with the table policies, not soften them.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  `rls-test-lsb` is an ordinary CID detective with no Penal Code standing --
 *  the reader the gate exists for. `rls-test-owner` is the owner and therefore
 *  passes private.penal_is_admin(), so it plays the administrator who is
 *  supposed to be able to review a draft before publishing it.
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Non-destructive and self-cleaning. The suite creates its OWN throwaway
 *  version and writes only into it; it never publishes, alters or reads
 *  through the real 'Odyssey RP Penal Code 2026' row, so a genuine publish
 *  cannot be caused by running the tests. Charges, schedules, rules and limits
 *  cascade from the version, which is deleted in afterAll. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.owner)
if (!enabled) console.warn('[rls:v173] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)

describe.skipIf(!enabled)('v1.73 — the draft Penal Code stays unpublished (live)', () => {
  let owner: C, lsb: C
  let versionId = ''

  beforeAll(async () => {
    owner = mk(); lsb = mk()
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)

    // A throwaway version of our own. Never the real one: publishing the real
    // code from a test would change the law in force.
    const v = await owner.from('penal_code_versions').insert({
      name: `[rls-test] draft gate ${RUN}`,
      effective_date: '2099-01-01',
      source_file: 'v173.test.ts',
      status: 'draft',
    }).select('id').single()
    expect(v.error, v.error?.message).toBeNull()
    versionId = v.data!.id as string

    const seeded = await Promise.all([
      owner.from('penal_charges').insert([
        { version_id: versionId, code: '9901', offense: `[rls-test] live charge ${RUN}`, charge_class: 'Felony', lifecycle: 'active' },
        { version_id: versionId, offense: `[rls-test] codeless charge ${RUN}`, charge_class: 'Felony', lifecycle: 'draft', needs_code: true },
      ]),
      owner.from('penal_substance_schedules').insert({ version_id: versionId, schedule: 1, substances: `[rls-test] ${RUN}` }),
      owner.from('penal_rules').insert({ version_id: versionId, section: 'Hard limits', ordinal: 1, body: `[rls-test] ${RUN}` }),
      owner.from('penal_limits').insert({ version_id: versionId, max_total_months: 200 }),
    ])
    for (const r of seeded) expect(r.error, r.error?.message).toBeNull()
  }, 90_000)

  afterAll(async () => {
    // Charges, schedules, rules and limits cascade from the version.
    if (versionId) await owner.from('penal_code_versions').delete().eq('id', versionId)
    await Promise.all([owner, lsb].map((c) => c.auth.signOut()))
  }, 60_000)

  const countFor = async (c: C, table: string) => {
    const r = await c.from(table).select('*', { count: 'exact', head: true }).eq('version_id', versionId)
    expect(r.error, r.error?.message).toBeNull()
    return r.count ?? 0
  }

  /* ------------------------------------------------- while it is a draft */

  it('hides a draft version itself from an ordinary member', async () => {
    const r = await lsb.from('penal_code_versions').select('id').eq('id', versionId)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toHaveLength(0)
  })

  it('hides draft charges, schedules, rules AND limits — all four', async () => {
    // The bug was that only the first of these was gated. Each is asserted
    // separately so a future regression names the table it broke.
    expect(await countFor(lsb, 'penal_charges')).toBe(0)
    expect(await countFor(lsb, 'penal_substance_schedules')).toBe(0)
    expect(await countFor(lsb, 'penal_rules')).toBe(0)
    expect(await countFor(lsb, 'penal_limits')).toBe(0)
  })

  it('still shows the draft to a Penal Code administrator', async () => {
    // Otherwise the reviewer cannot review what they are being asked to publish.
    expect(await countFor(owner, 'penal_charges')).toBe(2)
    expect(await countFor(owner, 'penal_substance_schedules')).toBe(1)
    expect(await countFor(owner, 'penal_rules')).toBe(1)
    expect(await countFor(owner, 'penal_limits')).toBe(1)
  })

  it('refuses a member write to the code outright', async () => {
    const r = await lsb.from('penal_charges').insert({
      version_id: versionId, code: '9999', offense: `[rls-test] forged ${RUN}`, charge_class: 'Felony',
    })
    expect(r.error).not.toBeNull()
    expect(await countFor(owner, 'penal_charges')).toBe(2)
  })

  /* --------------------------------------------------- once it publishes */

  it('opens to the force on publish, and keeps codeless charges back', async () => {
    // penal_code_versions_one_published permits exactly one published version
    // at a time, so this test cannot publish its own while a real code is in
    // force. Both worlds are asserted rather than one of them skipped: a
    // suite that quietly does nothing under some conditions is how a gate
    // goes unverified for months while the tick stays green.
    const live = await owner.from('penal_code_versions')
      .select('id').eq('status', 'published').maybeSingle()
    expect(live.error, live.error?.message).toBeNull()

    if (live.data) {
      // A real code is in force. Assert the gate is OPEN on it, read-only.
      const realId = live.data.id as string
      const seen = await lsb.from('penal_code_versions').select('id').eq('id', realId)
      expect(seen.error, seen.error?.message).toBeNull()
      expect(seen.data).toHaveLength(1)
      for (const t of ['penal_substance_schedules', 'penal_rules', 'penal_limits']) {
        const r = await lsb.from(t).select('*', { count: 'exact', head: true }).eq('version_id', realId)
        expect(r.error, r.error?.message).toBeNull()
        expect(r.count ?? 0).toBeGreaterThan(0)
      }
      // And no charge of the published code reaches a member as a draft row.
      const drafts = await lsb.from('penal_charges')
        .select('id', { count: 'exact', head: true })
        .eq('version_id', realId).eq('lifecycle', 'draft')
      expect(drafts.error, drafts.error?.message).toBeNull()
      expect(drafts.count ?? 0).toBe(0)
      return
    }

    const pub = await owner.from('penal_code_versions')
      .update({ status: 'published' }).eq('id', versionId)
    expect(pub.error, pub.error?.message).toBeNull()

    try {
      expect(await countFor(lsb, 'penal_substance_schedules')).toBe(1)
      expect(await countFor(lsb, 'penal_rules')).toBe(1)
      expect(await countFor(lsb, 'penal_limits')).toBe(1)

      // Two charges exist; only the coded one is law. The codeless draft is
      // held back by the ROW's own lifecycle, independently of the version.
      const c = await lsb.from('penal_charges').select('code, offense').eq('version_id', versionId)
      expect(c.error, c.error?.message).toBeNull()
      expect(c.data).toHaveLength(1)
      expect(c.data![0].code).toBe('9901')
    } finally {
      // Back to draft whatever the assertions did, so a failure mid-test
      // cannot leave a published test version behind.
      await owner.from('penal_code_versions').update({ status: 'draft' }).eq('id', versionId)
    }
  })
})

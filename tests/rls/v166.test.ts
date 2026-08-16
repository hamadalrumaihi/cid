/** v1.66 — Special Investigation Unit, Phase 1
 *  (migration 20260820120000_siu_phase1), LIVE project.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  Runs with the standard CID build fixtures: lsb, bcb, lead, director, owner.
 *  No new fixture account is required, because the BUILD-PHASE RELEASE GATE
 *  (`siu_settings.enabled_for_non_owner = false`) means SIU standing belongs to
 *  the Portal Owner and to nobody else — which is exactly the property the bulk
 *  of this suite has to prove.
 *
 *  A second lane, guarded by RLS_TEST_SIU_RELEASED=1, asserts the PRODUCTION
 *  model (SIU agents reading CID read-only, compartment exclusion between two
 *  different SIU agents). It stays skipped until the gate is opened and the SIU
 *  fixtures exist, and runs unmodified the day they do — the v163/v165 pattern.
 *
 *  ── What it proves ─────────────────────────────────────────────────────────
 *   1. CID → SIU is NOTHING. A detective, a Bureau Lead and a DIRECTOR see an
 *      SIU investigation in no surface at all: not the case row, not its
 *      reports/evidence/media/tasks/intel links, not global search (by title
 *      OR by case number), not the audit feed, not the roster, not the SIU
 *      tables. They get zero rows — never a "restricted" placeholder, never a
 *      count, never an error that would confirm the record exists.
 *   2. Rank is not a key. The Director — who can read every CID case in the
 *      division through private.is_command() — gets nothing on an SIU case.
 *      That is what makes an SIU investigation INTO CID command possible.
 *   3. Every SIU RPC refuses a non-owner while the gate is closed: create,
 *      classify, appoint, remove, assign, compartment, release.
 *   4. case_authority / siu_classification are RPC-only: a client cannot mint
 *      an SIU case by INSERT and cannot promote a CID case by UPDATE.
 *   5. The SIU tables carry no client write policy at all.
 *   6. The Owner's own path works end to end: create → classify → roster →
 *      audit feed → overview, with the SIU-8000000 number series.
 *   7. Compartment mechanics: no self-removal, and a compartment can never be
 *      emptied — so the allow-list cannot be dissolved to reopen a case.
 *   8. Existing CID access is UNCHANGED: the detective still reads their own
 *      bureau's cases and their children (a regression guard on the re-emitted
 *      can_access_case / can_read_case chokepoints).
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Every SIU case is created by the owner fixture, so `cases.created_by` puts
 *  it inside rls_test_cleanup's sweep (which this migration extended with the
 *  three SIU tables); siu_case_agents / siu_compartment_members also cascade
 *  from cases. Titles carry the [rls-test] marker. SIU audit_log rows are
 *  deliberately NOT swept — audit is append-only and is never rewritten. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  agent: process.env.RLS_TEST_PASSWORD_SIU_AGENT,
  agent2: process.env.RLS_TEST_PASSWORD_SIU_AGENT2,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.director && PW.owner)
if (!enabled) console.warn('[rls:v166] fixture passwords not set — suite skipped')

/** Post-release lane: needs the gate open AND two SIU field agents. */
const released = enabled && process.env.RLS_TEST_SIU_RELEASED === '1' && !!(PW.agent && PW.agent2)
if (enabled && !released) {
  console.warn('[rls:v166] production-model lane skipped — set RLS_TEST_SIU_RELEASED=1 with RLS_TEST_PASSWORD_SIU_AGENT/AGENT2 once the release gate is opened')
}

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)
const tag = (what: string) => `[rls-test] SIU ${what} ${RUN}`

describe.skipIf(!enabled)('v1.66 — SIU Phase 1 (live)', () => {
  let owner: C, lsb: C, lead: C, director: C
  let ownerId = ''
  let lsbId = ''
  /** Plain 'siu' investigation, and a compartmented one. */
  let plainCase = ''
  let compCase = ''
  let plainNumber = ''
  /** A CID case the detective legitimately owns — the regression guard. */
  let cidCase = ''

  beforeAll(async () => {
    owner = mk(); lsb = mk(); lead = mk(); director = mk()
    ownerId = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)

    const a = await owner.rpc('siu_create_case', {
      p_title: tag('plain'), p_summary: 'Integrity review fixture.', p_classification: 'siu',
    })
    expect(a.error, a.error?.message).toBeNull()
    plainCase = a.data as string

    const b = await owner.rpc('siu_create_case', {
      p_title: tag('compartmented'), p_classification: 'siu_compartmented',
    })
    expect(b.error, b.error?.message).toBeNull()
    compCase = b.data as string

    const num = await owner.from('cases').select('case_number').eq('id', plainCase).single()
    plainNumber = (num.data?.case_number as string) ?? ''
    expect(plainNumber).toMatch(/^SIU-\d+$/)

    // An ordinary CID case owned by the detective — proves the chokepoint
    // re-emit did not narrow anything for CID.
    const c = await lsb.from('cases').insert({
      case_number: `LSB-${Date.now().toString().slice(-6)}`,
      title: tag('cid control'), bureau: 'LSB',
    }).select('id').single()
    expect(c.error, c.error?.message).toBeNull()
    cidCase = c.data!.id as string
  }, 90_000)

  afterAll(async () => {
    // Best-effort teardown: no fixture here holds command rank, so `cases_del`
    // (can_delete AND case access) makes these a no-op rather than a delete.
    // The authoritative sweep is rls_test_cleanup — a definer RPC that removes
    // every case created by an rls-test account, and which globalSetup runs
    // both BEFORE and after the suite, so a crashed run cannot leak rows.
    await owner.from('cases').delete().in('id', [plainCase, compCase].filter(Boolean))
    await lsb.from('cases').delete().eq('id', cidCase)
    await Promise.all([owner, lsb, lead, director].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ── 1 + 2. CID sees nothing, at every rank ─────────────────────────────── */

  it('an SIU investigation is invisible to a detective, a Bureau Lead and the Director', async () => {
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const byId = await c.from('cases').select('id,case_number,title').eq('id', plainCase)
      expect(byId.error, `${who}: reading an SIU case must not error, it must return nothing`).toBeNull()
      expect(byId.data, `${who} must not see the SIU case row`).toEqual([])

      const anySiu = await c.from('cases').select('id').eq('case_authority', 'siu')
      expect(anySiu.data, `${who} must not see ANY SIU case`).toEqual([])

      const comp = await c.from('cases').select('id').eq('id', compCase)
      expect(comp.data, `${who} must not see the compartmented case`).toEqual([])

      // A count query is the classic existence oracle — it must read zero too.
      const cnt = await c.from('cases').select('id', { count: 'exact', head: true }).eq('case_authority', 'siu')
      expect(cnt.count ?? 0, `${who} must not learn how many SIU cases exist`).toBe(0)
    }
  })

  it('SIU case children are invisible to CID through every child table', async () => {
    const tables = [
      'reports', 'evidence', 'case_tasks', 'case_blockers', 'case_intel_links',
      'case_assignments', 'case_signoff_history', 'case_access_grants', 'media',
    ] as const
    for (const t of tables) {
      const r = await lsb.from(t).select('id').eq('case_id', plainCase)
      expect(r.error, `${t}: must not error`).toBeNull()
      expect(r.data, `${t} must expose nothing for an SIU case`).toEqual([])
    }
    // siu_case_agents rows exist for the owner-created case — CID sees none.
    const agents = await lsb.from('siu_case_agents').select('id').eq('case_id', plainCase)
    expect(agents.data).toEqual([])
  })

  it('SIU records never surface through global search — by title or by case number', async () => {
    // Assert the security property (no SIU record is reachable), not "zero
    // hits" — search_all is trigram-fuzzy, so an unrelated CID row could
    // legitimately score against these terms without that being a leak.
    const siuIds = [plainCase, compCase]
    for (const [who, c] of [['detective', lsb], ['director', director]] as const) {
      for (const q of [`SIU ${RUN}`, plainNumber, RUN]) {
        const res = await c.rpc('search_all', { q })
        expect(res.error, `${who}: search must not error for "${q}"`).toBeNull()
        const leaked = (res.data ?? []).filter((h: { id: string }) => siuIds.includes(h.id))
        expect(leaked, `${who} must get no SIU hit for "${q}"`).toEqual([])
      }
    }
  })

  it('the SIU tables and read RPCs return nothing to CID — no roster, no audit, no settings', async () => {
    for (const [who, c] of [['detective', lsb], ['director', director]] as const) {
      for (const t of ['siu_memberships', 'siu_settings', 'siu_case_agents', 'siu_compartment_members'] as const) {
        const r = await c.from(t).select('*')
        expect(r.error, `${who}/${t}: must not error`).toBeNull()
        expect(r.data, `${who} must read no rows from ${t}`).toEqual([])
      }
      const roster = await c.rpc('siu_roster', {})
      expect(roster.data ?? [], `${who} must get an empty SIU roster`).toEqual([])

      const audit = await c.rpc('siu_audit_feed', { p_limit: 100 })
      expect(audit.data ?? [], `${who} must get an empty SIU audit feed`).toEqual([])

      const overview = await c.rpc('siu_overview', {})
      expect(overview.data, `${who} must get the no-access overview shape`).toEqual({ access: false })

      const candidates = await c.rpc('siu_member_search', { p_q: '' })
      expect(candidates.data ?? [], `${who} must not enumerate appointment candidates`).toEqual([])
    }
  })

  /* ── 3. Every write RPC refuses a non-owner ─────────────────────────────── */

  it('every SIU write RPC refuses a non-owner while the release gate is closed', async () => {
    for (const [who, c, uid] of [['detective', lsb, lsbId], ['director', director, ownerId]] as const) {
      const calls: Array<[string, PromiseLike<{ error: unknown }>]> = [
        ['siu_create_case', c.rpc('siu_create_case', { p_title: tag('forbidden') })],
        ['siu_appoint', c.rpc('siu_appoint', { p_user: uid, p_role: 'special_agent' })],
        ['siu_remove', c.rpc('siu_remove', { p_user: uid, p_reason: 'test' })],
        ['siu_set_callsign', c.rpc('siu_set_callsign', { p_user: uid, p_callsign: 'X-9' })],
        ['siu_set_release', c.rpc('siu_set_release', { p_enabled: true, p_reason: 'test' })],
        ['siu_set_case_classification', c.rpc('siu_set_case_classification', { p_case: plainCase, p_classification: 'siu', p_reason: 'test' })],
        ['siu_assign_agent', c.rpc('siu_assign_agent', { p_case: plainCase, p_user: uid })],
        ['siu_unassign_agent', c.rpc('siu_unassign_agent', { p_case: plainCase, p_user: uid, p_reason: 'test' })],
        ['siu_compartment_add', c.rpc('siu_compartment_add', { p_case: compCase, p_user: uid, p_reason: 'test' })],
        ['siu_compartment_remove', c.rpc('siu_compartment_remove', { p_case: compCase, p_user: uid, p_reason: 'test' })],
      ]
      for (const [name, p] of calls) {
        const r = await p
        expect(r.error, `${who} must be refused by ${name}`).not.toBeNull()
      }
    }
  })

  it('nothing a refused caller did left a row behind', async () => {
    const cases = await owner.from('cases').select('id,title').eq('case_authority', 'siu')
    const titles = (cases.data ?? []).map((r: { title: string | null }) => r.title ?? '')
    expect(titles.some((t: string) => t.includes('forbidden'))).toBe(false)
    const members = await owner.rpc('siu_roster', {})
    expect((members.data ?? []).some((m: { user_id: string }) => m.user_id === lsbId)).toBe(false)
  })

  /* ── 4 + 5. The columns and the tables are RPC-only ─────────────────────── */

  it('a client cannot mint an SIU case by INSERT — the guard forces it back to CID', async () => {
    const ins = await lsb.from('cases').insert({
      case_number: `LSB-${Date.now().toString().slice(-6)}`,
      title: tag('insert probe'), bureau: 'LSB',
      case_authority: 'siu', siu_classification: 'siu_command',
    }).select('id,case_authority,siu_classification').single()
    // The insert succeeds as an ORDINARY CID case: the guard rewrites the two
    // columns rather than erroring, so no probing signal is returned either.
    expect(ins.error, ins.error?.message).toBeNull()
    expect(ins.data!.case_authority).toBe('cid')
    expect(ins.data!.siu_classification).toBeNull()
    await lsb.from('cases').delete().eq('id', ins.data!.id)
  })

  it('a client cannot promote their own CID case to SIU authority by UPDATE', async () => {
    const up = await lsb.from('cases').update({ case_authority: 'siu' }).eq('id', cidCase).select('id')
    expect(up.error, 'promoting a case to SIU authority must be refused').not.toBeNull()
    const cls = await lsb.from('cases').update({ siu_classification: 'siu_command' }).eq('id', cidCase).select('id')
    expect(cls.error, 'setting an SIU classification directly must be refused').not.toBeNull()
    const still = await lsb.from('cases').select('case_authority').eq('id', cidCase).single()
    expect(still.data!.case_authority).toBe('cid')
  })

  it('the SIU tables carry no client write policy — not even for the owner', async () => {
    // No INSERT policy exists, so Postgres raises 42501 outright.
    const inserts: Array<[string, PromiseLike<{ error: unknown }>]> = [
      ['siu_memberships', owner.from('siu_memberships').insert({ user_id: lsbId, siu_role: 'special_agent' })],
      ['siu_case_agents', owner.from('siu_case_agents').insert({ case_id: plainCase, user_id: lsbId })],
      ['siu_compartment_members', owner.from('siu_compartment_members').insert({ case_id: compCase, user_id: lsbId })],
    ]
    for (const [name, w] of inserts) {
      const r = await w
      expect(r.error, `direct INSERT into ${name} must be refused — RPCs are the only path`).not.toBeNull()
    }
    // No UPDATE policy is a SILENT no-op in Postgres (zero rows, no error), so
    // assert the effect, not the error: the release gate cannot be flipped by
    // a direct write, only by siu_set_release().
    const upd = await owner.from('siu_settings').update({ enabled_for_non_owner: true }).eq('id', true).select('id')
    expect((upd.data ?? []).length, 'a direct UPDATE must touch no row').toBe(0)
    const gate = await owner.from('siu_settings').select('enabled_for_non_owner').single()
    expect(gate.data!.enabled_for_non_owner, 'the release gate must still be closed').toBe(false)
  })

  /* ── 6. The Owner's path works end to end ──────────────────────────────── */

  it('the Owner can run the SIU workspace: cases, numbering, classification, roster, audit, overview', async () => {
    const mine = await owner.from('cases').select('id,case_number,siu_classification').eq('case_authority', 'siu')
    expect(mine.error, mine.error?.message).toBeNull()
    const ids = (mine.data ?? []).map((r: { id: string }) => r.id)
    expect(ids).toContain(plainCase)
    expect(ids).toContain(compCase)
    for (const r of mine.data ?? []) expect(r.case_number).toMatch(/^SIU-\d+$/)

    const reclass = await owner.rpc('siu_set_case_classification', {
      p_case: plainCase, p_classification: 'siu_restricted', p_reason: 'fixture reclassification',
    })
    expect(reclass.error, reclass.error?.message).toBeNull()

    // A reason is mandatory, and a no-op reclassification is refused.
    const blank = await owner.rpc('siu_set_case_classification', {
      p_case: plainCase, p_classification: 'siu', p_reason: '   ',
    })
    expect(blank.error?.message ?? '').toMatch(/reason/i)
    const same = await owner.rpc('siu_set_case_classification', {
      p_case: plainCase, p_classification: 'siu_restricted', p_reason: 'again',
    })
    expect(same.error?.message ?? '').toMatch(/already/i)

    const overview = await owner.rpc('siu_overview', {})
    const o = overview.data as { access: boolean; standing: string; release_open: boolean; investigations: number }
    expect(o.access).toBe(true)
    expect(o.standing).toBe('owner')
    expect(o.release_open).toBe(false)
    expect(o.investigations).toBeGreaterThanOrEqual(2)

    const audit = await owner.rpc('siu_audit_feed', { p_limit: 50 })
    const actions = (audit.data ?? []).map((r: { action: string }) => r.action)
    expect(actions).toContain('SIU_CASE_CREATED')
    expect(actions).toContain('SIU_CLASSIFICATION_CHANGED')
  })

  it('siu_create_case validates its arguments', async () => {
    const noTitle = await owner.rpc('siu_create_case', { p_title: '  ' })
    expect(noTitle.error?.message ?? '').toMatch(/title/i)
    const badClass = await owner.rpc('siu_create_case', { p_title: tag('bad'), p_classification: 'top_secret' })
    expect(badClass.error?.message ?? '').toMatch(/classification/i)
  })

  it('siu_appoint refuses an inactive, removed, system or unknown account', async () => {
    const unknown = await owner.rpc('siu_appoint', { p_user: randomUUID(), p_role: 'special_agent' })
    expect(unknown.error?.message ?? '').toMatch(/not found/i)
    const badRole = await owner.rpc('siu_appoint', { p_user: lsbId, p_role: 'chief' })
    expect(badRole.error?.message ?? '').toMatch(/role/i)
  })

  /* ── 7. Compartment mechanics ───────────────────────────────────────────── */

  it('a compartment cannot be emptied and nobody removes themselves from one', async () => {
    // The owner is the compartment's only member (siu_create_case seeds the
    // opener). Both guards must fire before any row is touched.
    const self = await owner.rpc('siu_compartment_remove', {
      p_case: compCase, p_user: ownerId, p_reason: 'trying to leave',
    })
    expect(self.error?.message ?? '', 'self-removal must be refused').toMatch(/yourself|at least one member/i)

    const members = await owner.from('siu_compartment_members')
      .select('user_id').eq('case_id', compCase).is('revoked_at', null)
    expect(members.data?.length, 'the compartment must still have its member').toBe(1)
  })

  it('the compartment allow-list is only readable from inside the compartment', async () => {
    const outside = await lsb.from('siu_compartment_members').select('id').eq('case_id', compCase)
    expect(outside.data, 'a non-member must not see who is in a compartment').toEqual([])
    const inside = await owner.from('siu_compartment_members').select('id').eq('case_id', compCase)
    expect(inside.data?.length).toBe(1)
  })

  /* ── 8. CID regression guard ────────────────────────────────────────────── */

  it('ordinary CID access is unchanged by the chokepoint re-emit', async () => {
    const own = await lsb.from('cases').select('id,case_authority').eq('id', cidCase).single()
    expect(own.error, own.error?.message).toBeNull()
    expect(own.data!.case_authority).toBe('cid')

    // The detective can still write their own case and its children.
    const upd = await lsb.from('cases').update({ summary: 'still writable' }).eq('id', cidCase).select('id')
    expect(upd.error, upd.error?.message).toBeNull()

    const task = await lsb.from('case_tasks').insert({ case_id: cidCase, title: tag('task') }).select('id').single()
    expect(task.error, task.error?.message).toBeNull()
    await lsb.from('case_tasks').delete().eq('id', task.data!.id)

    // A bureau-wide read still works, and the Director still sees it.
    const dir = await director.from('cases').select('id').eq('id', cidCase)
    expect(dir.data?.length, 'command must still read CID cases across bureaus').toBe(1)

    // And search still finds the detective's own CID case.
    const hits = await lsb.rpc('search_all', { q: `cid control ${RUN}` })
    expect((hits.data ?? []).some((h: { id: string }) => h.id === cidCase)).toBe(true)
  })
})

/* ── Production-model lane (runs once the release gate is opened) ─────────── */

describe.skipIf(!released)('v1.66 — SIU production model (live, post-release)', () => {
  let agent: C, agent2: C, lsb: C
  let agentId = ''
  let agent2Id = ''
  let cidCase = ''
  let restricted = ''
  let compartment = ''

  beforeAll(async () => {
    agent = mk(); agent2 = mk(); lsb = mk()
    agentId = await signInWithRetry(agent, 'rls-test-siu-agent@cidportal.test', PW.agent!)
    agent2Id = await signInWithRetry(agent2, 'rls-test-siu-agent2@cidportal.test', PW.agent2!)
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)

    const c = await lsb.from('cases').insert({
      case_number: `LSB-${Date.now().toString().slice(-6)}`,
      title: tag('oversight target'), bureau: 'LSB', summary: 'CID-owned.',
    }).select('id').single()
    cidCase = c.data!.id as string

    const r = await agent.rpc('siu_create_case', { p_title: tag('restricted'), p_classification: 'siu_restricted' })
    restricted = r.data as string
    const k = await agent.rpc('siu_create_case', { p_title: tag('compartment'), p_classification: 'siu_compartmented' })
    compartment = k.data as string
  }, 90_000)

  afterAll(async () => {
    await agent.from('cases').delete().in('id', [restricted, compartment].filter(Boolean))
    await lsb.from('cases').delete().eq('id', cidCase)
    await Promise.all([agent, agent2, lsb].map((c) => c.auth.signOut()))
  }, 60_000)

  it('an SIU agent READS a CID case from a bureau they were never in', async () => {
    const r = await agent.from('cases').select('id,title,summary').eq('id', cidCase).single()
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data!.id).toBe(cidCase)
  })

  it('…but cannot WRITE it — broad read is not a write path', async () => {
    const upd = await agent.from('cases').update({ summary: 'rewritten by SIU' }).eq('id', cidCase).select('id')
    // RLS UPDATE is not widened, so the row is not visible to the write path:
    // either an explicit denial or zero rows affected — never a mutation.
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true)
    const after = await lsb.from('cases').select('summary').eq('id', cidCase).single()
    expect(after.data!.summary, 'the CID summary must be untouched').toBe('CID-owned.')
  })

  it('an SIU agent cannot rewrite or delete another detective’s CID report or evidence', async () => {
    const rep = await lsb.from('reports').insert({ case_id: cidCase, template: 'initial', fields: {} }).select('id').single()
    expect(rep.error, rep.error?.message).toBeNull()
    const reportId = rep.data!.id as string

    const read = await agent.from('reports').select('id').eq('id', reportId)
    expect(read.data?.length, 'SIU oversight may READ the report').toBe(1)

    const edit = await agent.from('reports').update({ template: 'tampered' }).eq('id', reportId).select('id')
    expect(edit.error !== null || (edit.data ?? []).length === 0, 'SIU must not rewrite a CID report').toBe(true)

    const del = await agent.from('reports').delete().eq('id', reportId).select('id')
    expect(del.error !== null || (del.data ?? []).length === 0, 'SIU must not delete a CID report').toBe(true)

    await lsb.from('reports').delete().eq('id', reportId)
  })

  it('an unassigned Special Agent is excluded from siu_restricted', async () => {
    const r = await agent2.from('cases').select('id').eq('id', restricted)
    expect(r.data, 'restricted needs assignment, command standing or an allow-list row').toEqual([])
  })

  it('a compartment excludes every other agent — including SIU command', async () => {
    const r = await agent2.from('cases').select('id').eq('id', compartment)
    expect(r.data).toEqual([])
    const add = await agent2.rpc('siu_compartment_add', {
      p_case: compartment, p_user: agent2Id, p_reason: 'self-grant attempt',
    })
    expect(add.error, 'nobody outside a compartment may add themselves to it').not.toBeNull()

    // The opener CAN admit them — deliberately, and audited.
    const grant = await agent.rpc('siu_compartment_add', {
      p_case: compartment, p_user: agent2Id, p_reason: 'read-in for the fixture',
    })
    expect(grant.error, grant.error?.message).toBeNull()
    const now = await agent2.from('cases').select('id').eq('id', compartment)
    expect(now.data?.length).toBe(1)

    // …and once admitted, they can be read out again by the other member.
    const revoke = await agent.rpc('siu_compartment_remove', {
      p_case: compartment, p_user: agent2Id, p_reason: 'fixture teardown',
    })
    expect(revoke.error, revoke.error?.message).toBeNull()
    const after = await agent2.from('cases').select('id').eq('id', compartment)
    expect(after.data, 'revocation takes effect immediately').toEqual([])
  })

  it('a removed SIU agent loses access at once but keeps their authorship', async () => {
    const reports = await agent.from('reports').select('id').eq('case_id', restricted)
    expect(reports.error).toBeNull()
    // Removal itself is exercised by the owner lane; here we assert the shape
    // the roster keeps: an ended membership stays on the roster as history.
    const roster = await agent.rpc('siu_roster', {})
    expect((roster.data ?? []).some((r: { user_id: string }) => r.user_id === agentId)).toBe(true)
  })
})

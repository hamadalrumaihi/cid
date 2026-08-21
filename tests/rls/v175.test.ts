/** v1.75 — SIU compartmentation: the registry stops being one shared list
 *  (migrations 20260928120000 / 120100 / 120200 / 120300), LIVE project.
 *
 *  ── What this is actually testing ──────────────────────────────────────────
 *  persons, vehicles, gangs and places were each `using (private.is_active())`
 *  -- every active investigator saw every row, so an SIU agent who added a
 *  person mid-investigation published them to all of CID the moment they hit
 *  save. The fix is a conjunct, `not private.siu_hidden(type, id)`, on the
 *  SELECT, UPDATE **and** DELETE policies of all four.
 *
 *  UPDATE and DELETE matter as much as SELECT and are pinned separately below.
 *  A row hidden from SELECT but still updatable leaks its own existence: an
 *  UPDATE that reports one row affected confirms exactly what the SELECT
 *  denied. Both must come back as ZERO ROWS, not as an error -- which is why
 *  every negative assertion here reads the row count rather than checking that
 *  `error` is null. An RLS refusal is a silent no-op and a trigger refusal is
 *  an exception; a test that accepted either would pass against a hole.
 *
 *  ── ABSENCE MEANS VISIBLE ──────────────────────────────────────────────────
 *  There is no visibility column on any registry table and nothing was
 *  backfilled as hidden. A record is hidden only when a siu_visibility row says
 *  so. The 95 registry records the migration flagged are 'unclassified', which
 *  does NOT hide -- pinned below, because getting that wrong would have removed
 *  all ten vehicles and 49 of 54 gangs from CID on the day this shipped.
 *
 *  ── Who may do this ────────────────────────────────────────────────────────
 *  The Director is deliberately NOT permitted, and that is pinned. The Director
 *  heads CID; letting them authorise release of SIU material into their own
 *  division inverts the arrangement, most sharply for an integrity
 *  investigation into CID personnel. The existing model already withholds SIU
 *  command from them (siu_can_appoint says so in as many words) and this
 *  follows it.
 *
 *  ── The shared-record rule ─────────────────────────────────────────────────
 *  A record CID already holds does not become SIU property because SIU opens a
 *  file on it. siu_mark_origin refuses outright, in the definer function rather
 *  than in a disabled button.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  `rls-test-owner` is the SIU actor: private.siu_standing() returns 'owner'
 *  from its FIRST branch, before the release gate, so this suite does not
 *  depend on siu_settings being open. `rls-test-lsb` is the ordinary CID
 *  detective who must not see compartmented material, and `rls-test-director`
 *  is the CID head who must not be able to release it.
 *
 *  ── Cleanup ────────────────────────────────────────────────────────────────
 *  Self-cleaning and non-destructive: two registry records created here and
 *  deleted in afterAll, whose ledger rows the 20260928120300 triggers purge
 *  automatically, plus rls_test_cleanup_visibility() for the audit rows. No
 *  pre-existing registry record is written to, and nothing in the 95-record
 *  review queue is resolved. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
}
const enabled = !!(ANON && PW.owner && PW.lsb && PW.director)
if (!enabled) console.warn('[rls:v175] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)
const REASON = 'Subject of an active integrity investigation.'

describe.skipIf(!enabled)('v1.75 — SIU compartmentation of the shared registry (live)', () => {
  let owner: C, lsb: C, director: C
  let directorId = ''
  let personId = ''      // the compartmented subject
  let gangId = ''        // the shared-record case: a gang CID already references
  let gangPersonId = ''  // the CID reference that makes it shared

  beforeAll(async () => {
    owner = mk(); lsb = mk(); director = mk()
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    directorId = await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)

    const p = await owner.from('persons')
      .insert({ name: `[rls-test] compartment subject ${RUN}` }).select('id').single()
    expect(p.error, p.error?.message).toBeNull()
    personId = p.data!.id as string

    const g = await owner.from('gangs')
      .insert({ name: `[rls-test] shared org ${RUN}` }).select('id').single()
    expect(g.error, g.error?.message).toBeNull()
    gangId = g.data!.id as string

    // The CID reference that makes the gang a shared record: persons.gang_id.
    const gp = await owner.from('persons')
      .insert({ name: `[rls-test] member ${RUN}`, gang_id: gangId }).select('id').single()
    expect(gp.error, gp.error?.message).toBeNull()
    gangPersonId = gp.data!.id as string
  }, 120_000)

  afterAll(async () => {
    // Deleting the registry rows purges their ledger rows through the
    // 20260928120300 triggers; the companion sweeps the audit.
    if (gangPersonId) await owner.from('persons').delete().eq('id', gangPersonId)
    if (personId) await owner.from('persons').delete().eq('id', personId)
    if (gangId) await owner.from('gangs').delete().eq('id', gangId)
    await owner.rpc('rls_test_cleanup_visibility')
    await Promise.all([owner, lsb, director].map((c) => c.auth.signOut()))
  }, 60_000)

  it('a new registry record is shared with CID until somebody says otherwise', async () => {
    const r = await lsb.from('persons').select('id').eq('id', personId)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toHaveLength(1)
  })

  it('the flagged records are visible, because a flag is a question not a decision', async () => {
    // The migration marked 95 registry records 'unclassified'. If that state
    // hid anything, CID would have lost 49 of 54 gangs overnight.
    const q = await owner.from('siu_visibility')
      .select('entity_id, entity_type').eq('state', 'unclassified').eq('entity_type', 'gang').limit(5)
    expect(q.error, q.error?.message).toBeNull()
    const ids = (q.data ?? []).map((r) => r.entity_id as string)
    if (ids.length === 0) return  // nothing flagged: nothing to prove
    const seen = await lsb.from('gangs').select('id').in('id', ids)
    expect(seen.error, seen.error?.message).toBeNull()
    expect(seen.data).toHaveLength(ids.length)
  })

  it('only SIU may compartment: a CID detective is refused', async () => {
    const r = await lsb.rpc('siu_mark_origin',
      { p_type: 'person', p_id: personId, p_reason: REASON })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/only SIU/i)
  })

  it('the Director of CID may not release SIU material into their own division', async () => {
    await owner.rpc('siu_mark_origin', { p_type: 'person', p_id: personId, p_reason: REASON })
    const r = await director.rpc('siu_reveal_to_cid',
      { p_type: 'person', p_id: personId, p_reason: 'Releasing this to my own division.' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/only SIU/i)
  })

  it('a compartmented record is gone from CID: select, update and delete alike', async () => {
    const sel = await lsb.from('persons').select('id').eq('id', personId)
    expect(sel.error, sel.error?.message).toBeNull()
    expect(sel.data).toHaveLength(0)

    // The leak that a SELECT-only policy would leave: an UPDATE reporting one
    // row affected confirms the record the SELECT just denied.
    const upd = await lsb.from('persons')
      .update({ notes: 'probe' }).eq('id', personId).select('id')
    expect(upd.error, upd.error?.message).toBeNull()
    expect(upd.data).toHaveLength(0)

    const del = await lsb.from('persons').delete().eq('id', personId).select('id')
    expect(del.error, del.error?.message).toBeNull()
    expect(del.data).toHaveLength(0)

    // And it is absent from the Director's view too — the compartment is not
    // about rank within CID.
    const dir = await director.from('persons').select('id').eq('id', personId)
    expect(dir.error, dir.error?.message).toBeNull()
    expect(dir.data).toHaveLength(0)
  })

  it('the existence of a compartment is itself compartmented', async () => {
    // A CID reader who could enumerate the ledger would learn how many hidden
    // records there are and of what kind, which is most of what hiding them
    // was for.
    const led = await lsb.from('siu_visibility').select('entity_id')
    expect(led.error, led.error?.message).toBeNull()
    expect(led.data).toHaveLength(0)

    const aud = await lsb.from('siu_visibility_events').select('id')
    expect(aud.error, aud.error?.message).toBeNull()
    expect(aud.data).toHaveLength(0)
  })

  it('SIU still sees its own material', async () => {
    const r = await owner.from('persons').select('id').eq('id', personId)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toHaveLength(1)
  })

  it('a record CID already holds stays shared', async () => {
    // The gang is referenced by a person's gang_id, so CID has it. SIU opening
    // a file does not take it away; the SIU intelligence about it is what gets
    // compartmented.
    const r = await owner.rpc('siu_mark_origin',
      { p_type: 'gang', p_id: gangId, p_reason: 'Taking an organisation CID already tracks.' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/CID already holds/i)

    const seen = await lsb.from('gangs').select('id').eq('id', gangId)
    expect(seen.error, seen.error?.message).toBeNull()
    expect(seen.data).toHaveLength(1)
  })

  it('a release needs a reason, and a keystroke is not one', async () => {
    const r = await owner.rpc('siu_reveal_to_cid',
      { p_type: 'person', p_id: personId, p_reason: 'ok' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/in a sentence/i)
  })

  it('a release cannot name both a case and a person', async () => {
    const r = await owner.rpc('siu_reveal_to_cid', {
      p_type: 'person', p_id: personId, p_reason: 'Releasing to two audiences at once.',
      p_to_case_id: randomUUID(), p_to_user_id: directorId,
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/not both/i)
  })

  it('revealing to CID makes the record visible again', async () => {
    const r = await owner.rpc('siu_reveal_to_cid',
      { p_type: 'person', p_id: personId, p_reason: 'Charging decision made; CID needs the subject.' })
    expect(r.error, r.error?.message).toBeNull()

    const seen = await lsb.from('persons').select('id').eq('id', personId)
    expect(seen.error, seen.error?.message).toBeNull()
    expect(seen.data).toHaveLength(1)
  })

  it('a release narrowed to one officer reaches that officer and nobody else', async () => {
    const r = await owner.rpc('siu_reveal_to_cid', {
      p_type: 'person', p_id: personId,
      p_reason: 'Released to the assigned detective only.', p_to_user_id: directorId,
    })
    expect(r.error, r.error?.message).toBeNull()

    const other = await lsb.from('persons').select('id').eq('id', personId)
    expect(other.error, other.error?.message).toBeNull()
    expect(other.data).toHaveLength(0)

    const named = await director.from('persons').select('id').eq('id', personId)
    expect(named.error, named.error?.message).toBeNull()
    expect(named.data).toHaveLength(1)
  })

  it('the audit records narrowing as narrowing, not as a wider release', async () => {
    // The defect the live probe caught before this shipped: every move between
    // two released states fell through to 'expanded'. An audit that overstates
    // a disclosure is worse than none, because it will be believed.
    const r = await owner.from('siu_visibility_events')
      .select('action, created_at').eq('entity_id', personId).order('created_at')
    expect(r.error, r.error?.message).toBeNull()
    const actions = (r.data ?? []).map((e) => e.action as string)
    expect(actions.slice(0, 3)).toEqual(['marked', 'revealed', 'reduced'])
  })

  it('the audit cannot be rewritten or erased through the portal', async () => {
    const upd = await owner.from('siu_visibility_events')
      .update({ reason: 'rewritten' }).eq('entity_id', personId).select('id')
    expect(upd.data ?? []).toHaveLength(0)

    const del = await owner.from('siu_visibility_events')
      .delete().eq('entity_id', personId).select('id')
    expect(del.data ?? []).toHaveLength(0)
  })

  it('the ledger cannot be written directly, only through the RPCs', async () => {
    // Otherwise the reason, the actor and the audit entry are all optional.
    const ins = await owner.from('siu_visibility')
      .insert({ entity_type: 'person', entity_id: randomUUID(), state: 'siu_only' })
      .select('entity_id')
    expect(ins.data ?? []).toHaveLength(0)

    const upd = await owner.from('siu_visibility')
      .update({ state: 'revealed' }).eq('entity_id', personId).select('entity_id')
    expect(upd.data ?? []).toHaveLength(0)
  })

  it('restricting pulls it back out of CID', async () => {
    const r = await owner.rpc('siu_restrict_to_siu',
      { p_type: 'person', p_id: personId, p_reason: 'Investigation reopened; pulling it back.' })
    expect(r.error, r.error?.message).toBeNull()

    const seen = await lsb.from('persons').select('id').eq('id', personId)
    expect(seen.error, seen.error?.message).toBeNull()
    expect(seen.data).toHaveLength(0)

    const named = await director.from('persons').select('id').eq('id', personId)
    expect(named.error, named.error?.message).toBeNull()
    expect(named.data).toHaveLength(0)
  })

  it('restricting something that was never SIU material is refused, not silently marked', async () => {
    // Otherwise restrict becomes a way around the shared-record check that
    // siu_mark_origin performs.
    const r = await owner.rpc('siu_restrict_to_siu',
      { p_type: 'gang', p_id: gangId, p_reason: 'Trying to hide it without marking it.' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/never SIU material/i)
  })

  it('deleting the record forgets its compartment', async () => {
    // entity_id has no FK, so without the trigger the ledger row would outlive
    // its subject and hide a different record if the uuid were ever reused.
    const throwaway = await owner.from('persons')
      .insert({ name: `[rls-test] transient ${RUN}` }).select('id').single()
    expect(throwaway.error, throwaway.error?.message).toBeNull()
    const id = throwaway.data!.id as string

    await owner.rpc('siu_mark_origin', { p_type: 'person', p_id: id, p_reason: REASON })
    const before = await owner.from('siu_visibility').select('entity_id').eq('entity_id', id)
    expect(before.data).toHaveLength(1)

    await owner.from('persons').delete().eq('id', id)
    const after = await owner.from('siu_visibility').select('entity_id').eq('entity_id', id)
    expect(after.error, after.error?.message).toBeNull()
    expect(after.data).toHaveLength(0)
  })
})

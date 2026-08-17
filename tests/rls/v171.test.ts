/** v1.71 — the person dossier gates itself through the CALLER'S policies
 *  (migrations 20260903120000 / 20260903130000 / 20260903140000), LIVE project.
 *
 *  ── What this suite is really guarding ─────────────────────────────────────
 *  `siu_person_dossier()` is the only SIU RPC written SECURITY **INVOKER**.
 *  Every other one is `security definer` because it performs a privileged act;
 *  this one only reads, so it runs as the caller and each of the fifteen tables
 *  it touches is filtered by that table's own policy. It restates no rule, so
 *  it cannot disagree with one.
 *
 *  That is a strong property and an easy one to destroy. Someone adding a
 *  column, a join, or a "just make it work for oversight" fix could flip it to
 *  `security definer` and the function would keep returning the same shape —
 *  while quietly handing the unit's watchlist, its intelligence notes and its
 *  registered informants to any authenticated account that can read a person.
 *  Nothing about the response shape would change. This suite is the alarm.
 *
 *  The assertion that matters is the PAIR: the same person id, the same
 *  function, called by two accounts, must return the same registry half and
 *  differ only in the SIU half. Testing the SIU caller alone would pass just as
 *  happily against a definer function.
 *
 *  ── The other half: the watchlist references a real record ─────────────────
 *  A watch now points at `persons.id` rather than carrying a copy of the name,
 *  which is what makes the dossier possible at all. Two properties are pinned
 *  here because both were live bugs:
 *
 *    * `siu_watch_add` REFUSES a subject that is not in the registry. Before
 *      20260903120000 it accepted any typed string, which is how the table
 *      ended up holding a watch on a "person" with no person attached.
 *    * `siu_deconflict` finds that watch BY NAME even though the watch stores
 *      no name — it resolves through the registry. Matching on the label alone
 *      meant a correctly linked watch disappeared from the one check whose job
 *      is to stop two agents burning the same operation, so the better the data
 *      got, the more the safety check missed.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  `rls-test-owner` holds SIU standing and is the SIU caller. `rls-test-lsb` is
 *  an ordinary CID detective with none, and is the control: it must see the
 *  person and nothing of the unit. `rls-test-lead` is a CID Bureau Lead — rank
 *  is not standing, and it must see no more of the SIU half than the detective
 *  does.
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Non-destructive and self-cleaning. The suite creates ONE person and ONE
 *  watch, both tagged with a per-run id, and closes the watch through
 *  `siu_watch_remove()` before deleting the person. Nothing pre-existing is
 *  modified, and no fixture reset is performed. */

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
if (!enabled) console.warn('[rls:v171] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)
const tag = (what: string) => `[rls-test] ${what} ${RUN}`

/** The dossier's shape, only as far as this suite reads it. */
interface Dossier {
  person: { id: string; name: string } | null
  watch: { id: string; reason: string } | null
  watch_history: unknown[]
  siu_intelligence: unknown[]
  siu_targets: unknown[]
  vehicles_registered: unknown[]
  accounts: unknown[]
}

describe.skipIf(!enabled)('v1.71 — the person dossier gates itself (live)', () => {
  let owner: C, lsb: C, lead: C
  /** A person in the shared registry, created by the CID detective — so the
   *  SIU half is the only thing that can differ between callers. */
  let personId = ''
  let watchId = ''
  const personName = tag('dossier subject')
  const watchReason = tag('watch reason')

  const dossier = async (c: C): Promise<Dossier | null> => {
    const r = await c.rpc('siu_person_dossier', { p_person: personId })
    expect(r.error, r.error?.message).toBeNull()
    return r.data as Dossier | null
  }

  beforeAll(async () => {
    owner = mk(); lsb = mk(); lead = mk()
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)

    const p = await lsb.from('persons').insert({ name: personName }).select('id').single()
    expect(p.error, p.error?.message).toBeNull()
    personId = p.data!.id as string
  }, 90_000)

  afterAll(async () => {
    // Close the watch before removing the person. The FK cascades, but going
    // through the RPC keeps the audit trail honest about how it ended.
    if (watchId) await owner.rpc('siu_watch_remove', { p_id: watchId, p_reason: 'suite teardown' })
    if (personId) await lsb.from('persons').delete().eq('id', personId)
    await Promise.all([owner, lsb, lead].map((c) => c.auth.signOut()))
  }, 60_000)

  it('refuses a watch on a subject that is not in the registry', async () => {
    // The bug this replaces: siu_watch_add accepted any typed string, so the
    // table collected watches on "people" nobody could look up.
    const bad = await owner.rpc('siu_watch_add', {
      p_entity_type: 'person',
      p_entity_id: randomUUID(),
      p_reason: tag('should not exist'),
      p_days: 7,
      p_review_days: 3,
    })
    expect(bad.error, 'a watch must not attach to a non-existent record').not.toBeNull()

    const noId = await owner.rpc('siu_watch_add', {
      p_entity_type: 'person',
      p_reason: tag('no target at all'),
      p_days: 7,
      p_review_days: 3,
    })
    expect(noId.error, 'a typed person watch must name a record').not.toBeNull()
  })

  it('attaches a watch to the registry record', async () => {
    const add = await owner.rpc('siu_watch_add', {
      p_entity_type: 'person',
      p_entity_id: personId,
      p_reason: watchReason,
      p_priority: 'priority',
      p_days: 7,
      p_review_days: 3,
    })
    expect(add.error, add.error?.message).toBeNull()
    watchId = add.data as string
    expect(watchId).toBeTruthy()

    // The watch carries the reference, not a copy of the name.
    const row = await owner.from('siu_watchlist')
      .select('person_id, label, entity_type, status').eq('id', watchId).single()
    expect(row.error, row.error?.message).toBeNull()
    expect(row.data!.person_id).toBe(personId)
    expect(row.data!.label, 'a linked watch stores no name of its own').toBeNull()
  })

  it('refuses a SECOND live watch on the same record', async () => {
    // A database fact, not a UI check somebody can race.
    const dup = await owner.rpc('siu_watch_add', {
      p_entity_type: 'person',
      p_entity_id: personId,
      p_reason: tag('duplicate'),
      p_days: 7,
      p_review_days: 3,
    })
    expect(dup.error, 'one live watch per record').not.toBeNull()
  })

  it('reads the display name through the registry, not off the watch', async () => {
    const live = await owner.rpc('siu_watchlist_live', {})
    expect(live.error, live.error?.message).toBeNull()
    const row = (live.data as { id: string; display_name: string }[] | null ?? [])
      .find((r) => r.id === watchId)
    expect(row, 'the watch must appear in the live list').toBeTruthy()
    expect(row!.display_name, 'the name comes from persons, live').toBe(personName)
  })

  it('deconflicts BY NAME even though the watch stores no name', async () => {
    // Resolution goes through the registry. Matching on the stored label alone
    // is what made correctly linked watches invisible here.
    const r = await owner.rpc('siu_deconflict', {
      p_entity_type: 'person', p_label: personName,
    })
    expect(r.error, r.error?.message).toBeNull()
    const hits = (r.data as { watchlist?: { id: string }[] }).watchlist ?? []
    expect(hits.map((w) => w.id)).toContain(watchId)
  })

  it('THE PAIR: same person, same function — only the SIU half differs', async () => {
    // This is the assertion the suite exists for. Asserting the SIU caller
    // alone would pass just as happily against a SECURITY DEFINER function
    // handing the watchlist to everybody.
    const asSiu = await dossier(owner)
    const asCid = await dossier(lsb)

    expect(asSiu?.person?.id, 'SIU sees the person').toBe(personId)
    expect(asCid?.person?.id, 'CID sees the same person — it is a shared registry').toBe(personId)

    expect(asSiu?.watch?.reason, 'SIU sees the watch it created').toBe(watchReason)
    expect(asCid?.watch, 'a CID detective must see no watch').toBeNull()
    expect(asCid?.watch_history ?? [], 'nor its history').toHaveLength(0)
    expect(asCid?.siu_intelligence ?? [], 'nor intelligence notes').toHaveLength(0)
    expect(asCid?.siu_targets ?? [], 'nor targets').toHaveLength(0)
  })

  it('CID command rank is not SIU standing', async () => {
    // A Bureau Lead outranks a detective everywhere in CID and reaches no
    // further than one into the unit.
    const asLead = await dossier(lead)
    expect(asLead?.person?.id, 'a Bureau Lead still sees the person').toBe(personId)
    expect(asLead?.watch, 'rank does not confer SIU sight').toBeNull()
    expect(asLead?.watch_history ?? []).toHaveLength(0)
  })

  it('the watchlist itself returns nothing to a caller without standing', async () => {
    // The dossier's emptiness above must come from the POLICY, not from the
    // function choosing to omit it — so check the table directly.
    const direct = await lsb.from('siu_watchlist').select('id').eq('id', watchId)
    expect(direct.error?.message ?? '').not.toMatch(/permission/i)
    expect(direct.data ?? [], 'siu_watchlist_sel returns no rows').toHaveLength(0)

    const live = await lsb.rpc('siu_watchlist_live', {})
    expect(live.error, live.error?.message).toBeNull()
    expect(live.data ?? [], 'and neither does the joined reader').toHaveLength(0)
  })

  it('registry search offers records without leaking who is watched', async () => {
    // `already_watched` is answered by the caller's own view of the watchlist,
    // so it must read false for an account that cannot see the watch — never a
    // side channel telling CID which subjects the unit is interested in.
    const asSiu = await owner.rpc('siu_registry_search', {
      p_entity_type: 'person', p_q: personName,
    })
    expect(asSiu.error, asSiu.error?.message).toBeNull()
    const mine = (asSiu.data as { id: string; already_watched: boolean }[] | null ?? [])
      .find((m) => m.id === personId)
    expect(mine?.already_watched, 'SIU is told the record is already watched').toBe(true)

    const asCid = await lsb.rpc('siu_registry_search', {
      p_entity_type: 'person', p_q: personName,
    })
    expect(asCid.error, asCid.error?.message).toBeNull()
    const theirs = (asCid.data as { id: string; already_watched: boolean }[] | null ?? [])
      .find((m) => m.id === personId)
    expect(theirs?.already_watched, 'CID learns nothing about SIU interest').toBe(false)
  })

  it('a review records what was decided and keeps the row', async () => {
    const noNote = await owner.rpc('siu_watch_review', {
      p_id: watchId, p_outcome: 'continue', p_note: '   ',
    })
    expect(noNote.error, 'a review without a note is not a review').not.toBeNull()

    const ok = await owner.rpc('siu_watch_review', {
      p_id: watchId, p_outcome: 'monitor',
      p_note: tag('stepped down, still of interest'), p_review_days: 5,
    })
    expect(ok.error, ok.error?.message).toBeNull()

    const row = await owner.from('siu_watchlist')
      .select('status, review_due_at').eq('id', watchId).single()
    expect(row.error, row.error?.message).toBeNull()
    expect(row.data!.status).toBe('monitor')
    expect(row.data!.review_due_at, 'the next review is scheduled').toBeTruthy()
  })

  it('a watch stepped down to monitoring is STILL found by deconfliction', async () => {
    // The exact regression fixed in 20260903140000: matching status = 'active'
    // alone hid live watches from the collision check.
    const r = await owner.rpc('siu_deconflict', {
      p_entity_type: 'person', p_entity_id: personId,
    })
    expect(r.error, r.error?.message).toBeNull()
    const hits = (r.data as { watchlist?: { id: string; status: string }[] }).watchlist ?? []
    const hit = hits.find((w) => w.id === watchId)
    expect(hit, 'monitoring is still being watched').toBeTruthy()
    expect(hit!.status).toBe('monitor')
  })
})

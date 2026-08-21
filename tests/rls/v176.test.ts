/** v1.76 — SIU compartmentation reaches the whole graph, and there are two ways
 *  to restrict (migrations 20260929120000 / 120100 / 120200), LIVE project.
 *
 *  ── The hole this closes ───────────────────────────────────────────────────
 *  v1.75 hid persons, vehicles, gangs and places. That closes the front door
 *  and leaves the windows open: gang_members still said "somebody is in this
 *  organisation" with the hidden person's id on it, person_relationships still
 *  drew the edge, account_links still tied them to a handle. Any one of those
 *  establishes that a person exists and who they associate with -- which is
 *  most of what hiding them was for.
 *
 *  So the tests below do not ask "is the record hidden". They ask the question
 *  an investigator would actually use to find it anyway: the graph edge, the
 *  membership row, the account link, the autocomplete, the global search, and
 *  the count. Every one must come back EMPTY, and empty means zero rows rather
 *  than an exception -- an RLS refusal is a silent no-op, and a test that
 *  accepted either would pass against a hole.
 *
 *  ── Two modes, and why the difference is the point ─────────────────────────
 *  Mode 'record' takes the record and everything under it. Mode 'sections'
 *  leaves the profile with CID and takes only what is named. The test that
 *  matters most is the pair: under 'sections', the restricted sections are
 *  empty AND the unrestricted ones still return rows. A wall that hid
 *  everything would pass a test that only checked the first half.
 *
 *  ── The second confirmation ────────────────────────────────────────────────
 *  A whole-record restriction on a record CID already uses is permitted and
 *  costly, so the acknowledgement is a PARAMETER, not a dialog. Pinned here by
 *  calling without it and requiring the refusal -- a dialog can be skipped by
 *  anything that is not the dialog.
 *
 *  ── Who may do it ──────────────────────────────────────────────────────────
 *  All three SIU ranks, the Director and the Owner -- and nobody else. The
 *  Director is the interesting one: private.siu_standing() returns NULL for
 *  them by deliberate design, so they cannot be reached through the SIU path at
 *  all and are checked against profiles.role. Pinned both ways: the Director
 *  CAN reveal, and a detective CANNOT even read the impact preview (which names
 *  the record, so it is itself a disclosure).
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  `rls-test-owner` is the SIU actor (siu_standing() returns 'owner' from its
 *  first branch, before the release gate, so this suite does not depend on
 *  siu_settings being open). `rls-test-lsb` is the CID detective who must not
 *  discover anything. `rls-test-director` is the CID head, who may control
 *  visibility but must not thereby gain SIU case material.
 *
 *  ── Cleanup ────────────────────────────────────────────────────────────────
 *  Self-cleaning: one small connected subgraph created here and deleted in
 *  afterAll, whose ledger rows the 20260928120300 triggers purge, plus
 *  rls_test_cleanup_visibility() for the audit. No pre-existing record is
 *  written to and nothing in the review queue is resolved. */

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
if (!enabled) console.warn('[rls:v176] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)
/** A tag no other row can match, so a search result is unambiguous. */
const TAG = `Zqx${RUN}`

describe.skipIf(!enabled)('v1.76 — compartmentation across the intelligence graph (live)', () => {
  let owner: C, lsb: C, director: C
  let subject = '', associate = '', gang = '', vehicle = '', place = '', account = ''

  /** Zero rows, never an exception — the only honest shape for "cannot see". */
  const empty = async (c: C, table: string, col: string, val: string) => {
    const r = await c.from(table).select('*', { count: 'exact' }).eq(col, val)
    expect(r.error, `${table}.${col}: ${r.error?.message}`).toBeNull()
    return r.data?.length ?? 0
  }

  beforeAll(async () => {
    owner = mk(); lsb = mk(); director = mk()
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)

    const mkRow = async (table: string, values: Record<string, unknown>) => {
      const r = await owner.from(table).insert(values).select('id').single()
      expect(r.error, `${table}: ${r.error?.message}`).toBeNull()
      return r.data!.id as string
    }
    subject   = await mkRow('persons',  { name: `${TAG} Subject` })
    associate = await mkRow('persons',  { name: `${TAG} Associate` })
    gang      = await mkRow('gangs',    { name: `${TAG} Org` })
    vehicle   = await mkRow('vehicles', { plate: `${TAG}V` })
    place     = await mkRow('places',   { name: `${TAG} Place`, type: 'stash_house' })
    account   = await mkRow('accounts', { platform: 'test', handle: `${TAG}acct` })

    for (const [t, v] of [
      ['person_relationships', { person_a: subject, person_b: associate, relationship: 'associate', rel_status: 'current' }],
      ['gang_members',   { gang_id: gang, person_id: subject }],
      ['person_vehicles',{ person_id: subject, vehicle_id: vehicle, role: 'driver', link_status: 'current' }],
      ['person_places',  { person_id: subject, place_id: place }],
      ['account_links',  { account_id: account, subject_kind: 'person', subject_id: subject, person_id: subject, ownership_confidence: 'confirmed' }],
    ] as const) {
      const r = await owner.from(t).insert(v)
      expect(r.error, `${t}: ${r.error?.message}`).toBeNull()
    }
  }, 120_000)

  afterAll(async () => {
    await owner.from('account_links').delete().eq('person_id', subject)
    await owner.from('person_places').delete().eq('person_id', subject)
    await owner.from('person_vehicles').delete().eq('person_id', subject)
    await owner.from('gang_members').delete().eq('person_id', subject)
    await owner.from('person_relationships').delete().eq('person_a', subject)
    await owner.from('accounts').delete().eq('id', account)
    await owner.from('places').delete().eq('id', place)
    await owner.from('vehicles').delete().eq('id', vehicle)
    await owner.from('gangs').delete().eq('id', gang)
    await owner.from('persons').delete().in('id', [subject, associate])
    await owner.rpc('rls_test_cleanup_visibility')
    await Promise.all([owner, lsb, director].map((c) => c.auth.signOut()))
  }, 60_000)

  it('before anything is restricted, CID can see the record and its graph', async () => {
    expect(await empty(lsb, 'persons', 'id', subject)).toBe(1)
    expect(await empty(lsb, 'person_relationships', 'person_a', subject)).toBe(1)
    expect(await empty(lsb, 'gang_members', 'person_id', subject)).toBe(1)
  })

  it('the impact preview is itself a disclosure, so a detective cannot read it', async () => {
    // It names the record and counts what is attached. Handing that to CID
    // would defeat the restriction it exists to inform.
    const r = await lsb.rpc('siu_restriction_impact', { p_type: 'person', p_id: subject })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/not authorized/i)
  })

  it('the preview counts what CID would actually lose', async () => {
    const r = await owner.rpc('siu_restriction_impact', { p_type: 'person', p_id: subject })
    expect(r.error, r.error?.message).toBeNull()
    const i = r.data as Record<string, unknown>
    expect(i.cid_authored).toBe(true)
    // Five edges were created above: relationship, membership, vehicle,
    // address, account. A preview that undercounted would understate the cost
    // of the button next to it.
    expect(i.relationships).toBe(5)
    // 'sections' is recommended by the SERVER whenever CID has a stake, so the
    // screen never has to re-derive the rule and get it subtly different.
    expect(i.recommended_mode).toBe('sections')
  })

  it('a whole-record restriction on CID material is refused without the acknowledgement', async () => {
    const r = await owner.rpc('siu_restrict', {
      p_type: 'person', p_id: subject, p_mode: 'record',
      p_reason: 'Restricting without acknowledging what CID loses.',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/created or currently used by CID/i)
    // And it really did not apply.
    expect(await empty(lsb, 'persons', 'id', subject)).toBe(1)
  })

  it('a detective cannot restrict anything', async () => {
    const r = await lsb.rpc('siu_restrict', {
      p_type: 'person', p_id: associate, p_mode: 'record',
      p_reason: 'A detective trying to compartment a record.',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/not authorized/i)
  })

  it('MODE 2 hides the named sections and leaves the rest — both halves', async () => {
    const r = await owner.rpc('siu_restrict', {
      p_type: 'person', p_id: subject, p_mode: 'sections',
      p_reason: 'Keep the profile shared; hide the SIU associations.',
      p_sections: ['relationships', 'gang_membership'],
    })
    expect(r.error, r.error?.message).toBeNull()

    // The profile stays. This is the half a "hide everything" bug would fail.
    expect(await empty(lsb, 'persons', 'id', subject)).toBe(1)
    expect(await empty(lsb, 'person_relationships', 'person_a', subject)).toBe(0)
    expect(await empty(lsb, 'gang_members', 'person_id', subject)).toBe(0)
    // Sections that were not named are untouched.
    expect(await empty(lsb, 'person_vehicles', 'person_id', subject)).toBe(1)
    expect(await empty(lsb, 'person_places', 'person_id', subject)).toBe(1)
  })

  it('a section restriction naming no section is refused', async () => {
    // It would render as "protected" while protecting nothing.
    const r = await owner.rpc('siu_restrict', {
      p_type: 'person', p_id: subject, p_mode: 'sections',
      p_reason: 'A restriction that restricts nothing at all.', p_sections: [],
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/at least one section/i)
  })

  it('MODE 1 removes the record from every surface CID could reach it by', async () => {
    const r = await owner.rpc('siu_restrict', {
      p_type: 'person', p_id: subject, p_mode: 'record',
      p_reason: 'Escalated; the whole record leaves CID.',
      p_acknowledge_cid_impact: true,
    })
    expect(r.error, r.error?.message).toBeNull()

    expect(await empty(lsb, 'persons', 'id', subject)).toBe(0)
    expect(await empty(lsb, 'person_relationships', 'person_a', subject)).toBe(0)
    expect(await empty(lsb, 'gang_members', 'person_id', subject)).toBe(0)
    expect(await empty(lsb, 'person_vehicles', 'person_id', subject)).toBe(0)
    expect(await empty(lsb, 'person_places', 'person_id', subject)).toBe(0)
    expect(await empty(lsb, 'account_links', 'person_id', subject)).toBe(0)

    // The search surfaces, which are how somebody would actually look.
    for (const [fn, args] of [
      ['search_all', { q: `${TAG} Subject` }],
      ['search_persons', { p_q: `${TAG} Subject`, p_limit: 20, p_offset: 0 }],
      ['siu_registry_search', { p_entity_type: 'person', p_q: `${TAG} Subject` }],
    ] as const) {
      const s = await lsb.rpc(fn, args as never)
      expect(s.error, `${fn}: ${s.error?.message}`).toBeNull()
      const rows = (s.data ?? []) as { id?: string }[]
      expect(rows.some((x) => x.id === subject), `${fn} leaked the id`).toBe(false)
    }
  })

  it('CID cannot create an edge to a record it cannot see', async () => {
    // Otherwise the insert succeeding is itself the answer: the person exists.
    const r = await lsb.from('person_relationships').insert({
      person_a: subject, person_b: associate,
      relationship: 'known_contact', rel_status: 'current',
    }).select('id')
    // Either shape is a refusal; what must not happen is a row coming back.
    expect(r.data ?? []).toHaveLength(0)
  })

  it('SIU still sees its own material', async () => {
    expect(await empty(owner, 'persons', 'id', subject)).toBe(1)
    expect(await empty(owner, 'person_relationships', 'person_a', subject)).toBe(1)
  })

  it('the Director may control visibility, and therefore may see', async () => {
    // Control implies read: the confirmation screen has to show the record.
    expect(await empty(director, 'persons', 'id', subject)).toBe(1)
    const r = await director.rpc('siu_reveal_to_cid', {
      p_type: 'person', p_id: subject,
      p_reason: 'The Director releasing the record back to CID.',
    })
    expect(r.error, r.error?.message).toBeNull()
    expect(await empty(lsb, 'persons', 'id', subject)).toBe(1)
    expect(await empty(lsb, 'person_relationships', 'person_a', subject)).toBe(1)
  })

  it('but controlling visibility does not hand the Director SIU case material', async () => {
    // The containment that makes including them tolerable: siu_targets,
    // siu_case_notes and the rest keep their own predicates. Otherwise the head
    // of CID could read the integrity file on CID.
    const t = await director.from('siu_targets').select('id')
    expect(t.error, t.error?.message).toBeNull()
    expect(t.data).toHaveLength(0)
    const n = await director.from('siu_case_notes').select('id')
    expect(n.error, n.error?.message).toBeNull()
    expect(n.data).toHaveLength(0)
  })

  it('a record can be born hidden, with no window where CID could see it', async () => {
    // The ledger row is written against an id BEFORE the record exists, which
    // is only possible because entity_id deliberately carries no foreign key.
    const id = randomUUID()
    const res = await owner.rpc('siu_reserve_visibility', {
      p_type: 'person', p_id: id, p_visibility: 'siu_only',
      p_reason: 'Created in the SIU workspace as SIU Only.',
    })
    expect(res.error, res.error?.message).toBeNull()

    const ins = await owner.from('persons').insert({ id, name: `${TAG} Born hidden` }).select('id')
    expect(ins.error, ins.error?.message).toBeNull()

    expect(await empty(lsb, 'persons', 'id', id)).toBe(0)
    expect(await empty(owner, 'persons', 'id', id)).toBe(1)

    await owner.from('persons').delete().eq('id', id)
  })

  it('reserving visibility for a record that already exists is refused', async () => {
    // That path skips the impact preview and the second confirmation, so it
    // must not become a way around them.
    const r = await owner.rpc('siu_reserve_visibility', {
      p_type: 'person', p_id: associate, p_visibility: 'siu_only',
      p_reason: 'Trying to reserve something that already exists.',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/already exists/i)
  })

  it('accounts and indicators are compartmentable registries in their own right', async () => {
    const r = await owner.rpc('siu_restrict', {
      p_type: 'account', p_id: account, p_mode: 'record',
      p_reason: 'The handle itself is the sensitive part here.',
      p_acknowledge_cid_impact: true,
    })
    expect(r.error, r.error?.message).toBeNull()
    expect(await empty(lsb, 'accounts', 'id', account)).toBe(0)
    expect(await empty(lsb, 'account_handles', 'account_id', account)).toBe(0)
    expect(await empty(owner, 'accounts', 'id', account)).toBe(1)
  })
})

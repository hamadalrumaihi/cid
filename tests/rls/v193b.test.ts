/** v1.93b — Organization associations: the security review's findings, pinned
 *  (migration 20261106120000 PART 6). Catalog test_id `v193a`.
 *
 *  v193a proves the happy path and the refusal shapes. It does NOT prove the
 *  wall: its fixtures are two ordinary gangs and a place that every actor can
 *  see, so no actor is ever denied an endpoint and the "both endpoints visible"
 *  rule the whole design rests on is never exercised. An independent review of
 *  PARTS 1–5 found seven real defects behind that gap. This suite is the
 *  regression net for each of them, with fixtures an actor genuinely cannot
 *  see.
 *
 *   · #1 (F4) trashing ONE endpoint hides the association from the reader, from
 *     `entity_associations_for`, and hides the trashed record's NAME — before
 *     the fix `private.registry_label` resolved it happily, because
 *     `perm_registry_visible` has no `deleted_at` term while the `*_sel`
 *     policies do;
 *   · #2 (F1) THE BIG ONE — a withdrawn association whose endpoint the caller
 *     cannot see must not appear in `trash_list`. `trash_list` is SECURITY
 *     DEFINER, admits rows on `perm_dispatch('restore', …)` alone, and
 *     `trash_case_expr` has no arm for this kind, so the restore arm was the
 *     ONLY filter — and it was the one arm that omitted `assoc_visible`. The
 *     row leaked its claim, its label, the officer who withdrew it and their
 *     stated reason. Restoring it was a write to a row the caller cannot read;
 *   · #3 (F3) the pair is canonical across kinds too: `('gang','place')` and
 *     `('place','gang')` are ONE row. Before the fix a rejected `controls`
 *     claim could be re-litigated by flipping the argument order into a fresh
 *     pending row that someone else could then confirm — the registry
 *     asserting and denying the same claim at once;
 *   · #4 (F2) a photograph of a substance restricted AFTER it was attached goes
 *     dark. PART 5 copied `narcotics.restricted` onto the media row at attach
 *     time; that snapshot never updated, so the picture stayed readable by
 *     every active member. The block is a live predicate now;
 *   · #5 (F6) a registry photograph can be withdrawn by its uploader. Every
 *     `registry_media_attach` row is caseless, and the media delete arm
 *     required a case — so nobody, not even the Owner, could remove one;
 *   · #6 (F8) an amendment cannot rewrite a decision: `confidence` is refused
 *     once the row has been ruled on (`code: 'decided'`), `last_confirmed` is
 *     no longer amendable at all, a ruling of `historical` needs a reason like
 *     the others, and reopening clears the whole decision trail together.
 *
 *  Fixtures: two gangs, a place and a narcotic, all `[rls-test]` stamped. The
 *  narcotic is the invisible endpoint — `restricted` narcotics intelligence is
 *  the one wall a plain detective fixture can be put behind without SIU
 *  standing, since `perm_registry_visible('narcotic', …)` gates on
 *  `can_edit_narcotics_intel()` (Senior Detective and above).
 *  `rls_test_cleanup` sweeps all of it. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v193b] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>

describe.skipIf(!enabled)('v1.93b — the association wall: an invisible endpoint hides the link, its label and its Trash row', () => {
  let lsb: C, bcb: C, lead: C, owner: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v193b ${tag}`
  let gangA = ''
  let gangB = ''
  let place = ''
  let narcotic = ''
  let pairAB = ''

  const jsonRpc = async (c: C, fn: string, args: Json): Promise<Json> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn}: ${r.error?.message}`).toBeNull()
    return r.data as Json
  }
  const assocRow = async (c: C, id: string): Promise<Json | null> => {
    const r = await c.from('entity_associations').select('*').eq('id', id).maybeSingle()
    expect(r.error, `entity_associations: ${r.error?.message}`).toBeNull()
    return (r.data ?? null) as Json | null
  }
  const trashIds = async (c: C): Promise<string[]> => {
    const r = await c.rpc('trash_list', { p_kind: 'entity_association', p_limit: 200 })
    expect(r.error, `trash_list: ${r.error?.message}`).toBeNull()
    return (r.data as Json[]).map((x) => String(x.id))
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    if (PW.owner) { owner = mk(); ids.owner = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const a = await lsb.from('gangs').insert({ name: `${stamp} Alpha`, classification: 'cartel' }).select('id').single()
    if (a.error) throw new Error(`gang A: ${a.error.message}`)
    gangA = a.data!.id
    const b = await lsb.from('gangs').insert({ name: `${stamp} Bravo`, classification: 'motorcycle_club' }).select('id').single()
    if (b.error) throw new Error(`gang B: ${b.error.message}`)
    gangB = b.data!.id
    const p = await lsb.from('places').insert({ name: `${stamp} Garage`, location_type: 'other' }).select('id').single()
    if (p.error) throw new Error(`place: ${p.error.message}`)
    place = p.data!.id
    // The lead is the can_edit_narcotics_intel audience (v134's pattern).
    const n = await lead.from('narcotics').insert({ name: `${stamp} substance`, status: 'unidentified' }).select('id').single()
    if (n.error) throw new Error(`narcotic: ${n.error.message}`)
    narcotic = n.data!.id

    const made = await jsonRpc(lsb, 'entity_association_create', {
      p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'gang', p_object_id: gangB,
      p_association: 'unconfirmed_association', p_note: `${stamp} co-located branding`,
    })
    pairAB = String(made.id)
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v193b] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, owner].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #1–#2 an endpoint the caller cannot see ============ */

  it('#1 trashing one endpoint hides the association, its list row and the trashed record’s name', async () => {
    expect(await assocRow(bcb, pairAB), 'visible while both endpoints are live').toBeTruthy()
    const before = await bcb.rpc('entity_associations_for', { p_kind: 'gang', p_id: gangA })
    expect(before.error, before.error?.message).toBeNull()
    const seen = (before.data as Json[]).find((r) => r.id === pairAB)
    expect(String(seen?.other_label ?? '')).toContain('Bravo')

    const gone = await jsonRpc(lsb, 'soft_delete', { p_kind: 'gang', p_id: gangB, p_reason: `${stamp} duplicate` })
    expect(gone, JSON.stringify(gone)).toMatchObject({ ok: true })

    // perm_registry_visible has no deleted_at term, so before the fix the row
    // stayed readable and registry_label happily returned the trashed name.
    expect(await assocRow(bcb, pairAB), 'a trashed endpoint hides the association').toBeNull()
    const after = await bcb.rpc('entity_associations_for', { p_kind: 'gang', p_id: gangA })
    expect(after.error, after.error?.message).toBeNull()
    expect((after.data as Json[]).some((r) => r.id === pairAB)).toBe(false)
    expect(JSON.stringify(after.data)).not.toContain('Bravo')
  })

  it('#2 a withdrawn association with an invisible endpoint never reaches the Trash of someone who cannot see it', async () => {
    const gone = await jsonRpc(lsb, 'soft_delete', { p_kind: 'entity_association', p_id: pairAB, p_reason: `${stamp} recorded in error` })
    expect(gone, JSON.stringify(gone)).toMatchObject({ ok: true })

    // trash_list is SECURITY DEFINER and filters on perm_dispatch('restore', …)
    // alone for this kind — so the restore arm is the whole wall.
    for (const [who, client] of [['bcb', bcb], ['lead', lead]] as [string, C][]) {
      expect(await trashIds(client), `${who} must not see it`).not.toContain(pairAB)
      const restored = await jsonRpc(client, 'restore_record', { p_kind: 'entity_association', p_id: pairAB })
      expect(restored, `${who} must not be able to restore it`).toMatchObject({ ok: false, code: 'denied' })
    }
    // Nothing leaked: not the reason, not the officer, not the claim.
    const dump = JSON.stringify((await lead.rpc('trash_list', { p_kind: 'entity_association', p_limit: 200 })).data)
    expect(dump).not.toContain('recorded in error')
    expect(dump).not.toContain(pairAB)
  })

  it.skipIf(!hasOwner)('#2 the Owner still sees it, so nothing is lost to recovery', async () => {
    expect(await trashIds(owner!)).toContain(pairAB)
    const back = await jsonRpc(owner!, 'restore_record', { p_kind: 'entity_association', p_id: pairAB })
    expect(back).toMatchObject({ ok: true })
    await jsonRpc(lsb, 'restore_record', { p_kind: 'gang', p_id: gangB })
  })

  /* ============ #3 canonical across kinds ============ */

  it('#3 a cross-kind pair is one row in either direction, so a rejected claim cannot be re-litigated by flipping it', async () => {
    const fwd = await jsonRpc(lsb, 'entity_association_create', {
      p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'place', p_object_id: place, p_association: 'controls',
    })
    expect(fwd).toMatchObject({ ok: true, created: true })
    const id = String(fwd.id)
    const ruled = await jsonRpc(lsb, 'entity_association_decide', { p_id: id, p_status: 'rejected', p_note: 'the branding was a mural' })
    expect(ruled).toMatchObject({ ok: true, status: 'rejected' })

    const flipped = await jsonRpc(bcb, 'entity_association_create', {
      p_subject_kind: 'place', p_subject_id: place, p_object_kind: 'gang', p_object_id: gangA, p_association: 'controls',
    })
    expect(flipped, 'the reversed cross-kind pair is the SAME row').toMatchObject({ ok: true, created: false, id })
    expect((await assocRow(lsb, id))!.status, 'and it keeps the rejection').toBe('rejected')
  })

  /* ============ #4 restricted narcotics intelligence ============ */

  it('#4 a photograph of a substance restricted after attachment goes dark for a plain member', async () => {
    const att = await jsonRpc(lead, 'registry_media_attach', {
      p_kind: 'narcotic', p_entity_id: narcotic, p_title: `${stamp} street sample`, p_filename: 'bag.png', p_mime: 'image/png',
    })
    expect(att, JSON.stringify(att)).toMatchObject({ ok: true, restricted: false })
    const mediaId = String(att.media_id)

    const openRead = await lsb.from('media').select('id, title').eq('id', mediaId).maybeSingle()
    expect(openRead.error, openRead.error?.message).toBeNull()
    expect(openRead.data, 'readable while the substance is open').toBeTruthy()

    const shut = await lead.from('narcotics').update({ restricted: true }).eq('id', narcotic)
    expect(shut.error, shut.error?.message).toBeNull()

    // media.restricted is STILL false — that is the point: the fix must not
    // depend on the stored snapshot.
    const stored = await lead.from('media').select('restricted').eq('id', mediaId).maybeSingle()
    expect(stored.error, stored.error?.message).toBeNull()
    expect(stored.data?.restricted, 'the stored flag is unchanged by design').toBe(false)

    const shutRead = await lsb.from('media').select('id, title').eq('id', mediaId).maybeSingle()
    expect(shutRead.error, shutRead.error?.message).toBeNull()
    expect(shutRead.data, 'the live predicate covers it anyway').toBeNull()
    // and the title never reaches a plain member through any media read
    const sweep = await lsb.from('media').select('title').ilike('title', `%${tag}%`)
    expect(sweep.error, sweep.error?.message).toBeNull()
    expect(JSON.stringify(sweep.data)).not.toContain('street sample')

    await lead.from('narcotics').update({ restricted: false }).eq('id', narcotic)
  })

  /* ============ #5 a registry photograph is removable ============ */

  it('#5 the uploader can withdraw a registry photograph — before the fix nobody could, not even the Owner', async () => {
    const att = await jsonRpc(lsb, 'registry_media_attach', {
      p_kind: 'gang', p_entity_id: gangA, p_title: `${stamp} wrong record`, p_filename: 'oops.png', p_mime: 'image/png',
    })
    const mediaId = String(att.media_id)
    const gone = await jsonRpc(lsb, 'soft_delete', { p_kind: 'media', p_id: mediaId, p_reason: `${stamp} wrong record` })
    expect(gone, JSON.stringify(gone)).toMatchObject({ ok: true })
    const after = await lsb.from('media').select('id').eq('id', mediaId).maybeSingle()
    expect(after.error, after.error?.message).toBeNull()
    expect(after.data).toBeNull()
    // and it is recoverable
    expect(await jsonRpc(lsb, 'restore_record', { p_kind: 'media', p_id: mediaId })).toMatchObject({ ok: true })
  })

  /* ============ #6 an amendment cannot rewrite a decision ============ */

  it('#6 confidence is frozen once an association is ruled on, last_confirmed is never amendable, and reopening clears the whole trail', async () => {
    const made = await jsonRpc(lsb, 'entity_association_create', {
      p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'place', p_object_id: place,
      p_association: 'operates_from', p_confidence: 'possible',
    })
    const id = String(made.id)
    // while pending, the author may still adjust their own assessment
    expect(await jsonRpc(lsb, 'entity_association_update', { p_id: id, p_patch: { confidence: 'probable' } })).toMatchObject({ ok: true })

    // a different officer rules on it
    const ruled = await jsonRpc(bcb, 'entity_association_decide', { p_id: id, p_status: 'confirmed', p_note: 'surveillance corroborated it' })
    expect(ruled).toMatchObject({ ok: true, status: 'confirmed' })
    expect((await assocRow(lsb, id))!.decided_by).toBe(ids.bcb)

    // the author may no longer strengthen the claim under the other officer's name
    expect(await jsonRpc(lsb, 'entity_association_update', { p_id: id, p_patch: { confidence: 'confirmed' } }))
      .toMatchObject({ ok: false, code: 'decided' })
    expect((await assocRow(lsb, id))!.confidence).toBe('probable')
    // last_confirmed is a decision artefact and left the whitelist entirely
    expect(await jsonRpc(lsb, 'entity_association_update', { p_id: id, p_patch: { last_confirmed: '2020-01-01' } }))
      .toMatchObject({ ok: false, code: 'bad_request' })
    // a ruling of historical needs a reason like the others
    expect(await jsonRpc(bcb, 'entity_association_decide', { p_id: id, p_status: 'historical' }))
      .toMatchObject({ ok: false, code: 'bad_request' })
    // reopening clears author, time AND note together — no orphan reason
    expect(await jsonRpc(bcb, 'entity_association_decide', { p_id: id, p_status: 'pending_investigation' })).toMatchObject({ ok: true })
    const reopened = await assocRow(lsb, id)
    expect(reopened!.decided_by).toBeNull()
    expect(reopened!.decided_at).toBeNull()
    expect(reopened!.decision_note).toBeNull()
  })
})

/** v1.28 — Person intelligence workspace: persons intelligence/lifecycle/BOLO
 *  columns, person_relationships / person_places / person_vehicles link
 *  tables, search_persons (SECURITY INVOKER), and person_merge (SECURITY
 *  DEFINER, command-gated tombstone merge) — migration 20260729010000. Pins:
 *   - the new persons columns are writable by an active detective and the
 *     CHECK vocabularies (confidence, lifecycle) reject invalid values (23514);
 *   - person_relationships: registry-wide read (is_active, no bureau wall),
 *     self-link rejected by CHECK (23514), inverse duplicates rejected by the
 *     canonical-pair unique index (23505), delete for command OR the creator
 *     only (the case_blockers convention);
 *   - person_places / person_vehicles: create/read + UNIQUE dupe rejection;
 *   - search_persons: name/phone/gang-name matches, limit/offset paging,
 *     sub-2-char queries return nothing, anonymous callers are denied, and a
 *     case-number match FAILS CLOSED for a detective outside the case's
 *     bureau (invoker RLS on cases/case_intel_links);
 *   - person_merge: non-command and blank-reason denied; the happy path
 *     repoints vehicles.owner_id / media.person_id / case_intel_links to the
 *     survivor, tombstones the victim (lifecycle='merged', merged_into set,
 *     row kept), leaves the survivor's name untouched, and writes a
 *     PERSON_MERGED audit row; an already-merged victim cannot be merged again.
 *
 *  Fixtures (tests/rls/README.md): lsb (LSB detective, creator), bcb (BCB
 *  detective — non-creator/cross-bureau negative), lead (bureau_lead —
 *  command delete positive), director (merge authority), owner (audit_log
 *  reader — audit_sel is owner-only). rls_test_cleanup at start + teardown;
 *  registry fixtures (persons/gang/place/vehicle) are torn down explicitly by
 *  the command fixture (the v122 convention — cleanup never swept registry
 *  rows); the new link tables CASCADE from persons.
 *  Requires migration 20260729010000. */

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
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.owner)
if (!enabled) console.warn('[rls:v128] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
/** search_persons rows come back untyped from the generic client. */
const hitIds = (data: unknown): string[] => ((data ?? []) as Array<{ id: string }>).map((r) => r.id)

describe.skipIf(!enabled)('v1.28 — person intelligence + merge + search (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, owner: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  // Distinct token for the case number: it must NOT share the person-name tag,
  // or trigram similarity against the fixture names themselves could produce a
  // legitimate name hit for the cross-bureau detective in the fail-closed test.
  const caseTag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const caseNumber = `CN128-${caseTag}`
  const phone = `555-${tag}`
  let caseId = ''
  let gangId = ''
  let placeId = ''
  let vehicleId = ''
  let survivorId = ''
  let victimId = ''
  let contactId = ''
  let relId = ''
  let mediaId = ''

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); owner = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c = await lsb.from('cases')
      .insert({ case_number: caseNumber, title: 'v1.28 person intel case', bureau: 'LSB', lead_detective_id: ids.lsb })
      .select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id as string

    const g = await lsb.from('gangs').insert({ name: `V128 Gang ${tag}`, threat_level: 'low' }).select('id')
    if (g.error) throw new Error(g.error.message)
    gangId = g.data![0].id as string

    const pl = await lsb.from('places').insert({ name: `V128 Place ${tag}`, type: 'stash_house' }).select('id')
    if (pl.error) throw new Error(pl.error.message)
    placeId = pl.data![0].id as string

    // Survivor carries the phone + gang link (search fixtures); victim shares
    // the V128A name prefix so limit/offset paging has two ranked hits.
    const s = await lsb.from('persons')
      .insert({ name: `V128A Survivor ${tag}`, phone, gang_id: gangId })
      .select('id')
    if (s.error) throw new Error(s.error.message)
    survivorId = s.data![0].id as string
    const v = await lsb.from('persons').insert({ name: `V128A Victim ${tag}` }).select('id')
    if (v.error) throw new Error(v.error.message)
    victimId = v.data![0].id as string
    const k = await lsb.from('persons').insert({ name: `V128C Contact ${tag}` }).select('id')
    if (k.error) throw new Error(k.error.message)
    contactId = k.data![0].id as string

    const veh = await lsb.from('vehicles')
      .insert({ plate: `V8${tag.slice(0, 4)}`, model: 'v128 sedan', owner_id: victimId })
      .select('id')
    if (veh.error) throw new Error(veh.error.message)
    vehicleId = veh.data![0].id as string
  })

  afterAll(async () => {
    if (!lsb) return
    // Explicit registry teardown via command (v122 convention): deleting the
    // persons CASCADEs the person_* link rows; vehicles.owner_id SET NULLs.
    if (director) {
      await director.from('persons').delete().in('id', [survivorId, victimId, contactId].filter(Boolean))
      if (vehicleId) await director.from('vehicles').delete().eq('id', vehicleId)
      if (placeId) await director.from('places').delete().eq('id', placeId)
      if (gangId) await director.from('gangs').delete().eq('id', gangId)
    }
    // Sweeps the fixture case + its case_intel_links + case-linked media.
    const clean = await lsb.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
    await Promise.all([lsb, bcb, lead, director, owner].filter(Boolean).map((c) => c.auth.signOut()))
  })

  // ── persons: new intelligence columns ───────────────────────────────────────
  it('an active detective can write the new intelligence/review/BOLO columns', async () => {
    const res = await lsb.from('persons')
      .update({
        classification: 'suspect', confidence: 'probable', priority: 'high',
        identity: { aliases: [`Ghost ${tag}`], street_names: ['Ghost'], occupation: 'mechanic' },
        intelligence_summary: { overview: `v128 summary ${tag}` },
        reviewed_at: new Date().toISOString(), reviewed_by: ids.lsb,
        next_review_at: new Date(Date.now() + 86400000).toISOString(),
        review_note: `v128 review ${tag}`, lead_detective_id: ids.lsb,
        bolo: true, bolo_reason: `armed ${tag}`, bolo_risk: 'high',
        bolo_instructions: 'do not approach', bolo_issued_by: ids.lsb,
        bolo_issued_at: new Date().toISOString(), bolo_case_id: caseId,
      })
      .eq('id', survivorId)
      .select('classification, confidence, priority, bolo_risk, review_note, lifecycle')
    expect(res.error).toBeNull()
    expect(res.data![0].classification).toBe('suspect')
    expect(res.data![0].bolo_risk).toBe('high')
    expect(res.data![0].lifecycle).toBe('active') // default untouched
  })

  it('an invalid confidence value is rejected by the CHECK constraint', async () => {
    const res = await lsb.from('persons').update({ confidence: 'certain' }).eq('id', survivorId).select('id')
    expect(res.error).not.toBeNull()
    expect(res.error!.code).toBe('23514')
  })

  it('an invalid lifecycle value is rejected by the CHECK constraint', async () => {
    const res = await lsb.from('persons').update({ lifecycle: 'retired' }).eq('id', survivorId).select('id')
    expect(res.error).not.toBeNull()
    expect(res.error!.code).toBe('23514')
  })

  // ── person_relationships ────────────────────────────────────────────────────
  it('a detective creates a person relationship with confidence/provenance', async () => {
    const res = await lsb.from('person_relationships')
      .insert({ person_a: survivorId, person_b: contactId, relationship: 'family', confidence: 'probable', provenance: 'reported', note: `v128 ${tag}` })
      .select('id, rel_status')
    expect(res.error).toBeNull()
    expect(res.data![0].rel_status).toBe('current')
    relId = res.data![0].id as string
  })

  it('a detective from another bureau reads the relationship (registry-wide, no bureau wall)', async () => {
    const res = await bcb.from('person_relationships').select('id, relationship').eq('id', relId)
    expect(res.error).toBeNull()
    expect(res.data ?? []).toHaveLength(1)
    expect(res.data![0].relationship).toBe('family')
  })

  it('a self-link is rejected by the CHECK constraint', async () => {
    const res = await lsb.from('person_relationships')
      .insert({ person_a: survivorId, person_b: survivorId, relationship: 'associate' })
      .select('id')
    expect(res.error).not.toBeNull()
    expect(res.error!.code).toBe('23514')
  })

  it('the inverse duplicate (B→A of an existing A→B) is rejected by the canonical-pair unique index', async () => {
    const res = await lsb.from('person_relationships')
      .insert({ person_a: contactId, person_b: survivorId, relationship: 'family' })
      .select('id')
    expect(res.error).not.toBeNull()
    expect(res.error!.code).toBe('23505')
  })

  it('a non-creator non-command detective cannot delete a relationship; the creator can', async () => {
    await bcb.from('person_relationships').delete().eq('id', relId)
    const still = await lsb.from('person_relationships').select('id').eq('id', relId)
    expect(still.data ?? []).toHaveLength(1)
    const del = await lsb.from('person_relationships').delete().eq('id', relId).select('id')
    expect(del.error).toBeNull()
    expect(del.data ?? []).toHaveLength(1)
  })

  it('command (bureau_lead) can delete a relationship it did not create', async () => {
    const ins = await lsb.from('person_relationships')
      .insert({ person_a: survivorId, person_b: contactId, relationship: 'associate' })
      .select('id')
    expect(ins.error).toBeNull()
    const rid = ins.data![0].id as string
    const del = await lead.from('person_relationships').delete().eq('id', rid).select('id')
    expect(del.error).toBeNull()
    expect(del.data ?? []).toHaveLength(1)
  })

  // ── person_places + person_vehicles ─────────────────────────────────────────
  it('person_places: create + cross-fixture read + UNIQUE(person, place) dupe rejection', async () => {
    const res = await lsb.from('person_places')
      .insert({ person_id: survivorId, place_id: placeId, role: 'residence', confidence: 'confirmed', provenance: 'manually_confirmed' })
      .select('id, link_status')
    expect(res.error).toBeNull()
    expect(res.data![0].link_status).toBe('current')
    const read = await bcb.from('person_places').select('id, role').eq('person_id', survivorId)
    expect(read.error).toBeNull()
    expect((read.data ?? []).some((r) => r.role === 'residence')).toBe(true)
    const dupe = await lsb.from('person_places')
      .insert({ person_id: survivorId, place_id: placeId, role: 'hangout' })
      .select('id')
    expect(dupe.error).not.toBeNull()
    expect(dupe.error!.code).toBe('23505')
  })

  it('person_vehicles: create + cross-fixture read + UNIQUE(person, vehicle) dupe rejection', async () => {
    const res = await lsb.from('person_vehicles')
      .insert({ person_id: survivorId, vehicle_id: vehicleId, role: 'driver', provenance: 'reported' })
      .select('id, link_status')
    expect(res.error).toBeNull()
    expect(res.data![0].link_status).toBe('current')
    const read = await bcb.from('person_vehicles').select('id, role').eq('person_id', survivorId)
    expect(read.error).toBeNull()
    expect((read.data ?? []).some((r) => r.role === 'driver')).toBe(true)
    const dupe = await lsb.from('person_vehicles')
      .insert({ person_id: survivorId, vehicle_id: vehicleId, role: 'passenger' })
      .select('id')
    expect(dupe.error).not.toBeNull()
    expect(dupe.error!.code).toBe('23505')
  })

  // ── search_persons ──────────────────────────────────────────────────────────
  it('search_persons finds a person by a name fragment', async () => {
    const res = await lsb.rpc('search_persons', { p_q: `Survivor ${tag}` })
    expect(res.error).toBeNull()
    expect(hitIds(res.data)).toContain(survivorId)
  })

  it('search_persons finds a person by phone', async () => {
    const res = await lsb.rpc('search_persons', { p_q: phone })
    expect(res.error).toBeNull()
    expect(hitIds(res.data)).toContain(survivorId)
  })

  it('search_persons finds a person by their gang name', async () => {
    const res = await lsb.rpc('search_persons', { p_q: `V128 Gang ${tag}` })
    expect(res.error).toBeNull()
    expect(hitIds(res.data)).toContain(survivorId)
  })

  it('search_persons respects limit and offset', async () => {
    const all = await lsb.rpc('search_persons', { p_q: `V128A` })
    expect(all.error).toBeNull()
    const allIds = hitIds(all.data)
    expect(allIds).toContain(survivorId)
    expect(allIds).toContain(victimId)
    const first = await lsb.rpc('search_persons', { p_q: `V128A`, p_limit: 1, p_offset: 0 })
    expect(first.error).toBeNull()
    expect(first.data ?? []).toHaveLength(1)
    const second = await lsb.rpc('search_persons', { p_q: `V128A`, p_limit: 1, p_offset: 1 })
    expect(second.error).toBeNull()
    expect(second.data ?? []).toHaveLength(1)
    expect(hitIds(second.data)[0]).not.toBe(hitIds(first.data)[0])
  })

  it('a query under 2 characters returns nothing', async () => {
    const res = await lsb.rpc('search_persons', { p_q: 'x' })
    expect(res.error).toBeNull()
    expect(res.data ?? []).toHaveLength(0)
  })

  it('an anonymous caller is denied search_persons', async () => {
    const anon = mk()
    const res = await anon.rpc('search_persons', { p_q: `V128A` })
    expect(res.error).not.toBeNull()
  })

  it('a case-number match fails closed across the bureau wall (invoker RLS)', async () => {
    const link = await lsb.from('case_intel_links')
      .insert({ case_id: caseId, kind: 'person', ref_id: contactId })
      .select('id')
    expect(link.error).toBeNull()
    // The case creator hits the contact via the LSB case number...
    const mine = await lsb.rpc('search_persons', { p_q: caseNumber })
    expect(mine.error).toBeNull()
    expect(hitIds(mine.data)).toContain(contactId)
    // ...a BCB detective searching the same case number gets no such hit.
    const theirs = await bcb.rpc('search_persons', { p_q: caseNumber })
    expect(theirs.error).toBeNull()
    expect(hitIds(theirs.data)).not.toContain(contactId)
  })

  // ── person_merge ────────────────────────────────────────────────────────────
  it('a non-command detective cannot merge persons', async () => {
    const res = await lsb.rpc('person_merge', { p_survivor: survivorId, p_victims: [victimId], p_reason: `dedupe ${tag}` })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/restricted to command/i)
  })

  it('a blank reason is rejected', async () => {
    const res = await director.rpc('person_merge', { p_survivor: survivorId, p_victims: [victimId], p_reason: '   ' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/reason is required/i)
  })

  it('director merges the victim into the survivor: children repointed, victim tombstoned, survivor intact', async () => {
    // Victim-owned children to be repointed.
    const m = await lsb.from('media')
      .insert({ title: `V128 mugshot ${tag}`, type: 'image', external_url: 'https://example.com/v128.png', person_id: victimId, case_id: caseId })
      .select('id')
    expect(m.error).toBeNull()
    mediaId = m.data![0].id as string
    const link = await lsb.from('case_intel_links')
      .insert({ case_id: caseId, kind: 'person', ref_id: victimId })
      .select('id')
    expect(link.error).toBeNull()

    const res = await director.rpc('person_merge', { p_survivor: survivorId, p_victims: [victimId], p_reason: `duplicate record ${tag}` })
    expect(res.error).toBeNull()

    const veh = await lsb.from('vehicles').select('owner_id').eq('id', vehicleId)
    expect(veh.data?.[0]?.owner_id).toBe(survivorId)
    const med = await lsb.from('media').select('person_id').eq('id', mediaId)
    expect(med.data?.[0]?.person_id).toBe(survivorId)
    const links = await lsb.from('case_intel_links').select('ref_id').eq('case_id', caseId).eq('kind', 'person')
    const refs = (links.data ?? []).map((r) => r.ref_id)
    expect(refs).toContain(survivorId)
    expect(refs).not.toContain(victimId)

    const victim = await lsb.from('persons').select('lifecycle, merged_into, bolo').eq('id', victimId)
    expect(victim.data?.[0]?.lifecycle).toBe('merged')
    expect(victim.data?.[0]?.merged_into).toBe(survivorId)
    expect(victim.data?.[0]?.bolo).toBe(false)
    const survivor = await lsb.from('persons').select('name, lifecycle').eq('id', survivorId)
    expect(survivor.data?.[0]?.name).toBe(`V128A Survivor ${tag}`)
    expect(survivor.data?.[0]?.lifecycle).toBe('active')
  })

  it('the merge wrote a PERSON_MERGED audit row (readable by owner — audit_sel is owner-only)', async () => {
    const al = await owner.from('audit_log')
      .select('action, entity, detail')
      .eq('action', 'PERSON_MERGED')
      .eq('entity_id', victimId)
    expect(al.error).toBeNull()
    expect((al.data ?? []).length).toBeGreaterThan(0)
    const detail = (al.data![0] as { detail: { survivor_id?: string; reason?: string } }).detail
    expect(detail?.survivor_id).toBe(survivorId)
    expect(detail?.reason).toContain('duplicate record')
  })

  it('an already-merged victim cannot be merged again', async () => {
    const res = await director.rpc('person_merge', { p_survivor: survivorId, p_victims: [victimId], p_reason: `retry ${tag}` })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/already merged/i)
  })
})

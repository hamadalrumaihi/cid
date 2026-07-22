/** v1.53 — legal hold PRESERVATION LOCK, migration
 *  20260808160000_legal_hold_preservation.
 *
 *  20260807190000 made an active hold block the Owner-only permanent purge.
 *  This suite proves the hold is now a FULL preservation lock at the remaining
 *  destructive chokepoints, all keyed on the ONE reusable predicate
 *  private.case_has_active_hold(uuid). On a bare HELD case:
 *   - case_archive is refused (/active legal hold/i);
 *   - a case-attached media DELETE affects 0 rows (RLS-blocked, row survives);
 *   - a reports DELETE affects 0 rows (row survives);
 *   - a case_tasks DELETE affects 0 rows (row survives);
 *   - a held case's case_intel_links row cannot be DELETEd (BEFORE DELETE
 *     trigger raises /legal hold/i);
 *   - person_merge of a case-linked person is refused (the merge repoints the
 *     held link → the trigger aborts the whole RPC);
 *   - after a command LIFTS the hold, case_archive succeeds.
 *
 *  Fixtures (v147 hold-suite shape): lead (LSB bureau_lead = command — places/
 *  lifts the hold, owns the fixture rows), lsb (plain active detective), owner
 *  (is_owner — teardown purge), anon (unused write path here, kept for shape).
 *  Self-cleaning: teardown lifts any residual hold, deletes the linked person,
 *  then owner-deletes the case (cascading its media/reports/tasks/links);
 *  rls_test_cleanup sweeps the fixture case.
 *
 *  Merge enforcement lives at the case_intel_links chokepoint, not the entity
 *  tombstone: person_merge / merge_narcotics must repoint (or delete) the
 *  victim's held link, and the BEFORE UPDATE-OR-DELETE trigger on
 *  case_intel_links rejects that while the case is held — aborting the whole
 *  merge without re-emitting the large RPCs. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lead && PW.lsb && PW.owner)
if (!enabled) console.warn('[rls:v153] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.53 — legal hold preservation lock (live)', () => {
  let lead: C, lsb: C, owner: C, anon: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let holdId = ''
  let mediaId = ''
  let reportId = ''
  let taskId = ''
  let personId = ''
  let survivorId = ''
  const caseDeleted = false

  beforeAll(async () => {
    lead = mk(); lsb = mk(); owner = mk(); anon = mk()
    for (const [client, email, pw] of [
      [lead, 'rls-test-lead@cidportal.test', PW.lead],
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb],
      [owner, 'rls-test-owner@cidportal.test', PW.owner],
    ] as const) {
      await signInWithRetry(client, email, pw!)
    }
    try { await lead.rpc('rls_test_cleanup') } catch { /* best effort */ }

    // A bare case carrying NO legal requests — the hold is the only blocker.
    const c = await lead.from('cases').insert({ case_number: `V153-${tag}`, title: `[rls-test] v153 preservation case ${tag}`, bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(`case insert: ${c.error.message}`)
    caseId = c.data![0].id as string

    // Case-attached child rows that the hold must protect from deletion.
    const m = await lead.from('media').insert({ title: `[rls-test] v153 media ${tag}`, type: 'image', case_id: caseId }).select('id')
    if (m.error) throw new Error(`media insert: ${m.error.message}`)
    mediaId = m.data![0].id as string

    const r = await lead.from('reports').insert({ case_id: caseId, template: 'note' }).select('id')
    if (r.error) throw new Error(`report insert: ${r.error.message}`)
    reportId = r.data![0].id as string

    const t = await lead.from('case_tasks').insert({ case_id: caseId, title: `[rls-test] v153 task ${tag}` }).select('id')
    if (t.error) throw new Error(`task insert: ${t.error.message}`)
    taskId = t.data![0].id as string

    // A person linked to the case via case_intel_links — the merge chokepoint.
    const pe = await lead.from('persons').insert({ name: `[rls-test] v153 person ${tag}` }).select('id')
    if (pe.error) throw new Error(`person insert: ${pe.error.message}`)
    personId = pe.data![0].id as string
    const link = await lead.from('case_intel_links').insert({ case_id: caseId, kind: 'person', ref_id: personId })
    if (link.error) throw new Error(`intel link insert: ${link.error.message}`)

    // A survivor person (NOT linked to the held case) to merge the linked
    // victim into — person_merge must be refused while the hold is active.
    const sv = await lead.from('persons').insert({ name: `[rls-test] v153 survivor ${tag}` }).select('id')
    if (sv.error) throw new Error(`survivor insert: ${sv.error.message}`)
    survivorId = sv.data![0].id as string

    // Place the hold (command).
    const place = await lead.rpc('legal_hold_place', { p_case: caseId, p_legal_request: null, p_reason: `[rls-test] v153 hold ${tag}` })
    if (place.error) throw new Error(`hold place: ${place.error.message}`)
    holdId = (place.data as { id: string }).id
  })

  afterAll(async () => {
    if (!owner) return
    if (holdId) {
      try { await lead.rpc('legal_hold_lift', { p_hold: holdId, p_reason: '[rls-test] v153 teardown lift' }) } catch { /* already lifted */ }
    }
    if (personId) {
      try { await lead.from('case_intel_links').delete().eq('ref_id', personId) } catch { /* cascades with case anyway */ }
      try { await lead.from('persons').delete().eq('id', personId) } catch { /* command delete */ }
    }
    if (survivorId) {
      try { await lead.from('persons').delete().eq('id', survivorId) } catch { /* command delete */ }
    }
    if (!caseDeleted && caseId) {
      try { await owner.rpc('case_permanent_delete', { p_case: caseId, p_reason: '[rls-test] v153 teardown' }) } catch { /* already gone */ }
    }
    try { await lead.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lead, lsb, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('a held case cannot be archived (no override)', async () => {
    const r = await lead.rpc('case_archive', { p_case: caseId, p_note: '[rls-test] v153 archive attempt' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/active legal hold/i)
    // Still un-archived.
    const still = await lead.from('cases').select('id,archived_at').eq('id', caseId).maybeSingle()
    expect(still.data?.archived_at ?? null).toBeNull()
  })

  it('a case-attached media row cannot be deleted while held', async () => {
    const del = await lead.from('media').delete().eq('id', mediaId).select('id')
    // RLS filters the row out of the delete set → no error, 0 rows affected.
    expect(del.error, del.error?.message).toBeNull()
    expect(del.data ?? []).toHaveLength(0)
    const still = await lead.from('media').select('id').eq('id', mediaId)
    expect(still.data ?? []).toHaveLength(1)
  })

  it('a report cannot be deleted while held', async () => {
    const del = await lead.from('reports').delete().eq('id', reportId).select('id')
    expect(del.error, del.error?.message).toBeNull()
    expect(del.data ?? []).toHaveLength(0)
    const still = await lead.from('reports').select('id').eq('id', reportId)
    expect(still.data ?? []).toHaveLength(1)
  })

  it('a case task cannot be deleted while held', async () => {
    const del = await lead.from('case_tasks').delete().eq('id', taskId).select('id')
    expect(del.error, del.error?.message).toBeNull()
    expect(del.data ?? []).toHaveLength(0)
    const still = await lead.from('case_tasks').select('id').eq('id', taskId)
    expect(still.data ?? []).toHaveLength(1)
  })

  it("a held case's intel link cannot be deleted (BEFORE DELETE trigger raises)", async () => {
    const del = await lead.from('case_intel_links').delete().eq('ref_id', personId).eq('case_id', caseId).select('id')
    expect(del.error).not.toBeNull()
    expect(del.error!.message).toMatch(/legal hold/i)
    const still = await lead.from('case_intel_links').select('id').eq('ref_id', personId).eq('case_id', caseId)
    expect(still.data ?? []).toHaveLength(1)
  })

  it('merging a linked person is refused while held (person_merge repoints the held link)', async () => {
    const m = await lead.rpc('person_merge', { p_survivor: survivorId, p_victims: [personId], p_reason: '[rls-test] v153 merge attempt' })
    expect(m.error).not.toBeNull()
    expect(m.error!.message).toMatch(/legal hold/i)
    // Victim survives, un-merged.
    const still = await lead.from('persons').select('lifecycle').eq('id', personId).maybeSingle()
    expect(still.data?.lifecycle).not.toBe('merged')
  })

  it('after a command lift, the case can be archived', async () => {
    const lift = await lead.rpc('legal_hold_lift', { p_hold: holdId, p_reason: '[rls-test] v153 released' })
    expect(lift.error, lift.error?.message).toBeNull()
    holdId = '' // lifted — teardown need not re-lift

    const arch = await lead.rpc('case_archive', { p_case: caseId, p_note: '[rls-test] v153 archive after lift' })
    expect(arch.error, arch.error?.message).toBeNull()
    expect((arch.data as { archived_at: string | null }).archived_at).not.toBeNull()
  })
})

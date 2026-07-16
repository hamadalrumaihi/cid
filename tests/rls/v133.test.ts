/** v1.33 — Narcotics intelligence data model
 *  (migration 20260803010000_narcotics_intelligence).
 *
 *  Pins:
 *   - narcotics SELECT: active members see catalog rows; `restricted` rows are
 *     hidden below senior_detective (plain detectives blind; lead/owner see);
 *   - narcotics INSERT: open to active members, but private.guard_narcotic()
 *     forces NON-managers to provisional records (status 'unidentified',
 *     restricted false, reviewed_* cleared, created_by pinned to the caller);
 *     managers (bureau_lead/director/owner) create confirmed rows directly;
 *   - narcotics UPDATE: detectives edit ONLY their own still-provisional rows,
 *     and the guard keeps status/restricted/category/charge_codes/reviewed_*
 *     frozen for them; created_by and merged_into are immutable for EVERYONE
 *     on direct writes (merge is RPC-only);
 *   - narcotics DELETE: Owner-only (a bureau lead is denied);
 *   - child tables (aliases/places/persons/gangs/vehicles/seizures): sel/ins
 *     gate on PARENT visibility (a link under a restricted parent disappears
 *     for a plain detective), upd is intel-editor-or-creator, del is
 *     intel-editor-only;
 *   - narcotic_suggestions: RPC-only writes (direct INSERT denied);
 *     submit works for a detective (status 'submitted' + event row), fails
 *     closed on a restricted target (no existence leak); visibility is
 *     submitter/manager only; decide is manager-only with a note REQUIRED for
 *     declined / needs_more_information;
 *   - merge_narcotics: manager-only, reason required, tombstone semantics
 *     (status 'merged' + merged_into; alias/place-link/seizure repointed to
 *     the survivor; the merged row's name preserved as a survivor alias);
 *   - resolve_provisional_narcotic: manager-only confirm stamps reviewed_by
 *     and removes the row from the detective's editable set;
 *   - search_narcotics: RLS-scoped, merged tombstones excluded, anon has no
 *     EXECUTE; anon reads zero narcotics rows and cannot submit suggestions.
 *
 *  Fixtures (tests/rls/README.md): lead (bureau_lead LSB), director (director
 *  SAB), owner (detective+is_owner SAB), lsb (LSB detective), bcb (BCB
 *  detective). All fixture narcotics/places carry the `[rls-test] v133` +
 *  STAMP marker and are purged at start AND teardown by the owner/director
 *  fixtures (children cascade from narcotics). narcotic_suggestions has NO
 *  delete policy and rls_test_cleanup() pre-dates the table, so suggestion
 *  rows stay tombstoned server-side — they carry the [rls-test] stamp in
 *  their titles and their narcotic_id nulls out with the parent delete.
 *  Requires migration 20260803010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
}
const enabled = !!(ANON && PW.lead && PW.director && PW.owner && PW.lsb && PW.bcb)
if (!enabled) console.warn('[rls:v133] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const STAMP = Date.now()
const N = (s: string) => `[rls-test] v133 ${s} ${STAMP}`

describe.skipIf(!enabled)('v1.33 — narcotics intelligence data model (live)', () => {
  let anon: C, lead: C, director: C, owner: C, lsb: C, bcb: C
  const ids: Record<string, string> = {}
  const rows: Record<string, string> = {}

  /** Purge every v133 fixture row: narcotics via the Owner (narcotics_del is
   *  Owner-only; aliases/links/seizures cascade), places via the director
   *  (places_del = can_delete). Runs at start AND teardown so crashed runs
   *  never poison the next one. */
  const purge = async () => {
    await owner.from('narcotics').delete().like('name', '[rls-test] v133%')
    await director.from('places').delete().like('name', '[rls-test] v133%')
  }

  const mkNarcotic = async (client: C, key: string, row: Record<string, unknown>) => {
    const res = await client.from('narcotics').insert({ name: N(key), ...row }).select('id')
    if (res.error) throw new Error(`fixture narcotic ${key}: ${res.error.message}`)
    rows[key] = res.data![0].id as string
    return rows[key]
  }

  beforeAll(async () => {
    anon = mk(); lead = mk(); director = mk(); owner = mk(); lsb = mk(); bcb = mk()
    for (const [client, email, pw, key] of [
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    await purge()

    // Fixture shelf (director = catalog manager authors everything canonical):
    // a visible confirmed row, a restricted row (+ an alias under it, to prove
    // the parent-visibility gate), and the merge pair with an alias + place
    // link + seizure hanging off the record that will be merged away.
    await mkNarcotic(director, 'canonical', {
      category: 'stimulant', status: 'confirmed', confidence: 'confirmed',
      provenance: 'manually_confirmed', summary: 'v133 visible canonical fixture.',
    })
    await mkNarcotic(director, 'restricted', {
      category: 'unknown', status: 'confirmed', restricted: true,
      summary: 'v133 restricted fixture.',
    })
    const restrictedAlias = await director.from('narcotic_aliases')
      .insert({ narcotic_id: rows.restricted, alias: `v133 hidden alias ${STAMP}` }).select('id')
    if (restrictedAlias.error) throw new Error(`fixture restricted alias: ${restrictedAlias.error.message}`)
    rows.restrictedAlias = restrictedAlias.data![0].id as string

    await mkNarcotic(director, 'survivor', { category: 'opioid', status: 'confirmed' })
    await mkNarcotic(director, 'merged', { category: 'opioid', status: 'reported' })
    const place = await director.from('places')
      .insert({ name: N('place'), type: 'stash_house', area: 'v133 fixture' }).select('id')
    if (place.error) throw new Error(`fixture place: ${place.error.message}`)
    rows.place = place.data![0].id as string
    const mergedAlias = await director.from('narcotic_aliases')
      .insert({ narcotic_id: rows.merged, alias: `v133 merge alias ${STAMP}` }).select('id')
    if (mergedAlias.error) throw new Error(`fixture merge alias: ${mergedAlias.error.message}`)
    rows.mergedAlias = mergedAlias.data![0].id as string
    const mergedPlace = await director.from('narcotic_places')
      .insert({ narcotic_id: rows.merged, place_id: rows.place, role: 'stored_at' }).select('id')
    if (mergedPlace.error) throw new Error(`fixture merge place link: ${mergedPlace.error.message}`)
    rows.mergedPlace = mergedPlace.data![0].id as string
    const mergedSeizure = await director.from('narcotic_seizures')
      .insert({ narcotic_id: rows.merged, state: 'suspected', amount_recorded: '3 baggies', notes: '[rls-test] v133 seizure' })
      .select('id')
    if (mergedSeizure.error) throw new Error(`fixture merge seizure: ${mergedSeizure.error.message}`)
    rows.mergedSeizure = mergedSeizure.data![0].id as string
  })

  afterAll(async () => {
    // narcotics fixtures (incl. the merge tombstone) go via the Owner; the
    // aliases/links/seizures cascade; the fixture place goes via the director.
    // narcotic_suggestions rows remain by design (no DELETE policy, RPC-only
    // tracker) — stamped '[rls-test] v133' with narcotic_id nulled out.
    if (owner && director) await purge()
    await Promise.all([lead, director, owner, lsb, bcb].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── SELECT visibility ── */

  it('active detective sees a catalog row; anon reads nothing', async () => {
    const sel = await lsb.from('narcotics').select('id, name, status').eq('id', rows.canonical)
    expect(sel.error).toBeNull()
    expect(sel.data).toHaveLength(1)
    expect(sel.data![0].status).toBe('confirmed')
    const a = await anon.from('narcotics').select('id').eq('id', rows.canonical)
    expect(a.data ?? []).toHaveLength(0)
  })

  it('restricted row: plain detectives blind; lead and owner (intel editors) see it', async () => {
    for (const c of [lsb, bcb]) {
      const r = await c.from('narcotics').select('id').eq('id', rows.restricted)
      expect(r.error).toBeNull()
      expect(r.data ?? []).toHaveLength(0)
    }
    for (const c of [lead, owner]) {
      const r = await c.from('narcotics').select('id').eq('id', rows.restricted)
      expect(r.data).toHaveLength(1)
    }
  })

  it('a child row under a restricted parent is invisible to a plain detective and closed to their inserts', async () => {
    const hidden = await lsb.from('narcotic_aliases').select('id').eq('narcotic_id', rows.restricted)
    expect(hidden.error).toBeNull()
    expect(hidden.data ?? []).toHaveLength(0)
    const seen = await lead.from('narcotic_aliases').select('id').eq('narcotic_id', rows.restricted)
    expect(seen.data).toHaveLength(1)
    // INSERT with-check runs the parent EXISTS under the detective's own RLS.
    const ins = await lsb.from('narcotic_aliases')
      .insert({ narcotic_id: rows.restricted, alias: `v133 must fail ${STAMP}` }).select('id')
    expect(ins.error).not.toBeNull()
  })

  /* ── INSERT + the guard trigger ── */

  it('manager INSERT: director creates a confirmed row directly (status kept, created_by pinned to caller)', async () => {
    const res = await director.from('narcotics')
      .insert({ name: N('deletable'), category: 'sedative', status: 'confirmed', confidence: 'probable' })
      .select('id, status, confidence, created_by')
    expect(res.error).toBeNull()
    expect(res.data![0]).toMatchObject({ status: 'confirmed', confidence: 'probable', created_by: ids.director })
    rows.deletable = res.data![0].id as string
  })

  it('detective INSERT is forced provisional: status/restricted/reviewed_* pinned, created_by spoof ignored', async () => {
    const res = await lsb.from('narcotics')
      .insert({
        name: N('provisional'), status: 'confirmed', restricted: true,
        reviewed_at: new Date().toISOString(), reviewed_by: ids.director,
        created_by: ids.director, summary: 'v133 unknown substance report.',
      })
      .select('id, status, restricted, confidence, reviewed_at, reviewed_by, created_by, category')
    expect(res.error).toBeNull()
    expect(res.data![0]).toMatchObject({
      status: 'unidentified', restricted: false, confidence: 'unverified',
      reviewed_at: null, reviewed_by: null, created_by: ids.lsb,
    })
    rows.provisional = res.data![0].id as string
  })

  /* ── UPDATE + the guard trigger ── */

  it('detective edits their OWN provisional row: descriptive fields land, authority columns stay frozen', async () => {
    const res = await lsb.from('narcotics')
      .update({
        summary: 'v133 updated by creator.', status: 'confirmed', restricted: true,
        category: 'opioid', charge_codes: [{ code: 'PC-101' }], reviewed_by: ids.lsb,
      })
      .eq('id', rows.provisional)
      .select('summary, status, restricted, category, charge_codes, reviewed_by')
    expect(res.error).toBeNull()
    expect(res.data).toHaveLength(1)
    expect(res.data![0]).toMatchObject({
      summary: 'v133 updated by creator.',
      status: 'unidentified', restricted: false, category: 'unknown', reviewed_by: null,
    })
    expect(res.data![0].charge_codes).toEqual([])
  })

  it("another detective cannot touch it; created_by/merged_into are immutable even for a manager", async () => {
    const other = await bcb.from('narcotics')
      .update({ summary: 'v133 must not land.' }).eq('id', rows.provisional).select('id')
    expect(other.error).toBeNull()
    expect(other.data ?? []).toHaveLength(0)
    // Direct merge/ownership rewrites are frozen for EVERYONE — merge is RPC-only.
    const mgr = await director.from('narcotics')
      .update({ created_by: ids.director, merged_into: rows.survivor })
      .eq('id', rows.provisional)
      .select('created_by, merged_into')
    expect(mgr.error).toBeNull()
    expect(mgr.data![0]).toMatchObject({ created_by: ids.lsb, merged_into: null })
  })

  it('DELETE is Owner-only: bureau lead denied, owner succeeds', async () => {
    const deny = await lead.from('narcotics').delete().eq('id', rows.deletable).select('id')
    expect(deny.error).toBeNull()
    expect(deny.data ?? []).toHaveLength(0)
    const ok = await owner.from('narcotics').delete().eq('id', rows.deletable).select('id')
    expect(ok.error).toBeNull()
    expect(ok.data).toHaveLength(1)
  })

  /* ── child tables under a visible parent ── */

  it('aliases: detective creates under a visible parent; creator edits; others cannot; delete is intel-editor-only', async () => {
    const ins = await lsb.from('narcotic_aliases')
      .insert({ narcotic_id: rows.canonical, alias: `v133 street ${STAMP}`, alias_type: 'street_name' })
      .select('id, created_by')
    expect(ins.error).toBeNull()
    expect(ins.data![0].created_by).toBe(ids.lsb)
    const aliasId = ins.data![0].id as string
    const own = await lsb.from('narcotic_aliases')
      .update({ alias: `v133 street edited ${STAMP}` }).eq('id', aliasId).select('id')
    expect(own.error).toBeNull()
    expect(own.data).toHaveLength(1)
    const other = await bcb.from('narcotic_aliases')
      .update({ alias: `v133 hijack ${STAMP}` }).eq('id', aliasId).select('id')
    expect(other.data ?? []).toHaveLength(0)
    const delDeny = await lsb.from('narcotic_aliases').delete().eq('id', aliasId).select('id')
    expect(delDeny.data ?? []).toHaveLength(0)
    const delOk = await lead.from('narcotic_aliases').delete().eq('id', aliasId).select('id')
    expect(delOk.error).toBeNull()
    expect(delOk.data).toHaveLength(1)
  })

  it('seizures: any active member logs one and everyone active reads it; detective delete denied', async () => {
    const ins = await lsb.from('narcotic_seizures')
      .insert({ narcotic_id: rows.canonical, state: 'suspected', amount_recorded: '2 bricks', notes: '[rls-test] v133' })
      .select('id, created_by')
    expect(ins.error).toBeNull()
    expect(ins.data![0].created_by).toBe(ids.lsb)
    const seizureId = ins.data![0].id as string
    const read = await bcb.from('narcotic_seizures').select('id, amount_recorded').eq('id', seizureId)
    expect(read.data).toHaveLength(1)
    expect(read.data![0].amount_recorded).toBe('2 bricks') // stays TEXT as recorded
    const delDeny = await bcb.from('narcotic_seizures').delete().eq('id', seizureId).select('id')
    expect(delDeny.data ?? []).toHaveLength(0)
    const delOk = await lead.from('narcotic_seizures').delete().eq('id', seizureId).select('id')
    expect(delOk.data).toHaveLength(1)
  })

  /* ── suggestion tracker (RPC-only writes) ── */

  it('submit_narcotic_suggestion: detective files one (submitted + event row); direct INSERT is denied', async () => {
    const res = await lsb.rpc('submit_narcotic_suggestion', {
      p_narcotic: rows.canonical, p_type: 'missing_alias',
      p_title: N('sug'), p_explanation: 'Heard a new street name on patrol.',
    })
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({ status: 'submitted', narcotic_id: rows.canonical, created_by: ids.lsb })
    rows.sug = res.data!.id as string
    const ev = await lsb.from('narcotic_suggestion_events')
      .select('event_type, to_status').eq('suggestion_id', rows.sug)
    expect(ev.error).toBeNull()
    expect(ev.data).toHaveLength(1)
    expect(ev.data![0]).toMatchObject({ event_type: 'submitted', to_status: 'submitted' })
    // No INSERT policy — writes are RPC-only.
    const direct = await lsb.from('narcotic_suggestions')
      .insert({ title: N('direct'), explanation: 'must fail', narcotic_id: rows.canonical })
      .select('id')
    expect(direct.error).not.toBeNull()
  })

  it('a suggestion on a restricted narcotic fails closed for a detective (no existence leak)', async () => {
    const res = await lsb.rpc('submit_narcotic_suggestion', {
      p_narcotic: rows.restricted, p_type: 'other',
      p_title: N('sug-restricted'), p_explanation: 'Should be denied.',
    })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/narcotic not found/i)
  })

  it('suggestion visibility: submitter and lead see it; an unrelated detective does NOT', async () => {
    const mine = await lsb.from('narcotic_suggestions').select('id').eq('id', rows.sug)
    expect(mine.data).toHaveLength(1)
    const mgr = await lead.from('narcotic_suggestions').select('id').eq('id', rows.sug)
    expect(mgr.data).toHaveLength(1)
    const theirs = await bcb.from('narcotic_suggestions').select('id').eq('id', rows.sug)
    expect(theirs.error).toBeNull()
    expect(theirs.data ?? []).toHaveLength(0)
  })

  it('decide_narcotic_suggestion: detective denied; a note is REQUIRED for declined; lead decides with one', async () => {
    const deny = await lsb.rpc('decide_narcotic_suggestion', { p_suggestion: rows.sug, p_status: 'under_review' })
    expect(deny.error).not.toBeNull()
    expect(deny.error!.message).toMatch(/bureau lead or higher/i)
    const noNote = await lead.rpc('decide_narcotic_suggestion', {
      p_suggestion: rows.sug, p_status: 'declined', p_note: '   ',
    })
    expect(noNote.error).not.toBeNull()
    expect(noNote.error!.message).toMatch(/note is required/i)
    const ok = await lead.rpc('decide_narcotic_suggestion', {
      p_suggestion: rows.sug, p_status: 'declined', p_note: '[rls-test] v133 decline note',
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ status: 'declined', decided_by: ids.lead })
  })

  /* ── merge_narcotics ── */

  it('merge_narcotics: detective denied; a blank reason raises', async () => {
    const deny = await lsb.rpc('merge_narcotics', {
      p_survivor: rows.survivor, p_merged: rows.merged, p_reason: '[rls-test] must fail',
    })
    expect(deny.error).not.toBeNull()
    expect(deny.error!.message).toMatch(/bureau lead or higher/i)
    const noReason = await lead.rpc('merge_narcotics', {
      p_survivor: rows.survivor, p_merged: rows.merged, p_reason: '   ',
    })
    expect(noReason.error).not.toBeNull()
    expect(noReason.error!.message).toMatch(/reason is required/i)
  })

  it('lead merges: tombstone set, alias/place-link/seizure repointed, merged name kept as survivor alias', async () => {
    const res = await lead.rpc('merge_narcotics', {
      p_survivor: rows.survivor, p_merged: rows.merged, p_reason: '[rls-test] v133 duplicate record',
    })
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({ id: rows.survivor })
    const tomb = await director.from('narcotics')
      .select('status, merged_into').eq('id', rows.merged).single()
    expect(tomb.error).toBeNull()
    expect(tomb.data).toMatchObject({ status: 'merged', merged_into: rows.survivor })
    for (const [table, id] of [
      ['narcotic_aliases', rows.mergedAlias],
      ['narcotic_places', rows.mergedPlace],
      ['narcotic_seizures', rows.mergedSeizure],
    ] as const) {
      const moved = await director.from(table).select('narcotic_id').eq('id', id).single()
      expect(moved.error).toBeNull()
      expect(moved.data!.narcotic_id).toBe(rows.survivor)
    }
    const nameAlias = await director.from('narcotic_aliases')
      .select('alias').eq('narcotic_id', rows.survivor).eq('alias', N('merged'))
    expect(nameAlias.error).toBeNull()
    expect(nameAlias.data).toHaveLength(1)
  })

  /* ── resolve_provisional_narcotic ── */

  it('resolve_provisional_narcotic: detective denied; lead confirms (reviewed_by stamped, row leaves the detective’s editable set)', async () => {
    const deny = await lsb.rpc('resolve_provisional_narcotic', {
      p_provisional: rows.provisional, p_action: 'confirm',
    })
    expect(deny.error).not.toBeNull()
    expect(deny.error!.message).toMatch(/bureau lead or higher/i)
    const ok = await lead.rpc('resolve_provisional_narcotic', {
      p_provisional: rows.provisional, p_action: 'confirm', p_note: '[rls-test] v133 confirm',
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ status: 'confirmed', reviewed_by: ids.lead })
    expect(ok.data!.reviewed_at).not.toBeNull()
    // No longer provisional → the creating detective's update window is closed.
    const after = await lsb.from('narcotics')
      .update({ summary: 'v133 must not land post-confirm.' }).eq('id', rows.provisional).select('id')
    expect(after.error).toBeNull()
    expect(after.data ?? []).toHaveLength(0)
  })

  /* ── search + anon wall ── */

  it('search_narcotics: detective finds seeded canonicals; merged tombstones excluded; anon has no EXECUTE', async () => {
    const seeded = await lsb.rpc('search_narcotics', { p_query: 'fentanyl' })
    expect(seeded.error).toBeNull()
    expect(((seeded.data ?? []) as Array<{ name: string }>).some((r) => /fentanyl/i.test(r.name))).toBe(true)
    // The merged fixture's exact name: excluded as a tombstone, but findable
    // via the survivor (its name became a survivor alias in the merge).
    const merged = await lsb.rpc('search_narcotics', { p_query: N('merged') })
    expect(merged.error).toBeNull()
    const hits = (merged.data ?? []) as Array<{ id: string }>
    expect(hits.some((r) => r.id === rows.merged)).toBe(false)
    expect(hits.some((r) => r.id === rows.survivor)).toBe(true)
    const a = await anon.rpc('search_narcotics', { p_query: 'fentanyl' })
    expect(a.error).not.toBeNull()
  })

  it('anon is outside the wall: zero narcotics rows and no suggestion RPC', async () => {
    const sel = await anon.from('narcotics').select('id').limit(1)
    expect(sel.data ?? []).toHaveLength(0)
    const rpc = await anon.rpc('submit_narcotic_suggestion', {
      p_narcotic: rows.canonical, p_type: 'other',
      p_title: N('sug-anon'), p_explanation: 'Should be denied.',
    })
    expect(rpc.error).not.toBeNull()
  })
})

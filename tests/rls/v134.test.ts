/** v1.34 — RESTRICTED narcotic street-value sales
 *  (migration 20260804010000_narcotic_sales).
 *
 *  Three restricted intelligence tables + a media flag, all gated by
 *  private.can_edit_narcotics_intel() (senior_detective / bureau_lead /
 *  deputy_director / director / owner) and, for confirmed-row edits,
 *  private.can_manage_narcotics() (bureau_lead+ / owner). No senior_detective
 *  fixture exists, so lead/director/owner are the AUTHORIZED set and lsb/bcb
 *  (plain detectives) are the UNAUTHORIZED set; anon mirrors the v133 wall.
 *
 *  Pins:
 *   - narcotic_sale_series / _observations SELECT: can_edit_narcotics_intel().
 *     lead AND director AND owner see the seeded "LeafOS — Ditch Witch"
 *     series and its 2 seeded observations (payments 15584 / 39208); lsb AND
 *     bcb see ZERO even when filtering by the known seeded ids;
 *   - narcotic_sale_stacks SELECT: inherits visibility via EXISTS on a visible
 *     observation — authorized see the 9 seeded stacks, plain detectives see 0;
 *   - anon: zero rows on all three tables and no EXECUTE on either RPC;
 *   - media leak fix: media.restricted + gated media_sel — lsb/bcb reading the
 *     restricted cannabis sale media (narcotic_id + restricted=true) get ZERO;
 *     lead/director see them; a NON-restricted media row stays visible to lsb
 *     (media_sel didn't break normal media);
 *   - INSERT authority: lsb/bcb are DENIED both the direct observation INSERT
 *     and the add_narcotic_sale_observation RPC; a lead creates a draft via the
 *     RPC (state='draft') and confirms it via confirm_narcotic_sale_observation
 *     (state='confirmed');
 *   - guard: a lead inserting through the RPC gets restricted=true forced
 *     regardless of the payload;
 *   - UPDATE: a plain detective cannot update a confirmed observation (0 rows);
 *     a manager (lead/owner) can. DELETE: series/observations are is_owner()
 *     only — a bureau lead is denied, the owner succeeds;
 *   - RPC anon-denial: anon calling either RPC is rejected;
 *   - no search leakage: lsb calling search_narcotics / search_all for
 *     'Ditch Witch' may surface the PUBLIC cannabis substance, but there is no
 *     sale branch in search — the three sale tables still return ZERO for lsb.
 *
 *  Fixtures (tests/rls/README.md): lead (bureau_lead LSB), director (director
 *  SAB), owner (detective+is_owner SAB), lsb (LSB detective), bcb (BCB
 *  detective). Read assertions hit the LIVE prod seed (series
 *  6132197e-…, narcotic 951825a7-… cannabis, observations 9b344092-… /
 *  c17b7abd-…). All write tests build their own [rls-test] v134 fixture series
 *  (never the seed); observations/stacks cascade from it and it is purged by
 *  the Owner (series_del is is_owner-only) at start AND teardown, so crashed
 *  runs never poison the next one. Requires migration 20260804010000. */

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
if (!enabled) console.warn('[rls:v134] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const STAMP = Date.now()
const N = (s: string) => `[rls-test] v134 ${s} ${STAMP}`

/** Live prod seed (migration §10) — never mutated, read-only assertions. */
const SEED = {
  series: '6132197e-b53a-45fc-9772-3172ea43f7c9',
  narcotic: '951825a7-e1f3-4a79-b3e2-e8c63a4599a4', // canonical Cannabis (media narcotic_id too)
  obsMids: '9b344092-82a6-45ac-8f93-e2841ae0db6d', // Sale 1, payment 15584
  obsFire: 'c17b7abd-b15a-4b3a-a544-7931b0cd346f', // Sale 2, payment 39208
}

describe.skipIf(!enabled)('v1.34 — restricted narcotic street-value sales (live)', () => {
  let anon: C, lead: C, director: C, owner: C, lsb: C, bcb: C
  const ids: Record<string, string> = {}
  const rows: Record<string, string> = {}
  const createdObs: string[] = []

  /** Purge every v134 fixture series via the Owner (series_del is is_owner-only;
   *  observations/stacks cascade). Runs at start AND teardown. */
  const purge = async () => {
    await owner.from('narcotic_sale_series').delete().like('name', '[rls-test] v134%')
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

    // Fixture series (a restricted-intel editor authors it); the guard pins
    // restricted=true + created_by. Write tests append observations here so the
    // live LeafOS seed is never touched, and the whole tree cascades away with
    // the series delete in teardown.
    const s = await lead.from('narcotic_sale_series')
      .insert({ narcotic_id: SEED.narcotic, name: N('series'), product_name: 'v134 fixture' })
      .select('id, restricted, created_by')
    if (s.error) throw new Error(`fixture series: ${s.error.message}`)
    expect(s.data![0]).toMatchObject({ restricted: true, created_by: ids.lead })
    rows.series = s.data![0].id as string
  })

  afterAll(async () => {
    if (owner) await purge()
    await Promise.all([lead, director, owner, lsb, bcb].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── 1. restricted read VISIBLE to the authorized set ── */

  it('authorized (lead/director/owner) read the seeded series, observations, and stacks', async () => {
    for (const c of [lead, director, owner]) {
      const series = await c.from('narcotic_sale_series').select('id, name').eq('id', SEED.series)
      expect(series.error).toBeNull()
      expect(series.data).toHaveLength(1)
      expect(series.data![0].name).toBe('LeafOS — Ditch Witch Street-Value Study')

      const obs = await c.from('narcotic_sale_observations')
        .select('id, payment_amount').in('id', [SEED.obsMids, SEED.obsFire])
      expect(obs.error).toBeNull()
      expect(obs.data).toHaveLength(2)
      const pay = Object.fromEntries((obs.data ?? []).map((r) => [r.id, Number(r.payment_amount)]))
      expect(pay[SEED.obsMids]).toBe(15584)
      expect(pay[SEED.obsFire]).toBe(39208)

      const stacks = await c.from('narcotic_sale_stacks')
        .select('id').in('observation_id', [SEED.obsMids, SEED.obsFire])
      expect(stacks.error).toBeNull()
      expect(stacks.data).toHaveLength(9) // 7 (Mids) + 2 (Fire)
    }
  })

  /* ── 2. restricted read HIDDEN from plain detectives ── */

  it('unauthorized (lsb/bcb) read ZERO from all three tables — even by seeded id', async () => {
    for (const c of [lsb, bcb]) {
      const series = await c.from('narcotic_sale_series').select('id').eq('id', SEED.series)
      expect(series.error).toBeNull()
      expect(series.data ?? []).toHaveLength(0)

      const obs = await c.from('narcotic_sale_observations')
        .select('id').in('id', [SEED.obsMids, SEED.obsFire])
      expect(obs.error).toBeNull()
      expect(obs.data ?? []).toHaveLength(0)

      // stacks inherit visibility via EXISTS on the parent observation — with
      // the observation invisible, the stack disappears too.
      const stacks = await c.from('narcotic_sale_stacks')
        .select('id').in('observation_id', [SEED.obsMids, SEED.obsFire])
      expect(stacks.error).toBeNull()
      expect(stacks.data ?? []).toHaveLength(0)
    }
  })

  /* ── 3. anon is outside the wall ── */

  it('anon reads ZERO from all three sale tables', async () => {
    for (const table of ['narcotic_sale_series', 'narcotic_sale_observations', 'narcotic_sale_stacks'] as const) {
      const r = await anon.from(table).select('id').limit(1)
      expect(r.data ?? []).toHaveLength(0)
    }
  })

  /* ── 4. media leak fix ── */

  it('restricted sale media: hidden from lsb/bcb, visible to lead/director; normal media unaffected', async () => {
    for (const c of [lsb, bcb]) {
      const hidden = await c.from('media')
        .select('id').eq('narcotic_id', SEED.narcotic).eq('restricted', true)
      expect(hidden.error).toBeNull()
      expect(hidden.data ?? []).toHaveLength(0)
    }
    for (const c of [lead, director]) {
      const seen = await c.from('media')
        .select('id').eq('narcotic_id', SEED.narcotic).eq('restricted', true)
      expect(seen.error).toBeNull()
      expect((seen.data ?? []).length).toBeGreaterThan(0) // 16 restricted rows seeded
    }
    // Control: media_sel did NOT break normal (non-restricted) media for a
    // plain detective — the gate only bites `restricted` rows.
    const normal = await lsb.from('media').select('id').eq('restricted', false).limit(1)
    expect(normal.error).toBeNull()
    expect((normal.data ?? []).length).toBeGreaterThan(0)
  })

  /* ── 5. INSERT authority ── */

  it('plain detectives cannot create observations (direct INSERT and RPC both denied); lead can via the RPC', async () => {
    // Direct INSERT — WITH CHECK (can_edit_narcotics_intel) rejects.
    const directIns = await lsb.from('narcotic_sale_observations')
      .insert({ series_id: rows.series, narcotic_id: SEED.narcotic, payment_amount: 1 }).select('id')
    expect(directIns.error).not.toBeNull()

    // RPC — SECURITY DEFINER guard raises 42501 for a non-editor.
    for (const c of [lsb, bcb]) {
      const rpc = await c.rpc('add_narcotic_sale_observation', {
        p_series: rows.series,
        p_observation: { payment_amount: 100, total_units: 1 },
        p_stacks: [{ stack_number: 1, units: 1 }],
      })
      expect(rpc.error).not.toBeNull()
    }

    // Lead creates a draft observation via the RPC → state='draft'.
    const add = await lead.rpc('add_narcotic_sale_observation', {
      p_series: rows.series,
      p_observation: { product_state: 'bagged', payment_amount: 500, total_units: 5 },
      p_stacks: [{ stack_number: 1, units: 5, recorded_weight_value: 10, recorded_weight_unit: 'g' }],
    })
    expect(add.error).toBeNull()
    const obsId = add.data as string
    createdObs.push(obsId)
    const draft = await lead.from('narcotic_sale_observations').select('state, restricted').eq('id', obsId).single()
    expect(draft.error).toBeNull()
    expect(draft.data).toMatchObject({ state: 'draft', restricted: true })

    // Lead confirms it via confirm_narcotic_sale_observation → state='confirmed'.
    const conf = await lead.rpc('confirm_narcotic_sale_observation', { p_id: obsId, p_reason: '[rls-test] v134 confirm' })
    expect(conf.error).toBeNull()
    const confirmed = await lead.from('narcotic_sale_observations').select('state').eq('id', obsId).single()
    expect(confirmed.data!.state).toBe('confirmed')
  })

  /* ── 6. guard: restricted forced true regardless of payload ── */

  it('a lead inserting through the RPC gets restricted=true forced even when the payload says false', async () => {
    const add = await lead.rpc('add_narcotic_sale_observation', {
      p_series: rows.series,
      p_observation: { restricted: false, state: 'draft', payment_amount: 42 },
      p_stacks: [],
    })
    expect(add.error).toBeNull()
    const obsId = add.data as string
    createdObs.push(obsId)
    const row = await lead.from('narcotic_sale_observations').select('restricted').eq('id', obsId).single()
    expect(row.error).toBeNull()
    expect(row.data!.restricted).toBe(true)
  })

  /* ── 7. UPDATE + DELETE authority ── */

  it('confirmed observation: plain detective cannot update, managers can; delete is Owner-only', async () => {
    // A manager-authored confirmed observation on the fixture series.
    const add = await lead.rpc('add_narcotic_sale_observation', {
      p_series: rows.series,
      p_observation: { state: 'confirmed', payment_amount: 999, total_units: 3 },
      p_stacks: [],
    })
    expect(add.error).toBeNull()
    const obsId = add.data as string
    createdObs.push(obsId)

    // UPDATE — a plain detective is blind to the row (no matching USING) → 0 rows.
    const lsbUpd = await lsb.from('narcotic_sale_observations')
      .update({ analyst_note: 'v134 must not land' }).eq('id', obsId).select('id')
    expect(lsbUpd.error).toBeNull()
    expect(lsbUpd.data ?? []).toHaveLength(0)

    // A manager (lead) may edit a confirmed observation.
    const leadUpd = await lead.from('narcotic_sale_observations')
      .update({ analyst_note: '[rls-test] v134 lead edit' }).eq('id', obsId).select('id, state, analyst_note')
    expect(leadUpd.error).toBeNull()
    expect(leadUpd.data).toHaveLength(1)
    expect(leadUpd.data![0]).toMatchObject({ state: 'confirmed', analyst_note: '[rls-test] v134 lead edit' })

    // The owner (can_manage via is_owner) may edit it too.
    const ownerUpd = await owner.from('narcotic_sale_observations')
      .update({ analyst_note: '[rls-test] v134 owner edit' }).eq('id', obsId).select('id')
    expect(ownerUpd.error).toBeNull()
    expect(ownerUpd.data).toHaveLength(1)

    // DELETE observation — is_owner() only: the bureau lead is denied.
    const leadDelObs = await lead.from('narcotic_sale_observations').delete().eq('id', obsId).select('id')
    expect(leadDelObs.error).toBeNull()
    expect(leadDelObs.data ?? []).toHaveLength(0)

    // DELETE series — also is_owner() only: the lead cannot drop the fixture series.
    const leadDelSeries = await lead.from('narcotic_sale_series').delete().eq('id', rows.series).select('id')
    expect(leadDelSeries.error).toBeNull()
    expect(leadDelSeries.data ?? []).toHaveLength(0)

    // The owner succeeds — this cleans the observation up.
    const ownerDelObs = await owner.from('narcotic_sale_observations').delete().eq('id', obsId).select('id')
    expect(ownerDelObs.error).toBeNull()
    expect(ownerDelObs.data).toHaveLength(1)
    createdObs.splice(createdObs.indexOf(obsId), 1)
  })

  /* ── 8. RPC anon-denial ── */

  it('anon cannot execute either sale RPC', async () => {
    const add = await anon.rpc('add_narcotic_sale_observation', {
      p_series: SEED.series, p_observation: {}, p_stacks: [],
    })
    expect(add.error).not.toBeNull()
    const conf = await anon.rpc('confirm_narcotic_sale_observation', { p_id: SEED.obsMids })
    expect(conf.error).not.toBeNull()
  })

  /* ── 9. no search leakage ── */

  it('search has no sale branch: lsb may find the public cannabis substance but ZERO sale rows', async () => {
    // search_narcotics / search_all are RLS-scoped over the PUBLIC catalog; the
    // cannabis substance is unrestricted so lsb may see it, but neither RPC
    // projects the restricted sale tables — this re-confirms table denial.
    const narc = await lsb.rpc('search_narcotics', { p_query: 'Ditch Witch' })
    expect(narc.error).toBeNull()
    const all = await lsb.rpc('search_all', { q: 'Ditch Witch' })
    expect(all.error).toBeNull()
    // No result kind references the sale tables (there is no such kind).
    const kinds = (all.data ?? []) as Array<{ kind: string }>
    expect(kinds.some((r) => /sale/i.test(r.kind))).toBe(false)

    // The security wall, re-asserted directly: lsb still reads zero sale rows.
    const series = await lsb.from('narcotic_sale_series').select('id').eq('id', SEED.series)
    expect(series.data ?? []).toHaveLength(0)
    const obs = await lsb.from('narcotic_sale_observations').select('id').in('id', [SEED.obsMids, SEED.obsFire])
    expect(obs.data ?? []).toHaveLength(0)
    const stacks = await lsb.from('narcotic_sale_stacks').select('id').in('observation_id', [SEED.obsMids, SEED.obsFire])
    expect(stacks.data ?? []).toHaveLength(0)
  })
})

/** v1.51 — restricted-media view-audit + break-glass (spec D6,
 *  migration 20260807240000_restricted_access).
 *
 *  Restricted media (media.restricted) is visible today only to an intel editor
 *  (private.can_edit_narcotics_intel() — senior_detective+/owner). This adds a
 *  bounded emergency path: a member already ON the case may BREAK-GLASS into its
 *  restricted media with a mandatory reason — a time-boxed (24h) case-scoped
 *  grant widens media_sel (view only; media_upd is untouched), command is
 *  notified, and every restricted view is separately audited (13.4 / 13.8).
 *
 *  Two RPC-write-only tables carry it (no client write policy):
 *   - restricted_access_log   ral_sel = private.is_command() (command read the
 *                             trail); writes only via the two RPCs;
 *   - restricted_access_grants rag_sel = command OR own; the 24h grant row.
 *  A SECURITY DEFINER predicate private.has_media_break_glass(case,user) lets
 *  media_sel consult a live grant without exposing the grants table.
 *
 *  This suite proves, on an LSB case lsb owns carrying one RESTRICTED media row
 *  (created by `lead`, who is command + intel-cleared so the insert's RETURNING
 *  is visible — a plain detective could insert restricted:true but never read it
 *  back, so the cleared fixture is the reliable way to mint the fixture row):
 *   - BEFORE break-glass lsb (active, NON-cleared) cannot SELECT the restricted
 *     row (media_sel hides it); lead + owner (both cleared) can;
 *   - restricted_media_count(case) returns >=1 for lsb — the count without the
 *     rows, so the UI can offer break-glass;
 *   - restricted_media_break_glass(case,'') is REJECTED (reason required); with a
 *     reason it SUCCEEDS, returning a grant whose expires_at is ~24h past
 *     granted_at, scoped to (case, lsb);
 *   - AFTER break-glass lsb CAN SELECT the restricted row (the grant widened
 *     media_sel); a DIFFERENT non-cleared member (bcb) still cannot — the grant
 *     is per-user;
 *   - log_restricted_view('media', id) by lsb writes exactly ONE audit row, and
 *     a second call within the hour de-dups (still one 'view' row);
 *   - anon is denied on all three RPCs; a non-command member (lsb) reads ZERO
 *     from restricted_access_log (ral_sel); a member reads only their OWN grant
 *     (lsb sees it, bcb does not);
 *   - break-glass by a caller WITHOUT case access (bcb, other division) is
 *     rejected.
 *
 *  Fixtures: lsb (active LSB detective, NON-cleared, owns the case → the
 *  break-glass caller), lead (LSB bureau_lead = command + cleared — mints the
 *  restricted row, reads the audit trail), owner (SAB detective + is_owner =
 *  cleared but NOT command — a positive cleared read, and proof ral_sel is
 *  command-not-owner), bcb (active BCB detective, NON-cleared, NO access to the
 *  LSB case — the per-user + no-case-access negatives), anon (denied).
 *
 *  CLEANUP: rls_test_cleanup (definer, owner-privileged) deletes the case's
 *  media and the case; restricted_access_grants CASCADE off the case FK, and the
 *  break-glass notifications to command are swept by the cleanup's notifications
 *  delete. CAVEAT: restricted_access_log.entity_id is NOT a foreign key and the
 *  table has no client delete policy, so the two audit rows (one 'view' keyed to
 *  the media id, one 'break_glass' keyed to the case id) LEAK — they become
 *  orphan rows referencing deleted ids. Only owner/service could remove them;
 *  this is flagged, not swept.
 *
 *  NOTE: the migration is not yet applied to the live project, so against the
 *  current DB this suite fails on the missing restricted_access_log /
 *  restricted_access_grants tables + the three RPCs — "written, needs migration
 *  applied", not a defect (same posture as v147–v150 before their migrations
 *  landed). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.owner && PW.bcb)
if (!enabled) console.warn('[rls:v151] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.51 — restricted-media audit + break-glass (live)', () => {
  let lsb: C, lead: C, owner: C, bcb: C, anon: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let mediaId = ''
  let grantId = ''

  beforeAll(async () => {
    lsb = mk(); lead = mk(); owner = mk(); bcb = mk(); anon = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // Best-effort pre-clean so a crashed prior run doesn't collide.
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }

    // lsb owns an LSB case → lsb has can_access_case (break-glass caller).
    const c = await lsb.from('cases').insert({ case_number: `V151-${tag}`, title: `[rls-test] v151 restricted-media case ${tag}`, bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data![0].id as string

    // `lead` (command + intel-cleared) mints the RESTRICTED media row — the
    // insert's RETURNING is visible only to a cleared reader.
    const m = await lead.from('media')
      .insert({ title: `[rls-test] v151 restricted ${tag}`, type: 'image', external_url: 'https://example.com/v151-restricted.png', case_id: caseId, restricted: true, category: 'surveillance' })
      .select('id, restricted')
    if (m.error) throw new Error(`restricted media insert failed: ${m.error.message}`)
    mediaId = m.data![0].id as string
    expect(m.data![0].restricted).toBe(true)
  })

  afterAll(async () => {
    // rls_test_cleanup deletes the case's media + the case (grants CASCADE off
    // the case FK; command notifications are swept too). The restricted_access_log
    // rows have no FK/delete path and are left as orphans — see CLEANUP CAVEAT.
    try { await lsb.rpc('rls_test_cleanup') } catch (e) { console.warn('[rls:v151] rls_test_cleanup failed:', (e as Error).message) }
    await Promise.all([lsb, lead, owner, bcb, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('BEFORE break-glass: lsb cannot SELECT the restricted media row; cleared members can', async () => {
    const hidden = await lsb.from('media').select('id').eq('id', mediaId)
    expect(hidden.error, hidden.error?.message).toBeNull()
    expect(hidden.data ?? []).toHaveLength(0)

    // Positive controls: lead (command+cleared) and owner (is_owner→cleared) see it.
    for (const c of [lead, owner]) {
      const seen = await c.from('media').select('id, restricted').eq('id', mediaId)
      expect(seen.error, seen.error?.message).toBeNull()
      expect(seen.data).toHaveLength(1)
      expect(seen.data![0].restricted).toBe(true)
    }
  })

  it('restricted_media_count(case) returns >=1 for lsb (the count without the rows)', async () => {
    const r = await lsb.rpc('restricted_media_count', { p_case: caseId })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data as number).toBeGreaterThanOrEqual(1)
  })

  it('break-glass with an empty reason is rejected; with a reason it succeeds (~24h grant)', async () => {
    const empty = await lsb.rpc('restricted_media_break_glass', { p_case: caseId, p_reason: '   ' })
    expect(empty.error).not.toBeNull()
    expect(empty.error!.message).toMatch(/reason is required/i)

    const ok = await lsb.rpc('restricted_media_break_glass', { p_case: caseId, p_reason: `[rls-test] v151 emergency ${tag}` })
    expect(ok.error, ok.error?.message).toBeNull()
    const grant = ok.data as { id: string; case_id: string; user_id: string; reason: string; granted_at: string; expires_at: string }
    grantId = grant.id
    expect(grant.case_id).toBe(caseId)
    expect(grant.user_id).toBe(ids.lsb)
    // expires_at = granted_at + 24h (both evaluated in the same insert).
    const span = new Date(grant.expires_at).getTime() - new Date(grant.granted_at).getTime()
    expect(span).toBeGreaterThan(23.5 * 3600 * 1000)
    expect(span).toBeLessThan(24.5 * 3600 * 1000)
  })

  it('AFTER break-glass: lsb CAN SELECT the restricted row; a different non-cleared member (bcb) still cannot', async () => {
    const seen = await lsb.from('media').select('id, restricted').eq('id', mediaId)
    expect(seen.error, seen.error?.message).toBeNull()
    expect(seen.data).toHaveLength(1)
    expect(seen.data![0].restricted).toBe(true)

    // Grant is per-user: bcb (active, non-cleared, no grant) is still blocked.
    const bcbSeen = await bcb.from('media').select('id').eq('id', mediaId)
    expect(bcbSeen.error, bcbSeen.error?.message).toBeNull()
    expect(bcbSeen.data ?? []).toHaveLength(0)
  })

  it('log_restricted_view writes exactly ONE audit row; a second call within the hour de-dups', async () => {
    const l1 = await lsb.rpc('log_restricted_view', { p_entity_type: 'media', p_entity: mediaId })
    expect(l1.error, l1.error?.message).toBeNull()
    const l2 = await lsb.rpc('log_restricted_view', { p_entity_type: 'media', p_entity: mediaId })
    expect(l2.error, l2.error?.message).toBeNull()

    // command reads the trail (ral_sel = is_command); exactly one 'view' row.
    const log = await lead.from('restricted_access_log').select('id, action, actor_id').eq('entity_id', mediaId).eq('action', 'view')
    expect(log.error, log.error?.message).toBeNull()
    expect(log.data).toHaveLength(1)
    expect(log.data![0].actor_id).toBe(ids.lsb)
  })

  it('anon is denied on all three RPCs', async () => {
    const count = await anon.rpc('restricted_media_count', { p_case: caseId })
    expect(count.error).not.toBeNull()
    const view = await anon.rpc('log_restricted_view', { p_entity_type: 'media', p_entity: mediaId })
    expect(view.error).not.toBeNull()
    const bg = await anon.rpc('restricted_media_break_glass', { p_case: caseId, p_reason: 'nope' })
    expect(bg.error).not.toBeNull()
  })

  it('a non-command member cannot read restricted_access_log (ral_sel)', async () => {
    const r = await lsb.from('restricted_access_log').select('id').eq('entity_id', mediaId)
    // ral_sel = is_command() only → lsb (non-command) sees zero rows.
    expect(r.error !== null || (r.data ?? []).length === 0).toBe(true)
    expect(r.data ?? []).toHaveLength(0)
  })

  it('a member reads only their OWN restricted_access_grants', async () => {
    const own = await lsb.from('restricted_access_grants').select('id, case_id, user_id').eq('id', grantId).maybeSingle()
    expect(own.error, own.error?.message).toBeNull()
    expect(own.data?.user_id).toBe(ids.lsb)

    // A different member cannot see lsb's grant (rag_sel = command OR own).
    const other = await bcb.from('restricted_access_grants').select('id').eq('id', grantId)
    expect(other.error !== null || (other.data ?? []).length === 0).toBe(true)
    expect(other.data ?? []).toHaveLength(0)
  })

  it('break-glass by a caller WITHOUT case access is rejected', async () => {
    // bcb is a BCB detective with no access to the LSB case.
    const r = await bcb.rpc('restricted_media_break_glass', { p_case: caseId, p_reason: 'no access but trying' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/case you have access to/i)
  })
})

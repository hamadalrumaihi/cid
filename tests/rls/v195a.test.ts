/** v1.95a — the Guide Library's AUDIENCE wall, and the reader's own state.
 *  Catalog test_id `v195a` (guide/read, guide/progress, guide/feedback).
 *
 *  The first pass (v194a) proved that a draft is the editors' alone. This one
 *  proves the two things the second pass added on the reading side:
 *
 *   · AUDIENCE IS A WALL, NOT A LABEL. A guide filed to an audience the reader
 *     is outside is ABSENT: not listed, not readable by id, not findable by
 *     search, and not reachable through any count. A restricted guide, a
 *     draft, an archived guide and a slug that never existed are ONE answer —
 *     anything else discloses the guide by the shape of the refusal.
 *   · READING IS PRIVATE. Where somebody got to in a guide and whether they
 *     marked it read is visible to exactly one person: not to command, not to
 *     the Owner. Feedback is the same — a member sees their own and nobody
 *     else's; an editor works the queue.
 *
 *  What the CID fixtures prove (lsb — an ordinary MCB detective; lead — the
 *  MCB Bureau Lead, i.e. command, who may edit guides):
 *   · #1 an owner-audience guide is invisible to an ordinary member by list,
 *     by id and by search — and its title, summary and tags never appear;
 *   · #2 an archived guide disappears from an ordinary member the same way,
 *     and comes back whole when it is restored;
 *   · #3 the new tables take no client writes (42501): the RPCs are the only
 *     way in, as with every other library table;
 *   · #4 guide_view records the reader's position and counts the read WITHOUT
 *     making the guide look edited, and command cannot see that row;
 *   · #5 marking a guide read is the reader's own, and reversible;
 *   · #6 a member's feedback lands as `new`, the member sees only their own,
 *     an editor sees it and settles it, and a member cannot settle anything;
 *   · #7 guides_search never returns a section of a guide the caller may not
 *     read — the same wall, through a different door.
 *
 *  Fixtures: two guides created by lead and stamped `[rls-test]` — one
 *  published to the OWNER audience, one published to everybody. The v2 splice
 *  in 20261108120000 PART 8 sweeps progress and feedback rows a fixture left
 *  on a real guide; everything else cascades from the guides themselves. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
}
const enabled = !!(ANON && PW.lsb && PW.lead)
if (!enabled) console.warn('[rls:v195a] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>

describe.skipIf(!enabled)('v1.95a — a guide outside your audience is absent, and your reading is yours', () => {
  let lsb: C, lead: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toLowerCase()
  const openSlug = `rls-test-${tag}-open`
  const shutSlug = `rls-test-${tag}-owner`
  const stamp = `[rls-test] v195a ${tag.toUpperCase()}`
  // A word that appears nowhere else in the library, so a search hit can only
  // have come from the fixture.
  const needle = `zqx${tag}`
  let openId = ''
  let shutId = ''

  const jsonRpc = async (c: C, fn: string, args: Json): Promise<Json> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn}: ${r.error?.message}`).toBeNull()
    return r.data as Json
  }
  const expectP0403 = async (c: C, fn: string, args: Json): Promise<void> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn} should raise`).not.toBeNull()
    expect(r.error!.code, `${fn}: ${r.error!.message}`).toBe('P0403')
  }
  const guideRow = async (c: C, id: string): Promise<Json | null> => {
    const r = await c.from('guides').select('*').eq('id', id).maybeSingle()
    expect(r.error, `guides: ${r.error?.message}`).toBeNull()
    return (r.data ?? null) as Json | null
  }

  beforeAll(async () => {
    lsb = mk(); lead = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const open = await jsonRpc(lead, 'guide_upsert', {
      p_slug: openSlug, p_title: `${stamp} open`, p_summary: 'A fixture guide everyone may read.',
      p_category: 'portal', p_body_key: 'user-guide', p_body_kind: 'module',
      p_audience: 'all', p_keywords: needle,
    })
    openId = String(open.id)
    const shut = await jsonRpc(lead, 'guide_upsert', {
      p_slug: shutSlug, p_title: `${stamp} owner-only`, p_summary: `A fixture guide only the Owner may read — ${needle}.`,
      p_category: 'command-admin', p_body_key: 'user-guide', p_body_kind: 'module',
      p_audience: 'owner', p_tags: [needle], p_keywords: needle,
    })
    shutId = String(shut.id)
    await jsonRpc(lead, 'guide_publish', { p_id: openId, p_published: true })
    await jsonRpc(lead, 'guide_publish', { p_id: shutId, p_published: true })
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v195a] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, lead].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #1 the audience wall ============ */

  it('#1 a guide filed to an audience you are outside is absent — not listed, not by id, not by search', async () => {
    // Published, and readable by its own editor: the guide really exists.
    const forLead = await guideRow(lead, shutId)
    expect(forLead, 'the editor can read it').not.toBeNull()
    expect(forLead!.status).toBe('published')
    expect(forLead!.audience).toBe('owner')

    // For an ordinary member it is simply not there — the SAME answer as a
    // guide that does not exist, with nothing in it to infer from.
    expect(await guideRow(lsb, shutId)).toBeNull()
    const list = await lsb.from('guides').select('id, title, summary, tags, keywords')
    expect(list.error, list.error?.message).toBeNull()
    const text = JSON.stringify(list.data)
    expect(text).not.toContain(shutId)
    expect(text).not.toContain('owner-only')
    expect(text).not.toContain(needle)

    // Not through a count either: a count is a disclosure if it moves.
    const counted = await lsb.from('guides').select('id', { count: 'exact', head: true }).eq('id', shutId)
    expect(counted.error, counted.error?.message).toBeNull()
    expect(counted.count).toBe(0)

    // The guide everyone may read IS there, so #1 is proving the wall rather
    // than an empty library.
    expect(await guideRow(lsb, openId), 'the open fixture is readable').not.toBeNull()
  })

  /* ============ #2 archived ============ */

  it('#2 archiving hides a guide from an ordinary member; restoring brings it back whole', async () => {
    await jsonRpc(lead, 'guide_archive', { p_id: openId, p_archived: true, p_reason: 'fixture' })
    expect(await guideRow(lsb, openId), 'archived is absent for a member').toBeNull()
    // The editor still sees it — archiving hides, it does not destroy.
    const held = await guideRow(lead, openId)
    expect(held).not.toBeNull()
    expect(held!.archived_at).not.toBeNull()
    expect(held!.title).toBe(`${stamp} open`)

    await jsonRpc(lead, 'guide_archive', { p_id: openId, p_archived: false })
    await jsonRpc(lead, 'guide_publish', { p_id: openId, p_published: true })
    const back = await guideRow(lsb, openId)
    expect(back, 'restored and republished is readable again').not.toBeNull()
    expect(back!.archived_at).toBeNull()
  })

  /* ============ #3 no client writes ============ */

  it('#3 the v2 tables are SELECT-only for clients', async () => {
    const cat = await lead.from('guide_categories').insert({ slug: 'rls-test-cat', label: 'X' })
    expect(cat.error?.code, cat.error?.message).toBe('42501')
    const sec = await lead.from('guide_sections').insert({ guide_id: openId, anchor: 'x', heading: 'X', body: 'x' })
    expect(sec.error?.code, sec.error?.message).toBe('42501')
    const prog = await lsb.from('guide_progress').insert({ guide_id: openId, user_id: ids.lsb })
    expect(prog.error?.code, prog.error?.message).toBe('42501')
    const fb = await lsb.from('guide_feedback').insert({ guide_id: openId, kind: 'helpful' })
    expect(fb.error?.code, fb.error?.message).toBe('42501')
    const idx = await lead.from('guide_search_index').insert({ guide_id: openId, anchor: 'x', heading: 'X', terms: 'x' })
    expect(idx.error?.code, idx.error?.message).toBe('42501')
    const rev = await lead.from('guide_revisions').insert({ guide_id: openId, revision_no: 99, snapshot: {} })
    expect(rev.error?.code, rev.error?.message).toBe('42501')
  })

  /* ============ #4–#5 reading is the reader's own ============ */

  it('#4 a view records the position and counts the read without making the guide look edited', async () => {
    const before = await guideRow(lead, openId)
    const wasUpdated = String(before!.updated_at)
    const wasCount = Number(before!.view_count)

    await jsonRpc(lsb, 'guide_view', { p_id: openId, p_anchor: 'cases' })

    const after = await guideRow(lead, openId)
    expect(Number(after!.view_count)).toBe(wasCount + 1)
    // Counting a read must not touch updated_at: otherwise every reader would
    // make the guide look freshly revised to everybody else.
    expect(String(after!.updated_at)).toBe(wasUpdated)

    const mine = await lsb.from('guide_progress').select('*').eq('guide_id', openId)
    expect(mine.error, mine.error?.message).toBeNull()
    expect(mine.data).toHaveLength(1)
    expect(mine.data![0].last_anchor).toBe('cases')
    expect(mine.data![0].user_id).toBe(ids.lsb)

    // Command may edit every guide and still cannot see who read one, or how
    // far they got. Reading is not oversight material.
    const theirs = await lead.from('guide_progress').select('*').eq('guide_id', openId)
    expect(theirs.error, theirs.error?.message).toBeNull()
    expect(theirs.data ?? []).toHaveLength(0)
  })

  it('#5 marking a guide read is the reader’s own, and reversible', async () => {
    await jsonRpc(lsb, 'guide_mark_complete', { p_id: openId, p_complete: true })
    const done = await lsb.from('guide_progress').select('completed_at').eq('guide_id', openId).single()
    expect(done.error, done.error?.message).toBeNull()
    expect(done.data!.completed_at).not.toBeNull()

    await jsonRpc(lsb, 'guide_mark_complete', { p_id: openId, p_complete: false })
    const undone = await lsb.from('guide_progress').select('completed_at').eq('guide_id', openId).single()
    expect(undone.data!.completed_at).toBeNull()

    // A guide outside the audience cannot be marked read either — the refusal
    // is `not_found`, the same answer as a guide that does not exist.
    const shut = await lsb.rpc('guide_mark_complete', { p_id: shutId, p_complete: true })
    expect(shut.error, shut.error?.message).toBeNull()
    expect((shut.data as Json).ok).toBe(false)
    expect((shut.data as Json).code).toBe('not_found')
  })

  /* ============ #6 feedback goes to a queue ============ */

  it('#6 feedback lands as new, is the member’s own to see, and only an editor settles it', async () => {
    const sent = await jsonRpc(lsb, 'guide_feedback_submit', {
      p_id: openId, p_kind: 'suggestion', p_comment: `${stamp} please add an example`, p_anchor: 'cases',
    })
    expect(sent.ok).toBe(true)
    const fbId = String(sent.id)

    const mine = await lsb.from('guide_feedback').select('*').eq('id', fbId).maybeSingle()
    expect(mine.error, mine.error?.message).toBeNull()
    expect(mine.data, 'a member sees their own').not.toBeNull()
    expect(mine.data!.status).toBe('new')

    const theirs = await lead.from('guide_feedback').select('*').eq('id', fbId).maybeSingle()
    expect(theirs.data, 'an editor works the queue').not.toBeNull()

    // A member cannot settle anything, including their own.
    await expectP0403(lsb, 'guide_feedback_resolve', { p_id: fbId, p_status: 'resolved' })

    const settled = await jsonRpc(lead, 'guide_feedback_resolve', { p_id: fbId, p_status: 'resolved', p_note: 'done' })
    expect(settled.ok).toBe(true)
    const after = await lead.from('guide_feedback').select('status, resolved_by').eq('id', fbId).single()
    expect(after.data!.status).toBe('resolved')
    expect(after.data!.resolved_by).toBe(ids.lead)
  })

  /* ============ #7 the same wall, through search ============ */

  it('#7 guides_search never returns a section of a guide the caller may not read', async () => {
    const forMember = await lsb.rpc('guides_search', { p_query: needle, p_limit: 20 })
    expect(forMember.error, forMember.error?.message).toBeNull()
    const hits = (forMember.data ?? []) as { guide_id: string; title: string }[]
    expect(hits.some((h) => h.guide_id === shutId), 'the owner-only guide must not surface').toBe(false)
    expect(JSON.stringify(hits)).not.toContain('owner-only')

    // And a blank query is no search at all, rather than the whole library.
    const blank = await lsb.rpc('guides_search', { p_query: '   ' })
    expect(blank.error, blank.error?.message).toBeNull()
    expect((blank.data ?? []) as unknown[]).toHaveLength(0)
  })
})

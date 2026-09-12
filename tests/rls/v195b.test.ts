/** v1.95b — the Guide Library's EDITOR surface.
 *  Catalog test_id `v195b` (guide/edit, write_sections, archive, revision,
 *  review, manage_categories, resolve_feedback).
 *
 *  The second pass let a guide be written in the portal rather than only in
 *  the repository. That is a lot of new authority, and the parts worth pinning
 *  are the ones that protect somebody's work:
 *
 *   · A SAVE NEVER SILENTLY OVERWRITES ANOTHER. Both upsert RPCs take the
 *     updated_at the editor last read and refuse as `conflict` when it has
 *     moved, handing back the current value so the editor can re-read.
 *   · AN ANCHOR IS PERMANENT. A link into a section has to keep working after
 *     somebody renames the heading, so the anchor is set once.
 *   · AN EMPTY GUIDE IS WORSE THAN NO GUIDE. A guide written in the portal
 *     cannot be published until it says something.
 *   · NOTHING IS LOST. Publishing and removing a section record what the guide
 *     said at that moment, and restoring an old revision saves the current one
 *     first.
 *
 *  What the CID fixtures prove (lsb — an ordinary MCB detective; lead — the
 *  MCB Bureau Lead, i.e. command, who may edit guides):
 *   · #1 an ordinary member holds none of the new authority (P0403 each time);
 *   · #2 a guide written in the portal cannot be published empty, and can once
 *     it has a section;
 *   · #3 the anchor is derived once and survives a rename; a duplicate anchor
 *     is refused;
 *   · #4 a stale save is a `conflict` and writes NOTHING — for the guide and
 *     for a section alike;
 *   · #5 publishing records a revision, and restoring one saves the current
 *     state first, so restoring can never lose work;
 *   · #6 a duplicate is a fresh DRAFT — no pin, no publication date, no
 *     reading count — and carries its own copy of the sections;
 *   · #7 a category is a row: adding one lets a guide be filed under it, and
 *     retiring it leaves every guide filed there readable.
 *
 *  Fixtures: one `sections` guide created by lead, stamped `[rls-test]`.
 *  Sections, revisions, progress and feedback cascade from it. */

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
if (!enabled) console.warn('[rls:v195b] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>

describe.skipIf(!enabled)('v1.95b — writing a guide in the portal, without losing anybody’s work', () => {
  let lsb: C, lead: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toLowerCase()
  const slug = `rls-test-${tag}-written`
  const copySlug = `rls-test-${tag}-copy`
  const catSlug = `rls-test-${tag}-shelf`
  const stamp = `[rls-test] v195b ${tag.toUpperCase()}`
  let guide = ''

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
  const guideRow = async (c: C, id: string): Promise<Json> => {
    const r = await c.from('guides').select('*').eq('id', id).single()
    expect(r.error, `guides: ${r.error?.message}`).toBeNull()
    return r.data as Json
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

    const made = await jsonRpc(lead, 'guide_upsert', {
      p_slug: slug, p_title: stamp, p_summary: 'A fixture guide written in the portal.',
      p_category: 'portal', p_audience: 'all', p_body_kind: 'sections',
    })
    guide = String(made.id)
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v195b] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, lead].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #1 none of it belongs to a member ============ */

  it('#1 an ordinary member holds none of the new editor authority', async () => {
    await expectP0403(lsb, 'guide_section_upsert', { p_guide: guide, p_heading: 'Mine now' })
    await expectP0403(lsb, 'guide_sections_reorder', { p_guide: guide, p_ids: [guide] })
    await expectP0403(lsb, 'guide_section_remove', { p_id: guide })
    await expectP0403(lsb, 'guide_archive', { p_id: guide, p_archived: true })
    await expectP0403(lsb, 'guide_duplicate', { p_id: guide, p_slug: `${slug}-theirs` })
    await expectP0403(lsb, 'guide_mark_reviewed', { p_id: guide })
    await expectP0403(lsb, 'guide_mark_outdated', { p_id: guide, p_reason: 'nonsense' })
    await expectP0403(lsb, 'guide_revision_restore', { p_id: guide })
    await expectP0403(lsb, 'guide_category_upsert', { p_slug: catSlug, p_label: 'Theirs' })
  })

  /* ============ #2 an empty guide is not an answer ============ */

  it('#2 a guide written in the portal cannot be published until it says something', async () => {
    const empty = await jsonRpc(lead, 'guide_publish', { p_id: guide, p_published: true })
    expect(empty.ok).toBe(false)
    expect(empty.code).toBe('empty')
    expect(String((await guideRow(lead, guide)).status)).toBe('draft')

    const first = await jsonRpc(lead, 'guide_section_upsert', {
      p_guide: guide, p_heading: 'Getting Started', p_body: 'Sign in and open the Action Center.',
    })
    expect(first.ok).toBe(true)
    expect(first.anchor).toBe('getting-started')

    const done = await jsonRpc(lead, 'guide_publish', { p_id: guide, p_published: true })
    expect(done.ok).toBe(true)
    expect(done.status).toBe('published')
  })

  /* ============ #3 the anchor is permanent ============ */

  it('#3 an anchor is set once, survives a rename, and cannot be taken twice', async () => {
    const rows = await lead.from('guide_sections').select('*').eq('guide_id', guide).order('sort_order')
    expect(rows.error, rows.error?.message).toBeNull()
    const first = rows.data![0]

    const renamed = await jsonRpc(lead, 'guide_section_upsert', {
      p_guide: guide, p_id: first.id, p_heading: 'Before you start',
    })
    expect(renamed.anchor).toBe('getting-started')
    const after = await lead.from('guide_sections').select('anchor, heading').eq('id', first.id).single()
    expect(after.data!.heading).toBe('Before you start')
    expect(after.data!.anchor, 'a link into the section still lands').toBe('getting-started')

    const clash = await jsonRpc(lead, 'guide_section_upsert', {
      p_guide: guide, p_heading: 'Getting started', p_body: 'A second one.',
    })
    expect(clash.ok).toBe(false)
    expect(clash.code).toBe('anchor_taken')

    // The index the library's search reads follows the sections.
    const idx = await lead.from('guide_search_index').select('anchor, heading').eq('guide_id', guide)
    expect(idx.error, idx.error?.message).toBeNull()
    expect(idx.data!.map((r) => r.anchor)).toContain('getting-started')
  })

  /* ============ #4 a stale save is a conflict, not an overwrite ============ */

  it('#4 a save carrying a stale updated_at writes nothing, for a guide and for a section', async () => {
    const now = await guideRow(lead, guide)
    const stale = '2020-01-01T00:00:00+00:00'

    const clash = await jsonRpc(lead, 'guide_upsert', {
      p_id: guide, p_title: `${stamp} CLOBBERED`, p_expected_updated_at: stale,
    })
    expect(clash.ok).toBe(false)
    expect(clash.code).toBe('conflict')
    expect(String((await guideRow(lead, guide)).title), 'nothing was written').toBe(String(now.title))
    // The current value comes back, so the editor can re-read and retry.
    expect(clash.updated_at).toBeTruthy()

    const retried = await jsonRpc(lead, 'guide_upsert', {
      p_id: guide, p_title: `${stamp} revised`, p_expected_updated_at: clash.updated_at,
    })
    expect(retried.ok).toBe(true)
    expect(String((await guideRow(lead, guide)).title)).toBe(`${stamp} revised`)

    const sec = await lead.from('guide_sections').select('*').eq('guide_id', guide).order('sort_order')
    const first = sec.data![0]
    const secClash = await jsonRpc(lead, 'guide_section_upsert', {
      p_guide: guide, p_id: first.id, p_body: 'clobbered', p_expected_updated_at: stale,
    })
    expect(secClash.ok).toBe(false)
    expect(secClash.code).toBe('conflict')
    const held = await lead.from('guide_sections').select('body').eq('id', first.id).single()
    expect(held.data!.body).toBe(first.body)
  })

  /* ============ #5 nothing is lost ============ */

  it('#5 publishing records a revision, and restoring one saves the current state first', async () => {
    const before = await lead.from('guide_revisions').select('id, revision_no, summary')
      .eq('guide_id', guide).order('revision_no', { ascending: false })
    expect(before.error, before.error?.message).toBeNull()
    expect(before.data!.length, 'creation and publication were both recorded').toBeGreaterThanOrEqual(2)
    const oldest = before.data![before.data!.length - 1]

    const titleNow = String((await guideRow(lead, guide)).title)
    const restored = await jsonRpc(lead, 'guide_revision_restore', { p_id: oldest.id })
    expect(restored.ok).toBe(true)

    const after = await lead.from('guide_revisions').select('id').eq('guide_id', guide)
    expect(after.data!.length, 'the state being replaced was recorded first')
      .toBeGreaterThan(before.data!.length)
    // The restore actually moved the guide back to the older title.
    expect(String((await guideRow(lead, guide)).title)).not.toBe(titleNow)
  })

  /* ============ #6 a copy is a fresh draft ============ */

  it('#6 a duplicate is a DRAFT with its own sections and none of the original’s standing', async () => {
    await jsonRpc(lead, 'guide_set_pinned', { p_id: guide, p_pinned: true })
    const out = await jsonRpc(lead, 'guide_duplicate', { p_id: guide, p_slug: copySlug, p_title: `${stamp} copy` })
    expect(out.ok).toBe(true)
    const copy = await guideRow(lead, String(out.id))
    expect(copy.status).toBe('draft')
    expect(copy.pinned).toBe(false)
    expect(copy.published_at).toBeNull()
    expect(Number(copy.view_count)).toBe(0)

    const theirs = await lead.from('guide_sections').select('id, anchor').eq('guide_id', String(out.id))
    expect(theirs.error, theirs.error?.message).toBeNull()
    expect(theirs.data!.length).toBeGreaterThan(0)
    const mine = await lead.from('guide_sections').select('id').eq('guide_id', guide)
    // Its own rows, not the original's — editing the copy must not edit the
    // guide it came from.
    const overlap = theirs.data!.filter((r) => mine.data!.some((m) => m.id === r.id))
    expect(overlap).toHaveLength(0)

    const taken = await jsonRpc(lead, 'guide_duplicate', { p_id: guide, p_slug: copySlug })
    expect(taken.code).toBe('slug_taken')
  })

  /* ============ #7 a category is a row ============ */

  it('#7 a category can be added and retired without touching the guides filed under it', async () => {
    const unknown = await jsonRpc(lead, 'guide_upsert', { p_id: guide, p_category: catSlug })
    expect(unknown.ok).toBe(false)
    expect(unknown.code).toBe('bad_request')

    expect((await jsonRpc(lead, 'guide_category_upsert', { p_slug: catSlug, p_label: `${stamp} shelf` })).ok).toBe(true)
    expect((await jsonRpc(lead, 'guide_upsert', { p_id: guide, p_category: catSlug })).ok).toBe(true)
    expect(String((await guideRow(lead, guide)).category)).toBe(catSlug)

    // Retiring the shelf must not take the books.
    expect((await jsonRpc(lead, 'guide_category_upsert', { p_slug: catSlug, p_active: false })).ok).toBe(true)
    const still = await guideRow(lead, guide)
    expect(still.category).toBe(catSlug)
    await jsonRpc(lead, 'guide_publish', { p_id: guide, p_published: true })
    const forMember = await lsb.from('guides').select('id').eq('id', guide).maybeSingle()
    expect(forMember.error, forMember.error?.message).toBeNull()
    expect(forMember.data, 'a guide on a retired shelf is still readable').not.toBeNull()

    // Content health: reviewing clears an out-of-date flag.
    expect((await jsonRpc(lead, 'guide_mark_outdated', { p_id: guide, p_reason: 'fixture' })).ok).toBe(true)
    expect((await guideRow(lead, guide)).outdated_at).not.toBeNull()
    expect((await jsonRpc(lead, 'guide_mark_reviewed', { p_id: guide })).ok).toBe(true)
    const reviewed = await guideRow(lead, guide)
    expect(reviewed.outdated_at).toBeNull()
    expect(reviewed.last_reviewed_at).not.toBeNull()
  })
})

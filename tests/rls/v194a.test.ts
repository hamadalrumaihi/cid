/** v1.94a — The Guide Library (migration 20261107120000_guide_library).
 *  Catalog test_id `v194a`.
 *
 *  A guide is REFERENCE CONTENT: it reads no portal record, writes none, and
 *  nothing on it is live. The wall is therefore small and needs to be exact —
 *  which is why it is worth pinning.
 *
 *  What the CID fixtures prove (lsb — an ordinary MCB detective; lead — the
 *  MCB Bureau Lead, i.e. command, who may edit guides; owner optional):
 *   · #1 the three tables are SELECT-only for clients: INSERT, UPDATE and
 *     DELETE all fail (42501), so the RPCs are the only way in;
 *   · #2 an ordinary member cannot create, publish, pin or delete a guide, and
 *     cannot add an image (P0403 every time);
 *   · #3 a guide created by command lands as a DRAFT, and a draft is invisible
 *     to an ordinary member — the same outcome as a slug that names nothing,
 *     which is what makes drafting safe;
 *   · #4 publishing makes it readable by every active member; unpublishing
 *     hides it again the same instant, and `published_at` records the FIRST
 *     publication and is not rewritten by the round trip;
 *   · #5 the address is validated in the RPC rather than left to the CHECK
 *     constraint: a bad slug is `bad_slug`, a taken one `slug_taken`, an
 *     unknown category `bad_request` — none of them escape as a 23514;
 *   · #6 a bookmark is PRIVATE: an ordinary member may bookmark any guide they
 *     can read, and command — who may edit every guide — cannot see that row;
 *   · #7 imagery validation happens in the RPC: alt text is required, the type
 *     must be one of four, and 10 MB is the cap. The reserved path is bound to
 *     the guide and the row (`<guide_id>/<media_id>/<file>`);
 *   · #8 Trash round trip: deleting a guide REQUIRES a reason, the row appears
 *     in `trash_list('guide')` labelled by its title, an ordinary member never
 *     sees it there, and `restore_record` brings it back.
 *
 *  What this suite does NOT prove: the storage policies themselves — an object
 *  upload needs real bytes and a live bucket. They were verified live in a
 *  rolled-back transaction when the migration was applied.
 *
 *  Fixtures: one draft guide created by lead, stamped `[rls-test]` in its
 *  title and given a unique slug. `rls_test_cleanup` (spliced by
 *  20261107120000 PART 7) sweeps guides a fixture authored — guide_media and
 *  guide_bookmarks cascade from the parent — and any bookmark a fixture left
 *  on a real guide. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.lead)
if (!enabled) console.warn('[rls:v194a] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>

describe.skipIf(!enabled)('v1.94a — a published guide is division reading; a draft is the editors’ alone', () => {
  let lsb: C, lead: C, owner: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toLowerCase()
  const slug = `rls-test-${tag}`
  const stamp = `[rls-test] v194a ${tag.toUpperCase()}`
  let guide = ''
  let mediaId = ''
  let mediaPath = ''

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
    if (PW.owner) { owner = mk(); ids.owner = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v194a] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, lead, owner].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #1 the tables take no client writes ============ */

  it('#1 guides, guide_media and guide_bookmarks are SELECT-only for clients', async () => {
    const ins = await lsb.from('guides').insert({ slug: `${slug}-direct`, title: stamp, body_key: 'undergrnd' })
    expect(ins.error?.code, ins.error?.message).toBe('42501')
    const insMedia = await lead.from('guide_media').insert({ guide_id: ids.lsb, storage_path: 'x/y/z.png', alt: 'x' })
    expect(insMedia.error?.code, insMedia.error?.message).toBe('42501')
    // A bookmark is the reader's own row and STILL goes through the RPC — the
    // table itself grants nothing, so there is one code path to audit.
    const insMark = await lsb.from('guide_bookmarks').insert({ guide_id: ids.lsb, user_id: ids.lsb })
    expect(insMark.error?.code, insMark.error?.message).toBe('42501')
    const upd = await lead.from('guides').update({ pinned: true }).eq('slug', 'undergrnd').select()
    expect(upd.error?.code, upd.error?.message).toBe('42501')
    const del = await lead.from('guides').delete().eq('slug', 'undergrnd').select()
    expect(del.error?.code, del.error?.message).toBe('42501')
  })

  /* ============ #2 an ordinary member is not an editor ============ */

  it('#2 an ordinary member cannot create, publish, pin, image or delete a guide', async () => {
    await expectP0403(lsb, 'guide_upsert', { p_slug: `${slug}-member`, p_title: stamp, p_body_key: 'undergrnd' })
    await expectP0403(lsb, 'guide_publish', { p_id: ids.lsb, p_published: true })
    await expectP0403(lsb, 'guide_set_pinned', { p_id: ids.lsb, p_pinned: true })
    await expectP0403(lsb, 'guide_media_attach', {
      p_guide: ids.lsb, p_alt: 'a tag', p_filename: 'a.png', p_mime: 'image/png', p_byte_size: 1024,
    })
    await expectP0403(lsb, 'guide_media_remove', { p_id: ids.lsb })
  })

  /* ============ #3–#4 draft, publish, unpublish ============ */

  it('#3 a new guide lands as a DRAFT, and a draft is invisible to an ordinary member', async () => {
    const out = await jsonRpc(lead, 'guide_upsert', {
      p_slug: slug, p_title: stamp, p_summary: 'A fixture guide.', p_category: 'general', p_body_key: 'undergrnd',
    })
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, status: 'draft' })
    guide = String(out.id)
    const asLead = await guideRow(lead, guide)
    expect(asLead).toMatchObject({ slug, status: 'draft', category: 'general', body_key: 'undergrnd' })
    expect(asLead!.published_at).toBeNull()
    // The member sees nothing at all — the same answer as a slug that names
    // nothing, which is the point.
    expect(await guideRow(lsb, guide)).toBeNull()
    const bySlug = await lsb.from('guides').select('id').eq('slug', slug)
    expect(bySlug.data ?? []).toEqual([])
  })

  it('#4 publishing opens it to every active member; unpublishing closes it, and the first publication date is kept', async () => {
    const pub = await jsonRpc(lead, 'guide_publish', { p_id: guide, p_published: true })
    expect(pub).toMatchObject({ ok: true, status: 'published' })
    const afterPub = await guideRow(lead, guide)
    const firstPublished = afterPub!.published_at as string
    expect(firstPublished).toBeTruthy()
    expect(await guideRow(lsb, guide)).toMatchObject({ slug, status: 'published' })

    const un = await jsonRpc(lead, 'guide_publish', { p_id: guide, p_published: false })
    expect(un).toMatchObject({ ok: true, status: 'draft' })
    expect(await guideRow(lsb, guide)).toBeNull()
    expect((await guideRow(lead, guide))!.published_at).toBe(firstPublished)

    // Back to published for the rest of the suite.
    await jsonRpc(lead, 'guide_publish', { p_id: guide, p_published: true })
    expect((await guideRow(lead, guide))!.published_at).toBe(firstPublished)
  })

  /* ============ #5 validation lives in the RPC ============ */

  it('#5 a bad address, a taken address and an unknown category are refused as jsonb, never as a CHECK violation', async () => {
    expect(await jsonRpc(lead, 'guide_upsert', { p_slug: 'Not A Slug', p_title: stamp, p_body_key: 'undergrnd' }))
      .toMatchObject({ ok: false, code: 'bad_slug' })
    expect(await jsonRpc(lead, 'guide_upsert', { p_slug: slug, p_title: stamp, p_body_key: 'undergrnd' }))
      .toMatchObject({ ok: false, code: 'slug_taken' })
    expect(await jsonRpc(lead, 'guide_upsert', { p_slug: `${slug}-2`, p_title: stamp, p_category: 'weapons', p_body_key: 'undergrnd' }))
      .toMatchObject({ ok: false, code: 'bad_request' })
    // A new guide needs all three of address, title and body key.
    expect(await jsonRpc(lead, 'guide_upsert', { p_slug: `${slug}-3`, p_title: stamp }))
      .toMatchObject({ ok: false, code: 'bad_request' })
  })

  /* ============ #6 a bookmark is one person's ============ */

  it('#6 a member bookmarks a guide they can read, and command cannot see that row', async () => {
    const on = await jsonRpc(lsb, 'guide_bookmark_toggle', { p_id: guide })
    expect(on).toMatchObject({ ok: true, bookmarked: true })
    const mine = await lsb.from('guide_bookmarks').select('guide_id, user_id').eq('guide_id', guide)
    expect(mine.error, mine.error?.message).toBeNull()
    expect(mine.data).toEqual([{ guide_id: guide, user_id: ids.lsb }])
    // Command may edit every guide and still sees nothing of anyone's reading.
    const theirs = await lead.from('guide_bookmarks').select('guide_id').eq('guide_id', guide)
    expect(theirs.error, theirs.error?.message).toBeNull()
    expect(theirs.data ?? []).toEqual([])
    const off = await jsonRpc(lsb, 'guide_bookmark_toggle', { p_id: guide })
    expect(off).toMatchObject({ ok: true, bookmarked: false })
  })

  it.skipIf(!hasOwner)('#6 not even the Owner reads another member’s bookmarks', async () => {
    await jsonRpc(lsb, 'guide_bookmark_toggle', { p_id: guide })
    const r = await owner!.from('guide_bookmarks').select('guide_id').eq('guide_id', guide)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data ?? []).toEqual([])
    await jsonRpc(lsb, 'guide_bookmark_toggle', { p_id: guide })
  })

  /* ============ #7 imagery ============ */

  it('#7 an image needs alt text, one of four types and at most 10 MB, and its path is bound to the guide and the row', async () => {
    expect(await jsonRpc(lead, 'guide_media_attach', {
      p_guide: guide, p_alt: '   ', p_filename: 'a.png', p_mime: 'image/png', p_byte_size: 1024,
    })).toMatchObject({ ok: false, code: 'alt_required' })
    expect(await jsonRpc(lead, 'guide_media_attach', {
      p_guide: guide, p_alt: 'a tag', p_filename: 'a.svg', p_mime: 'image/svg+xml', p_byte_size: 1024,
    })).toMatchObject({ ok: false, code: 'bad_type' })
    expect(await jsonRpc(lead, 'guide_media_attach', {
      p_guide: guide, p_alt: 'a tag', p_filename: 'a.png', p_mime: 'image/png', p_byte_size: 10 * 1024 * 1024 + 1,
    })).toMatchObject({ ok: false, code: 'too_large' })

    const ok = await jsonRpc(lead, 'guide_media_attach', {
      p_guide: guide, p_alt: 'A tag on a shutter', p_filename: 'Photo 1.PNG', p_section: 'u-gear',
      p_caption: 'A caption', p_mime: 'image/png', p_byte_size: 4096,
    })
    expect(ok).toMatchObject({ ok: true, bucket: 'guides', sort_order: 0 })
    mediaId = String(ok.media_id)
    mediaPath = String(ok.storage_path)
    expect(mediaPath).toBe(`${guide}/${mediaId}/photo-1.png`)

    // A guide the caller cannot see is not_found, not a different error.
    expect(await jsonRpc(lead, 'guide_media_attach', {
      p_guide: ids.lsb, p_alt: 'x', p_filename: 'a.png', p_mime: 'image/png', p_byte_size: 10,
    })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('#7 an ordinary member reads a published guide’s imagery but cannot change it', async () => {
    const r = await lsb.from('guide_media').select('id, alt, section').eq('guide_id', guide)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data?.map((m) => m.id)).toEqual([mediaId])
    await expectP0403(lsb, 'guide_media_update', { p_id: mediaId, p_alt: 'rewritten' })
    await expectP0403(lsb, 'guide_media_reorder', { p_guide: guide, p_ids: [mediaId], p_section: 'u-gear' })
  })

  it('#7 removing an image takes the row and leaves the guide exactly as it was', async () => {
    const before = await guideRow(lead, guide)
    expect(await jsonRpc(lead, 'guide_media_update', { p_id: mediaId, p_alt: 'A tag, re-described' }))
      .toMatchObject({ ok: true })
    expect(await jsonRpc(lead, 'guide_media_remove', { p_id: mediaId })).toMatchObject({ ok: true })
    const after = await guideRow(lead, guide)
    expect(after!.title).toBe(before!.title)
    expect(after!.summary).toBe(before!.summary)
    expect(after!.body_key).toBe(before!.body_key)
    expect(after!.status).toBe(before!.status)
    const gone = await lead.from('guide_media').select('id').eq('id', mediaId)
    expect(gone.data ?? []).toEqual([])
  })

  /* ============ #8 the Trash round trip ============ */

  it('#8 deleting a guide needs a reason, reaches the Trash for editors only, and restores', async () => {
    expect(await jsonRpc(lead, 'soft_delete', { p_kind: 'guide', p_id: guide }))
      .toMatchObject({ ok: false, code: 'reason_required' })
    // soft_delete / restore_record answer a refusal as jsonb rather than
    // raising — the generic RPCs' shape, not this migration's.
    expect(await jsonRpc(lsb, 'soft_delete', { p_kind: 'guide', p_id: guide, p_reason: 'not mine to delete' }))
      .toMatchObject({ ok: false, code: 'denied' })

    expect(await jsonRpc(lead, 'soft_delete', { p_kind: 'guide', p_id: guide, p_reason: 'superseded' }))
      .toMatchObject({ ok: true, kind: 'guide' })
    expect(await guideRow(lsb, guide)).toBeNull()

    const trash = await lead.rpc('trash_list', { p_kind: 'guide' })
    expect(trash.error, trash.error?.message).toBeNull()
    const mine = (trash.data as { id: string; label: string; restorable: boolean }[]).find((t) => t.id === guide)
    expect(mine, 'the deleted guide should be in the editors’ Trash').toBeTruthy()
    expect(mine!.label).toBe(stamp)

    // The wall: trash_list admits a guide on the restore answer ALONE, so an
    // ordinary member must see nothing of it.
    const memberTrash = await lsb.rpc('trash_list', { p_kind: 'guide' })
    expect(memberTrash.error, memberTrash.error?.message).toBeNull()
    expect((memberTrash.data as { id: string }[]).some((t) => t.id === guide)).toBe(false)
    expect(await jsonRpc(lsb, 'restore_record', { p_kind: 'guide', p_id: guide }))
      .toMatchObject({ ok: false, code: 'denied' })

    expect(await jsonRpc(lead, 'restore_record', { p_kind: 'guide', p_id: guide }))
      .toMatchObject({ ok: true, kind: 'guide' })
    expect(await guideRow(lsb, guide)).toMatchObject({ slug, status: 'published' })
  })
})

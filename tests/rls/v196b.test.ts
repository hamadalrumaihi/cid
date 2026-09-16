/** v1.96b — one documentation library: the walls survived the move.
 *
 *  The SOPs area and the Guide Library were two systems over the same idea,
 *  and consolidating them meant re-expressing every document's `classification`
 *  as an `audience`. A migration like that fails silently in one direction —
 *  a document that was SIB-only becoming division reading — so the mapping is
 *  pinned here rather than trusted.
 *
 *   · #1 the migrated documents are in the library, typed, and carry their
 *     provenance (`migrated_document_id`);
 *   · #2 the SIB SOP stays SIB's. An ordinary CID detective — who could read
 *     every other migrated document — gets nothing for it, by list and by
 *     slug; an SIB account gets it. This is the one row whose classification
 *     was not `internal`, and the whole reason the mapping was checked;
 *   · #3 the retired tables are the OWNER's. A detective, a Bureau Lead and
 *     CID Command all read zero rows from `documents`, `document_sections`
 *     and `documents_versions` — the content moved, and the old copy is a
 *     record, not a second place to read from;
 *   · #4 the retired tables take no writes from anyone: no INSERT, no UPDATE,
 *     no DELETE, whatever the caller's rank;
 *   · #5 search still finds the SOPs. `guides_search` returns migrated
 *     content for the terms members actually type, and it matches SECTION
 *     TEXT, not just titles;
 *   · #6 a superseded document is still readable by its audience, and names
 *     its replacement — supersession records history, it does not delete it;
 *   · #7 type, category, audience and status are four independent columns:
 *     filtering by one does not constrain another.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  siuAgent: process.env.RLS_TEST_PASSWORD_SIU_AGENT,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.director)
if (!enabled) console.warn('[rls:v196b] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner
const hasSiu = !!PW.siuAgent

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>

/** The three retired tables. Owner-only, read-only, all of them. */
const RETIRED = ['documents', 'document_sections', 'documents_versions'] as const
const SIB_SOP = 'special-investigations-bureau-sop'

describe.skipIf(!enabled)('v1.96b — one documentation library', () => {
  let lsb: C, lead: C, director: C
  let owner: C | null = null, siu: C | null = null

  const guide = async (c: C, slug: string): Promise<Json | null> => {
    const r = await c.from('guides').select('*').eq('slug', slug).maybeSingle()
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? null) as Json | null
  }
  const rowsOf = async (c: C, table: string): Promise<Json[]> => {
    const r = await c.from(table).select('*').limit(50)
    expect(r.error, `${table}: ${r.error?.message}`).toBeNull()
    return (r.data ?? []) as Json[]
  }

  beforeAll(async () => {
    lsb = mk(); lead = mk(); director = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)
    if (hasOwner) { owner = mk(); await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!) }
    if (hasSiu) { siu = mk(); await signInWithRetry(siu, 'rls-test-siu-agent@cidportal.test', PW.siuAgent!) }
  }, 120_000)

  it('#1 the migrated documents are in the library, typed, and carry their provenance', async () => {
    const r = await lsb.from('guides').select('slug,doc_type,migrated_document_id').not('migrated_document_id', 'is', null)
    expect(r.error, r.error?.message).toBeNull()
    const rows = (r.data ?? []) as Array<{ slug: string; doc_type: string }>
    expect(rows.length, 'the reader sees the documents the mapping gave them').toBeGreaterThan(0)
    // Every migrated row carries a real type — nothing landed as an untyped blob.
    for (const g of rows) {
      expect(['sop', 'policy', 'procedure', 'guide', 'form', 'report_template', 'reference', 'training'])
        .toContain(g.doc_type)
    }
    // The forms came across as forms, not as SOPs.
    expect(rows.some((g) => g.doc_type === 'sop')).toBe(true)
    expect(rows.some((g) => g.doc_type === 'form')).toBe(true)
  })

  it('#2 the SIB SOP stays SIB’s — invisible to a CID detective, by list and by slug', async () => {
    expect(await guide(lsb, SIB_SOP), 'classification siu became audience sib').toBeNull()
    const list = await lsb.from('guides').select('slug').eq('slug', SIB_SOP)
    expect(list.error, list.error?.message).toBeNull()
    expect(list.data ?? []).toEqual([])
    // The title must not surface through search either.
    const s = await lsb.rpc('guides_search', { p_query: 'Special Investigations Bureau', p_limit: 20 })
    expect(s.error, s.error?.message).toBeNull()
    expect(((s.data ?? []) as Array<{ slug: string }>).map((h) => h.slug)).not.toContain(SIB_SOP)
  })

  it.skipIf(!hasSiu)('#2b an SIB account reads it', async () => {
    expect(await guide(siu!, SIB_SOP), 'the SIB SOP is SIB reading').toBeTruthy()
  })

  it('#3 the retired tables are the Owner’s — nobody else reads a row', async () => {
    for (const client of [lsb, lead, director]) {
      for (const t of RETIRED) expect(await rowsOf(client, t), `${t} must be empty`).toEqual([])
    }
  })

  it.skipIf(!hasOwner)('#3b the Owner still has the whole record, versions included', async () => {
    expect((await rowsOf(owner!, 'documents')).length).toBeGreaterThan(0)
    expect((await rowsOf(owner!, 'documents_versions')).length).toBeGreaterThan(0)
  })

  it('#4 the retired tables take no writes, from any rank', async () => {
    for (const client of [lsb, lead, director]) {
      const ins = await client.from('documents').insert({ name: '[rls-test] v196b', folder: 'SOPs' }).select('id')
      expect(ins.error, 'the retired library accepts no new document').not.toBeNull()

      const upd = await client.from('documents').update({ name: 'HIJACK' }).neq('id', '00000000-0000-4000-8000-000000000000').select('id')
      if (upd.error) expect(upd.error.code).toBe('42501')
      else expect(upd.data ?? [], 'an UPDATE changes nothing').toEqual([])

      const del = await client.from('documents').delete().neq('id', '00000000-0000-4000-8000-000000000000').select('id')
      if (del.error) expect(del.error.code).toBe('42501')
      else expect(del.data ?? [], 'a DELETE removes nothing').toEqual([])
    }
  })

  it('#5 the SOPs are still findable — by the words members actually type', async () => {
    for (const term of ['SOP', 'undercover', 'evidence', 'surveillance', 'case management']) {
      const r = await lsb.rpc('guides_search', { p_query: term, p_limit: 20 })
      expect(r.error, `${term}: ${r.error?.message}`).toBeNull()
      expect((r.data ?? []).length, `"${term}" must return library content`).toBeGreaterThan(0)
    }
  })

  it('#5b search matches section text, not only titles', async () => {
    // A term that appears INSIDE a document rather than in any title.
    const r = await lsb.rpc('guides_search', { p_query: 'surveillance', p_limit: 20 })
    expect(r.error, r.error?.message).toBeNull()
    const hits = (r.data ?? []) as Array<{ title: string; heading: string }>
    expect(hits.some((h) => !h.title.toLowerCase().includes('surveillance')),
      'at least one hit is a body match, not a title match').toBe(true)
  })

  it('#6 a superseded document is still readable and names its replacement', async () => {
    const old = await guide(lsb, 'cid-sop-superseded-2026-06')
    expect(old, 'supersession records history — it does not delete it').toBeTruthy()
    expect(old!.status).toBe('superseded')
    expect(old!.superseded_by, 'a superseded document must name what replaced it').toBeTruthy()

    const current = await guide(lsb, 'cid-standard-operating-procedure')
    expect(current).toBeTruthy()
    expect(old!.superseded_by).toBe(current!.id)
    expect(current!.status).toBe('published')
  })

  it('#7 type, category, audience and status are four independent columns', async () => {
    const r = await lsb.from('guides').select('slug,doc_type,category,audience,status').not('migrated_document_id', 'is', null)
    expect(r.error, r.error?.message).toBeNull()
    const rows = (r.data ?? []) as Array<{ doc_type: string; category: string; status: string }>
    // The same TYPE appears under more than one CATEGORY, and one category
    // carries more than one type — neither column is a proxy for the other.
    const byType = new Map<string, Set<string>>()
    const byCat = new Map<string, Set<string>>()
    for (const g of rows) {
      byType.set(g.doc_type, (byType.get(g.doc_type) ?? new Set()).add(g.category))
      byCat.set(g.category, (byCat.get(g.category) ?? new Set()).add(g.doc_type))
    }
    expect([...byType.values()].some((s) => s.size > 1), 'a type spans categories').toBe(true)
    expect([...byCat.values()].some((s) => s.size > 1), 'a category spans types').toBe(true)
  })
})

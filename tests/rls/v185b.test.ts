/** v1.85b — case_links and case_audit_feed (Portal Improvements P3-04,
 *  migration 20261022120000).
 *
 *  Related cases:
 *   · a link needs case access on the source AND read access on the target,
 *     created_by = the caller; a link to a case the caller cannot read is a
 *     policy violation (42501) — a link never reveals a case;
 *   · a reader who cannot read BOTH cases sees no link;
 *   · no client DELETE — soft_delete('case_link').
 *  The activity feed (definer, every row re-checked with the CALLER's
 *  predicate):
 *   · contains the case's own INSERT row, its notes' rows and its link row;
 *   · a command-restricted note's rows are ABSENT for a Detective (no
 *     placeholder) while command's feed carries them;
 *   · detail never carries body_md / notes / narrative;
 *   · changed_fields ride only on UPDATE rows (from record_versions);
 *   · p_limit and p_before page the feed;
 *   · a viewer without case read gets ZERO rows (bcb).
 *
 *  Fixtures: lsb (MCB detective — cases A and B), bcb (SCB detective —
 *  case C, the unreadable target), lead (MCB Bureau Lead — the restricted
 *  note). rls_test_cleanup() sweeps the cases (links and notes cascade). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, bcb: process.env.RLS_TEST_PASSWORD_BCB, lead: process.env.RLS_TEST_PASSWORD_LEAD }
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v185b] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type FeedRow = {
  id: number; at: string; actor_id: string | null; action: string; entity: string; entity_id: string | null
  kind: string; label: string | null; changed_fields: string[] | null; detail: Record<string, unknown> | null
}
const HIDDEN = ['body_md', 'notes', 'note', 'narrative', 'summary']
const feed = async (c: C, caseId: string, extra: { p_limit?: number; p_before?: string } = {}): Promise<FeedRow[]> => {
  const r = await c.rpc('case_audit_feed', { p_case: caseId, ...extra })
  expect(r.error, `case_audit_feed: ${r.error?.message}`).toBeNull()
  return (r.data ?? []) as unknown as FeedRow[]
}

describe.skipIf(!enabled)('v1.85b — case_links and the per-viewer activity feed', () => {
  let lsb: C, bcb: C, lead: C
  let lsbId = '', bcbId = '', leadId = ''
  let caseA = '', caseB = '', caseC = '', noteId = '', restrictedId = '', linkId = ''
  const tag = Date.now().toString(36)
  const stamp = `[rls-test] v185b ${tag}`

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    bcbId = await signInWithRetry(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    leadId = await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    const a = await lsb.from('cases').insert({ case_number: `V185B-${tag}-A`, title: `${stamp} case A`, bureau: 'major_crimes' }).select('id').single()
    if (a.error) throw new Error(`case A insert failed: ${a.error.message}`)
    caseA = a.data!.id
    const b = await lsb.from('cases').insert({ case_number: `V185B-${tag}-B`, title: `${stamp} case B`, bureau: 'major_crimes' }).select('id').single()
    if (b.error) throw new Error(`case B insert failed: ${b.error.message}`)
    caseB = b.data!.id
    const c = await bcb.from('cases').insert({ case_number: `V185B-${tag}-C`, title: `${stamp} case C (SCB)`, bureau: 'street_crimes' }).select('id').single()
    if (c.error) throw new Error(`case C insert failed: ${c.error.message}`)
    caseC = c.data!.id
    const n = await lsb.from('case_notes').insert({ case_id: caseA, author_id: lsbId, body_md: `${stamp} SECRET-BODY note on A` }).select('id').single()
    if (n.error) throw new Error(`note insert failed: ${n.error.message}`)
    noteId = n.data!.id
  }, 90_000)

  afterAll(async () => { if (lsb) await lsb.rpc('rls_test_cleanup') })

  it('a Detective links two readable cases; a link to an unreadable case is a policy violation; the pair is unique', async () => {
    const ok = await lsb.from('case_links').insert({ case_id: caseA, related_case_id: caseB, kind: 'related', created_by: lsbId, note: `${stamp} A→B` }).select('id, kind').single()
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data!.kind).toBe('related')
    linkId = ok.data!.id

    const unreadable = await lsb.from('case_links').insert({ case_id: caseA, related_case_id: caseC, kind: 'see_also', created_by: lsbId })
    expect(unreadable.error?.code).toBe('42501')

    // The other direction: bcb has no access to A, so its insert is refused too.
    const reverse = await bcb.from('case_links').insert({ case_id: caseC, related_case_id: caseA, kind: 'see_also', created_by: bcbId })
    expect(reverse.error?.code).toBe('42501')

    const forged = await lsb.from('case_links').insert({ case_id: caseB, related_case_id: caseA, kind: 'related', created_by: leadId })
    expect(forged.error?.code).toBe('42501')

    const dup = await lsb.from('case_links').insert({ case_id: caseA, related_case_id: caseB, kind: 'duplicate', created_by: lsbId })
    expect(dup.error?.code).toBe('23505')
  })

  it('the link reads for those who read both cases; another bureau sees none; no client DELETE', async () => {
    expect((await lsb.from('case_links').select('id').eq('case_id', caseA)).data).toEqual([{ id: linkId }])
    expect((await lead.from('case_links').select('id').eq('related_case_id', caseB)).data).toEqual([{ id: linkId }])
    expect((await bcb.from('case_links').select('id').eq('case_id', caseA)).data).toEqual([])
    expect((await lsb.from('case_links').delete().eq('id', linkId)).error?.code).toBe('42501')
  })

  it('the feed for a case reader carries the case INSERT, the note rows and the link row — never a note body', async () => {
    const rows = await feed(lsb, caseA)
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.some((r) => r.kind === 'case' && r.action === 'INSERT' && r.entity === 'cases' && r.entity_id === caseA)).toBe(true)
    expect(rows.find((r) => r.kind === 'case' && r.action === 'INSERT')?.label).toBe(`V185B-${tag}-A`)
    expect(rows.some((r) => r.kind === 'case_note' && r.entity_id === noteId && r.action === 'INSERT')).toBe(true)
    expect(rows.find((r) => r.kind === 'case_note' && r.entity_id === noteId)?.label).toBe('note')
    expect(rows.some((r) => r.kind === 'case_link' && r.entity_id === linkId && r.label === 'related')).toBe(true)
    // Nothing is listed for a legal request, ever; no detail key is a body.
    expect(rows.some((r) => r.entity === 'legal_requests')).toBe(false)
    for (const r of rows) {
      for (const k of HIDDEN) expect(r.detail == null || !(k in r.detail), `${k} leaked on ${r.entity} ${r.action}`).toBe(true)
      expect(JSON.stringify(r)).not.toContain('SECRET-BODY')
      if (r.action !== 'UPDATE') expect(r.changed_fields).toBeNull()
    }
    // Newest first.
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].at >= rows[i].at).toBe(true)
  })

  it('a command-restricted note is absent from a Detective\'s feed and present in command\'s', async () => {
    const r = await lead.from('case_notes').insert({ case_id: caseA, author_id: leadId, body_md: `${stamp} restricted`, restricted_to_command: true }).select('id').single()
    expect(r.error, r.error?.message).toBeNull()
    restrictedId = r.data!.id

    const mine = await feed(lsb, caseA)
    expect(mine.some((x) => x.entity_id === restrictedId)).toBe(false)
    expect(mine.some((x) => x.entity_id === noteId)).toBe(true)

    const theirs = await feed(lead, caseA)
    expect(theirs.some((x) => x.kind === 'case_note' && x.entity_id === restrictedId && x.action === 'INSERT')).toBe(true)
    expect(theirs.some((x) => x.entity_id === noteId)).toBe(true)
  })

  it('an UPDATE row carries changed_fields from record_versions; INSERT rows do not', async () => {
    const upd = await lsb.from('case_notes').update({ pinned: true }).eq('id', noteId).select('id')
    expect(upd.error, upd.error?.message).toBeNull()
    expect(upd.data).toHaveLength(1)
    const rows = await feed(lsb, caseA)
    const update = rows.find((r) => r.kind === 'case_note' && r.entity_id === noteId && r.action === 'UPDATE')
    expect(update, 'note UPDATE row').toBeDefined()
    expect(update!.changed_fields).toContain('pinned')
    expect(update!.label).toBe('pinned note')
    expect(rows.find((r) => r.entity_id === noteId && r.action === 'INSERT')!.changed_fields).toBeNull()
  })

  it('p_limit and p_before page the feed newest-first', async () => {
    const all = await feed(lsb, caseA)
    const one = await feed(lsb, caseA, { p_limit: 1 })
    expect(one).toHaveLength(1)
    expect(one[0].id).toBe(all[0].id)
    const older = await feed(lsb, caseA, { p_before: all[0].at })
    expect(older.every((r) => r.at < all[0].at)).toBe(true)
    expect(older.some((r) => r.id === all[0].id)).toBe(false)
  })

  it('a viewer without case read gets zero rows', async () => {
    expect(await feed(bcb, caseA)).toEqual([])
    expect(await feed(bcb, caseB)).toEqual([])
    // And bcb's own case reads for bcb only.
    expect((await feed(bcb, caseC)).some((r) => r.kind === 'case' && r.action === 'INSERT')).toBe(true)
    expect(await feed(lsb, caseC)).toEqual([])
  })

  it('soft_delete(case_link) trashes the link for its case\'s writers; an outsider is denied', async () => {
    expect((await bcb.rpc('soft_delete', { p_kind: 'case_link', p_id: linkId })).data).toMatchObject({ ok: false, code: 'denied' })
    const r = await lsb.rpc('soft_delete', { p_kind: 'case_link', p_id: linkId })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ ok: true, kind: 'case_link' })
    expect((await lsb.from('case_links').select('id').eq('id', linkId)).data).toEqual([])
    expect((await lsb.rpc('can_record', { p_action: 'restore', p_kind: 'case_link', p_id: linkId })).data).toBe(true)
    const back = await lsb.rpc('restore_record', { p_kind: 'case_link', p_id: linkId })
    expect(back.data).toMatchObject({ ok: true })
    expect((await lsb.from('case_links').select('id').eq('id', linkId)).data).toEqual([{ id: linkId }])
  })
})

/** v1.86c — Comments on legal requests (Portal Improvements P4-05,
 *  migrations 20261024120000_legal_tables + 20261026120000_legal_rpcs).
 *
 *  `legal_request_comments` is a threaded, participants-visible thread with
 *  an immutable edit history (`legal_request_comment_versions` keeps the
 *  PRIOR body on every edit and delete). RPC-only:
 *   · the creator comments; the CID approver pool (the Bureau Lead) comments
 *     while the request sits in review; replies carry parent_id;
 *   · the other bureau gets {ok:false, code:'denied'} and reads 0 rows;
 *   · edit is author-only and files the prior body as a version;
 *   · delete (author / AG / Owner) blanks the body and keeps the row;
 *   · a comment on a SEALED request notifies participants with a payload
 *     that carries only {request_id, sealed:true} — never a title or number;
 *     the author is never notified;
 *   · no client INSERT / UPDATE / DELETE on either table (42501).
 *
 *  Fixtures: lsb (creator), lead (approver — a participant once they have
 *  acted on the request), bcb (outsider), owner (may delete anyone's
 *  comment). Requests are swept by rls_test_cleanup() in afterAll; the
 *  person row is removed by the lead. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB, bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD, owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v186c] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Res = { ok: boolean; code?: string; id?: string }
type Payload = Record<string, unknown> & { request_id?: string; sealed?: boolean; title?: unknown; request_number?: unknown }

describe.skipIf(!enabled)('v1.86c — legal_request_comments: participants-only, versioned, sealed-safe', () => {
  let lsb: C, bcb: C, lead: C, owner: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v186c ${tag}`
  let caseId = '', personId = ''
  let warrantId = '', sealedId = ''
  let rootId = '', leadCommentId = '', replyId = ''

  const submitted = async (title: string, classification?: string) => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `${stamp} ${title}`, p_person: personId, p_narrative: 'Narrative for the v186c comments wall test.',
      p_form: { standard_of_proof: 'probable_cause', pc_statement: 'The affiant observed the transfer.' },
      ...(classification ? { p_classification: classification } : {}),
    })
    expect(r.error, r.error?.message).toBeNull()
    const id = r.data!.id as string
    await lsb.rpc('add_legal_exhibit', { p_request: id, p_type: 'external_link', p_meta: { url: `https://evidence.example/v186c/${tag}` } })
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: id })
    expect(sub.error, sub.error?.message).toBeNull()
    return id
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner!, 'owner'],
    ] as const) ids[key] = await signInWithRetry(client, email, pw)
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c = await lsb.from('cases').insert({ case_number: `V186C-${tag}`, title: `${stamp} comments case`, bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
    const p = await lsb.from('persons').insert({ name: `RLS Test Suspect ${tag}` }).select('id').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id
    warrantId = await submitted('commented warrant')
    sealedId = await submitted('SEALED warrant', 'sealed')
  }, 120_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v186c] cleanup:', JSON.stringify(data))
    if (personId) {
      const del = await lead.from('persons').delete().eq('id', personId)
      if (del.error) console.warn('[rls:v186c] person cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, owner].map((c) => c.auth.signOut()))
  }, 60_000)

  it('the creator comments, the reviewing Bureau Lead comments and replies; the outsider is denied and reads nothing', async () => {
    const mine = await lsb.rpc('legal_comment', { p_request: warrantId, p_body: `${stamp} first comment` })
    expect(mine.error, mine.error?.message).toBeNull()
    expect(mine.data).toMatchObject({ ok: true })
    rootId = (mine.data as Res).id!

    const blank = await lsb.rpc('legal_comment', { p_request: warrantId, p_body: '   ' })
    expect(blank.error !== null || (blank.data as Res).ok === false).toBe(true)

    // The approver pool may comment while the request is in CID review.
    const asLead = await lead.rpc('legal_comment', { p_request: warrantId, p_body: `${stamp} reviewer question` })
    expect(asLead.error, asLead.error?.message).toBeNull()
    expect(asLead.data).toMatchObject({ ok: true })
    leadCommentId = (asLead.data as Res).id!
    const reply = await lead.rpc('legal_comment', { p_request: warrantId, p_body: `${stamp} reply`, p_parent: rootId })
    expect(reply.error, reply.error?.message).toBeNull()
    replyId = (reply.data as Res).id!

    const rows = await lsb.from('legal_request_comments').select('id, author_id, parent_id, body').eq('legal_request_id', warrantId)
    expect(rows.error).toBeNull()
    expect(rows.data).toHaveLength(3)
    expect(rows.data!.find((r) => r.id === replyId)).toMatchObject({ author_id: ids.lead, parent_id: rootId })

    const outsider = await bcb.rpc('legal_comment', { p_request: warrantId, p_body: `${stamp} outsider` })
    expect(outsider.error).toBeNull()
    expect(outsider.data).toMatchObject({ ok: false, code: 'denied' })
    expect((await bcb.from('legal_request_comments').select('id').eq('legal_request_id', warrantId)).data ?? []).toEqual([])
    // A parent from another request is not a valid thread root.
    const crossThread = await lsb.rpc('legal_comment', { p_request: sealedId, p_body: `${stamp} wrong thread`, p_parent: rootId })
    expect(crossThread.error !== null || (crossThread.data as Res).ok === false).toBe(true)
  })

  it('edit is author-only and files the prior body as a version', async () => {
    const notMine = await lead.rpc('legal_comment_edit', { p_comment: rootId, p_body: 'hijacked' })
    expect(notMine.error).toBeNull()
    expect(notMine.data).toMatchObject({ ok: false, code: 'denied' })

    const edit = await lsb.rpc('legal_comment_edit', { p_comment: rootId, p_body: `${stamp} first comment (edited)` })
    expect(edit.error, edit.error?.message).toBeNull()
    expect(edit.data).toMatchObject({ ok: true })
    const row = await lsb.from('legal_request_comments').select('body, edited_at').eq('id', rootId).single()
    expect(row.data!.body).toBe(`${stamp} first comment (edited)`)
    expect(row.data!.edited_at).toBeTruthy()
    const versions = await lsb.from('legal_request_comment_versions').select('body, edited_by').eq('comment_id', rootId)
    expect(versions.error).toBeNull()
    expect(versions.data).toEqual([{ body: `${stamp} first comment`, edited_by: ids.lsb }])
    // The history follows the comment's visibility.
    expect((await bcb.from('legal_request_comment_versions').select('id').eq('comment_id', rootId)).data ?? []).toEqual([])
  })

  it('delete blanks the body, keeps the row and files the prior body; the Owner may delete anyone\'s', async () => {
    const notMine = await lsb.rpc('legal_comment_delete', { p_comment: leadCommentId })
    expect(notMine.error).toBeNull()
    expect(notMine.data).toMatchObject({ ok: false, code: 'denied' })

    const del = await lead.rpc('legal_comment_delete', { p_comment: leadCommentId })
    expect(del.error, del.error?.message).toBeNull()
    expect(del.data).toMatchObject({ ok: true })
    const row = await lsb.from('legal_request_comments').select('body, deleted_at, deleted_by').eq('id', leadCommentId).single()
    expect(row.data).toMatchObject({ body: '', deleted_by: ids.lead })
    expect(row.data!.deleted_at).toBeTruthy()
    const versions = await lsb.from('legal_request_comment_versions').select('body').eq('comment_id', leadCommentId)
    expect((versions.data ?? []).map((v) => v.body)).toEqual([`${stamp} reviewer question`])

    const asOwner = await owner.rpc('legal_comment_delete', { p_comment: replyId })
    expect(asOwner.error, asOwner.error?.message).toBeNull()
    expect(asOwner.data).toMatchObject({ ok: true })
    expect((await lsb.from('legal_request_comments').select('body').eq('id', replyId).single()).data).toMatchObject({ body: '' })
    // A deleted comment is not editable back into existence.
    const zombie = await lead.rpc('legal_comment_edit', { p_comment: leadCommentId, p_body: 'back' })
    expect(zombie.error !== null || (zombie.data as Res).ok === false).toBe(true)
  })

  it('a comment notifies participants but never the author; a SEALED request\'s payload carries no title', async () => {
    // The lead becomes a participant of both requests by acting on them.
    for (const id of [warrantId, sealedId]) {
      const ap = await lead.rpc('review_legal_request_as_cid', { p_request: id, p_decision: 'approve', p_signature: 'RLS Lead' })
      expect(ap.error, ap.error?.message).toBeNull()
      expect(ap.data).toMatchObject({ review_status: 'submitted_to_judge' })
    }
    const plain = await lsb.rpc('legal_comment', { p_request: warrantId, p_body: `${stamp} after approval` })
    expect(plain.data).toMatchObject({ ok: true })
    const sealed = await lsb.rpc('legal_comment', { p_request: sealedId, p_body: `${stamp} sealed comment` })
    expect(sealed.error, sealed.error?.message).toBeNull()
    expect(sealed.data).toMatchObject({ ok: true })

    const notif = await lead.from('notifications').select('payload, user_id').eq('type', 'legal_comment').order('created_at', { ascending: false }).limit(20)
    expect(notif.error).toBeNull()
    const payloads = (notif.data ?? []).map((n) => n.payload as Payload)
    const sealedPings = payloads.filter((p) => p.request_id === sealedId)
    expect(sealedPings.length).toBeGreaterThanOrEqual(1)
    for (const p of sealedPings) {
      expect(p.sealed).toBe(true)
      expect(p.title).toBeUndefined()
      expect(p.request_number).toBeUndefined()
      expect(JSON.stringify(p)).not.toContain(stamp)
    }
    expect(payloads.some((p) => p.request_id === warrantId)).toBe(true)

    // The author never pages themself.
    const own = await lsb.from('notifications').select('payload').eq('type', 'legal_comment').order('created_at', { ascending: false }).limit(20)
    expect((own.data ?? []).filter((n) => [warrantId, sealedId].includes((n.payload as Payload).request_id ?? '')).length).toBe(0)
    // The outsider never learns the sealed request exists.
    const outsider = await bcb.from('notifications').select('payload').eq('type', 'legal_comment').limit(20)
    expect((outsider.data ?? []).some((n) => (n.payload as Payload).request_id === sealedId)).toBe(false)
  })

  it('no client INSERT / UPDATE / DELETE on comments or their versions', async () => {
    const ins = await lsb.from('legal_request_comments').insert({ legal_request_id: warrantId, author_id: ids.lsb, body: 'direct' }).select('id')
    expect(ins.error?.code).toBe('42501')
    const upd = await lsb.from('legal_request_comments').update({ body: 'direct edit' }).eq('id', rootId).select('id')
    expect(upd.error?.code).toBe('42501')
    const del = await lsb.from('legal_request_comments').delete().eq('id', rootId).select('id')
    expect(del.error?.code).toBe('42501')
    const vIns = await lsb.from('legal_request_comment_versions').insert({ comment_id: rootId, body: 'forged history' }).select('id')
    expect(vIns.error?.code).toBe('42501')
    const vDel = await lsb.from('legal_request_comment_versions').delete().eq('comment_id', rootId).select('id')
    expect(vDel.error?.code).toBe('42501')
    expect((await lsb.from('legal_request_comments').select('body').eq('id', rootId).single()).data).toMatchObject({ body: `${stamp} first comment (edited)` })
  })
})

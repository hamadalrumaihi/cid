/** v1.31 — Document governance (SOPs & Library) — migration 20260801010000.
 *  Pins, per spec §30/§35:
 *   - classification visibility matrix: internal → active member; restricted
 *     → senior+ (detective denied); command → command; justice → justice
 *     members only (CID command DENIED — separate domains); owner → Owner;
 *   - draft gating: a draft in a locked folder is invisible to plain members
 *     and appears only to edit/approval authority;
 *   - versions inherit the parent document's visibility, and version INSERT
 *     now requires parent edit authority (pre-v131 any active member could
 *     fabricate history — regression pin);
 *   - workflow RPC authority + transitions (submit→approve→publish), reason
 *     required for reject, guard trigger silently keeps direct status writes
 *     inert (RPC-only columns);
 *   - version-specific acknowledgements: RPC-only insert, own-rows read,
 *     cross-user denial, manager-only aggregate; campaign publish authority,
 *     fan-out notification, completion summary;
 *   - private reading state (bookmarks): own rows only, cross-user denial,
 *     cannot write rows for another user;
 *   - search_documents: RLS-scoped (no titles/snippets/counts of classified
 *     docs for a detective), anon denied outright;
 *   - safe restore: reason required, content restored as a NEW version with
 *     change_type 'restore';
 *   - feedback kind 'document' accepted (report-issue routing).
 *
 *  Fixtures (tests/rls/README.md): lsb (active detective), director
 *  (command), owner, da (justice DA), judge (justice), bcb (cross-user
 *  denial). All fixture documents are created by director/owner and deleted
 *  in afterAll (acks/state/campaigns/versions cascade). Requires migration
 *  20260801010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  da: process.env.RLS_TEST_PASSWORD_DA,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.director && PW.owner && PW.da && PW.judge)
if (!enabled) console.warn('[rls:v131] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const STAMP = Date.now()
const N = (s: string) => `[rls-test] v131 ${s} ${STAMP}`

describe.skipIf(!enabled)('v1.31 — document governance (live)', () => {
  let anon: C, lsb: C, bcb: C, director: C, owner: C, da: C, judge: C
  const ids: Record<string, string> = {}
  const docs: Record<string, string> = {}

  const mkDoc = async (client: C, key: string, row: Record<string, unknown>) => {
    const res = await client.from('documents')
      .insert({ folder: 'SOPs', kind: 'doc', name: N(key), content: { body: `# ${key}\n\nBody of ${key}.` }, ...row })
      .select('id')
    if (res.error) throw new Error(`fixture doc ${key}: ${res.error.message}`)
    docs[key] = res.data![0].id as string
    return docs[key]
  }

  beforeAll(async () => {
    anon = mk(); lsb = mk(); bcb = mk(); director = mk(); owner = mk(); da = mk(); judge = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [da, 'rls-test-da@cidportal.test', PW.da, 'da'],
      [judge, 'rls-test-judge@cidportal.test', PW.judge, 'judge'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // Fixture shelf: one document per classification tier + a workflow draft.
    // Director-created drafts are published through the RPC (the whole point).
    await mkDoc(director, 'internal', { status: 'draft', classification: 'internal', category: 'sops', document_type: 'sop' })
    await director.rpc('document_workflow', { p_document: docs.internal, p_action: 'publish' })
    await mkDoc(director, 'restricted', { status: 'draft', classification: 'restricted', category: 'sops' })
    await director.rpc('document_workflow', { p_document: docs.restricted, p_action: 'publish' })
    await mkDoc(director, 'command', { status: 'draft', classification: 'command', category: 'command' })
    await director.rpc('document_workflow', { p_document: docs.command, p_action: 'publish' })
    await mkDoc(owner, 'ownerdoc', { status: 'draft', classification: 'owner', category: 'command' })
    await owner.rpc('document_workflow', { p_document: docs.ownerdoc, p_action: 'publish' })
    await mkDoc(owner, 'justicedoc', { status: 'draft', classification: 'justice', category: 'justice', document_type: 'legal_guidance' })
    await owner.rpc('document_workflow', { p_document: docs.justicedoc, p_action: 'publish' })
    await mkDoc(director, 'draftdoc', { status: 'draft', classification: 'internal', category: 'sops' })
  })

  afterAll(async () => {
    // documents_del gates on can_delete() (command tier) — the director
    // fixture always passes; cascades remove versions/acks/state/campaigns.
    for (const id of Object.values(docs)) {
      await director.from('documents').delete().eq('id', id)
    }
    await Promise.all([lsb, bcb, director, owner, da, judge].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── classification matrix ── */
  it('internal published doc: active detective sees it; anon sees nothing', async () => {
    const sel = await lsb.from('documents').select('id,name').eq('id', docs.internal)
    expect(sel.error).toBeNull()
    expect(sel.data).toHaveLength(1)
    const a = await anon.from('documents').select('id').eq('id', docs.internal)
    expect(a.data ?? []).toHaveLength(0)
  })

  it('restricted doc: detective denied, director (senior+) sees it', async () => {
    const d = await lsb.from('documents').select('id').eq('id', docs.restricted)
    expect(d.data ?? []).toHaveLength(0)
    const c = await director.from('documents').select('id').eq('id', docs.restricted)
    expect(c.data).toHaveLength(1)
  })

  it('command doc: detective denied, director sees it', async () => {
    const d = await lsb.from('documents').select('id').eq('id', docs.command)
    expect(d.data ?? []).toHaveLength(0)
    const c = await director.from('documents').select('id').eq('id', docs.command)
    expect(c.data).toHaveLength(1)
  })

  it('justice doc: detective AND CID director denied; DA and Judge see it', async () => {
    for (const c of [lsb, director]) {
      const r = await c.from('documents').select('id').eq('id', docs.justicedoc)
      expect(r.data ?? []).toHaveLength(0)
    }
    for (const c of [da, judge]) {
      const r = await c.from('documents').select('id').eq('id', docs.justicedoc)
      expect(r.data).toHaveLength(1)
    }
  })

  it('owner doc: director denied, owner sees it', async () => {
    const d = await director.from('documents').select('id').eq('id', docs.ownerdoc)
    expect(d.data ?? []).toHaveLength(0)
    const o = await owner.from('documents').select('id').eq('id', docs.ownerdoc)
    expect(o.data).toHaveLength(1)
  })

  it('a locked-folder draft is invisible to a plain member (edit/approval authority only)', async () => {
    const d = await lsb.from('documents').select('id').eq('id', docs.draftdoc)
    expect(d.data ?? []).toHaveLength(0)
    const c = await director.from('documents').select('id').eq('id', docs.draftdoc)
    expect(c.data).toHaveLength(1)
  })

  /* ── versions ── */
  it('version rows inherit parent visibility; version INSERT needs edit authority (regression pin)', async () => {
    const visible = await lsb.from('documents_versions').select('id').eq('document_id', docs.internal)
    expect(visible.error).toBeNull()
    expect((visible.data ?? []).length).toBeGreaterThan(0)
    const hidden = await lsb.from('documents_versions').select('id').eq('document_id', docs.command)
    expect(hidden.data ?? []).toHaveLength(0)
    // Pre-v131 ANY active member could insert fake history — now denied.
    const forged = await lsb.from('documents_versions')
      .insert({ document_id: docs.internal, name: 'forged', kind: 'doc', content: { body: 'x' } })
      .select('id')
    expect(forged.error).not.toBeNull()
  })

  /* ── workflow + guard ── */
  it('workflow: detective cannot publish; reject requires a reason; submit→approve→publish works', async () => {
    const deny = await lsb.rpc('document_workflow', { p_document: docs.draftdoc, p_action: 'publish' })
    expect(deny.error).not.toBeNull()
    const sub = await director.rpc('document_workflow', { p_document: docs.draftdoc, p_action: 'submit' })
    expect(sub.error).toBeNull()
    expect(sub.data).toMatchObject({ status: 'in_review' })
    const noReason = await director.rpc('document_workflow', { p_document: docs.draftdoc, p_action: 'reject' })
    expect(noReason.error).not.toBeNull()
    expect(noReason.error!.message).toMatch(/reason/i)
    const appr = await director.rpc('document_workflow', { p_document: docs.draftdoc, p_action: 'approve' })
    expect(appr.error).toBeNull()
    expect(appr.data).toMatchObject({ status: 'approved', approved_by: ids.director })
    const pub = await director.rpc('document_workflow', { p_document: docs.draftdoc, p_action: 'publish' })
    expect(pub.error).toBeNull()
    expect(pub.data).toMatchObject({ status: 'published' })
  })

  it('guard trigger: a direct status write is silently kept inert (RPC-only column)', async () => {
    const res = await director.from('documents')
      .update({ status: 'archived' }).eq('id', docs.internal).select('status')
    expect(res.error).toBeNull()
    expect(res.data![0].status).toBe('published')
  })

  /* ── acknowledgements + campaigns ── */
  it('campaigns: detective cannot publish one; director publishes to a specific member with fan-out', async () => {
    const deny = await lsb.rpc('publish_reading_campaign', {
      p_document: docs.internal, p_audience: 'all', p_reason: '[rls-test] must fail',
    })
    expect(deny.error).not.toBeNull()
    const ok = await director.rpc('publish_reading_campaign', {
      p_document: docs.internal, p_audience: 'specific',
      p_targets: [ids.lsb], p_reason: '[rls-test] v131 campaign',
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ status: 'active', audience: 'specific' })
    const notif = await lsb.from('notifications')
      .select('id,type,payload').eq('type', 'document_required')
    expect(notif.error).toBeNull()
    expect((notif.data ?? []).some((n) =>
      (n.payload as { document_id?: string }).document_id === docs.internal)).toBe(true)
  })

  it('acknowledge: RPC works for the targeted member; rows are own-only; direct insert denied', async () => {
    const ack = await lsb.rpc('acknowledge_document', { p_document: docs.internal })
    expect(ack.error).toBeNull()
    expect(ack.data).toMatchObject({ document_id: docs.internal, user_id: ids.lsb })
    const mine = await lsb.from('document_acknowledgements').select('id').eq('document_id', docs.internal)
    expect(mine.data).toHaveLength(1)
    const theirs = await bcb.from('document_acknowledgements').select('id').eq('document_id', docs.internal)
    expect(theirs.data ?? []).toHaveLength(0)
    const direct = await bcb.from('document_acknowledgements')
      .insert({ document_id: docs.internal, user_id: ids.bcb, document_version_id: ack.data!.document_version_id })
      .select('id')
    expect(direct.error).not.toBeNull() // no INSERT policy — RPC only
  })

  it('aggregate completion: detective denied; director sees the acknowledged target', async () => {
    const deny = await lsb.rpc('document_ack_summary', { p_document: docs.internal })
    expect(deny.error).not.toBeNull()
    const sum = await director.rpc('document_ack_summary', { p_document: docs.internal })
    expect(sum.error).toBeNull()
    const row = (sum.data as Array<{ user_id: string; acknowledged_at: string | null }>)
      .find((r) => r.user_id === ids.lsb)
    expect(row).toBeDefined()
    expect(row!.acknowledged_at).not.toBeNull()
  })

  /* ── private reading state ── */
  it('bookmarks are strictly private: own rows only, no cross-user reads or writes', async () => {
    const ins = await lsb.from('document_user_state')
      .upsert({ user_id: ids.lsb, document_id: docs.internal, bookmarked: true, last_anchor: 'body-of-internal' })
      .select('bookmarked')
    expect(ins.error).toBeNull()
    const spy = await bcb.from('document_user_state').select('*').eq('user_id', ids.lsb)
    expect(spy.data ?? []).toHaveLength(0)
    const forge = await bcb.from('document_user_state')
      .insert({ user_id: ids.lsb, document_id: docs.internal, bookmarked: true })
      .select('user_id')
    expect(forge.error).not.toBeNull()
  })

  /* ── search ── */
  it('search is RLS-scoped: no classified titles/snippets/counts for a detective; anon denied', async () => {
    const mine = await lsb.rpc('search_documents', { p_query: `v131 ${STAMP}` })
    expect(mine.error).toBeNull()
    const found = (mine.data ?? []) as Array<{ id: string }>
    expect(found.some((r) => r.id === docs.internal)).toBe(true)
    for (const hidden of [docs.command, docs.ownerdoc, docs.justicedoc, docs.restricted]) {
      expect(found.some((r) => r.id === hidden)).toBe(false)
    }
    const a = await anon.rpc('search_documents', { p_query: 'anything' })
    expect(a.error).not.toBeNull()
  })

  /* ── save + safe restore ── */
  it('document_save versions the post-state; restore needs a reason and lands as a NEW restore version', async () => {
    const save = await director.rpc('document_save', {
      p_document: docs.internal, p_name: N('internal'),
      p_body: '# internal\n\nRevised body v2.', p_change_type: 'procedural',
      p_change_summary: '[rls-test] material revision', p_requires_reack: true,
    })
    expect(save.error).toBeNull()
    const afterSave = save.data!.current_version_number as number
    const v1 = await director.from('documents_versions')
      .select('id, version_number').eq('document_id', docs.internal)
      .eq('version_number', afterSave - 1).single()
    expect(v1.error).toBeNull()
    const noReason = await director.rpc('document_restore_version', {
      p_document: docs.internal, p_version: v1.data!.id, p_reason: '',
    })
    expect(noReason.error).not.toBeNull()
    const restore = await director.rpc('document_restore_version', {
      p_document: docs.internal, p_version: v1.data!.id, p_reason: '[rls-test] v131 restore',
    })
    expect(restore.error).toBeNull()
    expect(restore.data!.current_version_number).toBe(afterSave + 1)
    const rv = await director.from('documents_versions')
      .select('change_type, restored_from').eq('document_id', docs.internal)
      .eq('version_number', afterSave + 1).single()
    expect(rv.error).toBeNull()
    expect(rv.data).toMatchObject({ change_type: 'restore', restored_from: v1.data!.id })
  })

  /* ── sync resolution authority ── */
  it('resolve_document_sync: detective denied; director refused when no conflict exists', async () => {
    const deny = await lsb.rpc('resolve_document_sync', {
      p_document: docs.internal, p_resolution: 'keep_portal', p_reason: '[rls-test] must fail',
    })
    expect(deny.error).not.toBeNull()
    const none = await director.rpc('resolve_document_sync', {
      p_document: docs.internal, p_resolution: 'keep_portal', p_reason: '[rls-test] no conflict',
    })
    expect(none.error).not.toBeNull()
    expect(none.error!.message).toMatch(/no sync conflict/i)
  })

  /* ── report-issue routing ── */
  it('feedback accepts kind=document (report-issue routing)', async () => {
    const fb = await lsb.from('feedback')
      .insert({ kind: 'document', title: N('issue'), details: 'Section unclear.' })
      .select('id, kind')
    expect(fb.error).toBeNull()
    expect(fb.data![0].kind).toBe('document')
    await lsb.from('feedback').delete().eq('id', fb.data![0].id)
  })
})

/** v1.32 — Bureau-scoped document edit authority + detective suggestion system
 *  (migration 20260802010000_document_bureau_scope_suggestions).
 *
 *  Pins:
 *   - `documents.bureau` scoped edit authority, enforced at BOTH the direct
 *     write boundary and the SECURITY DEFINER RPCs (document_save). A Bureau
 *     Lead may edit only their OWN bureau's internal/reference & SOP docs (the
 *     load-bearing cross-bureau denial), NOT a NULL/division-wide doc and NOT a
 *     command-class doc; Deputy Director/Director edit division-wide (any
 *     bureau incl. NULL); the Owner edits anything; a doc's own owner_user_id
 *     may edit their own doc while active.
 *   - The detective suggestion tracker: submit is open to any active member who
 *     can VIEW the target (no existence leak on a doc they can't see); tables
 *     are SELECT-only RLS with bureau-scoped visibility (submitter sees own,
 *     manager sees their scope, an unrelated detective sees nothing); decisions
 *     are manager-only and bureau-scoped, declined/needs_more_information
 *     require a note, accept assigns an editor and does NOT mutate the SOP;
 *     comment is submitter-or-manager; duplicate never deletes; implementation
 *     link only flows from an accepted status; anon is denied the write RPCs.
 *
 *  Fixtures (tests/rls/README.md): lead (bureau_lead LSB), director (director
 *  SAB), owner (detective+is_owner SAB), lsb (detective LSB), bcb (detective
 *  BCB), target (detective LSB). All fixture docs/suggestions are removed in
 *  afterAll (suggestions/events/comments cascade from the parent document).
 *  Requires migration 20260802010000. */

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
  target: process.env.RLS_TEST_PASSWORD_TARGET,
}
const enabled = !!(ANON && PW.lead && PW.director && PW.owner && PW.lsb && PW.bcb && PW.target)
if (!enabled) console.warn('[rls:v132] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const STAMP = Date.now()
const N = (s: string) => `[rls-test] v132 ${s} ${STAMP}`

describe.skipIf(!enabled)('v1.32 — bureau-scoped document edits + suggestions (live)', () => {
  let anon: C, lead: C, director: C, owner: C, lsb: C, bcb: C, target: C
  const ids: Record<string, string> = {}
  const docs: Record<string, string> = {}
  const sug: Record<string, string> = {}

  const mkDoc = async (client: C, key: string, row: Record<string, unknown>) => {
    const res = await client.from('documents')
      .insert({ folder: 'SOPs', kind: 'doc', name: N(key), content: { body: `# ${key}\n\nBody of ${key}.` }, ...row })
      .select('id')
    if (res.error) throw new Error(`fixture doc ${key}: ${res.error.message}`)
    docs[key] = res.data![0].id as string
    return docs[key]
  }

  beforeAll(async () => {
    anon = mk(); lead = mk(); director = mk(); owner = mk(); lsb = mk(); bcb = mk(); target = mk()
    for (const [client, email, pw, key] of [
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [target, 'rls-test-target@cidportal.test', PW.target, 'target'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }

    // Fixture shelf — director creates & publishes the bureau-scoped SOPs
    // (division leadership may author every bureau incl. NULL). The command doc
    // exercises the org-wide security tier; the restricted doc the no-view path.
    await mkDoc(director, 'lsbDoc', { status: 'draft', classification: 'internal', category: 'sops', document_type: 'sop', bureau: 'LSB' })
    await director.rpc('document_workflow', { p_document: docs.lsbDoc, p_action: 'publish' })
    await mkDoc(director, 'bcbDoc', { status: 'draft', classification: 'internal', category: 'sops', document_type: 'sop', bureau: 'BCB' })
    await director.rpc('document_workflow', { p_document: docs.bcbDoc, p_action: 'publish' })
    await mkDoc(director, 'nullDoc', { status: 'draft', classification: 'internal', category: 'sops', document_type: 'sop' })
    await director.rpc('document_workflow', { p_document: docs.nullDoc, p_action: 'publish' })
    await mkDoc(director, 'commandDoc', { status: 'draft', classification: 'command', category: 'command', bureau: 'LSB' })
    await director.rpc('document_workflow', { p_document: docs.commandDoc, p_action: 'publish' })
    await mkDoc(director, 'restrictedDoc', { status: 'draft', classification: 'restricted', category: 'sops', bureau: 'LSB' })
    await director.rpc('document_workflow', { p_document: docs.restrictedDoc, p_action: 'publish' })
    // A draft SOP the LSB detective owns — proves the owner-while-active branch.
    await mkDoc(lsb, 'ownDoc', { status: 'draft', classification: 'internal', category: 'sops', document_type: 'sop', bureau: 'LSB', owner_user_id: ids.lsb })
  })

  afterAll(async () => {
    // documents_del gates on command tier — the director fixture passes; the
    // cascade removes versions, suggestions, events and comments.
    for (const id of Object.values(docs)) {
      await director.from('documents').delete().eq('id', id)
    }
    await Promise.all([lead, director, owner, lsb, bcb, target].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── bureau-scoped edit authority (via document_save, the real user path) ── */

  it('LSB bureau lead CAN edit an LSB-bureau internal SOP', async () => {
    const before = await director.from('documents').select('current_version_number').eq('id', docs.lsbDoc).single()
    const save = await lead.rpc('document_save', {
      p_document: docs.lsbDoc, p_name: N('lsbDoc'),
      p_body: '# lsbDoc\n\nLead revision.', p_change_type: 'procedural',
      p_change_summary: '[rls-test] v132 lead edit', p_requires_reack: false,
    })
    expect(save.error).toBeNull()
    expect(save.data!.current_version_number).toBe((before.data!.current_version_number as number) + 1)
  })

  it('LSB bureau lead CANNOT edit a BCB-bureau SOP (cross-bureau denial)', async () => {
    const save = await lead.rpc('document_save', {
      p_document: docs.bcbDoc, p_name: N('bcbDoc'),
      p_body: '# bcbDoc\n\nUnauthorized cross-bureau edit.', p_change_type: 'procedural',
      p_change_summary: '[rls-test] must fail',
    })
    expect(save.error).not.toBeNull()
    expect(save.error!.message).toMatch(/not authorized/i)
  })

  it('LSB bureau lead CANNOT edit a NULL-bureau (division-wide) SOP', async () => {
    const save = await lead.rpc('document_save', {
      p_document: docs.nullDoc, p_name: N('nullDoc'),
      p_body: '# nullDoc\n\nUnauthorized division-wide edit.', p_change_type: 'procedural',
      p_change_summary: '[rls-test] must fail',
    })
    expect(save.error).not.toBeNull()
    expect(save.error!.message).toMatch(/not authorized/i)
  })

  it('director edits division-wide: a BCB-bureau doc AND a NULL-bureau doc', async () => {
    const bcbEdit = await director.rpc('document_save', {
      p_document: docs.bcbDoc, p_name: N('bcbDoc'),
      p_body: '# bcbDoc\n\nDirector revision.', p_change_type: 'procedural',
      p_change_summary: '[rls-test] v132 director bcb',
    })
    expect(bcbEdit.error).toBeNull()
    const nullEdit = await director.rpc('document_save', {
      p_document: docs.nullDoc, p_name: N('nullDoc'),
      p_body: '# nullDoc\n\nDirector revision.', p_change_type: 'procedural',
      p_change_summary: '[rls-test] v132 director null',
    })
    expect(nullEdit.error).toBeNull()
  })

  it('command-class doc: bureau lead DENIED; director and owner CAN edit', async () => {
    const deny = await lead.rpc('document_save', {
      p_document: docs.commandDoc, p_name: N('commandDoc'),
      p_body: '# commandDoc\n\nUnauthorized.', p_change_type: 'procedural',
      p_change_summary: '[rls-test] must fail',
    })
    expect(deny.error).not.toBeNull()
    expect(deny.error!.message).toMatch(/not authorized/i)
    const byDirector = await director.rpc('document_save', {
      p_document: docs.commandDoc, p_name: N('commandDoc'),
      p_body: '# commandDoc\n\nDirector revision.', p_change_type: 'procedural',
      p_change_summary: '[rls-test] v132 director command',
    })
    expect(byDirector.error).toBeNull()
    const byOwner = await owner.rpc('document_save', {
      p_document: docs.commandDoc, p_name: N('commandDoc'),
      p_body: '# commandDoc\n\nOwner revision.', p_change_type: 'procedural',
      p_change_summary: '[rls-test] v132 owner command',
    })
    expect(byOwner.error).toBeNull()
  })

  it('owner can edit any doc regardless of bureau', async () => {
    // Distinct names per doc — document_save renames the target and (folder,
    // name) is uniquely constrained, so a shared name would self-collide.
    for (const [key, id] of [['lsbDoc', docs.lsbDoc], ['bcbDoc', docs.bcbDoc], ['nullDoc', docs.nullDoc]] as const) {
      const save = await owner.rpc('document_save', {
        p_document: id, p_name: N(`owner-any ${key}`),
        p_body: '# owner-any\n\nOwner revision.', p_change_type: 'editorial',
      })
      expect(save.error).toBeNull()
    }
  })

  it("a doc's own owner (non-command detective) CAN edit their own doc while active", async () => {
    const save = await lsb.rpc('document_save', {
      p_document: docs.ownDoc, p_name: N('ownDoc'),
      p_body: '# ownDoc\n\nOwner-detective revision.', p_change_type: 'editorial',
    })
    expect(save.error).toBeNull()
    expect(save.data).toMatchObject({ id: docs.ownDoc })
    // A different LSB detective who does not own it and is no manager is denied.
    const deny = await target.rpc('document_save', {
      p_document: docs.ownDoc, p_name: N('ownDoc'),
      p_body: '# ownDoc\n\nUnauthorized.', p_change_type: 'editorial',
    })
    expect(deny.error).not.toBeNull()
  })

  /* ── detective suggestion system ── */

  it('an active detective CAN submit a suggestion on a doc they can view (status submitted, event recorded)', async () => {
    const res = await lsb.rpc('submit_document_suggestion', {
      p_document: docs.lsbDoc, p_type: 'unclear',
      p_title: N('sug-lsb'), p_explanation: 'Section 2 is ambiguous.',
      p_section_id: 'sec-2', p_section_title: 'Procedure',
    })
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({ status: 'submitted', document_id: docs.lsbDoc, created_by: ids.lsb })
    sug.lsb = res.data!.id as string
    // Creator can read the audit event trail for their own suggestion.
    const ev = await lsb.from('document_suggestion_events')
      .select('event_type, to_status').eq('suggestion_id', sug.lsb).eq('event_type', 'submitted')
    expect(ev.error).toBeNull()
    expect(ev.data).toHaveLength(1)
    expect(ev.data![0].to_status).toBe('submitted')
  })

  it('a detective CANNOT submit on a restricted doc they cannot view (no existence leak)', async () => {
    const res = await lsb.rpc('submit_document_suggestion', {
      p_document: docs.restrictedDoc, p_type: 'unclear',
      p_title: N('sug-restricted'), p_explanation: 'Should be denied.',
    })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/document not found/i)
  })

  it('submitter sees their own suggestion; an unrelated detective does NOT (RLS)', async () => {
    const mine = await lsb.from('document_suggestions').select('id').eq('id', sug.lsb)
    expect(mine.error).toBeNull()
    expect(mine.data).toHaveLength(1)
    const theirs = await bcb.from('document_suggestions').select('id').eq('id', sug.lsb)
    expect(theirs.data ?? []).toHaveLength(0)
  })

  it('LSB lead manages an LSB suggestion (sees + decides); cannot decide a BCB suggestion', async () => {
    // A suggestion on the BCB doc, submitted by the BCB detective.
    const bcbSug = await bcb.rpc('submit_document_suggestion', {
      p_document: docs.bcbDoc, p_type: 'outdated',
      p_title: N('sug-bcb'), p_explanation: 'BCB procedure changed.',
    })
    expect(bcbSug.error).toBeNull()
    sug.bcb = bcbSug.data!.id as string

    // The LSB lead sees & can decide the LSB suggestion...
    const seen = await lead.from('document_suggestions').select('id').eq('id', sug.lsb)
    expect(seen.data).toHaveLength(1)
    const decide = await lead.rpc('decide_document_suggestion', {
      p_suggestion: sug.lsb, p_status: 'under_review',
    })
    expect(decide.error).toBeNull()
    expect(decide.data).toMatchObject({ status: 'under_review', decided_by: ids.lead })

    // ...but neither sees nor may decide a suggestion on a BCB doc.
    const notSeen = await lead.from('document_suggestions').select('id').eq('id', sug.bcb)
    expect(notSeen.data ?? []).toHaveLength(0)
    const denied = await lead.rpc('decide_document_suggestion', {
      p_suggestion: sug.bcb, p_status: 'under_review',
    })
    expect(denied.error).not.toBeNull()
    expect(denied.error!.message).toMatch(/not authorized/i)
  })

  it("decide 'declined' with empty note raises; 'accepted' with an editor sets assigned_editor", async () => {
    const noNote = await lead.rpc('decide_document_suggestion', {
      p_suggestion: sug.lsb, p_status: 'declined', p_note: '   ',
    })
    expect(noNote.error).not.toBeNull()
    expect(noNote.error!.message).toMatch(/note is required/i)
    const accept = await lead.rpc('decide_document_suggestion', {
      p_suggestion: sug.lsb, p_status: 'accepted', p_assigned_editor: ids.target,
    })
    expect(accept.error).toBeNull()
    expect(accept.data).toMatchObject({ status: 'accepted', assigned_editor: ids.target })
  })

  it('accepting a suggestion does NOT edit the SOP (body & version unchanged)', async () => {
    const before = await director.from('documents')
      .select('current_version_number, content').eq('id', docs.lsbDoc).single()
    const fresh = await lsb.rpc('submit_document_suggestion', {
      p_document: docs.lsbDoc, p_type: 'missing_procedure',
      p_title: N('sug-noedit'), p_explanation: 'Add a rollback step.',
    })
    expect(fresh.error).toBeNull()
    const decide = await lead.rpc('decide_document_suggestion', {
      p_suggestion: fresh.data!.id, p_status: 'accepted',
    })
    expect(decide.error).toBeNull()
    const after = await director.from('documents')
      .select('current_version_number, content').eq('id', docs.lsbDoc).single()
    expect(after.data!.current_version_number).toBe(before.data!.current_version_number)
    expect(after.data!.content).toEqual(before.data!.content)
  })

  it('comment: submitter can post; an unrelated detective cannot', async () => {
    const mine = await lsb.rpc('comment_on_document_suggestion', {
      p_suggestion: sug.lsb, p_body: 'Thanks for reviewing this.',
    })
    expect(mine.error).toBeNull()
    expect(mine.data).toMatchObject({ suggestion_id: sug.lsb })
    const theirs = await bcb.rpc('comment_on_document_suggestion', {
      p_suggestion: sug.lsb, p_body: 'I should not be able to post here.',
    })
    expect(theirs.error).not.toBeNull()
    expect(theirs.error!.message).toMatch(/not authorized/i)
  })

  it('mark duplicate requires an original and leaves the row present as status duplicate', async () => {
    const dup = await lsb.rpc('submit_document_suggestion', {
      p_document: docs.lsbDoc, p_type: 'other',
      p_title: N('sug-dup'), p_explanation: 'Same as an earlier note.',
    })
    expect(dup.error).toBeNull()
    sug.dup = dup.data!.id as string
    const noOriginal = await lead.rpc('mark_document_suggestion_duplicate', {
      p_suggestion: sug.dup, p_original: null,
    })
    expect(noOriginal.error).not.toBeNull()
    expect(noOriginal.error!.message).toMatch(/original suggestion is required/i)
    const marked = await lead.rpc('mark_document_suggestion_duplicate', {
      p_suggestion: sug.dup, p_original: sug.lsb, p_note: 'Duplicate of the earlier note.',
    })
    expect(marked.error).toBeNull()
    expect(marked.data).toMatchObject({ status: 'duplicate', duplicate_of: sug.lsb })
    // Never deleted — the row is still present.
    const still = await lead.from('document_suggestions').select('id, status').eq('id', sug.dup).single()
    expect(still.error).toBeNull()
    expect(still.data!.status).toBe('duplicate')
  })

  it('link implementation: refused from a non-accepted status; succeeds from accepted', async () => {
    const s = await lsb.rpc('submit_document_suggestion', {
      p_document: docs.lsbDoc, p_type: 'incorrect',
      p_title: N('sug-impl'), p_explanation: 'Fix the cited statute.',
    })
    expect(s.error).toBeNull()
    const sid = s.data!.id as string
    const ver = await lead.from('documents_versions')
      .select('id').eq('document_id', docs.lsbDoc).limit(1).single()
    expect(ver.error).toBeNull()
    // Still 'submitted' — implementation link must be refused.
    const early = await lead.rpc('link_document_suggestion_implementation', {
      p_suggestion: sid, p_version: ver.data!.id,
    })
    expect(early.error).not.toBeNull()
    expect(early.error!.message).toMatch(/only accepted/i)
    // Accept, then link.
    const accept = await lead.rpc('decide_document_suggestion', { p_suggestion: sid, p_status: 'accepted' })
    expect(accept.error).toBeNull()
    const linked = await lead.rpc('link_document_suggestion_implementation', {
      p_suggestion: sid, p_version: ver.data!.id,
    })
    expect(linked.error).toBeNull()
    expect(linked.data).toMatchObject({ status: 'implemented', implemented_version_id: ver.data!.id })
  })

  it('anon cannot execute submit_document_suggestion', async () => {
    const res = await anon.rpc('submit_document_suggestion', {
      p_document: docs.lsbDoc, p_type: 'other',
      p_title: N('sug-anon'), p_explanation: 'Should be denied.',
    })
    expect(res.error).not.toBeNull()
  })
})

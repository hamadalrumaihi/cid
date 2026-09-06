/** v1.85a — case_notes (Portal Improvements P3-03, migration 20261021120000).
 *
 *  Authored notes replace the frozen cases.notes column:
 *   · INSERT needs case access on a live, non-archived case AND
 *     author_id = the caller (a forged author is a policy violation, 42501);
 *   · restricted_to_command is set by command only — a Detective's
 *     restricted insert is refused (42501);
 *   · a command-restricted note is INVISIBLE to a non-command reader who
 *     is not its author; an unrestricted note reads like the case;
 *   · another bureau sees no note at all (the case read predicate);
 *   · the author edits (pin, body) and record_history('case_note') carries
 *     the version with its changed_fields;
 *   · cases.notes is frozen for clients (P0403);
 *   · case_note_mention is author-only: {ok:true} for the author (sent may
 *     be 0 — every rls-test profile is is_test, so the fan-out is
 *     suppressed by design), {ok:false, code:'denied'} for anyone else;
 *   · no client DELETE: soft_delete('case_note') by the author trashes the
 *     row (it disappears from the author's list), can_record('restore')
 *     answers the author, restore_record brings it back.
 *
 *  Fixtures: lsb (author, MCB detective), lead (MCB Bureau Lead — the
 *  command author), bcb (SCB detective — the outsider). The case and its
 *  notes are swept by rls_test_cleanup() (case_notes cascade with the case). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, bcb: process.env.RLS_TEST_PASSWORD_BCB, lead: process.env.RLS_TEST_PASSWORD_LEAD }
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v185a] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Ver = { version_no: number; changed_fields: string[] }
type Res = { ok: boolean; code?: string; sent?: number }

describe.skipIf(!enabled)('v1.85a — case_notes: authored, restricted, versioned, soft-deleted', () => {
  let lsb: C, bcb: C, lead: C
  let lsbId = '', bcbId = '', leadId = ''
  let caseId = '', noteId = '', restrictedId = '', plainLeadNoteId = ''
  const tag = Date.now().toString(36)
  const stamp = `[rls-test] v185a ${tag}`

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    bcbId = await signInWithRetry(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    leadId = await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    const c = await lsb.from('cases').insert({ case_number: `V185A-${tag}`, title: `${stamp} notes case`, bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
  }, 90_000)

  afterAll(async () => { if (lsb) await lsb.rpc('rls_test_cleanup') })

  it('the author creates a note; a forged author and a Detective\'s restricted note are policy violations', async () => {
    const ok = await lsb.from('case_notes').insert({ case_id: caseId, author_id: lsbId, body_md: `${stamp} first note` }).select('id, source, pinned').single()
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toMatchObject({ source: 'manual', pinned: false })
    noteId = ok.data!.id

    const forged = await lsb.from('case_notes').insert({ case_id: caseId, author_id: leadId, body_md: `${stamp} forged author` })
    expect(forged.error?.code).toBe('42501')

    const restricted = await lsb.from('case_notes').insert({ case_id: caseId, author_id: lsbId, body_md: `${stamp} detective restricted`, restricted_to_command: true })
    expect(restricted.error?.code).toBe('42501')
  })

  it('command restricts a note; a Detective lists only their own and the unrestricted notes; another bureau sees none', async () => {
    const r = await lead.from('case_notes').insert({ case_id: caseId, author_id: leadId, body_md: `${stamp} command only`, restricted_to_command: true }).select('id').single()
    expect(r.error, r.error?.message).toBeNull()
    restrictedId = r.data!.id
    const p = await lead.from('case_notes').insert({ case_id: caseId, author_id: leadId, body_md: `${stamp} lead, unrestricted` }).select('id').single()
    expect(p.error, p.error?.message).toBeNull()
    plainLeadNoteId = p.data!.id

    const mine = await lsb.from('case_notes').select('id').eq('case_id', caseId)
    expect(mine.error).toBeNull()
    const ids = (mine.data ?? []).map((n) => n.id)
    expect(ids).toContain(noteId)
    expect(ids).toContain(plainLeadNoteId)
    expect(ids).not.toContain(restrictedId)
    expect((await lsb.from('case_notes').select('id').eq('id', restrictedId)).data).toEqual([])

    // The author of a restricted note reads it, as does command.
    expect((await lead.from('case_notes').select('id').eq('case_id', caseId)).data).toHaveLength(3)

    expect((await bcb.from('case_notes').select('id').eq('case_id', caseId)).data).toEqual([])
    const outsider = await bcb.from('case_notes').insert({ case_id: caseId, author_id: bcbId, body_md: `${stamp} outsider` })
    expect(outsider.error?.code).toBe('42501')
  })

  it('the author edits (pin, body) and record_history carries the version with its changed_fields; a Detective cannot restrict', async () => {
    const upd = await lsb.from('case_notes').update({ pinned: true, body_md: `${stamp} first note (edited)` }).eq('id', noteId).select('pinned, updated_at, created_at')
    expect(upd.error, upd.error?.message).toBeNull()
    expect(upd.data).toHaveLength(1)
    expect(upd.data![0].pinned).toBe(true)

    const h = await lsb.rpc('record_history', { p_kind: 'case_note', p_id: noteId })
    expect(h.error, h.error?.message).toBeNull()
    const versions = (h.data ?? []) as unknown as Ver[]
    expect(versions.length).toBeGreaterThanOrEqual(1)
    const fields = versions.flatMap((v) => v.changed_fields)
    expect(fields).toContain('pinned')
    expect(fields).toContain('body_md')
    expect((await lsb.rpc('can_record', { p_action: 'read_history', p_kind: 'case_note', p_id: noteId })).data).toBe(true)

    // A Detective may not flip restrict-to-command on their own note: USING
    // matches the row (author), WITH CHECK refuses the new row — a raised
    // policy violation, not the silent zero-row shape.
    const restrict = await lsb.from('case_notes').update({ restricted_to_command: true }).eq('id', noteId).select('id')
    expect(restrict.error?.code).toBe('42501')

    // Another Detective's note is not editable (zero rows, no error).
    const other = await bcb.from('case_notes').update({ pinned: false }).eq('id', noteId).select('id')
    expect(other.error).toBeNull()
    expect(other.data).toEqual([])
  })

  it('cases.notes is frozen for clients (P0403)', async () => {
    const r = await lsb.from('cases').update({ notes: `${stamp} legacy text` }).eq('id', caseId)
    expect(r.error?.code).toBe('P0403')
    expect(r.error?.message).toMatch(/read-only/i)
  })

  it('case_note_mention is author-only', async () => {
    const mine = await lsb.rpc('case_note_mention', { p_note: noteId, p_user_ids: [leadId, bcbId] })
    expect(mine.error, mine.error?.message).toBeNull()
    // Every rls-test profile is is_test: the fan-out is suppressed, so `sent`
    // may be 0 — the contract under test is the author gate.
    expect((mine.data as Res).ok).toBe(true)
    expect(typeof (mine.data as Res).sent).toBe('number')

    const other = await bcb.rpc('case_note_mention', { p_note: noteId, p_user_ids: [lsbId] })
    expect(other.error).toBeNull()
    expect(other.data).toMatchObject({ ok: false, code: 'denied' })

    // Command is not the author either.
    expect((await lead.rpc('case_note_mention', { p_note: noteId, p_user_ids: [lsbId] })).data).toMatchObject({ ok: false, code: 'denied' })
  })

  it('no client DELETE; soft_delete trashes the author\'s note, can_record answers the restore, restore_record brings it back', async () => {
    const del = await lsb.from('case_notes').delete().eq('id', noteId)
    expect(del.error?.code).toBe('42501')

    expect((await bcb.rpc('soft_delete', { p_kind: 'case_note', p_id: noteId })).data).toMatchObject({ ok: false, code: 'denied' })
    const trashed = await lsb.rpc('soft_delete', { p_kind: 'case_note', p_id: noteId })
    expect(trashed.error, trashed.error?.message).toBeNull()
    expect(trashed.data).toMatchObject({ ok: true, kind: 'case_note' })
    expect((await lsb.from('case_notes').select('id').eq('id', noteId)).data).toEqual([])

    expect((await lsb.rpc('can_record', { p_action: 'restore', p_kind: 'case_note', p_id: noteId })).data).toBe(true)
    expect((await bcb.rpc('can_record', { p_action: 'restore', p_kind: 'case_note', p_id: noteId })).data).toBe(false)

    const back = await lsb.rpc('restore_record', { p_kind: 'case_note', p_id: noteId })
    expect(back.error, back.error?.message).toBeNull()
    expect(back.data).toMatchObject({ ok: true })
    expect((await lsb.from('case_notes').select('id, deleted_at').eq('id', noteId)).data).toEqual([{ id: noteId, deleted_at: null }])
  })
})

/** v1.88a — Intel triage: reject, restore, the guard trigger, comments and
 *  the validation mark (Portal Improvements P6-01 / P6-02 / P6-05, migration
 *  20261030120000_intel_triage).
 *
 *  What the CID fixtures prove (lsb — the MCB detective who AUTHORS the
 *  test records as an investigator and is also a reviewer; bcb — the SCB
 *  detective, the other reviewer; lead — the MCB Bureau Lead, command;
 *  owner optional — audit reads; the field-officer fixture optional — the
 *  officer wall):
 *   · field_submission_reject needs a reason ('say why this is being
 *     rejected'); a reviewer who can read the record rejects it → status
 *     'rejected', rejected_at / rejected_by, a reviewer note 'Rejected:
 *     <reason>', FIELD_SUBMISSION_REJECTED carrying the reason — the reason
 *     is NOT a row column (the text lives only in the note and the audit
 *     row) — and NO notification to the submitter (IT3);
 *   · a rejected record is terminal for a reviewer: decide, ask and a
 *     second reject are refused; validate says 'that record is closed';
 *   · restore from rejected is COMMAND only — a detective gets SQLSTATE
 *     P0403 ('only a Bureau Lead or above can restore a rejected record');
 *     the lead restores → reviewing, the rejected_* columns cleared, a note
 *     'Restored after rejection', the audit row carrying from_status;
 *   · the client-facing guard refuses EVERY direct UPDATE of a sent record
 *     ('that record has already been sent; the review state only changes
 *     through the review actions') and a draft's review columns; a
 *     non-author's UPDATE matches zero rows or is refused;
 *   · field_submission_comment: private (a field_submission_reviews row) by
 *     default, visible → the officer thread with from_reviewer; neither
 *     moves the status; a blank body is refused; a direct INSERT into the
 *     notes is refused (42501 — the policy is gone); the officer thread's
 *     INSERT is the author's own reply while a question is open;
 *   · with the officer fixture: a private note never reaches the officer's
 *     reads, a visible message does;
 *   · field_submission_validate is refused until every claim is decided and
 *     the source graded (the message counts them), then sets validated_*
 *     and a note 'Validated: …'; setting twice raises 'already validated';
 *     withdrawing needs a note and clears; field_submission_counts carries
 *     claims / decided / validated.
 *
 *  Authority refusals raise P0403 (private.perm_raise); no PERMISSION_DENIED
 *  row is asserted (it would roll back with the statement). Every record is
 *  authored by lsb with a '[rls-test] v188a' summary in the city
 *  jurisdiction; rls_test_cleanup sweeps fixture-authored field_submissions
 *  (20261030120000) and the lead hard-deletes best-effort in afterAll. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  field: process.env.RLS_TEST_PASSWORD_FIELD,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v188a] fixture passwords not set — suite skipped')
const hasField = !!PW.field

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Sub = { id: string; status: string; submission_no: string | null; officer_id: string; rejected_at: string | null; rejected_by: string | null; validated_at: string | null; validated_by: string | null; reliability: string | null; assigned_to: string | null }
type Counts = { submission_id: string; persons: number; items: number; claims: number; decided: number; validated: boolean }
const SUB_COLS = 'id, status, submission_no, officer_id, rejected_at, rejected_by, validated_at, validated_by, reliability, assigned_to'
const GUARD = /review state|already been sent|permission|42501|not allowed/i

describe.skipIf(!enabled)('v1.88a — intel triage: reject → terminal, restore is command\'s, the guard trigger, comments, the validation mark', () => {
  let lsb: C, bcb: C, lead: C, owner: C | null = null, field: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v188a ${tag}`
  let recA = ''   // the reject / restore / comment walkthrough
  let recB = ''   // the validation walkthrough (two claims)
  let recF = ''   // the field officer's own record (optional)
  let personClaim = '', itemClaim = ''
  const created: string[] = []

  const record = async (c: C, id: string): Promise<Sub | null> => {
    const r = await c.from('field_submissions').select(SUB_COLS).eq('id', id).maybeSingle()
    expect(r.error, r.error?.message).toBeNull()
    return (r.data as Sub | null) ?? null
  }
  const notesOf = async (c: C, id: string) => {
    const r = await c.from('field_submission_reviews').select('id, author_id, note').eq('submission_id', id).order('created_at')
    expect(r.error, r.error?.message).toBeNull()
    return r.data ?? []
  }
  const messagesOf = async (c: C, id: string) => {
    const r = await c.from('field_submission_messages').select('id, author_id, from_reviewer, body').eq('submission_id', id).order('created_at')
    expect(r.error, r.error?.message).toBeNull()
    return r.data ?? []
  }
  const countsOf = async (c: C, id: string): Promise<Counts | undefined> => {
    const r = await c.rpc('field_submission_counts')
    expect(r.error, r.error?.message).toBeNull()
    return ((r.data ?? []) as Counts[]).find((x) => x.submission_id === id)
  }
  /** A sent record authored by `c` — a draft first when claims are wanted (claims are draft-only inserts). */
  const send = async (c: C, label: string, withClaims = false): Promise<string> => {
    const ins = await c.from('field_submissions').insert({ summary: `${stamp} ${label}`, details: 'rls pin', jurisdiction: 'city', status: withClaims ? 'draft' : 'new' }).select('id, status').single()
    if (ins.error) throw new Error(`record ${label}: ${ins.error.message}`)
    const id = ins.data!.id as string
    created.push(id)
    if (withClaims) {
      const p = await c.from('field_submission_persons').insert({ submission_id: id, full_name: `RLS Test Claimant ${tag}` }).select('id').single()
      if (p.error) throw new Error(`person claim: ${p.error.message}`)
      personClaim = p.data!.id
      const i = await c.from('field_submission_items').insert({ submission_id: id, category: 'narcotics', description: `${stamp} baggie` }).select('id').single()
      if (i.error) throw new Error(`item claim: ${i.error.message}`)
      itemClaim = i.data!.id
      const up = await c.from('field_submissions').update({ status: 'new' }).eq('id', id).select('id, submission_no')
      if (up.error || !up.data?.length) throw new Error(`send ${label}: ${up.error?.message ?? 'zero rows'}`)
    }
    return id
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    if (PW.owner) { owner = mk(); ids.owner = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    if (PW.field) { field = mk(); ids.field = await signInWithRetry(field, 'rls-test-field@cidportal.test', PW.field) }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    recA = await send(lsb, 'reject walkthrough')
    recB = await send(lsb, 'validation walkthrough', true)
    expect((await record(lsb, recA))!.submission_no).toBeTruthy()
    expect((await record(lsb, recB))!.status).toBe('new')
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v188a] cleanup:', JSON.stringify(data))
    // Belt and braces: command hard-deletes whatever the sweep did not own.
    if (created.length) {
      const del = await lead.from('field_submissions').delete().in('id', created)
      if (del.error) console.warn('[rls:v188a] lead delete:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, owner, field].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ P6-01 reject ============ */

  it('reject needs a reason; bcb rejects with one → rejected_* set, the reviewer note, the audit row; the submitter is not told', async () => {
    const noReason = await bcb.rpc('field_submission_reject', { p_submission: recA, p_reason: '  ' })
    expect(noReason.error).not.toBeNull()
    expect(noReason.error!.message).toMatch(/say why this is being rejected/i)
    expect((await record(lsb, recA))!.status).toBe('new')

    const ok = await bcb.rpc('field_submission_reject', { p_submission: recA, p_reason: `${stamp} nothing actionable` })
    expect(ok.error, ok.error?.message).toBeNull()
    const s = (await record(lsb, recA))!
    expect(s).toMatchObject({ status: 'rejected', rejected_by: ids.bcb })
    expect(s.rejected_at).toBeTruthy()
    // The reason is not a row column — the author's SELECT never carries it; the note and the audit row do.
    const cols = await lsb.from('field_submissions').select('*').eq('id', recA).single()
    expect(cols.error, cols.error?.message).toBeNull()
    expect(cols.data).not.toHaveProperty('reject_reason')
    expect(cols.data).not.toHaveProperty('validation_note')
    const notes = await notesOf(lsb, recA)
    expect(notes.map((n) => n.note)).toContain(`Rejected: ${stamp} nothing actionable`)
    expect(notes.find((n) => n.note.startsWith('Rejected:'))!.author_id).toBe(ids.bcb)
    // IT3: the submitter holds no intel notification about the rejection.
    const mine = await lsb.from('notifications').select('type, payload').order('created_at', { ascending: false }).limit(50)
    expect(mine.error).toBeNull()
    expect((mine.data ?? []).filter((n) => (n.payload as { submission_id?: string } | null)?.submission_id === recA)).toEqual([])
    if (owner) {
      const a = await owner.from('audit_log').select('action, actor_id, detail').eq('entity_id', recA).eq('action', 'FIELD_SUBMISSION_REJECTED')
      expect(a.error, a.error?.message).toBeNull()
      expect(a.data).toHaveLength(1)
      expect(a.data![0]).toMatchObject({ actor_id: ids.bcb })
      expect(a.data![0].detail).toMatchObject({ from_status: 'new', reason: `${stamp} nothing actionable` })
    }
  })

  it('a rejected record is terminal for a reviewer: decide, ask, a second reject are refused; validate says closed', async () => {
    const decide = await bcb.rpc('field_submission_decide', { p_submission: recA, p_status: 'reviewed' })
    expect(decide.error).not.toBeNull()
    expect(decide.error!.message).toMatch(/cannot go from rejected/i)
    const ask = await bcb.rpc('field_submission_ask', { p_submission: recA, p_question: 'still there?' })
    expect(ask.error).not.toBeNull()
    expect(ask.error!.message).toMatch(/cannot go from rejected/i)
    const again = await lsb.rpc('field_submission_reject', { p_submission: recA, p_reason: 'again' })
    expect(again.error).not.toBeNull()
    expect(again.error!.message).toMatch(/already rejected/i)
    const validate = await bcb.rpc('field_submission_validate', { p_submission: recA, p_note: 'x' })
    expect(validate.error).not.toBeNull()
    expect(validate.error!.message).toMatch(/closed/i)
    expect((await record(lsb, recA))!.status).toBe('rejected')
  })

  it('restore from rejected: a detective is refused with P0403; the lead restores → reviewing, rejected_* cleared, the note and the audit from_status', async () => {
    const asDetective = await lsb.rpc('field_submission_restore', { p_submission: recA, p_reason: 'second look' })
    expect(asDetective.error).not.toBeNull()
    expect(asDetective.error!.code).toBe('P0403')
    expect(asDetective.error!.message).toMatch(/only a Bureau Lead or above can restore a rejected record/i)
    const asOther = await bcb.rpc('field_submission_restore', { p_submission: recA, p_reason: 'second look' })
    expect(asOther.error).not.toBeNull()
    expect(asOther.error!.code).toBe('P0403')
    expect((await record(lsb, recA))!.status).toBe('rejected')

    const ok = await lead.rpc('field_submission_restore', { p_submission: recA, p_reason: `${stamp} second look` })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(await record(lsb, recA)).toMatchObject({ status: 'reviewing', rejected_at: null, rejected_by: null })
    expect((await notesOf(lsb, recA)).map((n) => n.note)).toContain(`Restored after rejection: ${stamp} second look`)
    if (owner) {
      const a = await owner.from('audit_log').select('detail').eq('entity_id', recA).eq('action', 'FIELD_SUBMISSION_RESTORED')
      expect(a.error, a.error?.message).toBeNull()
      expect(a.data!.map((x) => (x.detail as { from_status?: string }).from_status)).toContain('rejected')
    }
    const notArchived = await lead.rpc('field_submission_restore', { p_submission: recA })
    expect(notArchived.error).not.toBeNull()
    expect(notArchived.error!.message).toMatch(/not archived/i)
  })

  /* ============ the guard trigger ============ */

  it('every direct UPDATE of a sent record is refused by the guard (the review columns, the grade, even a harmless edit); a non-author matches zero rows; a draft\'s review columns are refused too', async () => {
    for (const patch of [
      { status: 'rejected' },
      { rejected_at: new Date().toISOString() },
      { validated_at: new Date().toISOString() },
      { assigned_to: ids.lsb },
      { siu_sensitive: true },
      { reliability: 'confirmed' },
      { urgency: 'high' },
      { summary: `${stamp} rewritten` },
    ]) {
      const r = await lsb.from('field_submissions').update(patch).eq('id', recA).select('id')
      expect(r.error, `patch ${JSON.stringify(patch)} must be refused`).not.toBeNull()
      expect(r.error!.message).toMatch(GUARD)
    }
    // The author's UPDATE policy is the only client path; a reviewer's PATCH matches nothing (or is refused) — never a write.
    const other = await bcb.from('field_submissions').update({ urgency: 'high' }).eq('id', recA).select('id')
    expect(other.error !== null || (other.data ?? []).length === 0).toBe(true)
    expect(await record(lsb, recA)).toMatchObject({ status: 'reviewing', rejected_at: null, validated_at: null, assigned_to: null })
    // A draft is the author's editor — its summary changes, its review state never; a forged INSERT is refused too.
    const draft = await lsb.from('field_submissions').insert({ summary: `${stamp} guarded draft`, details: 'rls pin', jurisdiction: 'city' }).select('id').single()
    expect(draft.error, draft.error?.message).toBeNull()
    created.push(draft.data!.id)
    const edit = await lsb.from('field_submissions').update({ summary: `${stamp} guarded draft, edited` }).eq('id', draft.data!.id).select('id')
    expect(edit.error, edit.error?.message).toBeNull()
    expect(edit.data).toHaveLength(1)
    for (const patch of [{ status: 'rejected' }, { assigned_to: ids.lsb }, { reliability: 'confirmed' }, { siu_sensitive: true }]) {
      const r = await lsb.from('field_submissions').update(patch).eq('id', draft.data!.id).select('id')
      expect(r.error, `draft patch ${JSON.stringify(patch)} must be refused`).not.toBeNull()
      expect(r.error!.message).toMatch(GUARD)
    }
    const forged = await lsb.from('field_submissions').insert({ summary: `${stamp} forged`, details: 'rls pin', jurisdiction: 'city', status: 'new', assigned_to: ids.lsb }).select('id')
    expect(forged.error).not.toBeNull()
    expect(forged.error!.message).toMatch(/without review state|review state|review actions/i)
  })

  /* ============ P6-02 comments ============ */

  it('comment: private → a reviewer note, visible → the officer thread with from_reviewer; neither moves the status; blank refused', async () => {
    const before = (await record(lsb, recA))!.status
    const priv = await bcb.rpc('field_submission_comment', { p_submission: recA, p_body: `${stamp} private: looks like the pier crew` })
    expect(priv.error, priv.error?.message).toBeNull()
    expect(typeof priv.data).toBe('string')
    const note = (await notesOf(lsb, recA)).find((n) => n.id === priv.data)
    expect(note).toMatchObject({ author_id: ids.bcb, note: `${stamp} private: looks like the pier crew` })
    expect((await messagesOf(lsb, recA)).some((m) => m.body.includes('private:'))).toBe(false)

    const vis = await bcb.rpc('field_submission_comment', { p_submission: recA, p_body: `${stamp} visible: which pier?`, p_visible_to_officer: true })
    expect(vis.error, vis.error?.message).toBeNull()
    const msg = (await messagesOf(lsb, recA)).find((m) => m.id === vis.data)
    expect(msg).toMatchObject({ author_id: ids.bcb, from_reviewer: true, body: `${stamp} visible: which pier?` })
    expect((await notesOf(lsb, recA)).some((n) => n.note.includes('visible:'))).toBe(false)
    expect((await record(lsb, recA))!.status).toBe(before)

    const blank = await bcb.rpc('field_submission_comment', { p_submission: recA, p_body: '   ' })
    expect(blank.error).not.toBeNull()
    expect(blank.error!.message).toMatch(/write the comment first/i)
    if (owner) {
      const a = await owner.from('audit_log').select('detail').eq('entity_id', recA).eq('action', 'FIELD_SUBMISSION_COMMENTED')
      expect(a.error, a.error?.message).toBeNull()
      expect(a.data!.length).toBeGreaterThanOrEqual(2)
      // The body is never copied into the audit detail.
      for (const row of a.data!) expect(JSON.stringify(row.detail)).not.toMatch(/pier crew|which pier/)
    }
  })

  it('no client INSERT into the notes (42501); the thread INSERT is the author\'s own reply while a question is open', async () => {
    const forged = await bcb.from('field_submission_reviews').insert({ submission_id: recA, note: `${stamp} forged note` }).select('id')
    expect(forged.error).not.toBeNull()
    expect(forged.error!.code).toBe('42501')
    const lsbForged = await lsb.from('field_submission_reviews').insert({ submission_id: recA, note: `${stamp} forged note` }).select('id')
    expect(lsbForged.error).not.toBeNull()
    // A reviewer's direct message is refused (the reviewer branch moved to the RPC).
    const reviewerMsg = await bcb.from('field_submission_messages').insert({ submission_id: recA, body: `${stamp} direct reviewer message` }).select('id')
    expect(reviewerMsg.error).not.toBeNull()
    expect(reviewerMsg.error!.code).toBe('42501')
    // The author cannot reply while no question is open (status reviewing) …
    const early = await lsb.from('field_submission_messages').insert({ submission_id: recA, body: `${stamp} early reply` }).select('id')
    expect(early.error).not.toBeNull()
    // … and can once a question is asked (needs_info) — replyAsOfficer keeps working.
    const ask = await bcb.rpc('field_submission_ask', { p_submission: recA, p_question: `${stamp} which pier exactly?` })
    expect(ask.error, ask.error?.message).toBeNull()
    expect((await record(lsb, recA))!.status).toBe('needs_info')
    const reply = await lsb.from('field_submission_messages').insert({ submission_id: recA, body: `${stamp} Del Perro` }).select('id, author_id, from_reviewer').single()
    expect(reply.error, reply.error?.message).toBeNull()
    expect(reply.data).toMatchObject({ author_id: ids.lsb })
    expect((await notesOf(lsb, recA)).some((n) => n.note.includes('forged'))).toBe(false)
  })

  it.skipIf(!hasField)('the officer fixture: a private note never reaches the officer, a visible message sits in their thread', async () => {
    const ins = await field!.from('field_submissions').insert({ summary: `${stamp} officer record`, details: 'rls pin', jurisdiction: 'city', status: 'new' }).select('id, officer_id, status').single()
    expect(ins.error, ins.error?.message).toBeNull()
    recF = ins.data!.id
    created.push(recF)
    expect(ins.data).toMatchObject({ officer_id: ids.field, status: 'new' })
    const priv = await bcb.rpc('field_submission_comment', { p_submission: recF, p_body: `${stamp} private about the officer` })
    expect(priv.error, priv.error?.message).toBeNull()
    const vis = await bcb.rpc('field_submission_comment', { p_submission: recF, p_body: `${stamp} visible to the officer`, p_visible_to_officer: true })
    expect(vis.error, vis.error?.message).toBeNull()
    expect(await notesOf(field!, recF)).toEqual([])
    const thread = await messagesOf(field!, recF)
    expect(thread.map((m) => m.body)).toEqual([`${stamp} visible to the officer`])
    expect(thread[0].from_reviewer).toBe(true)
    // The officer cannot write a note either.
    const forged = await field!.from('field_submission_reviews').insert({ submission_id: recF, note: 'x' }).select('id')
    expect(forged.error).not.toBeNull()
  })

  /* ============ P6-05 validation ============ */

  it('validate is refused until every claim is decided and the source graded; then set, idempotent, withdrawable; counts carry the derived flag', async () => {
    const c0 = await countsOf(bcb, recB)
    expect(c0).toMatchObject({ persons: 1, items: 1, claims: 2, decided: 0, validated: false })
    const none = await bcb.rpc('field_submission_validate', { p_submission: recB, p_note: 'solid' })
    expect(none.error).not.toBeNull()
    expect(none.error!.message).toMatch(/validate every claim and grade the source first \(0 of 2 claims decided, source ungraded\)/i)

    const d1 = await bcb.rpc('field_claim_decide', { p_kind: 'person', p_claim: personClaim, p_verdict: 'verified' })
    expect(d1.error, d1.error?.message).toBeNull()
    const one = await bcb.rpc('field_submission_validate', { p_submission: recB, p_note: 'solid' })
    expect(one.error).not.toBeNull()
    expect(one.error!.message).toMatch(/\(1 of 2 claims decided, source ungraded\)/i)
    const d2 = await bcb.rpc('field_claim_decide', { p_kind: 'item', p_claim: itemClaim, p_verdict: 'unverified' })
    expect(d2.error, d2.error?.message).toBeNull()
    const ungraded = await bcb.rpc('field_submission_validate', { p_submission: recB, p_note: 'solid' })
    expect(ungraded.error).not.toBeNull()
    expect(ungraded.error!.message).toMatch(/\(2 of 2 claims decided, source ungraded\)/i)
    expect(await countsOf(bcb, recB)).toMatchObject({ claims: 2, decided: 2, validated: false })

    const grade = await bcb.rpc('field_submission_grade', { p_submission: recB, p_reliability: 'probable' })
    expect(grade.error, grade.error?.message).toBeNull()
    expect(await countsOf(bcb, recB)).toMatchObject({ claims: 2, decided: 2, validated: true })
    const noNote = await bcb.rpc('field_submission_validate', { p_submission: recB, p_note: '  ' })
    expect(noNote.error).not.toBeNull()
    expect(noNote.error!.message).toMatch(/say why/i)
    expect((await record(lsb, recB))!.validated_at).toBeNull()

    const ok = await bcb.rpc('field_submission_validate', { p_submission: recB, p_note: `${stamp} both claims hold` })
    expect(ok.error, ok.error?.message).toBeNull()
    const s = (await record(lsb, recB))!
    expect(s).toMatchObject({ validated_by: ids.bcb, status: 'new' })
    expect(s.validated_at).toBeTruthy()
    expect((await notesOf(lsb, recB)).map((n) => n.note)).toContain(`Validated: ${stamp} both claims hold`)
    const twice = await bcb.rpc('field_submission_validate', { p_submission: recB, p_note: 'again' })
    expect(twice.error).not.toBeNull()
    expect(twice.error!.message).toMatch(/already validated/i)

    // A later verdict change does NOT clear the explicit mark (the badge says "claims changed since").
    const redo = await bcb.rpc('field_claim_decide', { p_kind: 'item', p_claim: itemClaim, p_verdict: 'rejected' })
    expect(redo.error, redo.error?.message).toBeNull()
    expect((await record(lsb, recB))!.validated_at).toBeTruthy()

    const clearNoNote = await lsb.rpc('field_submission_validate', { p_submission: recB, p_note: '', p_clear: true })
    expect(clearNoNote.error).not.toBeNull()
    const cleared = await lsb.rpc('field_submission_validate', { p_submission: recB, p_note: `${stamp} item disproven`, p_clear: true })
    expect(cleared.error, cleared.error?.message).toBeNull()
    expect(await record(lsb, recB)).toMatchObject({ validated_at: null, validated_by: null })
    expect((await notesOf(lsb, recB)).map((n) => n.note)).toContain(`Validation withdrawn: ${stamp} item disproven`)
    const notSet = await lsb.rpc('field_submission_validate', { p_submission: recB, p_note: 'x', p_clear: true })
    expect(notSet.error).not.toBeNull()
    expect(notSet.error!.message).toMatch(/not validated/i)
    if (owner) {
      const a = await owner.from('audit_log').select('action').eq('entity_id', recB)
      expect(a.error, a.error?.message).toBeNull()
      const actions = a.data!.map((x) => x.action)
      expect(actions).toContain('FIELD_SUBMISSION_VALIDATED')
      expect(actions).toContain('FIELD_SUBMISSION_UNVALIDATED')
    }
  })

  it('validate on a draft and on an archived record is refused; the validated_* columns are client-frozen', async () => {
    const draft = await lsb.from('field_submissions').insert({ summary: `${stamp} draft`, details: 'rls pin', jurisdiction: 'city' }).select('id, status').single()
    expect(draft.error, draft.error?.message).toBeNull()
    created.push(draft.data!.id)
    expect(draft.data!.status).toBe('draft')
    const onDraft = await lsb.rpc('field_submission_validate', { p_submission: draft.data!.id, p_note: 'x' })
    expect(onDraft.error).not.toBeNull()
    expect(onDraft.error!.message).toMatch(/not been sent yet/i)
    const forged = await lsb.from('field_submissions').update({ validated_at: new Date().toISOString(), validated_by: ids.lsb }).eq('id', recB).select('id')
    expect(forged.error).not.toBeNull()
    expect(forged.error!.message).toMatch(GUARD)
    const archive = await bcb.rpc('field_submission_archive', { p_submission: recB, p_reason: `${stamp} retained for reference` })
    expect(archive.error, archive.error?.message).toBeNull()
    const onArchived = await bcb.rpc('field_submission_validate', { p_submission: recB, p_note: 'x' })
    expect(onArchived.error).not.toBeNull()
    expect(onArchived.error!.message).toMatch(/closed/i)
  })
})

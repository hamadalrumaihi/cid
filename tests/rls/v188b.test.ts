/** v1.88b — Intel triage: notifications, the realtime shadow table and the
 *  SIB cross-link (Portal Improvements P6-06 / P6-07, migrations
 *  20261030120000_intel_triage + 20261031120000_intel_groups_convert).
 *
 *  What the CID fixtures prove (lsb — the MCB detective who authors the
 *  records; bcb — the other detective; lead — MCB Bureau Lead; director —
 *  Director with `director_oversight` SIB standing, NOT an agent; inactive;
 *  owner optional — the SIB agent stand-in; the field-officer fixture
 *  optional — the reply leg):
 *   · a send (a direct INSERT with status 'new') reaches the lead and the
 *     director as `intel_new` with a MINIMAL payload — submission_id /
 *     submission_no / jurisdiction / actor_id / actor_name and nothing else
 *     (no summary, details or reason) — never the detectives, never the
 *     inactive account, never the actor;
 *   · `field_submission_assign` → `intel_assigned` for the assignee only,
 *     carrying assigned_by;
 *   · `field_submission_ask` → `intel_question` for the SUBMITTER only (the
 *     one kind a submitter ever receives); an investigator author's reply
 *     is stamped from_reviewer and pings nobody — with the officer fixture,
 *     the officer's reply → `intel_reply` for the reviewer who asked;
 *   · the shadow table `field_submission_events`: readers of the record
 *     read one row carrying status / assigned_to / siu_state / updated_at
 *     only; the inactive account reads none; a draft casts no shadow; no
 *     client INSERT / UPDATE / DELETE (42501);
 *   · `field_submission_siu_sensitive` is SIB's alone (the lead is refused);
 *     a `public_corruption` referral restricts the record at once: bcb, the
 *     lead and the director (oversight) read neither the record nor its
 *     shadow row; the referrer still does; the Owner (agent) does;
 *   · `intel_referred` reaches SIB agents (the Owner when present) with the
 *     category — never the referrer, never oversight;
 *   · `siu_referred_submissions()` answers zero rows to the director, bcb
 *     and lsb (no error) and, to the Owner, the referred record with the
 *     nine contract keys and no summary.
 *
 *  Contract note: the contract's "siu_sensitive flip as lead" leg is not
 *  possible — `field_submission_siu_sensitive` requires SIB agent standing,
 *  which no CID fixture holds; the flip is exercised through the
 *  public_corruption referral instead, and the lead's refusal is pinned.
 *  Every record is authored by lsb ('[rls-test] v188b …', city);
 *  rls_test_cleanup sweeps them and the fixtures' notifications. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  field: process.env.RLS_TEST_PASSWORD_FIELD,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.inactive)
if (!enabled) console.warn('[rls:v188b] fixture passwords not set — suite skipped')
const hasField = !!PW.field

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Payload = Record<string, unknown> | null
type Notif = { type: string; payload: Payload }
type Event = { submission_id: string; status: string; assigned_to: string | null; siu_state: string | null; updated_at: string }
const MINIMAL = ['actor_id', 'actor_name', 'jurisdiction', 'submission_id', 'submission_no']
const FORBIDDEN = ['summary', 'details', 'reason', 'title']

describe.skipIf(!enabled)('v1.88b — intel triage: minimal notifications per kind, the realtime shadow behind the read wall, the SIB cross-link', () => {
  let lsb: C, bcb: C, lead: C, director: C, inactive: C, owner: C | null = null, field: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v188b ${tag}`
  let recN = ''   // the notification walkthrough
  let recS = ''   // the sensitive (referred) record
  let recF = ''   // the officer's record (optional)
  const created: string[] = []

  const notificationsFor = async (c: C, type: string, submissionId: string): Promise<Notif[]> => {
    const r = await c.from('notifications').select('type, payload').eq('type', type).order('created_at', { ascending: false }).limit(50)
    expect(r.error, r.error?.message).toBeNull()
    return ((r.data ?? []) as Notif[]).filter((n) => n.payload?.submission_id === submissionId)
  }
  const anyIntelFor = async (c: C, submissionId: string): Promise<Notif[]> => {
    const r = await c.from('notifications').select('type, payload').order('created_at', { ascending: false }).limit(100)
    expect(r.error, r.error?.message).toBeNull()
    return ((r.data ?? []) as Notif[]).filter((n) => n.type.startsWith('intel_') && n.payload?.submission_id === submissionId)
  }
  const expectMinimal = (n: Notif, extra: string[] = []) => {
    const keys = Object.keys(n.payload ?? {}).sort()
    expect(keys).toEqual([...MINIMAL, ...extra].sort())
    for (const k of FORBIDDEN) expect(n.payload, `payload must not carry ${k}`).not.toHaveProperty(k)
  }
  const eventsFor = async (c: C, submissionId: string): Promise<Event[]> => {
    const r = await c.from('field_submission_events').select('*').eq('submission_id', submissionId)
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as Event[]
  }
  const send = async (c: C, label: string): Promise<string> => {
    const ins = await c.from('field_submissions').insert({ summary: `${stamp} ${label}`, details: 'rls pin', jurisdiction: 'city', status: 'new' }).select('id, submission_no').single()
    if (ins.error) throw new Error(`record ${label}: ${ins.error.message}`)
    created.push(ins.data!.id)
    return ins.data!.id as string
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); inactive = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director!, 'director'],
      [inactive, 'rls-test-inactive@cidportal.test', PW.inactive!, 'inactive'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    if (PW.owner) { owner = mk(); ids.owner = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    if (PW.field) { field = mk(); ids.field = await signInWithRetry(field, 'rls-test-field@cidportal.test', PW.field) }
    // Sweeps the fixtures' notifications too, so the dedupe window never masks a leg.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    recN = await send(lsb, 'notification walkthrough')
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v188b] cleanup:', JSON.stringify(data))
    if (created.length) {
      const del = await lead.from('field_submissions').delete().in('id', created)
      if (del.error) console.warn('[rls:v188b] lead delete:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, director, inactive, owner, field].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ intel_new ============ */

  it('a send reaches the lead and the director as intel_new with a minimal payload — never the detectives, the inactive account or the actor', async () => {
    for (const [c, who] of [[lead, 'lead'], [director, 'director']] as const) {
      const pings = await notificationsFor(c, 'intel_new', recN)
      expect(pings.length, `${who} holds intel_new`).toBe(1)
      expectMinimal(pings[0])
      expect(pings[0].payload).toMatchObject({ submission_id: recN, jurisdiction: 'city', actor_id: ids.lsb })
      expect(pings[0].payload!.submission_no).toBeTruthy()
    }
    for (const [c, who] of [[lsb, 'lsb'], [bcb, 'bcb'], [inactive, 'inactive']] as const) {
      expect(await anyIntelFor(c, recN), `${who} holds nothing`).toEqual([])
    }
    if (owner) {
      const pings = await notificationsFor(owner, 'intel_new', recN)
      expect(pings).toHaveLength(1)
      expectMinimal(pings[0])
    }
  })

  /* ============ intel_assigned / intel_question / intel_reply ============ */

  it('assign → intel_assigned for the assignee only (assigned_by = the lead); the shadow row follows', async () => {
    const r = await lead.rpc('field_submission_assign', { p_submission: recN, p_user: ids.bcb })
    expect(r.error, r.error?.message).toBeNull()
    const pings = await notificationsFor(bcb, 'intel_assigned', recN)
    expect(pings).toHaveLength(1)
    expectMinimal(pings[0], ['assigned_by', 'action'])
    expect(pings[0].payload).toMatchObject({ assigned_by: ids.lead, actor_id: ids.lead, action: 'assigned' })
    expect(await notificationsFor(lsb, 'intel_assigned', recN)).toEqual([])
    expect(await notificationsFor(lead, 'intel_assigned', recN)).toEqual([])
    expect(await notificationsFor(director, 'intel_assigned', recN)).toEqual([])
    const [ev] = await eventsFor(lsb, recN)
    expect(ev).toMatchObject({ status: 'reviewing', assigned_to: ids.bcb, siu_state: null })
  })

  it('ask → intel_question for the submitter only; an investigator author\'s reply is stamped from_reviewer and pings nobody', async () => {
    const r = await bcb.rpc('field_submission_ask', { p_submission: recN, p_question: `${stamp} which pier?` })
    expect(r.error, r.error?.message).toBeNull()
    const pings = await notificationsFor(lsb, 'intel_question', recN)
    expect(pings).toHaveLength(1)
    expectMinimal(pings[0])
    expect(pings[0].payload).toMatchObject({ actor_id: ids.bcb })
    for (const c of [bcb, lead, director]) expect(await notificationsFor(c, 'intel_question', recN)).toEqual([])
    expect((await eventsFor(lsb, recN))[0].status).toBe('needs_info')
    // lsb (active, the author) replies directly — the trigger stamps from_reviewer = is_active(), so no intel_reply.
    const reply = await lsb.from('field_submission_messages').insert({ submission_id: recN, body: `${stamp} Del Perro` }).select('id, from_reviewer').single()
    expect(reply.error, reply.error?.message).toBeNull()
    expect(reply.data!.from_reviewer).toBe(true)
    expect(await notificationsFor(bcb, 'intel_reply', recN)).toEqual([])
  })

  it.skipIf(!hasField)('the officer fixture: its own send, the question, and its reply → intel_reply for the reviewer who asked', async () => {
    const ins = await field!.from('field_submissions').insert({ summary: `${stamp} officer record`, details: 'rls pin', jurisdiction: 'city', status: 'new' }).select('id').single()
    expect(ins.error, ins.error?.message).toBeNull()
    recF = ins.data!.id
    created.push(recF)
    expect((await notificationsFor(lead, 'intel_new', recF)).length).toBe(1)
    const claim = await bcb.rpc('field_submission_decide', { p_submission: recF, p_status: 'reviewing' })
    expect(claim.error, claim.error?.message).toBeNull()
    const ask = await bcb.rpc('field_submission_ask', { p_submission: recF, p_question: `${stamp} unit?` })
    expect(ask.error, ask.error?.message).toBeNull()
    const q = await notificationsFor(field!, 'intel_question', recF)
    expect(q).toHaveLength(1)
    expectMinimal(q[0])
    // The officer is never told anything else.
    expect((await anyIntelFor(field!, recF)).map((n) => n.type)).toEqual(['intel_question'])
    const reply = await field!.from('field_submission_messages').insert({ submission_id: recF, body: `${stamp} Unit 12` }).select('id, from_reviewer').single()
    expect(reply.error, reply.error?.message).toBeNull()
    expect(reply.data!.from_reviewer).toBe(false)
    const pings = await notificationsFor(bcb, 'intel_reply', recF)
    expect(pings).toHaveLength(1)
    expectMinimal(pings[0])
    expect(await notificationsFor(lead, 'intel_reply', recF)).toEqual([])
    // The officer reads its own shadow row; the private notes never.
    expect((await eventsFor(field!, recF))[0]).toMatchObject({ status: 'needs_info' })
  })

  /* ============ the shadow table ============ */

  it('the shadow row carries status / assigned_to / siu_state / updated_at only; readers see it, the inactive account does not; no client writes; a draft casts no shadow', async () => {
    for (const [c, who] of [[lsb, 'lsb'], [bcb, 'bcb'], [lead, 'lead'], [director, 'director']] as const) {
      const rows = await eventsFor(c, recN)
      expect(rows, `${who} reads the row`).toHaveLength(1)
      expect(Object.keys(rows[0]).sort()).toEqual(['assigned_to', 'siu_state', 'status', 'submission_id', 'updated_at'])
      expect(rows[0]).toMatchObject({ status: 'needs_info', assigned_to: ids.bcb, siu_state: null })
    }
    expect(await eventsFor(inactive, recN)).toEqual([])
    const ins = await lsb.from('field_submission_events').insert({ submission_id: recN, status: 'archived' }).select('submission_id')
    expect(ins.error).not.toBeNull()
    expect(ins.error!.code).toBe('42501')
    const upd = await lsb.from('field_submission_events').update({ status: 'archived' }).eq('submission_id', recN).select('submission_id')
    expect(upd.error).not.toBeNull()
    expect(upd.error!.code).toBe('42501')
    const del = await lead.from('field_submission_events').delete().eq('submission_id', recN).select('submission_id')
    expect(del.error).not.toBeNull()
    expect(del.error!.code).toBe('42501')
    expect((await eventsFor(lsb, recN))[0].status).toBe('needs_info')
    // A draft is the author's alone: no shadow row even for the author.
    const draft = await lsb.from('field_submissions').insert({ summary: `${stamp} draft`, details: 'rls pin', jurisdiction: 'city' }).select('id, status').single()
    expect(draft.error, draft.error?.message).toBeNull()
    created.push(draft.data!.id)
    expect(draft.data!.status).toBe('draft')
    expect(await eventsFor(lsb, draft.data!.id)).toEqual([])
    // Sending it mirrors it and announces it.
    const sent = await lsb.from('field_submissions').update({ status: 'new' }).eq('id', draft.data!.id).select('id, submission_no')
    expect(sent.error, sent.error?.message).toBeNull()
    expect(sent.data).toHaveLength(1)
    expect(sent.data![0].submission_no).toBeTruthy()
    expect((await eventsFor(bcb, draft.data!.id))[0]).toMatchObject({ status: 'new', assigned_to: null })
    expect(await notificationsFor(lead, 'intel_new', draft.data!.id)).toHaveLength(1)
  })

  /* ============ the sensitive wall + SIB cross-link ============ */

  it('the lead cannot flip sensitivity (SIB only); a public_corruption referral restricts the record: bcb, the lead and the director read neither the record nor its shadow; the referrer does', async () => {
    recS = await send(lsb, 'sensitive walkthrough')
    expect((await eventsFor(bcb, recS))).toHaveLength(1)
    const flip = await lead.rpc('field_submission_siu_sensitive', { p_submission: recS, p_on: true, p_reason: `${stamp} lead cannot` })
    expect(flip.error).not.toBeNull()
    expect(flip.error!.message).toMatch(/only SIB/i)

    const refer = await lsb.rpc('field_submission_siu_refer', { p_submission: recS, p_category: 'public_corruption', p_reason: `${stamp} a badge was named` })
    expect(refer.error, refer.error?.message).toBeNull()
    const mine = await lsb.from('field_submissions').select('siu_sensitive, siu_state, siu_referred_by').eq('id', recS).single()
    expect(mine.error, mine.error?.message).toBeNull()
    expect(mine.data).toEqual({ siu_sensitive: true, siu_state: 'referred', siu_referred_by: ids.lsb })
    expect((await eventsFor(lsb, recS))[0]).toMatchObject({ status: 'new', siu_state: 'referred' })
    for (const [c, who] of [[bcb, 'bcb'], [lead, 'lead'], [director, 'director'], [inactive, 'inactive']] as const) {
      expect(await eventsFor(c, recS), `${who} sees no shadow row`).toEqual([])
      const rec = await c.from('field_submissions').select('id').eq('id', recS)
      expect(rec.error, rec.error?.message).toBeNull()
      expect(rec.data, `${who} sees no record`).toEqual([])
    }
    if (owner) {
      expect(await eventsFor(owner, recS)).toHaveLength(1)
      const pings = await notificationsFor(owner, 'intel_referred', recS)
      expect(pings).toHaveLength(1)
      expectMinimal(pings[0], ['category'])
      expect(pings[0].payload).toMatchObject({ category: 'public_corruption', actor_id: ids.lsb })
    }
    // Never the referrer, never oversight, never a detective.
    for (const c of [lsb, director, bcb, lead]) expect(await notificationsFor(c, 'intel_referred', recS)).toEqual([])
    // An assignment would open the wall to the assignee — but the lead cannot even read it now.
    const assign = await lead.rpc('field_submission_assign', { p_submission: recS, p_user: ids.bcb })
    expect(assign.error).not.toBeNull()
  })

  it('siu_referred_submissions(): zero rows for the director (oversight), bcb and lsb; the Owner (agent) sees the referral with the nine keys and no summary', async () => {
    for (const [c, who] of [[director, 'director'], [bcb, 'bcb'], [lsb, 'lsb'], [inactive, 'inactive']] as const) {
      const r = await c.rpc('siu_referred_submissions')
      expect(r.error, `${who}: ${r.error?.message}`).toBeNull()
      expect(r.data ?? [], `${who} gets zero rows`).toEqual([])
    }
    if (owner) {
      const r = await owner.rpc('siu_referred_submissions')
      expect(r.error, r.error?.message).toBeNull()
      const row = (r.data ?? []).find((x: { id: string }) => x.id === recS)
      expect(row).toBeTruthy()
      expect(Object.keys(row!).sort()).toEqual(['id', 'jurisdiction', 'siu_assigned_to', 'siu_case_id', 'siu_category', 'siu_referred_at', 'siu_referred_by', 'siu_state', 'submission_no'])
      expect(row).toMatchObject({ siu_category: 'public_corruption', siu_state: 'referred', siu_referred_by: ids.lsb, jurisdiction: 'city' })
    }
  })

  it('every intel notification the fixtures hold carries no summary, details or reason', async () => {
    for (const c of [lsb, bcb, lead, director, ...(owner ? [owner] : []), ...(field ? [field] : [])]) {
      const r = await c.from('notifications').select('type, payload').order('created_at', { ascending: false }).limit(100)
      expect(r.error, r.error?.message).toBeNull()
      for (const n of (r.data ?? []) as Notif[]) {
        if (!n.type.startsWith('intel_')) continue
        for (const k of FORBIDDEN) expect(n.payload, `${n.type} must not carry ${k}`).not.toHaveProperty(k)
        expect(JSON.stringify(n.payload)).not.toContain(stamp)
      }
    }
  })
})

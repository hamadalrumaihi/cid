/** v1.96a — CID undercover operations: §4's disclosure list, enforced.
 *
 *  The procedure names exactly three positions that may be told an undercover
 *  identity — High Command, the CID Bureau Lead, CID Command — plus, by
 *  necessity, the Detective running the operation. That list is the whole
 *  access model, and `private.uc_row_visible` is its only implementation.
 *
 *  What this suite pins is the part a UI cannot be trusted with. Concretely:
 *
 *   · #1 the Detective sees their own operation, its alias, and its audit;
 *   · #2 CASE ACCESS IS NOT UC ACCESS — the strongest case here. bcb can read
 *     the fixture case (`can_read_case` true, the case row comes back) and
 *     still reads ZERO rows from all four uc_* tables, including a direct-id
 *     lookup of the operation. There is no lock, no count, no placeholder:
 *     the row does not exist as far as they are concerned;
 *   · #3 the Detective's OWN Bureau Lead reads the operation and the alias
 *     (§4 authorizes them) but `uc_command()` is FALSE for them — §8's actions
 *     belong to Command, and a Bureau Lead calling `uc_command_act` is
 *     refused P0403 even on an operation they can see;
 *   · #4 CID Command and High Command read it and hold the actions;
 *   · #5 an SIB account gets nothing. SIB standing is not CID standing here,
 *     and — the other direction — this suite never touches `siu_*`: the SIB
 *     compartment's own undercover table is untouched by all of this;
 *   · #6 an inactive account reads nothing, the same as any non-CID account;
 *   · #7 no write path leaks: a non-owner's UPDATE changes zero rows, an
 *     INSERT naming another detective is refused, and all three RPCs answer
 *     P0403 with the same wording whether the caller is unauthorized or the
 *     operation id is unknown;
 *   · #8 nothing deletes. There is no DELETE policy and (since
 *     20261111130000) no DELETE grant either, on any of the four tables;
 *   · #9 the audit trail is append-only even for the operation's own subject:
 *     UPDATE and DELETE change nothing, a forged INSERT is refused, and the
 *     row still reads what the trigger wrote;
 *   · #10 §3's retention is the SERVER's arithmetic — `retention_until` is
 *     always `ended_at + 72h`, and a client that tries to set it is ignored;
 *   · #11 §5 is a reporting duty: an incomplete report is ACCEPTED and names
 *     what is outstanding, and nothing anywhere records a disciplinary state;
 *   · #12 a command action moves the operation's own oversight fields and
 *     leaves the underlying case row untouched.
 *
 *  Fixtures: one case created by lsb (`[rls-test] v196a <tag>`), and the
 *  operations created on it. Everything cascades from the case; the suite
 *  deletes its own case at the end (uc rows cascade with it) because uc_*
 *  admits no client DELETE at all — which is the point of #8.
 */

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
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
  siuAgent: process.env.RLS_TEST_PASSWORD_SIU_AGENT,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director)
if (!enabled) console.warn('[rls:v196a] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner
const hasInactive = !!PW.inactive
const hasSiu = !!PW.siuAgent

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>

/** Every table in the compartment. A viewer §4 does not authorize reads zero
 *  rows from ALL of them — not "the sensitive one". */
const UC_TABLES = ['uc_operations', 'uc_criminal_activity', 'uc_command_actions', 'uc_audit_events'] as const

const ALIAS = 'RLS-PROBE-IDENTITY'
const HOUR = 3600_000

describe.skipIf(!enabled)('v1.96a — undercover: §4 is the access model, and RLS is the only copy of it', () => {
  let lsb: C, bcb: C, lead: C, director: C
  let owner: C | null = null, inactive: C | null = null, siu: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v196a ${tag}`
  let caseId = ''
  let opId = ''

  const rowsOf = async (c: C, table: string): Promise<Json[]> => {
    const r = await c.from(table).select('*').limit(50)
    // A blocked read is an EMPTY read, never an error — an error would itself
    // tell the caller that something is there to be blocked.
    expect(r.error, `${table}: ${r.error?.message}`).toBeNull()
    return (r.data ?? []) as Json[]
  }
  const expectP0403 = async (c: C, fn: string, args: Json): Promise<string> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn} should raise`).not.toBeNull()
    expect(r.error!.code, `${fn}: ${r.error!.message}`).toBe('P0403')
    return r.error!.message
  }
  const op = async (c: C): Promise<Json | null> => {
    const r = await c.from('uc_operations').select('*').eq('id', opId).maybeSingle()
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? null) as Json | null
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director!, 'director'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    if (hasOwner) { owner = mk(); ids.owner = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!) }
    if (hasInactive) { inactive = mk(); ids.inactive = await signInWithRetry(inactive, 'rls-test-inactive@cidportal.test', PW.inactive!) }
    if (hasSiu) { siu = mk(); ids.siu = await signInWithRetry(siu, 'rls-test-siu-agent@cidportal.test', PW.siuAgent!) }

    const c = await lsb.from('cases').insert({ title: `${stamp} case`, status: 'open' }).select('id').single()
    if (c.error) throw new Error(`case: ${c.error.message}`)
    caseId = c.data!.id

    const prof = await lsb.from('profiles').select('division').eq('id', ids.lsb).single()
    if (prof.error) throw new Error(`profile: ${prof.error.message}`)
    const o = await lsb.from('uc_operations').insert({
      case_id: caseId,
      detective_id: ids.lsb,
      bureau: (prof.data as { division: string }).division,
      alias: ALIAS,
      objective: `${stamp} objective`,
      started_at: new Date(Date.now() - 5 * HOUR).toISOString(),
      status: 'active',
    }).select('id').single()
    if (o.error) throw new Error(`operation: ${o.error.message}`)
    opId = o.data!.id
  }, 120_000)

  afterAll(async () => {
    // The case cascades the operation and everything hanging off it. Deleting
    // the uc rows directly is impossible on purpose — see #8.
    if (caseId) await lsb.from('cases').delete().eq('id', caseId)
  })

  /* ── #1 the Detective ─────────────────────────────────────────────────── */

  it('#1 the Detective running it reads their own operation, its identity and its audit', async () => {
    const rows = await rowsOf(lsb, 'uc_operations')
    const mine = rows.find((r) => r.id === opId)
    expect(mine, 'the detective must see their own operation').toBeTruthy()
    expect(mine!.alias).toBe(ALIAS)
    const audit = await rowsOf(lsb, 'uc_audit_events')
    expect(audit.filter((a) => a.operation_id === opId).map((a) => a.action)).toContain('UC_OPERATION_CREATED')
  })

  /* ── #2 case access is not UC access ──────────────────────────────────── */

  it('#2 a CID detective who can read the CASE reads nothing of the operation', async () => {
    // The premise this test rests on: bcb genuinely has the case.
    const theCase = await bcb.from('cases').select('id').eq('id', caseId).maybeSingle()
    expect(theCase.error, theCase.error?.message).toBeNull()
    expect(theCase.data, 'the fixture case must be readable by bcb for this test to mean anything').toBeTruthy()

    // And still: nothing, on every table, including a direct-id lookup.
    for (const t of UC_TABLES) {
      const rows = await rowsOf(bcb, t)
      expect(rows.filter((r) => r.operation_id === opId || r.id === opId), `${t} must be empty for bcb`).toEqual([])
    }
    expect(await op(bcb), 'a direct-id read is null, not a locked row').toBeNull()
  })

  it('#2b the alias never reaches an unauthorized reader through any column projection', async () => {
    const r = await bcb.from('uc_operations').select('alias').limit(50)
    expect(r.error, r.error?.message).toBeNull()
    expect((r.data ?? []).map((x) => (x as Json).alias)).not.toContain(ALIAS)
  })

  /* ── #3 the Bureau Lead reads, but holds no §8 action ─────────────────── */

  it('#3 the Detective’s own Bureau Lead reads the operation and the identity', async () => {
    const mine = await op(lead)
    expect(mine, '§4 authorizes the CID Bureau Lead').toBeTruthy()
    expect(mine!.alias).toBe(ALIAS)
  })

  it('#3b a Bureau Lead is NOT “CID Command” — uc_command_act refuses them', async () => {
    const msg = await expectP0403(lead, 'uc_command_act', { p_op: opId, p_action: 'request_recording', p_note: null })
    expect(msg).toMatch(/only CID Command/i)
  })

  /* ── #4 Command and High Command ──────────────────────────────────────── */

  it('#4 CID Command reads the operation and holds the §8 actions', async () => {
    const seen = await op(director)
    expect(seen).toBeTruthy()
    expect(seen!.alias).toBe(ALIAS)
    const r = await director.rpc('uc_command_act', { p_op: opId, p_action: 'request_recording', p_note: null })
    expect(r.error, r.error?.message).toBeNull()
    expect((r.data as Json).ok).toBe(true)
    const after = await op(director)
    expect(after!.command_review_status).toBe('requested')
  })

  it('#4b a command action that needs a reason is refused without one', async () => {
    const r = await director.rpc('uc_command_act', { p_op: opId, p_action: 'add_restriction', p_note: null })
    expect(r.error, r.error?.message).toBeNull()
    expect((r.data as Json).ok).toBe(false)
    expect((r.data as Json).code).toBe('note_required')
  })

  it.skipIf(!hasOwner)('#4c High Command reads it too', async () => {
    expect(await op(owner!)).toBeTruthy()
  })

  /* ── #5 SIB, #6 non-CID ───────────────────────────────────────────────── */

  it.skipIf(!hasSiu)('#5 an SIB account reads nothing — SIB standing is not CID standing here', async () => {
    for (const t of UC_TABLES) {
      const rows = await rowsOf(siu!, t)
      expect(rows.filter((r) => r.operation_id === opId || r.id === opId), `${t} must be empty for SIB`).toEqual([])
    }
    expect(await op(siu!)).toBeNull()
  })

  it.skipIf(!hasInactive)('#6 an inactive (non-CID) account reads nothing', async () => {
    for (const t of UC_TABLES) expect(await rowsOf(inactive!, t)).toEqual([])
    expect(await op(inactive!)).toBeNull()
  })

  /* ── #7 write paths ───────────────────────────────────────────────────── */

  it('#7 a non-owner’s UPDATE changes nothing, and every RPC refuses them', async () => {
    const u = await bcb.from('uc_operations').update({ alias: 'HIJACKED' }).eq('id', opId).select('id')
    expect(u.error, u.error?.message).toBeNull()
    expect(u.data ?? [], 'the UPDATE must match zero rows').toEqual([])
    // And the alias is still what the detective wrote.
    expect((await op(lsb))!.alias).toBe(ALIAS)

    await expectP0403(bcb, 'uc_command_act', { p_op: opId, p_action: 'terminate', p_note: null })
    await expectP0403(bcb, 'uc_mark_compromised', { p_op: opId, p_compromised_at: new Date().toISOString(), p_note: 'x' })
    await expectP0403(bcb, 'uc_report_criminal_activity', { p_op: opId, p_description: 'x', p_occurred_at: new Date().toISOString() })
  })

  it('#7b an unauthorized id and an unknown id answer identically — no existence oracle', async () => {
    const real = await expectP0403(bcb, 'uc_mark_compromised', { p_op: opId, p_compromised_at: new Date().toISOString(), p_note: 'x' })
    const fake = await expectP0403(bcb, 'uc_mark_compromised', {
      p_op: '00000000-0000-4000-8000-000000000000', p_compromised_at: new Date().toISOString(), p_note: 'x',
    })
    expect(fake).toBe(real)
  })

  it('#7c a detective cannot log an operation naming somebody else', async () => {
    const r = await bcb.from('uc_operations').insert({
      case_id: caseId, detective_id: ids.lsb, bureau: 'major_crimes', status: 'planned',
    }).select('id')
    expect(r.error, 'the insert policy must refuse it').not.toBeNull()
    expect(r.error!.code).toBe('42501')
  })

  /* ── #8 nothing deletes ───────────────────────────────────────────────── */

  it('#8 no account can delete from any uc_* table — no policy, and no grant', async () => {
    for (const client of [lsb, lead, director]) {
      for (const t of UC_TABLES) {
        const d = await client.from(t).delete().eq(t === 'uc_operations' ? 'id' : 'operation_id', opId).select('id')
        // Either a hard grant refusal (42501) or a policy that matches nothing.
        if (d.error) expect(d.error.code, `${t}: ${d.error.message}`).toBe('42501')
        else expect(d.data ?? [], `${t} must delete nothing`).toEqual([])
      }
    }
    expect(await op(lsb), 'the operation is still there').toBeTruthy()
  })

  /* ── #9 the audit trail ───────────────────────────────────────────────── */

  it('#9 the audit trail is append-only, even for the operation’s own subject', async () => {
    const before = await lsb.from('uc_audit_events').select('id,action').eq('operation_id', opId).order('created_at')
    expect(before.error, before.error?.message).toBeNull()
    const first = (before.data ?? [])[0] as Json
    expect(first, 'there is an audit row to try to rewrite').toBeTruthy()

    const u = await lsb.from('uc_audit_events').update({ action: 'REWRITTEN' }).eq('operation_id', opId).select('id')
    if (u.error) expect(u.error.code).toBe('42501')
    else expect(u.data ?? []).toEqual([])

    const forge = await lsb.from('uc_audit_events').insert({
      operation_id: opId, action: 'FORGED', entity: 'uc_operations', detail: {},
    }).select('id')
    expect(forge.error, 'a forged audit row must be refused').not.toBeNull()

    const after = await lsb.from('uc_audit_events').select('id,action').eq('operation_id', opId).order('created_at')
    expect((after.data ?? [])[0]).toEqual(first)
    expect((after.data ?? []).map((a) => (a as Json).action)).not.toContain('FORGED')
  })

  /* ── #10 §3 retention ─────────────────────────────────────────────────── */

  it('#10 retention_until is the server’s 72 hours from the END, and a client cannot set it', async () => {
    const ended = new Date(Date.now() - HOUR).toISOString()
    const bogus = new Date(Date.now() + 5 * 60_000).toISOString()
    const u = await lsb.from('uc_operations')
      .update({ ended_at: ended, status: 'concluded', retention_until: bogus })
      .eq('id', opId).select('ended_at,retention_until').single()
    expect(u.error, u.error?.message).toBeNull()
    const row = u.data as { ended_at: string; retention_until: string }
    expect(Date.parse(row.retention_until) - Date.parse(row.ended_at)).toBe(72 * HOUR)
    expect(row.retention_until, 'the client value is discarded').not.toBe(bogus)
  })

  /* ── #11 §5 is a duty, not a finding ──────────────────────────────────── */

  it('#11 an incomplete §5 report is accepted and names what is still outstanding', async () => {
    const r = await lsb.rpc('uc_report_criminal_activity', {
      p_op: opId,
      p_description: `${stamp} activity`,
      p_occurred_at: new Date(Date.now() - 2 * HOUR).toISOString(),
      p_incident_reference: 'INC-1',
      p_bureau_lead_notified: true,
    })
    expect(r.error, r.error?.message).toBeNull()
    const body = r.data as { ok: boolean; outstanding: string[] }
    expect(body.ok, 'the report is filed even though two duties are outstanding').toBe(true)
    expect(body.outstanding).toEqual(['command', 'recording'])

    const row = await op(lsb)
    expect(row!.criminal_activity).toBe(true)
    // The flag is a reporting state. Nothing anywhere turns it into a verdict.
    expect(JSON.stringify(row)).not.toMatch(/misconduct|discipline/i)
  })

  it('#11b a §5 report is visible to the authorized audience and to nobody else', async () => {
    const forLead = await lead.from('uc_criminal_activity').select('id').eq('operation_id', opId)
    expect(forLead.error, forLead.error?.message).toBeNull()
    expect((forLead.data ?? []).length, 'the Bureau Lead is one of §5’s addressees').toBeGreaterThan(0)
    expect(await rowsOf(bcb, 'uc_criminal_activity')).toEqual([])
  })

  /* ── #12 command oversight does not touch the case ────────────────────── */

  it('#12 a command action moves the operation’s own fields and leaves the case alone', async () => {
    const before = await director.from('cases').select('updated_at,status,lead_detective_id').eq('id', caseId).single()
    expect(before.error, before.error?.message).toBeNull()

    const r = await director.rpc('uc_command_act', { p_op: opId, p_action: 'flag_review', p_note: `${stamp} review` })
    expect(r.error, r.error?.message).toBeNull()
    expect((await op(director))!.command_review_status).toBe('under_review')

    const after = await director.from('cases').select('updated_at,status,lead_detective_id').eq('id', caseId).single()
    expect(after.data, 'the underlying case is untouched').toEqual(before.data)
  })

  it('#12b the command action log is readable by the authorized audience only', async () => {
    const forLead = await lead.from('uc_command_actions').select('id').eq('operation_id', opId)
    expect(forLead.error, forLead.error?.message).toBeNull()
    expect((forLead.data ?? []).length).toBeGreaterThan(0)
    expect(await rowsOf(bcb, 'uc_command_actions')).toEqual([])
  })
})

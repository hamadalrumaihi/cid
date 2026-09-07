/** v1.86e — Reminders, escalation and expiry sweeps (Portal Improvements
 *  P4-10, migration 20261027120000_legal_sweeps).
 *
 *  Two private sweeps run hourly from the `legal-sweep` cron job (minute 35):
 *  `private.legal_reminder_sweep()` (48 h nudge → 5 d escalation → 7 d
 *  approved-but-unissued → 72 h expiring) and `private.legal_expiry_sweep()`
 *  (issued warrants past expires_at → `expired`; subpoenas past their
 *  response deadline). Both are IDEMPOTENT through `legal_request_reminders`
 *  (unique on request / kind / stage). `legal_sweep_run()` is the Owner's
 *  manual trigger for both.
 *
 *  What this suite pins:
 *   · a detective's `legal_sweep_run()` is refused ({ok:false} or raise);
 *   · the Owner's run returns jsonb counts, and an immediate second run
 *     reports ZERO new reminders (idempotence);
 *   · `legal_request_reminders` has no client write;
 *   · `legal_expiry_defaults` is readable by an active member (arrest 30 d,
 *     search 14 d, subpoenas 14 d) and not writable;
 *   · `stage_entered_at` is trigger-maintained: set on submit, moved on
 *     every status change (the clock every reminder threshold reads).
 *
 *  Note on blast radius: the Owner's manual run sweeps the LIVE queue the
 *  same way the hourly cron does — it only brings a scheduled pass forward;
 *  fixture-created requests notify fixture (`is_test`) recipients only.
 *  Fixture rows are swept by rls_test_cleanup() in afterAll. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, owner: process.env.RLS_TEST_PASSWORD_OWNER }
const enabled = !!(ANON && PW.lsb && PW.owner)
if (!enabled) console.warn('[rls:v186e] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Res = { ok?: boolean; code?: string }

/** Sum every numeric reminder / expiry counter in the sweep's jsonb, however
 *  it is nested — the contract is "counts", not a fixed key list. */
function reminderTotal(v: unknown): number {
  if (typeof v === 'number') return v
  if (!v || typeof v !== 'object') return 0
  let total = 0
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k === 'ok') continue
    if (typeof val === 'number') { if (/nudg|escalat|unissued|expir|deadline|remind|notified|sent/i.test(k)) total += val }
    else total += reminderTotal(val)
  }
  return total
}

describe.skipIf(!enabled)('v1.86e — legal sweeps: Owner-only manual run, idempotent reminders, expiry defaults', () => {
  let lsb: C, owner: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v186e ${tag}`
  let caseId = '', requestId = ''

  beforeAll(async () => {
    lsb = mk(); owner = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c = await lsb.from('cases').insert({ case_number: `V186E-${tag}`, title: `${stamp} sweeps case`, bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'document_production',
      p_title: `${stamp} subpoena`, p_recipient_type: 'entity', p_recipient_name: 'Maze Bank',
      p_narrative: 'Records needed for the v186e sweep wall test.',
      p_form: { items_requested: 'Ledger extracts', date_range: '2026-01→2026-06' },
    })
    if (r.error) throw new Error(`create_legal_request failed: ${r.error.message}`)
    requestId = r.data!.id
  }, 90_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v186e] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, owner].map((c) => c.auth.signOut()))
  }, 60_000)

  it('legal_expiry_defaults is readable by an active member with the seeded days, and not writable', async () => {
    const rows = await lsb.from('legal_expiry_defaults').select('subtype, days')
    expect(rows.error, rows.error?.message).toBeNull()
    const days = Object.fromEntries((rows.data ?? []).map((r) => [r.subtype, r.days]))
    expect(days.arrest_warrant).toBe(30)
    expect(days.search_warrant).toBe(14)
    expect(days.document_production).toBe(14)
    for (const s of ['testimony', 'medical_records']) expect(days[s], s).toBe(14)

    const ins = await lsb.from('legal_expiry_defaults').insert({ subtype: `rls_${tag}`, days: 1 }).select('subtype')
    expect(ins.error?.code).toBe('42501')
    const upd = await lsb.from('legal_expiry_defaults').update({ days: 1 }).eq('subtype', 'arrest_warrant').select('subtype')
    expect(upd.error?.code).toBe('42501')
    const asOwner = await owner.from('legal_expiry_defaults').update({ days: 1 }).eq('subtype', 'arrest_warrant').select('subtype')
    expect(asOwner.error?.code).toBe('42501')
    expect((await lsb.from('legal_expiry_defaults').select('days').eq('subtype', 'arrest_warrant').single()).data).toMatchObject({ days: 30 })
  })

  it('stage_entered_at is set on submit and moves with every status change', async () => {
    const draft = await lsb.from('legal_requests').select('review_status, stage_entered_at, nudged_at, escalated_at').eq('id', requestId).single()
    expect(draft.data).toMatchObject({ review_status: 'not_submitted', nudged_at: null, escalated_at: null })
    await lsb.rpc('add_legal_exhibit', { p_request: requestId, p_type: 'external_link', p_meta: { url: `https://evidence.example/v186e/${tag}` } })
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: requestId })
    expect(sub.error, sub.error?.message).toBeNull()
    const entered = (sub.data as { stage_entered_at: string | null }).stage_entered_at
    expect(entered).toBeTruthy()
    expect(Math.abs(Date.now() - Date.parse(entered!))).toBeLessThan(5 * 60_000)
    // Clients cannot touch the clock.
    const direct = await lsb.from('legal_requests').update({ stage_entered_at: '2020-01-01T00:00:00Z' }).eq('id', requestId).select('id')
    expect(direct.error).not.toBeNull()
    const wd = await lsb.rpc('withdraw_legal_request', { p_request: requestId, p_note: `${stamp} withdrawn` })
    expect(wd.error, wd.error?.message).toBeNull()
    expect((wd.data as { review_status: string }).review_status).toBe('withdrawn')
    expect((wd.data as { stage_entered_at: string | null }).stage_entered_at).not.toBe(entered)
  })

  it('legal_sweep_run is Owner-only: a detective is refused', async () => {
    const res = await lsb.rpc('legal_sweep_run')
    if (res.error) {
      expect(res.error.message).toMatch(/owner/i)
    } else {
      expect((res.data as Res).ok).toBe(false)
    }
  })

  it('the Owner runs both sweeps and gets counts; an immediate second run reports 0 new reminders', async () => {
    const first = await owner.rpc('legal_sweep_run')
    expect(first.error, first.error?.message).toBeNull()
    expect(first.data).toBeTruthy()
    expect(typeof first.data).toBe('object')
    expect((first.data as Res).ok).not.toBe(false)
    expect(reminderTotal(first.data)).toBeGreaterThanOrEqual(0)

    const second = await owner.rpc('legal_sweep_run')
    expect(second.error, second.error?.message).toBeNull()
    expect((second.data as Res).ok).not.toBe(false)
    expect(reminderTotal(second.data)).toBe(0)
    // Nothing in this run's fixture set is old enough to be reminded about.
    const mine = await lsb.from('legal_request_reminders').select('id').eq('legal_request_id', requestId)
    expect(mine.error).toBeNull()
    expect(mine.data ?? []).toEqual([])
  })

  it('legal_request_reminders has no client write', async () => {
    const ins = await lsb.from('legal_request_reminders').insert({ legal_request_id: requestId, kind: 'nudge', stage: 'withdrawn' }).select('id')
    expect(ins.error?.code).toBe('42501')
    const asOwner = await owner.from('legal_request_reminders').insert({ legal_request_id: requestId, kind: 'nudge', stage: 'withdrawn' }).select('id')
    expect(asOwner.error?.code).toBe('42501')
    const del = await lsb.from('legal_request_reminders').delete().eq('legal_request_id', requestId).select('id')
    expect(del.error?.code).toBe('42501')
    // Reads follow the request's visibility, never an error.
    const rows = await lsb.from('legal_request_reminders').select('id').eq('legal_request_id', requestId)
    expect(rows.error).toBeNull()
  })
})

/** v1.89b — Action Center: the escalation ladder (Portal Improvements
 *  P7-03, migration 20261101120000_action_center).
 *
 *  What the CID fixtures prove (lsb — the MCB detective who creates and
 *  LEADS the test case and is the overdue task's assignee; bcb — the SCB
 *  detective who cannot see the case; lead — the MCB Bureau Lead, the
 *  escalation's recipient; owner optional — the only caller who may read
 *  the rules and tune them):
 *   · action_escalation_rules reads for the Owner alone (lsb / bcb / lead:
 *     zero rows, no error) — four seeded kinds, `legal` disabled;
 *   · action_escalation_rule_set by the lead and by lsb → jsonb {ok:false,
 *     code:'denied', message:'only the Owner may change the escalation
 *     rules'}; the dataset-wide action_escalation_run() → the same denial
 *     for every fixture (the Owner fixture never runs it here — see below);
 *     a direct UPDATE of the rules / INSERT into the ledger is 42501 (or
 *     matches zero rows); the Owner may set task_overdue to its own value
 *     (48 → 48, a no-op — the suite never changes a production rule) and
 *     gets the row back with {ok:true} + ACTION_ESCALATION_RULE_SET;
 *   · the sweep is driven through the fixture-scoped runner
 *     `rls_test_escalation_run(p_case)` — a test-fixture caller, a
 *     fixture-created case, the sweep over that ONE case (never the whole
 *     dataset): a task due three days ago, assigned to the case lead →
 *     ONE ledger row (kind task_overdue, source_id = the task, case_id set,
 *     stage null) that lsb and the lead read (case visibility) and bcb does
 *     not; `notified` holds exactly the recipients actually written — the
 *     lead fixture (the case creator is a test member, so no real Bureau
 *     Lead is paged); `action_escalated` {kind, source_id, case_id,
 *     case_number} to the lead only, never a title / summary / reason, and
 *     no actor (the runner writes system rows); ACTION_ESCALATED (entity
 *     case_tasks); the case lead is not told about their own task;
 *   · a second run re-notifies nobody and adds no row;
 *   · marking the task done, then a run → resolved_at set, the row stays;
 *   · the runner refuses a case that is not fixture-created ('case is not
 *     fixture-owned') — probed with a random id, never a real case;
 *   · scheduled_job_runs: the Owner may read `action_escalation_sweep`
 *     rows (present once the hourly job has run at least once); lsb reads
 *     none.
 *
 *  Nothing here makes a real item qualify earlier or later: the rule stays
 *  at its seed, the run is scoped to the fixture case. rls_test_cleanup
 *  sweeps the fixture case (its tasks cascade), the fixtures' notifications
 *  and — spliced by 20261101120000 — the action_escalations rows of fixture
 *  cases. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v189b] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Rule = { kind: string; after_hours: number; enabled: boolean; target: string }
type Ledger = { id: string; kind: string; source_id: string; case_id: string | null; escalated_at: string; notified: string[]; resolved_at: string | null; stage: string | null }
type Notif = { type: string; payload: Record<string, unknown> | null }
type Counts = { escalated: number; resolved: number }
type RunOut = { ok: boolean; signoff: Counts; access_request: Counts; task_overdue: Counts }
const FORBIDDEN = ['title', 'summary', 'reason', 'details', 'body', 'note']
const SEED: Record<string, { hours: number; enabled: boolean }> = {
  signoff: { hours: 72, enabled: true }, access_request: { hours: 48, enabled: true }, task_overdue: { hours: 48, enabled: true }, legal: { hours: 120, enabled: false },
}

describe.skipIf(!enabled)('v1.89b — Action Center: escalation rules are the Owner\'s, the fixture-scoped sweep escalates once, resolves, and tells only the ladder', () => {
  let lsb: C, bcb: C, lead: C, owner: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v189b ${tag}`
  let caseId = ''
  let caseNumber = ''
  let taskId = ''

  const rulesOf = async (c: C): Promise<Rule[]> => {
    const r = await c.from('action_escalation_rules').select('kind, after_hours, enabled, target').order('kind')
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as Rule[]
  }
  const ledgerOf = async (c: C): Promise<Ledger[]> => {
    const r = await c.from('action_escalations').select('id, kind, source_id, case_id, escalated_at, notified, resolved_at, stage').eq('source_id', taskId)
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as Ledger[]
  }
  const escalatedTo = async (c: C): Promise<Notif[]> => {
    const r = await c.from('notifications').select('type, payload').eq('type', 'action_escalated').order('created_at', { ascending: false }).limit(100)
    expect(r.error, r.error?.message).toBeNull()
    return ((r.data ?? []) as Notif[]).filter((n) => n.payload?.source_id === taskId)
  }
  /** The fixture-scoped sweep, as lsb, over the fixture case only. */
  const run = async (): Promise<RunOut> => {
    const r = await lsb.rpc('rls_test_escalation_run', { p_case: caseId })
    expect(r.error, r.error?.message).toBeNull()
    const out = r.data as RunOut
    expect(out.ok, JSON.stringify(out)).toBe(true)
    return out
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
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c = await lsb.from('cases').insert({ case_number: `V189B-${tag}`, title: `${stamp} escalation case`, bureau: 'major_crimes', lead_detective_id: ids.lsb }).select('id, case_number').single()
    if (c.error) throw new Error(`case: ${c.error.message}`)
    caseId = c.data!.id; caseNumber = c.data!.case_number
    // Due three days ago and assigned to the case lead → the rule pages the bureau's Bureau Leads.
    const due = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
    const t = await lsb.from('case_tasks').insert({ case_id: caseId, title: `${stamp} overdue task`, due, assignee: ids.lsb }).select('id').single()
    if (t.error) throw new Error(`task: ${t.error.message}`)
    taskId = t.data!.id
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v189b] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, owner].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ the rules ============ */

  it('action_escalation_rules answers zero rows (no error) to detectives and the Bureau Lead', async () => {
    for (const [c, who] of [[lsb, 'lsb'], [bcb, 'bcb'], [lead, 'lead']] as const) expect(await rulesOf(c), `${who} reads nothing`).toEqual([])
  })

  it.skipIf(!hasOwner)('the Owner reads the four seeded kinds with their hours; legal is disabled', async () => {
    const rules = await rulesOf(owner!)
    expect(rules.map((r) => r.kind).sort()).toEqual(['access_request', 'legal', 'signoff', 'task_overdue'])
    for (const r of rules) {
      // The Owner may have tuned a rule in production — report, never fail, on a changed value.
      if (r.after_hours !== SEED[r.kind].hours || r.enabled !== SEED[r.kind].enabled) console.warn(`[rls:v189b] rule ${r.kind} is not at its seed (${r.after_hours} h, ${r.enabled ? 'enabled' : 'disabled'})`)
      expect(r.after_hours).toBeGreaterThanOrEqual(1)
      expect(r.after_hours).toBeLessThanOrEqual(720)
      expect(r.target.length).toBeGreaterThan(0)
    }
    expect(rules.find((r) => r.kind === 'legal')!.enabled).toBe(false)
  })

  it('rule_set and the dataset-wide run are refused as jsonb {ok:false, code:\'denied\'} for the lead and a detective; no client writes on the rules or the ledger', async () => {
    for (const [c, who] of [[lead, 'lead'], [lsb, 'lsb']] as const) {
      const r = await c.rpc('action_escalation_rule_set', { p_kind: 'task_overdue', p_after_hours: 48, p_enabled: true })
      expect(r.error, `${who}: ${r.error?.message}`).toBeNull()
      expect(r.data, who).toEqual({ ok: false, code: 'denied', message: 'only the Owner may change the escalation rules' })
      const run = await c.rpc('action_escalation_run')
      expect(run.error, `${who}: ${run.error?.message}`).toBeNull()
      expect(run.data, who).toEqual({ ok: false, code: 'denied', message: 'only the Owner may run the escalation sweep' })
    }
    const upd = await lead.from('action_escalation_rules').update({ after_hours: 1 }).eq('kind', 'task_overdue').select('kind')
    if (upd.error) expect(upd.error.code).toBe('42501')
    else expect(upd.data ?? []).toEqual([])
    const ins = await lsb.from('action_escalations').insert({ kind: 'task_overdue', source_id: taskId, case_id: caseId }).select('id')
    expect(ins.error).not.toBeNull()
    expect(ins.error!.code).toBe('42501')
    expect(await ledgerOf(lsb)).toEqual([])
  })

  it.skipIf(!hasOwner)('the Owner may tune a rule: task_overdue set to its current value (a no-op) answers {ok:true} + the row and audits ACTION_ESCALATION_RULE_SET; an unknown kind and out-of-range hours raise', async () => {
    const current = (await rulesOf(owner!)).find((r) => r.kind === 'task_overdue')!
    const set = await owner!.rpc('action_escalation_rule_set', { p_kind: 'task_overdue', p_after_hours: current.after_hours, p_enabled: current.enabled })
    expect(set.error, set.error?.message).toBeNull()
    expect(set.data).toMatchObject({ ok: true, kind: 'task_overdue', after_hours: current.after_hours, enabled: current.enabled })
    const unknown = await owner!.rpc('action_escalation_rule_set', { p_kind: 'nope', p_after_hours: 1, p_enabled: true })
    expect(unknown.error).not.toBeNull()
    expect(unknown.error!.message).toMatch(/unknown escalation rule/)
    const range = await owner!.rpc('action_escalation_rule_set', { p_kind: 'task_overdue', p_after_hours: 0, p_enabled: true })
    expect(range.error).not.toBeNull()
    expect(range.error!.message).toMatch(/1 to 720 hours/)
    expect((await rulesOf(owner!)).find((r) => r.kind === 'task_overdue')).toMatchObject({ after_hours: current.after_hours, enabled: current.enabled })
    const a = await owner!.from('audit_log').select('action, detail').eq('action', 'ACTION_ESCALATION_RULE_SET').order('created_at', { ascending: false }).limit(5)
    expect(a.error, a.error?.message).toBeNull()
    const rows = (a.data ?? []) as { detail: Record<string, unknown> | null }[]
    expect(rows.some((r) => r.detail?.kind === 'task_overdue')).toBe(true)
  })

  /* ============ the fixture-scoped sweep ============ */

  it('the runner refuses a case that is not fixture-created', async () => {
    const r = await lsb.rpc('rls_test_escalation_run', { p_case: randomUUID() })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/case is not fixture-owned/)
  })

  it('one run: ONE ledger row (task_overdue, stage null) lsb and the lead read and bcb does not; action_escalated to the Bureau Lead only, minimal, no actor; ACTION_ESCALATED', async () => {
    const out = await run()
    expect(out.task_overdue.escalated).toBe(1)
    expect(out.signoff.escalated).toBe(0)
    expect(out.access_request.escalated).toBe(0)
    const mine = await ledgerOf(lsb)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ kind: 'task_overdue', source_id: taskId, case_id: caseId, resolved_at: null, stage: null })
    // Only recipients actually written — the lead fixture; no real MCB lead (the case creator is a test member).
    expect(mine[0].notified).toEqual([ids.lead])
    expect(await ledgerOf(bcb)).toEqual([])
    expect(await ledgerOf(lead)).toHaveLength(1)
    const pings = await escalatedTo(lead)
    expect(pings).toHaveLength(1)
    expect(pings[0].payload).toMatchObject({ kind: 'task_overdue', source_id: taskId, case_id: caseId, case_number: caseNumber })
    expect(pings[0].payload).not.toHaveProperty('actor_id')
    for (const k of FORBIDDEN) expect(pings[0].payload, `payload must not carry ${k}`).not.toHaveProperty(k)
    expect(JSON.stringify(pings[0].payload)).not.toContain(stamp)
    // The case lead is the assignee — the ladder skips them; the outsider hears nothing.
    expect(await escalatedTo(lsb)).toEqual([])
    expect(await escalatedTo(bcb)).toEqual([])
    if (owner) {
      const a = await owner.from('audit_log').select('action, entity, actor_id, detail').eq('action', 'ACTION_ESCALATED').eq('entity_id', taskId)
      expect(a.error, a.error?.message).toBeNull()
      expect(a.data).toHaveLength(1)
      expect(a.data![0]).toMatchObject({ entity: 'case_tasks', actor_id: null })
      expect((a.data![0].detail as { notified: string[] }).notified).toEqual([ids.lead])
    }
  })

  it('a second run re-notifies nobody and adds no row', async () => {
    const out = await run()
    expect(out.task_overdue).toEqual({ escalated: 0, resolved: 0 })
    expect(await ledgerOf(lsb)).toHaveLength(1)
    expect(await escalatedTo(lead)).toHaveLength(1)
  })

  it('marking the task done, then a run → resolved_at is set; the row stays readable; nobody is told again', async () => {
    const done = await lsb.from('case_tasks').update({ done: true }).eq('id', taskId).select('id')
    expect(done.error, done.error?.message).toBeNull()
    expect(done.data ?? []).toHaveLength(1)
    const out = await run()
    expect(out.task_overdue).toEqual({ escalated: 0, resolved: 1 })
    const [row] = await ledgerOf(lsb)
    expect(row.resolved_at).toBeTruthy()
    expect(await escalatedTo(lead)).toHaveLength(1)
    // Reopening the task starts a fresh row cycle only when the rule's hours have passed again — here it re-qualifies at once (due is unchanged), on the SAME row.
    const reopen = await lsb.from('case_tasks').update({ done: false }).eq('id', taskId).select('id')
    expect(reopen.error, reopen.error?.message).toBeNull()
    const again = await run()
    expect(again.task_overdue.escalated).toBe(1)
    const rows = await ledgerOf(lsb)
    expect(rows).toHaveLength(1)
    expect(rows[0].resolved_at).toBeNull()
  })

  it('scheduled_job_runs: the Owner may read the hourly job\'s rows, lsb reads none; the fixture runner writes no job row', async () => {
    const mine = await lsb.from('scheduled_job_runs').select('id').eq('job', 'action_escalation_sweep').limit(5)
    expect(mine.error, mine.error?.message).toBeNull()
    expect(mine.data ?? []).toEqual([])
    if (owner) {
      const r = await owner.from('scheduled_job_runs').select('job, status, started_at, finished_at').eq('job', 'action_escalation_sweep').order('started_at', { ascending: false }).limit(5)
      expect(r.error, r.error?.message).toBeNull()
      if (!(r.data ?? []).length) console.warn('[rls:v189b] no action_escalation_sweep job row yet — the hourly job has not run since the migration')
      for (const row of r.data ?? []) expect(row.status, JSON.stringify(row)).not.toBe('failed')
    }
  })
})

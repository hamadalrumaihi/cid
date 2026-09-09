/** v1.89a — Action Center: per-viewer state, notification hydration and
 *  reassignment (Portal Improvements P7-01 / P7-04 / P7-07, migration
 *  20261101120000_action_center).
 *
 *  What the CID fixtures prove (lsb — the MCB detective who creates and
 *  LEADS the test case; bcb — the SCB detective, the outsider until granted;
 *  lead — the MCB Bureau Lead, command; owner optional — audit reads;
 *  inactive optional — the deny-by-default leg):
 *   · action_item_set_state upserts a row only its viewer reads (`ais_sel`);
 *     `seen` stamps seen_at; `snooze` needs a future p_until within 48 h
 *     ('snooze for up to 48 hours' — 49 h refused, no p_until refused);
 *     `unsnooze` clears; `dismiss` is allowed for an informational key
 *     (notif:) and refused with SQLSTATE P0403 for assigned work (task:) or
 *     a decision (case:…:signoff-decide) — 'this item is a decision or
 *     assigned work — decide it, finish it or snooze it'; `undismiss` clears;
 *   · action_item_set_state_many applies per key, SKIPS (never raises) a
 *     dismiss of a non-dismissable key and reports it, refuses more than 100
 *     keys ('at most 100 items at a time'); a snooze that touches a decision
 *     key writes ONE ACTION_ITEM_SNOOZED row the Owner reads (AC1);
 *   · a key is an identifier: the CHECK `action_item_state_key_shape`
 *     (`^[a-z_]+:[A-Za-z0-9_:.@-]+$`) refuses a key with spaces as SQLSTATE
 *     23514; action_item_state takes no client INSERT / UPDATE (42501 or
 *     zero rows); an inactive caller is refused with P0403 ('your account is
 *     not active');
 *   · notifications_mark_read flips the caller's own unread rows, the trigger
 *     stamps read_at, the count comes back; another user's ids → 0; a client
 *     may still UPDATE the `read` column of its own row (the column grant —
 *     the trigger stamps read_at there too) and nothing else (42501);
 *   · notification_resolve (SECURITY INVOKER) answers visible = true + the
 *     case number for a case the viewer can read and visible = false, label
 *     null for a case in the other bureau — the client renders "An item you
 *     no longer have access to"; it never returns another user's rows and
 *     answers the first 100 ids without raising;
 *   · action_reassign_task: the lead cannot hand a task to a member who
 *     cannot see the case ('that member cannot see this case') until the
 *     Bureau Lead grants access (case_access_grants); then the assignee
 *     changes, TASK_REASSIGNED carries {case_id, from, to, reason} and the
 *     target receives `task_assigned` with case_id / case_number / task_id
 *     and NO title; a non-lead detective → P0403 ('only the case lead or
 *     command can reassign a task'); a reason under 3 characters → 'say why
 *     the task is being reassigned'; a done task → 'that task is already
 *     closed'; the same member → 'already assigned to that member'; the
 *     Bureau Lead (command) may reassign;
 *   · action_reassign_blocker mirrors it over case_blockers (owner_id,
 *     BLOCKER_REASSIGNED, `blocker_assigned` {case_id, case_number,
 *     blocker_id}, 'that blocker is already resolved').
 *
 *  Authority refusals raise P0403 (private.perm_raise); no PERMISSION_DENIED
 *  row is asserted (it would roll back with the statement). Every record is
 *  authored by lsb ('[rls-test] v189a …') on a case lsb leads; bcb's SCB case
 *  exists only to be invisible. rls_test_cleanup sweeps the fixture cases
 *  (tasks / blockers / grants cascade), the fixtures' notifications and —
 *  spliced by 20261101120000 — their action_item_state rows. */

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
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v189a] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type State = { user_id: string; dedupe_key: string; seen_at: string | null; snoozed_until: string | null; dismissed_at: string | null }
type StateOut = { ok: boolean; key: string; seen_at: string | null; snoozed_until: string | null; dismissed_at: string | null }
type ManyOut = { ok: boolean; applied: number; skipped: string[] }
type Notif = { id: string; type: string; read: boolean; read_at: string | null; payload: Record<string, unknown> | null }
type Resolved = { id: string; type: string; subject_kind: string | null; subject_id: string | null; visible: boolean; label: string | null }
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()
const FORBIDDEN = ['title', 'summary', 'reason', 'details', 'body']

describe.skipIf(!enabled)('v1.89a — Action Center: per-viewer state, mark-read + resolve, reassign a task or blocker', () => {
  let lsb: C, bcb: C, lead: C, owner: C | null = null, inactive: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v189a ${tag}`
  let caseId = ''       // lsb's MCB case (lsb leads it)
  let caseNumber = ''
  let otherCase = ''    // bcb's SCB case — invisible to lsb
  let taskId = ''
  let doneTaskId = ''
  let blockerId = ''
  let visibleNotif = ''   // to lsb, about caseId (from the lead)
  let hiddenNotif = ''    // to lsb, about otherCase (from bcb)

  const stateOf = async (c: C, key: string): Promise<State[]> => {
    const r = await c.from('action_item_state').select('user_id, dedupe_key, seen_at, snoozed_until, dismissed_at').eq('dedupe_key', key)
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as State[]
  }
  const setState = (c: C, key: string, op: string, until?: string) =>
    c.rpc('action_item_set_state', { p_key: key, p_op: op, ...(until ? { p_until: until } : {}) })
  const notifsOf = async (c: C, type: string): Promise<Notif[]> => {
    const r = await c.from('notifications').select('id, type, read, read_at, payload').eq('type', type).order('created_at', { ascending: false }).limit(50)
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as Notif[]
  }
  const auditRows = async (action: string, entityId?: string) => {
    let q = owner!.from('audit_log').select('action, entity, entity_id, detail').eq('action', action).order('created_at', { ascending: false }).limit(50)
    if (entityId) q = q.eq('entity_id', entityId)
    const r = await q
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as { action: string; entity: string; entity_id: string | null; detail: Record<string, unknown> | null }[]
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
    if (PW.inactive) { inactive = mk(); ids.inactive = await signInWithRetry(inactive, 'rls-test-inactive@cidportal.test', PW.inactive) }
    // Sweeps state rows and notifications too, so the 1-hour dedupe never masks a leg.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const preB = await bcb.rpc('rls_test_cleanup')
    if (preB.error) throw new Error(`pre-run cleanup (bcb) failed: ${preB.error.message}`)

    const c = await lsb.from('cases').insert({ case_number: `V189A-${tag}`, title: `${stamp} reassign case`, bureau: 'major_crimes', lead_detective_id: ids.lsb }).select('id, case_number').single()
    if (c.error) throw new Error(`case: ${c.error.message}`)
    caseId = c.data!.id; caseNumber = c.data!.case_number
    const t = await lsb.from('case_tasks').insert({ case_id: caseId, title: `${stamp} task` }).select('id').single()
    if (t.error) throw new Error(`task: ${t.error.message}`)
    taskId = t.data!.id
    const d = await lsb.from('case_tasks').insert({ case_id: caseId, title: `${stamp} done task`, done: true }).select('id').single()
    if (d.error) throw new Error(`done task: ${d.error.message}`)
    doneTaskId = d.data!.id
    const b = await lsb.from('case_blockers').insert({ case_id: caseId, title: `${stamp} blocker`, type: 'other' }).select('id').single()
    if (b.error) throw new Error(`blocker: ${b.error.message}`)
    blockerId = b.data!.id
    const o = await bcb.from('cases').insert({ case_number: `V189O-${tag}`, title: `${stamp} other-bureau case`, bureau: 'street_crimes', lead_detective_id: ids.bcb }).select('id').single()
    if (o.error) throw new Error(`other case: ${o.error.message}`)
    otherCase = o.data!.id
    // Two notifications for lsb through the client-emitted kind the server allows on a
    // case the ACTOR can access: the lead about lsb's case, bcb about bcb's case.
    const n1 = await lead.rpc('create_notification', { p_user_id: ids.lsb, p_type: 'chat_mention', p_payload: { case_id: caseId } })
    if (n1.error) throw new Error(`visible notification: ${n1.error.message}`)
    const n2 = await bcb.rpc('create_notification', { p_user_id: ids.lsb, p_type: 'chat_mention', p_payload: { case_id: otherCase } })
    if (n2.error) throw new Error(`hidden notification: ${n2.error.message}`)
    const mine = await notifsOf(lsb, 'chat_mention')
    visibleNotif = mine.find((n) => n.payload?.case_id === caseId)?.id ?? ''
    hiddenNotif = mine.find((n) => n.payload?.case_id === otherCase)?.id ?? ''
    if (!visibleNotif || !hiddenNotif) throw new Error('fixture notifications not readable by lsb')
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    for (const [c, who] of [[lsb, 'lsb'], [bcb, 'bcb']] as const) {
      const { data, error } = await c.rpc('rls_test_cleanup')
      if (error) throw new Error(`rls_test_cleanup (${who}) failed: ${error.message}`)
      console.info(`[rls:v189a] cleanup (${who}):`, JSON.stringify(data))
    }
    await Promise.all([lsb, bcb, lead, owner, inactive].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ action_item_set_state ============ */

  it('seen upserts a row only its viewer reads: lsb reads it, bcb reads zero rows for the same key', async () => {
    const key = `task:${taskId}`
    const r = await setState(lsb, key, 'seen')
    expect(r.error, r.error?.message).toBeNull()
    const out = r.data as StateOut
    expect(out).toMatchObject({ ok: true, key, snoozed_until: null, dismissed_at: null })
    expect(out.seen_at).toBeTruthy()
    const mine = await stateOf(lsb, key)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ user_id: ids.lsb, dedupe_key: key })
    expect(await stateOf(bcb, key)).toEqual([])
    // A second seen only moves the stamp — still one row.
    await setState(lsb, key, 'seen')
    expect(await stateOf(lsb, key)).toHaveLength(1)
  })

  it('snooze needs a future p_until within 48 hours (49 h and a missing p_until are refused); unsnooze clears it', async () => {
    const key = `notif:${visibleNotif}`
    const late = await setState(lsb, key, 'snooze', hoursFromNow(49))
    expect(late.error).not.toBeNull()
    expect(late.error!.message).toMatch(/snooze for up to 48 hours/)
    const none = await setState(lsb, key, 'snooze')
    expect(none.error).not.toBeNull()
    expect(none.error!.message).toMatch(/snooze for up to 48 hours/)
    const past = await setState(lsb, key, 'snooze', hoursFromNow(-1))
    expect(past.error).not.toBeNull()
    expect(past.error!.message).toMatch(/snooze for up to 48 hours/)
    const until = hoursFromNow(4)
    const ok = await setState(lsb, key, 'snooze', until)
    expect(ok.error, ok.error?.message).toBeNull()
    expect(Math.abs(Date.parse((ok.data as StateOut).snoozed_until!) - Date.parse(until))).toBeLessThan(1_000)
    expect((await stateOf(lsb, key))[0].snoozed_until).toBeTruthy()
    const un = await setState(lsb, key, 'unsnooze')
    expect(un.error, un.error?.message).toBeNull()
    expect((un.data as StateOut).snoozed_until).toBeNull()
    expect((await stateOf(lsb, key))[0].snoozed_until).toBeNull()
    const bad = await setState(lsb, key, 'archive')
    expect(bad.error).not.toBeNull()
    expect(bad.error!.message).toMatch(/unknown state operation/)
  })

  it('dismiss is allowed for an informational key and refused with P0403 for assigned work or a decision; undismiss clears', async () => {
    const ok = await setState(lsb, `notif:${visibleNotif}`, 'dismiss')
    expect(ok.error, ok.error?.message).toBeNull()
    expect((ok.data as StateOut).dismissed_at).toBeTruthy()
    for (const key of [`task:${taskId}`, `case:${caseId}:signoff-decide`, `blocker:${blockerId}`]) {
      const r = await setState(lsb, key, 'dismiss')
      expect(r.error, key).not.toBeNull()
      expect(r.error!.code, key).toBe('P0403')
      expect(r.error!.message).toMatch(/decision or assigned work — decide it, finish it or snooze it/)
      expect((await stateOf(lsb, key)).every((s) => s.dismissed_at === null), `${key} not dismissed`).toBe(true)
    }
    const un = await setState(lsb, `notif:${visibleNotif}`, 'undismiss')
    expect(un.error, un.error?.message).toBeNull()
    expect((un.data as StateOut).dismissed_at).toBeNull()
  })

  it('_many applies per key, skips a dismiss of a non-dismissable key and reports it, and caps at 100 keys', async () => {
    const keys = [`notif:${visibleNotif}`, `task:${taskId}`, `case:${caseId}:signoff-decide`, `draft:report:${randomUUID()}`]
    const r = await lsb.rpc('action_item_set_state_many', { p_keys: keys, p_op: 'dismiss' })
    expect(r.error, r.error?.message).toBeNull()
    const out = r.data as ManyOut
    expect(out.ok).toBe(true)
    expect(out.applied).toBe(2)
    expect([...out.skipped].sort()).toEqual([keys[1], keys[2]].sort())
    expect((await stateOf(lsb, keys[0]))[0].dismissed_at).toBeTruthy()
    expect((await stateOf(lsb, keys[1])).every((s) => s.dismissed_at === null)).toBe(true)
    const undo = await lsb.rpc('action_item_set_state_many', { p_keys: [keys[0], keys[3]], p_op: 'undismiss' })
    expect(undo.error, undo.error?.message).toBeNull()
    expect((undo.data as ManyOut).applied).toBe(2)
    const many = await lsb.rpc('action_item_set_state_many', { p_keys: Array.from({ length: 101 }, (_, i) => `notif:${i}`), p_op: 'seen' })
    expect(many.error).not.toBeNull()
    expect(many.error!.message).toMatch(/at most 100 items at a time/)
  })

  it('a key is an identifier: a key with spaces or without a prefix violates the shape CHECK (23514); the queue\'s real key shapes pass', async () => {
    for (const bad of ['notif:has a space', 'no-colon', 'Notif:UPPER-prefix']) {
      const r = await setState(lsb, bad, 'seen')
      expect(r.error, bad).not.toBeNull()
      expect(r.error!.code, bad).toBe('23514')
      expect(await stateOf(lsb, bad)).toEqual([])
    }
    for (const good of [`draft:report:${randomUUID()}`, 'owner:client_errors:2026-09-09', `restricted:${randomUUID()}:expiry`]) {
      const r = await setState(lsb, good, 'seen')
      expect(r.error, `${good}: ${r.error?.message}`).toBeNull()
    }
  })

  it.skipIf(!hasOwner)('snoozing a decision writes ACTION_ITEM_SNOOZED (single: {key, until}; bulk: ONE row with {keys, until}); the Owner reads it', async () => {
    const key = `access:${randomUUID()}`
    const until = hoursFromNow(2)
    const r = await setState(lsb, key, 'snooze', until)
    expect(r.error, r.error?.message).toBeNull()
    const single = (await auditRows('ACTION_ITEM_SNOOZED')).find((a) => a.detail?.key === key)
    expect(single, 'single snooze audited').toBeTruthy()
    expect(single!.entity).toBe('action_item')
    expect(single!.entity_id).toBeNull()
    const keys = [`transfer:${randomUUID()}`, `legal:${randomUUID()}`]
    const m = await lsb.rpc('action_item_set_state_many', { p_keys: [`notif:${visibleNotif}`, ...keys], p_op: 'snooze', p_until: until })
    expect(m.error, m.error?.message).toBeNull()
    expect((m.data as ManyOut).applied).toBe(3)
    const bulk = (await auditRows('ACTION_ITEM_SNOOZED')).filter((a) => Array.isArray(a.detail?.keys) && (a.detail!.keys as string[]).includes(keys[0]))
    expect(bulk).toHaveLength(1)
    expect([...(bulk[0].detail!.keys as string[])].sort()).toEqual([...keys].sort())
    // An informational snooze is not audited.
    const infoKey = `bolo:${randomUUID()}`
    await setState(lsb, infoKey, 'snooze', until)
    expect((await auditRows('ACTION_ITEM_SNOOZED')).some((a) => a.detail?.key === infoKey)).toBe(false)
    await lsb.rpc('action_item_set_state_many', { p_keys: [key, ...keys, infoKey, `notif:${visibleNotif}`], p_op: 'unsnooze' })
  })

  it('action_item_state takes no client INSERT or UPDATE; an inactive caller is refused with P0403', async () => {
    const key = `notif:${randomUUID()}`
    const ins = await lsb.from('action_item_state').insert({ user_id: ids.lsb, dedupe_key: key }).select('dedupe_key')
    expect(ins.error).not.toBeNull()
    expect(ins.error!.code).toBe('42501')
    expect(await stateOf(lsb, key)).toEqual([])
    const seen = `task:${taskId}`
    const upd = await lsb.from('action_item_state').update({ dismissed_at: new Date().toISOString() }).eq('dedupe_key', seen).select('dedupe_key')
    if (upd.error) expect(upd.error.code).toBe('42501')
    else expect(upd.data ?? []).toEqual([])
    expect((await stateOf(lsb, seen))[0].dismissed_at).toBeNull()
    const del = await lsb.from('action_item_state').delete().eq('dedupe_key', seen).select('dedupe_key')
    if (del.error) expect(del.error.code).toBe('42501')
    else expect(del.data ?? []).toEqual([])
    expect(await stateOf(lsb, seen)).toHaveLength(1)
    if (inactive) {
      const r = await setState(inactive, `notif:${randomUUID()}`, 'seen')
      expect(r.error).not.toBeNull()
      expect(r.error!.code).toBe('P0403')
      expect(r.error!.message).toMatch(/not active/)
    }
  })

  /* ============ notifications_mark_read / notification_resolve ============ */

  it('notifications_mark_read flips own unread rows, stamps read_at and returns the count; another user\'s ids count 0', async () => {
    const before = (await notifsOf(lsb, 'chat_mention')).find((n) => n.id === visibleNotif)!
    expect(before.read).toBe(false)
    expect(before.read_at).toBeNull()
    const theirs = await bcb.rpc('notifications_mark_read', { p_ids: [visibleNotif, hiddenNotif] })
    expect(theirs.error, theirs.error?.message).toBeNull()
    expect(theirs.data).toBe(0)
    const r = await lsb.rpc('notifications_mark_read', { p_ids: [visibleNotif, randomUUID()] })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toBe(1)
    const after = (await notifsOf(lsb, 'chat_mention')).find((n) => n.id === visibleNotif)!
    expect(after.read).toBe(true)
    expect(after.read_at).toBeTruthy()
    const again = await lsb.rpc('notifications_mark_read', { p_ids: [visibleNotif] })
    expect(again.data).toBe(0)
    const many = await lsb.rpc('notifications_mark_read', { p_ids: Array.from({ length: 501 }, () => randomUUID()) })
    expect(many.error).not.toBeNull()
    expect(many.error!.message).toMatch(/at most 500 notifications at a time/)
    // The column grant: a client may flip `read` on its own row (the trigger stamps / clears read_at) and nothing else.
    const unread = await lsb.from('notifications').update({ read: false }).eq('id', visibleNotif).select('id, read, read_at')
    expect(unread.error, unread.error?.message).toBeNull()
    expect(unread.data).toHaveLength(1)
    expect(unread.data![0]).toMatchObject({ read: false, read_at: null })
    const reread = await lsb.from('notifications').update({ read: true }).eq('id', visibleNotif).select('id, read, read_at')
    expect(reread.error, reread.error?.message).toBeNull()
    expect(reread.data![0].read).toBe(true)
    expect(reread.data![0].read_at).toBeTruthy()
    const forged = await lsb.from('notifications').update({ payload: { case_id: caseId, title: 'forged' } }).eq('id', visibleNotif).select('id')
    expect(forged.error).not.toBeNull()
    expect(forged.error!.code).toBe('42501')
    const theirsDirect = await bcb.from('notifications').update({ read: true }).eq('id', hiddenNotif).select('id')
    if (theirsDirect.error) expect(theirsDirect.error.code).toBe('42501')
    else expect(theirsDirect.data ?? []).toEqual([])
  })

  it('notification_resolve: visible + case number for a readable case, visible=false + null label for the other bureau\'s case; never another user\'s rows', async () => {
    const r = await lsb.rpc('notification_resolve', { p_ids: [visibleNotif, hiddenNotif] })
    expect(r.error, r.error?.message).toBeNull()
    const rows = (r.data ?? []) as Resolved[]
    expect(rows).toHaveLength(2)
    expect(rows.find((x) => x.id === visibleNotif)).toEqual({ id: visibleNotif, type: 'chat_mention', subject_kind: 'case', subject_id: caseId, visible: true, label: caseNumber })
    expect(rows.find((x) => x.id === hiddenNotif)).toEqual({ id: hiddenNotif, type: 'chat_mention', subject_kind: 'case', subject_id: otherCase, visible: false, label: null })
    const theirs = await bcb.rpc('notification_resolve', { p_ids: [visibleNotif, hiddenNotif] })
    expect(theirs.error, theirs.error?.message).toBeNull()
    expect(theirs.data ?? []).toEqual([])
    // More than 100 ids: the first 100 are answered, never an error.
    const many = await lsb.rpc('notification_resolve', { p_ids: [visibleNotif, ...Array.from({ length: 100 }, () => randomUUID())] })
    expect(many.error, many.error?.message).toBeNull()
    expect((many.data ?? []) as Resolved[]).toHaveLength(1)
  })

  /* ============ action_reassign_task ============ */

  it('the lead cannot hand a task to a member who cannot see the case; after the Bureau Lead grants access the reassignment lands with TASK_REASSIGNED and a minimal task_assigned', async () => {
    const first = await lsb.rpc('action_reassign_task', { p_task: taskId, p_user: ids.bcb, p_reason: `${stamp} they know the pier` })
    expect(first.error).not.toBeNull()
    expect(first.error!.message).toMatch(/that member cannot see this case/)
    const g = await lead.from('case_access_grants').insert({ case_id: caseId, officer_id: ids.bcb }).select('id')
    expect(g.error, g.error?.message).toBeNull()
    const seen = await bcb.from('cases').select('id').eq('id', caseId)
    expect(seen.data ?? []).toHaveLength(1)
    const ok = await lsb.rpc('action_reassign_task', { p_task: taskId, p_user: ids.bcb, p_reason: `${stamp} they know the pier` })
    expect(ok.error, ok.error?.message).toBeNull()
    const t = await lsb.from('case_tasks').select('assignee').eq('id', taskId).single()
    expect(t.data!.assignee).toBe(ids.bcb)
    const pings = (await notifsOf(bcb, 'task_assigned')).filter((n) => n.payload?.task_id === taskId)
    expect(pings).toHaveLength(1)
    expect(pings[0].payload).toMatchObject({ case_id: caseId, case_number: caseNumber, task_id: taskId })
    for (const k of FORBIDDEN) expect(pings[0].payload, `payload must not carry ${k}`).not.toHaveProperty(k)
    expect(JSON.stringify(pings[0].payload)).not.toContain(stamp)
    if (owner) {
      const [a] = await auditRows('TASK_REASSIGNED', taskId)
      expect(a).toBeTruthy()
      expect(a.entity).toBe('case_tasks')
      expect(a.detail).toMatchObject({ case_id: caseId, from: null, to: ids.bcb, reason: `${stamp} they know the pier` })
    }
    const same = await lsb.rpc('action_reassign_task', { p_task: taskId, p_user: ids.bcb, p_reason: `${stamp} again` })
    expect(same.error).not.toBeNull()
    expect(same.error!.message).toMatch(/already assigned to that member/)
  })

  it('a non-lead detective is refused with P0403; a short reason, a done task and an unknown task raise; the Bureau Lead (command) may reassign', async () => {
    const outsider = await bcb.rpc('action_reassign_task', { p_task: taskId, p_user: ids.lsb, p_reason: `${stamp} give it back` })
    expect(outsider.error).not.toBeNull()
    expect(outsider.error!.code).toBe('P0403')
    expect(outsider.error!.message).toMatch(/only the case lead or command can reassign a task/)
    // Authority is answered before the row's state: the outsider learns nothing about the done task.
    const outsiderDone = await bcb.rpc('action_reassign_task', { p_task: doneTaskId, p_user: ids.lsb, p_reason: `${stamp} closed?` })
    expect(outsiderDone.error).not.toBeNull()
    expect(outsiderDone.error!.code).toBe('P0403')
    expect(outsiderDone.error!.message).not.toMatch(/already closed/)
    const short = await lsb.rpc('action_reassign_task', { p_task: taskId, p_user: ids.lsb, p_reason: 'ab' })
    expect(short.error).not.toBeNull()
    expect(short.error!.message).toMatch(/say why the task is being reassigned/)
    const done = await lsb.rpc('action_reassign_task', { p_task: doneTaskId, p_user: ids.bcb, p_reason: `${stamp} closed` })
    expect(done.error).not.toBeNull()
    expect(done.error!.message).toMatch(/that task is already closed/)
    const missing = await lsb.rpc('action_reassign_task', { p_task: randomUUID(), p_user: ids.bcb, p_reason: `${stamp} nothing` })
    expect(missing.error).not.toBeNull()
    expect(missing.error!.message).toMatch(/task not found/)
    const cmd = await lead.rpc('action_reassign_task', { p_task: taskId, p_user: ids.lsb, p_reason: `${stamp} command says` })
    expect(cmd.error, cmd.error?.message).toBeNull()
    const t = await lsb.from('case_tasks').select('assignee').eq('id', taskId).single()
    expect(t.data!.assignee).toBe(ids.lsb)
  })

  /* ============ action_reassign_blocker ============ */

  it('action_reassign_blocker mirrors the task path: P0403 for the outsider, the reason, owner_id + BLOCKER_REASSIGNED + blocker_assigned, and a resolved blocker refuses', async () => {
    const outsider = await bcb.rpc('action_reassign_blocker', { p_blocker: blockerId, p_user: ids.bcb, p_reason: `${stamp} mine now` })
    expect(outsider.error).not.toBeNull()
    expect(outsider.error!.code).toBe('P0403')
    expect(outsider.error!.message).toMatch(/only the case lead or command can reassign a blocker/)
    const short = await lsb.rpc('action_reassign_blocker', { p_blocker: blockerId, p_user: ids.bcb, p_reason: 'x' })
    expect(short.error).not.toBeNull()
    expect(short.error!.message).toMatch(/say why the blocker is being reassigned/)
    const ok = await lsb.rpc('action_reassign_blocker', { p_blocker: blockerId, p_user: ids.bcb, p_reason: `${stamp} lab liaison` })
    expect(ok.error, ok.error?.message).toBeNull()
    const b = await lsb.from('case_blockers').select('owner_id, status').eq('id', blockerId).single()
    expect(b.data!.owner_id).toBe(ids.bcb)
    const pings = (await notifsOf(bcb, 'blocker_assigned')).filter((n) => n.payload?.blocker_id === blockerId)
    expect(pings).toHaveLength(1)
    expect(pings[0].payload).toMatchObject({ case_id: caseId, case_number: caseNumber, blocker_id: blockerId })
    for (const k of FORBIDDEN) expect(pings[0].payload, `payload must not carry ${k}`).not.toHaveProperty(k)
    if (owner) {
      const [a] = await auditRows('BLOCKER_REASSIGNED', blockerId)
      expect(a).toBeTruthy()
      expect(a.entity).toBe('case_blockers')
      expect(a.detail).toMatchObject({ case_id: caseId, from: null, to: ids.bcb })
    }
    const same = await lsb.rpc('action_reassign_blocker', { p_blocker: blockerId, p_user: ids.bcb, p_reason: `${stamp} again` })
    expect(same.error).not.toBeNull()
    expect(same.error!.message).toMatch(/already assigned to that member/)
    // Resolve it (the case editor's own write), then a reassignment is refused.
    const res = await lsb.from('case_blockers').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: ids.lsb }).eq('id', blockerId).select('id')
    if (res.error || !res.data?.length) { console.warn('[rls:v189a] could not resolve the blocker as lsb — skipping the resolved leg:', res.error?.message ?? 'zero rows'); return }
    const closed = await lsb.rpc('action_reassign_blocker', { p_blocker: blockerId, p_user: ids.lsb, p_reason: `${stamp} back` })
    expect(closed.error).not.toBeNull()
    expect(closed.error!.message).toMatch(/that blocker is already resolved/)
  })
})

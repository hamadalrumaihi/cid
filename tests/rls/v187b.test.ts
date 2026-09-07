/** v1.87b — Report review flow (Portal Improvements P5-03, migration
 *  20261029120000_report_review).
 *
 *    draft → submitted → approved (sealed)
 *            ↘ returned ↗          reopen (reason) → draft
 *
 *  What the CID fixtures prove (lsb author, lead Bureau Lead MCB reviewer,
 *  bcb SCB detective outsider):
 *   · report_submit with missing `required` keys raises 'required fields
 *     missing: <labels>' — the keys are READ from the pinned version, never
 *     assumed;
 *   · direct UPDATE of review_status / finalized is refused by the trigger;
 *   · a successful submit lands in 'submitted' with the author signature
 *     (signer_id from auth.uid()); the author's fields are then LOCKED;
 *   · report_review: never the author, never another bureau; a return
 *     needs a note → 'returned' (the author edits and resubmits); an
 *     approve with a typed signature → finalized, 'approved', a
 *     report_versions row carrying reviewer_signature;
 *   · report_reopen needs a reason; the Bureau Lead reopens → draft, both
 *     signatures null, a `_reopen_log` entry with the reason;
 *   · report_finalize on a review-required template raises 'requires review';
 *   · an 'arrest_warrant' report (review_required=false) SELF-SEALS on
 *     report_submit (and still on report_finalize);
 *   · case_closure refuses submit while a case task is open, until the task
 *     is done or waived (case_task_waive — Bureau Lead, reason required);
 *   · notifications: the lead received report_submitted, the author received
 *     report_returned / report_finalized / report_reopened (queried as the
 *     recipient — notifications is under RLS).
 *
 *  Safety: every case/report is created by lsb and carries the [rls-test]
 *  marker; rls_test_cleanup runs pre-suite and in afterAll. Every fixture is
 *  is_test, so the fan-out reaches only fixtures. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, bcb: process.env.RLS_TEST_PASSWORD_BCB, lead: process.env.RLS_TEST_PASSWORD_LEAD }
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v187b] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Field = { key: string; label: string; type: string; opts?: string[] }
type Section = { id: string; type: string; key?: string; fields?: Field[]; cols?: { key: string }[] }
type Ver = { id: string; required: string[]; review_required: boolean; schema: { sections: Section[] } }
type Sig = { officer?: string; signer_id?: string; badge?: string; signed_at?: string; typed?: string; role?: string } | null
type Rep = { id: string; template: string; template_version_id: string | null; review_status: string; finalized: boolean; signature: Sig; reviewer_signature: Sig; review_note: string | null; submitted_by: string | null; reviewed_by: string | null; fields: Record<string, unknown> }
type Notif = { type: string; payload: { report_id?: string; case_id?: string; reason?: string; actor_id?: string } | null }

/** Every `required` key of a version, filled with a value that passes. */
function fillRequired(v: Ver, base: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const key of v.required) {
    const grid = v.schema.sections.find((s) => s.type === 'grid' && s.id === key)
    const field = v.schema.sections.flatMap((s) => (s.type === 'kv' ? s.fields ?? [] : [])).find((f) => f.key === key)
    out[key] = grid ? [{ [grid.cols![0].key]: 'x' }]
      : field?.type === 'checks' ? [field.opts?.[0] ?? 'x']
        : field?.type === 'select' ? field.opts?.find(Boolean) ?? 'x'
          : `[rls-test] ${key}`
  }
  return out
}

describe.skipIf(!enabled)('v1.87b — report review: required keys, submit → return → resubmit → approve, reopen with reason, self-seal, closure gate', () => {
  let lsb: C, bcb: C, lead: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v187b ${tag}`
  let caseId = ''
  let reportId = ''     // the incident_followup walkthrough
  let version: Ver | null = null

  const create = async (template: string, kind = 'initial'): Promise<Rep> => {
    const r = await lsb.rpc('report_create', { p_case: caseId, p_template: template, p_kind: kind, p_fields: {} })
    expect(r.error, `${template}: ${r.error?.message}`).toBeNull()
    return r.data as unknown as Rep
  }
  const versionOf = async (r: Rep): Promise<Ver> => {
    expect(r.template_version_id, 'report_create must pin a version').toBeTruthy()
    const v = await lsb.from('report_template_versions').select('id, required, review_required, schema').eq('id', r.template_version_id!).single()
    expect(v.error, v.error?.message).toBeNull()
    return v.data as unknown as Ver
  }
  const setFields = async (c: C, id: string, fields: Record<string, unknown>) =>
    c.from('reports').update({ fields }).eq('id', id).select('id')
  const report = async (c: C, id: string): Promise<Rep | null> => {
    const r = await c.from('reports').select('id, template, template_version_id, review_status, finalized, signature, reviewer_signature, review_note, submitted_by, reviewed_by, fields').eq('id', id).maybeSingle()
    expect(r.error, r.error?.message).toBeNull()
    return (r.data as unknown as Rep | null) ?? null
  }
  const notificationsFor = async (c: C, type: string, id: string): Promise<Notif[]> => {
    const r = await c.from('notifications').select('type, payload').eq('type', type).order('created_at', { ascending: false }).limit(50)
    expect(r.error, r.error?.message).toBeNull()
    return ((r.data ?? []) as Notif[]).filter((n) => n.payload?.report_id === id)
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c = await lsb.from('cases').insert({ case_number: `V187B-${tag}`, title: `${stamp} review case`, bureau: 'major_crimes', lead_detective_id: ids.lsb }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
  }, 120_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v187b] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ required keys + the trigger ============ */

  it('report_submit refuses a draft missing its required keys (labels named), and only the author may submit', async () => {
    const r = await create('incident_followup')
    reportId = r.id
    expect(r).toMatchObject({ review_status: 'draft', finalized: false, signature: null })
    version = await versionOf(r)
    expect(version.review_required).toBe(true)
    expect(version.required.length).toBeGreaterThan(0)

    const empty = await lsb.rpc('report_submit', { p_report: reportId })
    expect(empty.error).not.toBeNull()
    expect(empty.error!.message).toMatch(/required fields missing/i)
    // Every required label is named — the case number's label at least.
    const caseLabel = version.schema.sections.flatMap((s) => s.fields ?? []).find((f) => f.key === 'case_number')?.label
    if (caseLabel && version.required.includes('case_number')) expect(empty.error!.message).toContain(caseLabel)

    // A blank string does not count as present.
    const blank = fillRequired(version)
    blank[version.required[version.required.length - 1]] = '   '
    expect((await setFields(lsb, reportId, blank)).data).toHaveLength(1)
    const stillMissing = await lsb.rpc('report_submit', { p_report: reportId })
    expect(stillMissing.error).not.toBeNull()
    expect(stillMissing.error!.message).toMatch(/required fields missing/i)

    // The lead (case access, not the author) cannot submit it.
    expect((await setFields(lsb, reportId, fillRequired(version, { case_number: `V187B-${tag}` }))).data).toHaveLength(1)
    const asLead = await lead.rpc('report_submit', { p_report: reportId })
    expect(asLead.error).not.toBeNull()
    expect((await report(lsb, reportId))!.review_status).toBe('draft')
  })

  it('the workflow columns are trigger-frozen for clients', async () => {
    for (const patch of [{ review_status: 'approved' }, { finalized: true }, { submitted_by: ids.lsb }, { reviewer_signature: { typed: 'forged' } }]) {
      const r = await lsb.from('reports').update(patch).eq('id', reportId).select('id')
      expect(r.error, `patch ${JSON.stringify(patch)} must be refused`).not.toBeNull()
    }
    expect(await report(lsb, reportId)).toMatchObject({ review_status: 'draft', finalized: false, reviewer_signature: null })
  })

  it('the identity columns are frozen too, and a direct INSERT cannot forge a sealed, reviewed or foreign-author row', async () => {
    for (const patch of [{ author_id: ids.lead }, { template: 'case_closure' }, { kind: 'supplemental' as const }]) {
      const r = await lsb.from('reports').update(patch).eq('id', reportId).select('id')
      expect(r.error, `patch ${JSON.stringify(patch)} must be refused`).not.toBeNull()
    }
    const forged = [
      { finalized: true },
      { review_status: 'approved' },
      { reviewer_signature: { officer: 'Forged Lead', typed: 'Forged Lead' } },
      { author_id: ids.lead },
      { submitted_by: ids.lsb },
    ]
    for (const extra of forged) {
      const r = await lsb.from('reports').insert({ case_id: caseId, template: 'incident_followup', kind: 'initial', seq: 90, fields: {}, ...extra }).select('id')
      expect(r.error, `insert ${JSON.stringify(extra)} must be refused`).not.toBeNull()
    }
  })

  /* ============ submit → return → resubmit → approve ============ */

  it('submit → submitted with the author signature; the author\'s fields are locked; the lead is notified', async () => {
    const r = await lsb.rpc('report_submit', { p_report: reportId, p_signature: 'RLS Test LSB', p_badge: 'V187B' })
    expect(r.error, r.error?.message).toBeNull()
    const rep = r.data as unknown as Rep
    expect(rep).toMatchObject({ review_status: 'submitted', finalized: false, submitted_by: ids.lsb, reviewer_signature: null })
    expect(rep.signature).toMatchObject({ signer_id: ids.lsb, badge: 'V187B', typed: 'RLS Test LSB' })
    expect(rep.signature!.officer).toBeTruthy()
    expect(rep.signature!.signed_at).toBeTruthy()

    const locked = await setFields(lsb, reportId, { ...rep.fields, narrative: `${stamp} late edit` })
    expect(locked.error, 'a submitted report\'s fields are locked').not.toBeNull()
    const twice = await lsb.rpc('report_submit', { p_report: reportId })
    expect(twice.error).not.toBeNull()

    const pings = await notificationsFor(lead, 'report_submitted', reportId)
    expect(pings.length).toBeGreaterThanOrEqual(1)
    expect(pings[0].payload).toMatchObject({ report_id: reportId, case_id: caseId, actor_id: ids.lsb })
    // The author is never their own reviewer's audience; the outsider sees nothing.
    expect(await notificationsFor(lsb, 'report_submitted', reportId)).toEqual([])
    expect(await notificationsFor(bcb, 'report_submitted', reportId)).toEqual([])
  })

  it('report_review: never the author, never another bureau; a return needs a note; the author edits and resubmits', async () => {
    const self = await lsb.rpc('report_review', { p_report: reportId, p_decision: 'approve', p_signature: 'me' })
    expect(self.error).not.toBeNull()
    const outsider = await bcb.rpc('report_review', { p_report: reportId, p_decision: 'approve', p_signature: 'bcb' })
    expect(outsider.error).not.toBeNull()
    const noNote = await lead.rpc('report_review', { p_report: reportId, p_decision: 'return' })
    expect(noNote.error).not.toBeNull()
    expect((await report(lsb, reportId))!.review_status).toBe('submitted')

    const ret = await lead.rpc('report_review', { p_report: reportId, p_decision: 'return', p_note: `${stamp} name the second officer` })
    expect(ret.error, ret.error?.message).toBeNull()
    expect(ret.data).toMatchObject({ review_status: 'returned', finalized: false, reviewed_by: ids.lead, review_note: `${stamp} name the second officer` })
    const returned = await notificationsFor(lsb, 'report_returned', reportId)
    expect(returned.length).toBeGreaterThanOrEqual(1)
    expect(returned[0].payload).toMatchObject({ report_id: reportId, actor_id: ids.lead })

    // Returned → editable again by the author; resubmit.
    const cur = (await report(lsb, reportId))!
    const edit = await setFields(lsb, reportId, { ...cur.fields, narrative: `${stamp} second officer named` })
    expect(edit.error, edit.error?.message).toBeNull()
    expect(edit.data).toHaveLength(1)
    const again = await lsb.rpc('report_submit', { p_report: reportId, p_signature: 'RLS Test LSB' })
    expect(again.error, again.error?.message).toBeNull()
    expect(again.data).toMatchObject({ review_status: 'submitted' })
  })

  it('approve with a typed signature → finalized + approved, a report_versions row with both signatures; the author is notified', async () => {
    const ok = await lead.rpc('report_review', { p_report: reportId, p_decision: 'approve', p_signature: 'RLS Test Lead', p_badge: 'LEAD1' })
    expect(ok.error, ok.error?.message).toBeNull()
    const rep = ok.data as unknown as Rep
    expect(rep).toMatchObject({ review_status: 'approved', finalized: true, reviewed_by: ids.lead })
    expect(rep.reviewer_signature).toMatchObject({ signer_id: ids.lead, typed: 'RLS Test Lead', badge: 'LEAD1' })
    expect(rep.signature).toMatchObject({ signer_id: ids.lsb })

    const vs = await lsb.from('report_versions').select('version_number, fields, signature, reviewer_signature').eq('report_id', reportId).order('version_number', { ascending: true })
    expect(vs.error, vs.error?.message).toBeNull()
    expect(vs.data).toHaveLength(1)
    expect(vs.data![0].version_number).toBe(1)
    expect(vs.data![0].reviewer_signature).toMatchObject({ signer_id: ids.lead, typed: 'RLS Test Lead' })
    expect(vs.data![0].signature).toMatchObject({ signer_id: ids.lsb })
    expect(vs.data![0].fields).toMatchObject({ narrative: `${stamp} second officer named` })
    expect((await bcb.from('report_versions').select('id').eq('report_id', reportId)).data ?? []).toHaveLength(0)

    const fin = await notificationsFor(lsb, 'report_finalized', reportId)
    expect(fin.length).toBeGreaterThanOrEqual(1)
    // Sealed: the author's edit is refused; the review is over.
    const late = await setFields(lsb, reportId, { narrative: 'tamper' })
    expect(late.error).not.toBeNull()
    expect((await lead.rpc('report_review', { p_report: reportId, p_decision: 'approve' })).error).not.toBeNull()
  })

  /* ============ reopen ============ */

  it('report_reopen needs a reason; the Bureau Lead reopens → draft, both signatures cleared, the seal break logged with the reason; the author is notified', async () => {
    const noReason = await lead.rpc('report_reopen', { p_report: reportId })
    expect(noReason.error).not.toBeNull()
    expect(noReason.error!.message).toMatch(/reason/i)
    const blank = await lead.rpc('report_reopen', { p_report: reportId, p_reason: '   ' })
    expect(blank.error).not.toBeNull()
    const author = await lsb.rpc('report_reopen', { p_report: reportId, p_reason: `${stamp} mine` })
    expect(author.error).not.toBeNull()
    const outsider = await bcb.rpc('report_reopen', { p_report: reportId, p_reason: `${stamp} outsider` })
    expect(outsider.error).not.toBeNull()
    expect((await report(lsb, reportId))!.finalized).toBe(true)

    const re = await lead.rpc('report_reopen', { p_report: reportId, p_reason: `${stamp} wrong date on page one` })
    expect(re.error, re.error?.message).toBeNull()
    const rep = re.data as unknown as Rep
    expect(rep).toMatchObject({ finalized: false, review_status: 'draft', signature: null, reviewer_signature: null })
    const log = (rep.fields as { _reopen_log?: Array<{ by?: string; reason?: string; prev_signature?: Sig; prev_reviewer_signature?: Sig }> })._reopen_log ?? []
    expect(log.length).toBeGreaterThanOrEqual(1)
    const last = log[log.length - 1]
    expect(last).toMatchObject({ by: ids.lead, reason: `${stamp} wrong date on page one` })
    expect(last.prev_signature).toMatchObject({ signer_id: ids.lsb })
    expect(last.prev_reviewer_signature).toMatchObject({ signer_id: ids.lead })
    expect((await notificationsFor(lsb, 'report_reopened', reportId)).length).toBeGreaterThanOrEqual(1)
    // v1 is still intact.
    expect((await lsb.from('report_versions').select('version_number').eq('report_id', reportId)).data).toEqual([{ version_number: 1 }])
  })

  it('report_finalize refuses a review-required template', async () => {
    const r = await lsb.rpc('report_finalize', { p_report: reportId, p_badge: 'V187B' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/requires review/i)
    expect(await report(lsb, reportId)).toMatchObject({ finalized: false, review_status: 'draft' })
  })

  /* ============ self-seal templates ============ */

  it('an arrest_warrant report (review_required=false) self-seals on report_submit; a second one still seals via report_finalize', async () => {
    const aw = await create('arrest_warrant')
    const v = await versionOf(aw)
    expect(v.review_required).toBe(false)
    const missing = await lsb.rpc('report_submit', { p_report: aw.id })
    expect(missing.error).not.toBeNull()
    expect(missing.error!.message).toMatch(/required fields missing/i)
    expect((await setFields(lsb, aw.id, fillRequired(v, { case_number: `V187B-${tag}` }))).data).toHaveLength(1)
    const sealed = await lsb.rpc('report_submit', { p_report: aw.id, p_badge: 'AW1' })
    expect(sealed.error, sealed.error?.message).toBeNull()
    expect(sealed.data).toMatchObject({ finalized: true, review_status: 'approved', reviewer_signature: null })
    expect((sealed.data as unknown as Rep).signature).toMatchObject({ signer_id: ids.lsb, badge: 'AW1' })
    expect((await lsb.from('report_versions').select('version_number, reviewer_signature').eq('report_id', aw.id)).data).toEqual([{ version_number: 1, reviewer_signature: null }])
    // No review was requested.
    expect(await notificationsFor(lead, 'report_submitted', aw.id)).toEqual([])

    const aw2 = await create('arrest_warrant', 'supplemental')
    expect((await setFields(lsb, aw2.id, fillRequired(v, { case_number: `V187B-${tag}` }))).data).toHaveLength(1)
    // Only the author seals a self-seal draft — the Bureau Lead is refused.
    const byLead = await lead.rpc('report_finalize', { p_report: aw2.id })
    expect(byLead.error).not.toBeNull()
    expect(byLead.error!.message).toMatch(/author/i)
    const fin = await lsb.rpc('report_finalize', { p_report: aw2.id, p_badge: 'AW2' })
    expect(fin.error, fin.error?.message).toBeNull()
    expect(fin.data).toMatchObject({ finalized: true })
    expect((await report(lsb, aw2.id))!.review_status).toBe('approved')
  })

  /* ============ case_closure + task waivers ============ */

  it('case_closure refuses submit while a task is open; the Bureau Lead waives it (reason required) and the closure submits for review', async () => {
    const task = await lsb.from('case_tasks').insert({ case_id: caseId, title: `${stamp} return the phone` }).select('id').single()
    expect(task.error, task.error?.message).toBeNull()
    const taskId = task.data!.id
    const closure = await create('case_closure')
    const v = await versionOf(closure)
    expect(v.review_required).toBe(true)
    expect((await setFields(lsb, closure.id, fillRequired(v, { case_number: `V187B-${tag}` }))).data).toHaveLength(1)

    const gated = await lsb.rpc('report_submit', { p_report: closure.id })
    expect(gated.error).not.toBeNull()
    expect(gated.error!.message).toMatch(/open task/i)

    const noReason = await lead.rpc('case_task_waive', { p_task: taskId })
    expect(noReason.error).not.toBeNull()
    const outsider = await bcb.rpc('case_task_waive', { p_task: taskId, p_reason: `${stamp} outsider` })
    expect(outsider.error).not.toBeNull()
    expect((await lsb.from('case_tasks').select('waived_at').eq('id', taskId).single()).data).toEqual({ waived_at: null })
    // A client cannot waive by hand.
    const direct = await lsb.from('case_tasks').update({ waived_at: new Date().toISOString(), waived_by: ids.lsb, waive_reason: 'forged' }).eq('id', taskId).select('id')
    expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true)

    const waived = await lead.rpc('case_task_waive', { p_task: taskId, p_reason: `${stamp} phone destroyed in evidence` })
    expect(waived.error, waived.error?.message).toBeNull()
    expect(waived.data).toMatchObject({ id: taskId, waived_by: ids.lead, waive_reason: `${stamp} phone destroyed in evidence`, done: false })
    expect(waived.data!.waived_at).toBeTruthy()

    const ok = await lsb.rpc('report_submit', { p_report: closure.id, p_signature: 'RLS Test LSB' })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toMatchObject({ review_status: 'submitted', finalized: false })

    // Unwaive restores the gate for the next closure draft.
    const un = await lead.rpc('case_task_unwaive', { p_task: taskId })
    expect(un.error, un.error?.message).toBeNull()
    expect(un.data).toMatchObject({ waived_at: null, waived_by: null, waive_reason: null })
    const closure2 = await create('case_closure', 'supplemental')
    expect((await setFields(lsb, closure2.id, fillRequired(v, { case_number: `V187B-${tag}` }))).data).toHaveLength(1)
    const gatedAgain = await lsb.rpc('report_submit', { p_report: closure2.id })
    expect(gatedAgain.error).not.toBeNull()
    expect(gatedAgain.error!.message).toMatch(/open task/i)
    // Done clears it too.
    expect((await lsb.from('case_tasks').update({ done: true }).eq('id', taskId).select('id')).data).toHaveLength(1)
    const done = await lsb.rpc('report_submit', { p_report: closure2.id })
    expect(done.error, done.error?.message).toBeNull()
    expect(done.data).toMatchObject({ review_status: 'submitted' })
  })
})

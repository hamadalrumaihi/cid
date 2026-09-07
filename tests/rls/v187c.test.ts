/** v1.87c — Report entities + exports (Portal Improvements P5-04 / P5-07,
 *  migration 20261029120000_report_review).
 *
 *  A report carries a SET of the records it inserted or mentioned
 *  (report_entities) and a receipt for every download (report_exports).
 *  Both are RPC-written and read through the parent report.
 *   · report_entities_set by the author replaces the set — a person subject,
 *     a case charge and a timeline_event (ref_id null + label);
 *   · a ref the caller cannot read (another bureau's case), a charge on a
 *     different case, an unknown kind and a timeline_event with a ref_id all
 *     raise; the outsider is denied; the source rows are never written;
 *   · report_entities reads follow the report (bcb sees none); "mentioned in
 *     reports" is a plain list by (kind, ref_id) as the author;
 *   · the set is denied once the report is submitted;
 *   · report_record_export pdf → {ok, verification_code (10 chars),
 *     version_number null for a draft}; md / docx too; an invalid format
 *     raises; bcb is denied; report_exports reads follow the report; the
 *     REPORT_EXPORTED audit row is visible to the Owner; after a seal the
 *     receipt carries the sealed version number.
 *
 *  Fixtures: lsb (author, MCB detective), lead (MCB Bureau Lead — the
 *  reviewer, and removes the person row), bcb (SCB detective — creates the
 *  unreadable case), owner (audit reads). rls_test_cleanup runs pre-suite as
 *  lsb AND bcb (each sweeps its own case) and again in afterAll. */

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
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v187c] CID fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Field = { key: string; label: string; type: string; opts?: string[] }
type Section = { id: string; type: string; key?: string; fields?: Field[]; cols?: { key: string }[] }
type Ver = { id: string; required: string[]; review_required: boolean; schema: { sections: Section[] } }
type Rep = { id: string; template_version_id: string | null; review_status: string; finalized: boolean }
type SetRes = { ok: boolean; code?: string; count?: number }
type ExportRes = { ok: boolean; code?: string; id?: string; version_number?: number | null; verification_code?: string }
type Entity = { id: string; report_id: string; kind: string; ref_id: string | null; role: string | null; label: string; snapshot: unknown; edited: boolean; inserted_by: string | null }

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

describe.skipIf(!enabled)('v1.87c — report entities + exports: author-set, readable refs only, read through the report, audited receipts', () => {
  let lsb: C, bcb: C, lead: C, owner: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v187c ${tag}`
  let caseId = '', caseBId = '', bcbCaseId = ''
  let personId = '', chargeId = '', foreignChargeId = ''
  let reportId = ''
  let draftCode = ''

  const entities = async (c: C, filter: Record<string, string>): Promise<Entity[]> => {
    let q = c.from('report_entities').select('id, report_id, kind, ref_id, role, label, snapshot, edited, inserted_by')
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v)
    const r = await q
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as unknown as Entity[]
  }
  const setEntities = (c: C, id: string, items: unknown[]) => c.rpc('report_entities_set', { p_report: id, p_items: items })
  const exportAs = (c: C, id: string, format: string) => c.rpc('report_record_export', { p_report: id, p_format: format })

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner!, 'owner'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    for (const [c, who] of [[lsb, 'lsb'], [bcb, 'bcb']] as const) {
      const pre = await c.rpc('rls_test_cleanup')
      if (pre.error) throw new Error(`pre-run cleanup (${who}) failed: ${pre.error.message}`)
    }
    const mkCase = async (c: C, n: string, bureau: string) => {
      const r = await c.from('cases').insert({ case_number: `V187C-${tag}-${n}`, title: `${stamp} case ${n}`, bureau }).select('id').single()
      if (r.error) throw new Error(`case ${n} insert failed: ${r.error.message}`)
      return r.data!.id as string
    }
    caseId = await mkCase(lsb, 'A', 'major_crimes')
    caseBId = await mkCase(lsb, 'B', 'major_crimes')
    bcbCaseId = await mkCase(bcb, 'SCB', 'street_crimes')
    const p = await lsb.from('persons').insert({ name: `RLS Test Subject ${tag}` }).select('id').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id
    // Two case charges (any active penal charge — the BEFORE INSERT trigger snapshots it).
    const penal = await lsb.from('penal_charges').select('id').eq('lifecycle', 'active').order('code').limit(1)
    if (penal.error || !penal.data?.length) throw new Error(`penal_charges read failed: ${penal.error?.message ?? 'none active'}`)
    const penalId = penal.data[0].id as string
    for (const [cid, slot] of [[caseId, 'A'], [caseBId, 'B']] as const) {
      const cc = await lsb.from('case_charges').insert({ case_id: cid, charge_id: penalId, counts: 1 }).select('id').single()
      if (cc.error) throw new Error(`case_charges ${slot} insert failed: ${cc.error.message}`)
      if (slot === 'A') chargeId = cc.data!.id; else foreignChargeId = cc.data!.id
    }
    const rep = await lsb.rpc('report_create', { p_case: caseId, p_template: 'incident_followup', p_kind: 'initial', p_fields: { case_number: `V187C-${tag}-A` } })
    if (rep.error) throw new Error(`report_create failed: ${rep.error.message}`)
    reportId = (rep.data as unknown as Rep).id
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    for (const c of [lsb, bcb]) {
      const { data, error } = await c.rpc('rls_test_cleanup')
      if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
      console.info('[rls:v187c] cleanup:', JSON.stringify(data))
    }
    if (personId) {
      const del = await lead.from('persons').delete().eq('id', personId)
      if (del.error) console.warn('[rls:v187c] person cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, owner].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ P5-04: entities ============ */

  it('the author sets a person subject, a case charge and a timeline event; rows read through the report; the sources are untouched', async () => {
    const personBefore = (await lsb.from('persons').select('updated_at, name').eq('id', personId).single()).data
    const chargeBefore = (await lsb.from('case_charges').select('updated_at, counts').eq('id', chargeId).single()).data
    const r = await setEntities(lsb, reportId, [
      { kind: 'person', ref_id: personId, role: 'subject', label: `RLS Test Subject ${tag}`, snapshot: { name: `RLS Test Subject ${tag}` } },
      { kind: 'charge', ref_id: chargeId, role: 'charge', label: 'Count 1' },
      { kind: 'timeline_event', ref_id: null, role: 'event', label: '02:10 — shots fired', edited: true },
    ])
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data as SetRes).toEqual({ ok: true, count: 3 })

    const rows = await entities(lsb, { report_id: reportId })
    expect(rows).toHaveLength(3)
    expect(rows.map((e) => e.kind).sort()).toEqual(['charge', 'person', 'timeline_event'])
    expect(rows.find((e) => e.kind === 'person')).toMatchObject({ ref_id: personId, role: 'subject', edited: false, inserted_by: ids.lsb, snapshot: { name: `RLS Test Subject ${tag}` } })
    expect(rows.find((e) => e.kind === 'timeline_event')).toMatchObject({ ref_id: null, edited: true, label: '02:10 — shots fired' })
    // Case access reads them too (the lead); the outsider sees none.
    expect(await entities(lead, { report_id: reportId })).toHaveLength(3)
    expect(await entities(bcb, { report_id: reportId })).toEqual([])
    expect((await bcb.from('report_entities').select('id').eq('ref_id', personId)).data ?? []).toHaveLength(0)

    expect((await lsb.from('persons').select('updated_at, name').eq('id', personId).single()).data).toEqual(personBefore)
    expect((await lsb.from('case_charges').select('updated_at, counts').eq('id', chargeId).single()).data).toEqual(chargeBefore)
  })

  it('refusals: an unreadable case ref, a charge on another case, an unknown kind, a timeline_event with a ref raise; the outsider is denied; the set is unchanged', async () => {
    const probes: [string, unknown[]][] = [
      ['unreadable case', [{ kind: 'case', ref_id: bcbCaseId, role: 'related_case', label: 'SCB case' }]],
      ['foreign charge', [{ kind: 'charge', ref_id: foreignChargeId, role: 'charge', label: 'Count 1 (case B)' }]],
      ['unknown kind', [{ kind: 'spaceship', ref_id: personId, label: 'x' }]],
      ['timeline_event with ref', [{ kind: 'timeline_event', ref_id: personId, label: 'x' }]],
      ['ghost ref', [{ kind: 'person', ref_id: '00000000-0000-4000-a000-000000000000', label: 'ghost' }]],
    ]
    for (const [name, items] of probes) {
      const r = await setEntities(lsb, reportId, items)
      expect(r.error, `${name} must raise`).not.toBeNull()
    }
    const outsider = await setEntities(bcb, reportId, [])
    expect(outsider.error, outsider.error?.message).toBeNull()
    expect(outsider.data as SetRes).toMatchObject({ ok: false, code: 'denied' })
    expect(await entities(lsb, { report_id: reportId })).toHaveLength(3)
    // No client writes on the table itself.
    const ins = await lsb.from('report_entities').insert({ report_id: reportId, kind: 'person', ref_id: personId, label: 'forged' }).select('id')
    expect(ins.error).not.toBeNull()
    const first = (await entities(lsb, { report_id: reportId }))[0]
    const upd = await lsb.from('report_entities').update({ label: 'forged' }).eq('id', first.id).select('id')
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true)
    const del = await lsb.from('report_entities').delete().eq('id', first.id).select('id')
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    expect(await entities(lsb, { report_id: reportId })).toHaveLength(3)
  })

  it('"mentioned in reports" is a plain list by (kind, ref_id); a second set REPLACES the first; a case-writable editor may set too', async () => {
    const mentioned = await entities(lsb, { kind: 'person', ref_id: personId })
    expect(mentioned.map((e) => e.report_id)).toContain(reportId)
    const byLead = await setEntities(lead, reportId, [{ kind: 'case', ref_id: caseBId, role: 'related_case', label: `V187C-${tag}-B` }])
    expect(byLead.error, byLead.error?.message).toBeNull()
    expect(byLead.data as SetRes).toEqual({ ok: true, count: 1 })
    const rows = await entities(lsb, { report_id: reportId })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'case', ref_id: caseBId, inserted_by: ids.lead })
    expect(await entities(lsb, { kind: 'person', ref_id: personId })).toEqual([])
    // Restore the subject for the export legs (with a mention token role).
    const back = await setEntities(lsb, reportId, [{ kind: 'person', ref_id: personId, role: 'mention', label: `RLS Test Subject ${tag}` }])
    expect(back.data as SetRes).toEqual({ ok: true, count: 1 })
  })

  /* ============ P5-07: exports ============ */

  it('report_record_export: pdf / md / docx receipts for a draft (version_number null, 10-char code); invalid format raises; the outsider is denied', async () => {
    const pdf = await exportAs(lsb, reportId, 'pdf')
    expect(pdf.error, pdf.error?.message).toBeNull()
    const res = pdf.data as ExportRes
    expect(res).toMatchObject({ ok: true, version_number: null })
    expect(res.id).toBeTruthy()
    expect(res.verification_code).toMatch(/^[A-Z0-9]{10}$/)
    draftCode = res.verification_code!
    for (const format of ['md', 'docx']) {
      const r = await exportAs(lsb, reportId, format)
      expect(r.error, `${format}: ${r.error?.message}`).toBeNull()
      expect(r.data as ExportRes).toMatchObject({ ok: true, version_number: null })
      // Every export mints its own receipt code — a code proves an export was recorded.
      expect((r.data as ExportRes).verification_code).toMatch(/^[A-Z0-9]{10}$/)
      expect((r.data as ExportRes).verification_code).not.toBe(draftCode)
    }
    const bad = await exportAs(lsb, reportId, 'odt')
    expect(bad.error).not.toBeNull()
    const outsider = await exportAs(bcb, reportId, 'pdf')
    expect(outsider.error, outsider.error?.message).toBeNull()
    expect(outsider.data as ExportRes).toMatchObject({ ok: false, code: 'denied' })
    // A reader with case access (the lead) may export.
    expect(((await exportAs(lead, reportId, 'pdf')).data as ExportRes).ok).toBe(true)

    const mine = await lsb.from('report_exports').select('format, version_number, verification_code, exported_by').eq('report_id', reportId)
    expect(mine.error, mine.error?.message).toBeNull()
    expect(mine.data).toHaveLength(4)
    expect(mine.data!.filter((e) => e.exported_by === ids.lsb).map((e) => e.format).sort()).toEqual(['docx', 'md', 'pdf'])
    expect((await bcb.from('report_exports').select('id').eq('report_id', reportId)).data ?? []).toHaveLength(0)
    const ins = await lsb.from('report_exports').insert({ report_id: reportId, format: 'pdf', verification_code: 'FORGED0000' }).select('id')
    expect(ins.error).not.toBeNull()
  })

  it('the Owner sees the REPORT_EXPORTED and REPORT_ENTITIES_SET audit rows; nobody else reads the ledger', async () => {
    const a = await owner.from('audit_log').select('action, actor_id').eq('entity_id', reportId)
    expect(a.error, a.error?.message).toBeNull()
    const actions = (a.data ?? []).map((x) => x.action)
    expect(actions).toContain('REPORT_EXPORTED')
    expect(actions).toContain('REPORT_ENTITIES_SET')
    expect((a.data ?? []).find((x) => x.action === 'REPORT_EXPORTED')!.actor_id).toBe(ids.lsb)
    const peek = await lsb.from('audit_log').select('id').eq('entity_id', reportId)
    expect(peek.error !== null || (peek.data ?? []).length === 0).toBe(true)
  })

  it('once submitted the entity set is locked (denied); after the seal an export receipt carries the sealed version number', async () => {
    const v = await lsb.from('report_template_versions').select('id, required, review_required, schema').eq('id', (await lsb.from('reports').select('template_version_id').eq('id', reportId).single()).data!.template_version_id).single()
    expect(v.error, v.error?.message).toBeNull()
    const cur = (await lsb.from('reports').select('fields').eq('id', reportId).single()).data!.fields as Record<string, unknown>
    expect((await lsb.from('reports').update({ fields: fillRequired(v.data as unknown as Ver, cur) }).eq('id', reportId).select('id')).data).toHaveLength(1)
    const sub = await lsb.rpc('report_submit', { p_report: reportId, p_signature: 'RLS Test LSB' })
    expect(sub.error, sub.error?.message).toBeNull()
    expect(sub.data).toMatchObject({ review_status: 'submitted' })
    const locked = await setEntities(lsb, reportId, [])
    expect(locked.error, locked.error?.message).toBeNull()
    expect(locked.data as SetRes).toMatchObject({ ok: false, code: 'denied' })
    expect(await entities(lsb, { report_id: reportId })).toHaveLength(1)
    // Exporting a submitted-but-unsealed report is still a draft receipt.
    expect((await exportAs(lsb, reportId, 'pdf')).data as ExportRes).toMatchObject({ ok: true, version_number: null })

    const ok = await lead.rpc('report_review', { p_report: reportId, p_decision: 'approve', p_signature: 'RLS Test Lead' })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toMatchObject({ finalized: true, review_status: 'approved' })
    const sealed = await exportAs(lsb, reportId, 'pdf')
    expect(sealed.error, sealed.error?.message).toBeNull()
    const res = sealed.data as ExportRes
    expect(res).toMatchObject({ ok: true, version_number: 1 })
    expect(res.verification_code).toMatch(/^[A-Z0-9]{10}$/)
    expect(res.verification_code).not.toBe(draftCode)
    expect((await setEntities(lead, reportId, [])).data as SetRes).toMatchObject({ ok: false, code: 'denied' })
    expect((await lsb.from('report_exports').select('version_number').eq('id', res.id!).single()).data).toEqual({ version_number: 1 })
  })
})

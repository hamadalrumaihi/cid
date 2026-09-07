/** v1.87a — Report templates (Portal Improvements P5-01 / P5-02, migration
 *  20261028120000_report_templates).
 *
 *  Report templates are a CATALOG the server owns: the 14 FORM_SCHEMAS are
 *  seeded as published version 1; every later version is proposed by a
 *  Bureau Lead+ and published by the Director / Deputy Director / Owner;
 *  reports pin the version they were created under.
 *   · any active member SELECTs report_templates + the published versions
 *     (14 seeded keys incl. the six Phase 5 forms; `required` / `advisory`
 *     arrays; review_required false ONLY for arrest_warrant / search_warrant
 *     / wiretap_warrant / subpoena);
 *   · a Detective cannot report_template_save ({ok:false, code:'denied'});
 *   · a Bureau Lead CAN save a draft on an existing key (a "proposal") but
 *     cannot publish it and cannot create a NEW key;
 *   · the Director creates a new key and publishes it; a later publish
 *     supersedes the previous version while the report created before it
 *     keeps its pinned template_version_id; at most one draft per template
 *     (a second save REPLACES it);
 *   · a malformed schema, and a required key that is not in the schema, raise;
 *   · report_template_discard: the draft's author or the Director;
 *   · direct INSERT / UPDATE on both tables is refused (42501 / zero rows);
 *   · report_create with an unknown key raises; a report row INSERTED
 *     directly with a known template key gets template_version_id filled by
 *     the BEFORE INSERT trigger, an unknown key ('initial') keeps NULL;
 *   · a retired template (active=false) refuses report_create.
 *
 *  Namespace note. Templates are NOT swept by rls_test_cleanup (only draft
 *  versions authored by fixtures are). This suite therefore works on ONE
 *  fixed key, `rls_test_v187a`, which it (re)activates at the start and
 *  RETIRES (active=false) at the end, so it never shows in a real officer's
 *  template picker outside the seconds a run holds it active. Published /
 *  superseded versions of that key accumulate across runs by design (the
 *  catalog's history is immutable); the seeded 14 are never modified.
 *
 *  Fixtures: lsb (author, MCB detective), bcb (SCB detective — the outsider),
 *  lead (MCB Bureau Lead — proposer), director (publisher). The case and its
 *  reports are swept by rls_test_cleanup() pre-suite and in afterAll. */

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
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director)
if (!enabled) console.warn('[rls:v187a] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Tpl = { id: string; key: string; name: string; active: boolean; is_default: boolean }
type Ver = { id: string; template_id: string; version_number: number; status: string; required: string[]; advisory: string[]; review_required: boolean; schema: { title?: string; sections?: unknown[] }; created_by: string | null }
type SaveRes = { ok: boolean; code?: string; template_id?: string; version_id?: string; version_number?: number }
type PubRes = { ok: boolean; code?: string; version_id?: string; superseded_version_id?: string | null }

/** The 14 seeded keys (src/lib/forms.ts FORM_SCHEMAS). */
const SEEDED = [
  'cid_investigative_report', 'raid_seizure', 'uc_operation', 'arrest_warrant', 'search_warrant', 'wiretap_warrant', 'subpoena',
  'surveillance_report', 'incident_followup', 'interview', 'arrest_report', 'search_report', 'case_closure', 'warrant_return',
]
const SELF_SEAL = new Set(['arrest_warrant', 'search_warrant', 'wiretap_warrant', 'subpoena'])
/** The fixture-owned key this suite administers (see the namespace note). */
const KEY = 'rls_test_v187a'

/** A minimal valid FormSchema for the admin legs. */
const schema = (title: string) => ({
  title,
  subtitle: '[rls-test] Criminal Investigations Department — FOR OFFICIAL USE ONLY',
  sections: [
    { id: 'hdr', label: 'Report', type: 'kv', fields: [
      { key: 'case_number', label: 'Case Number', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'detective', label: 'Detective', type: 'text' },
    ] },
    { id: 'narrative', label: 'Narrative', type: 'textarea', key: 'narrative' },
  ],
})
const REQUIRED = ['case_number', 'narrative']

describe.skipIf(!enabled)('v1.87a — report templates: catalog reads, propose / publish / discard authority, pinned versions', () => {
  let lsb: C, bcb: C, lead: C, director: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v187a ${tag}`
  let caseId = ''
  let templateId = ''          // the rls_test_v187a template row
  let firstPublishedId = ''    // the version the first report pins
  let pinnedReportId = ''      // created before the second publish
  let secondPublishedId = ''

  const save = (c: C, key: string, title: string, extra: Record<string, unknown> = {}) =>
    c.rpc('report_template_save', { p_key: key, p_name: title, p_schema: schema(title), p_required: REQUIRED, p_change_summary: stamp, ...extra })
  const template = async (c: C, key: string): Promise<Tpl | null> => {
    const r = await c.from('report_templates').select('id, key, name, active, is_default').eq('key', key).maybeSingle()
    expect(r.error, r.error?.message).toBeNull()
    return (r.data as Tpl | null) ?? null
  }
  const versions = async (c: C, tplId: string): Promise<Ver[]> => {
    const r = await c.from('report_template_versions').select('id, template_id, version_number, status, required, advisory, review_required, schema, created_by').eq('template_id', tplId).order('version_number', { ascending: true })
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as unknown as Ver[]
  }
  /** Best-effort retire of the fixture key so it never lingers in a real picker. */
  const retire = async () => {
    if (!templateId || !director) return
    const r = await director.rpc('report_template_update', { p_template: templateId, p_patch: { active: false } })
    if (r.error) console.warn('[rls:v187a] retire failed:', r.error.message)
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
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c = await lsb.from('cases').insert({ case_number: `V187A-${tag}`, title: `${stamp} templates case`, bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
    // A previous run leaves the fixture key retired: bring it back so the
    // create-vs-existing legs below are deterministic either way.
    const existing = await template(director, KEY)
    if (existing) {
      templateId = existing.id
      const up = await director.rpc('report_template_update', { p_template: templateId, p_patch: { active: true, name: `${stamp} template` } })
      if (up.error) throw new Error(`re-activate failed: ${up.error.message}`)
    }
  }, 120_000)

  afterAll(async () => {
    if (!lsb) return
    await retire()
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v187a] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, director].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ P5-01: the seeded catalog ============ */

  it('any active member reads the 14 seeded templates with one published version each; review_required is false only for the legal drafting forms', async () => {
    const t = await bcb.from('report_templates').select('id, key, name, active, is_default').in('key', SEEDED)
    expect(t.error, t.error?.message).toBeNull()
    const templates = (t.data ?? []) as Tpl[]
    expect(templates.map((x) => x.key).sort()).toEqual([...SEEDED].sort())
    expect(templates.every((x) => x.active)).toBe(true)
    expect(templates.filter((x) => x.is_default).map((x) => x.key)).toEqual(['cid_investigative_report'])

    const v = await bcb.from('report_template_versions').select('id, template_id, version_number, status, required, advisory, review_required, schema, created_by')
      .in('template_id', templates.map((x) => x.id)).eq('status', 'published')
    expect(v.error, v.error?.message).toBeNull()
    const published = (v.data ?? []) as unknown as Ver[]
    expect(published).toHaveLength(SEEDED.length) // at most ONE published per template
    for (const tpl of templates) {
      const ver = published.find((x) => x.template_id === tpl.id)
      expect(ver, tpl.key).toBeDefined()
      expect(Array.isArray(ver!.required), tpl.key).toBe(true)
      expect(ver!.required.length, tpl.key).toBeGreaterThan(0)
      expect(ver!.required, tpl.key).toContain('case_number')
      expect(Array.isArray(ver!.advisory), tpl.key).toBe(true)
      expect(ver!.review_required, tpl.key).toBe(!SELF_SEAL.has(tpl.key))
      expect(typeof ver!.schema?.title, tpl.key).toBe('string')
      expect(Array.isArray(ver!.schema?.sections), tpl.key).toBe(true)
      // Every required / advisory key exists in the schema (the client trusts this).
      const keys = new Set<string>()
      for (const s of ver!.schema!.sections as Array<{ id: string; type: string; key?: string; fields?: { key: string }[] }>) {
        if (s.type === 'kv') s.fields?.forEach((f) => keys.add(f.key))
        else if (s.type === 'textarea' && s.key) keys.add(s.key)
        else if (s.type === 'grid') keys.add(s.id)
      }
      for (const k of [...ver!.required, ...ver!.advisory]) expect(keys.has(k), `${tpl.key}.${k}`).toBe(true)
    }
    // An anonymous client sees nothing.
    expect((await mk().from('report_templates').select('id').limit(1)).data ?? []).toHaveLength(0)
  })

  it('no client writes: INSERT / UPDATE / DELETE on report_templates and report_template_versions are refused, even for the Director', async () => {
    const ins = await director.from('report_templates').insert({ key: `rls_test_direct_${tag}`, name: `${stamp} direct` }).select('id')
    expect(ins.error).not.toBeNull()
    const seeded = await template(director, 'incident_followup')
    const upd = await director.from('report_templates').update({ name: `${stamp} renamed` }).eq('id', seeded!.id).select('id')
    expect(upd.error !== null || (upd.data ?? []).length === 0, 'template UPDATE must be refused or match zero rows').toBe(true)
    expect((await template(bcb, 'incident_followup'))!.name).toBe(seeded!.name)
    const del = await director.from('report_templates').delete().eq('id', seeded!.id).select('id')
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    expect(await template(bcb, 'incident_followup')).not.toBeNull()

    const [ver] = await versions(director, seeded!.id)
    const vIns = await director.from('report_template_versions').insert({ template_id: seeded!.id, version_number: 999, schema: schema('forged'), status: 'draft' }).select('id')
    expect(vIns.error).not.toBeNull()
    const vUpd = await director.from('report_template_versions').update({ review_required: false }).eq('id', ver.id).select('id')
    expect(vUpd.error !== null || (vUpd.data ?? []).length === 0).toBe(true)
    expect((await versions(bcb, seeded!.id)).find((x) => x.id === ver.id)!.review_required).toBe(true)
  })

  /* ============ P5-02: authority ============ */

  it('a Detective cannot save a template version (denied); a Bureau Lead cannot create a NEW key', async () => {
    for (const [c, who] of [[bcb, 'bcb'], [lsb, 'lsb']] as const) {
      const r = await save(c, 'incident_followup', `${stamp} ${who} proposal`)
      expect(r.error, `${who}: ${r.error?.message}`).toBeNull()
      expect(r.data as SaveRes).toMatchObject({ ok: false, code: 'denied' })
    }
    const newKey = `rls_test_v187a_lead_${tag.toLowerCase()}`
    const r = await save(lead, newKey, `${stamp} lead new key`)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data as SaveRes).toMatchObject({ ok: false, code: 'denied' })
    expect(await template(lead, newKey)).toBeNull()
  })

  it('the Director creates (or re-drafts) the fixture key and publishes it; a report then pins that version', async () => {
    const r = await save(director, KEY, `${stamp} template`, { p_description: stamp, p_review_required: true })
    expect(r.error, r.error?.message).toBeNull()
    const res = r.data as SaveRes
    expect(res).toMatchObject({ ok: true })
    expect(res.template_id).toBeTruthy(); expect(res.version_id).toBeTruthy()
    templateId = res.template_id!
    const tpl = await template(bcb, KEY)
    expect(tpl).toMatchObject({ id: templateId, active: true, is_default: false })
    const draft = (await versions(director, templateId)).find((v) => v.id === res.version_id)
    expect(draft).toMatchObject({ status: 'draft', required: REQUIRED, review_required: true, created_by: ids.director })
    expect(draft!.version_number).toBe(res.version_number)

    // Unpublished → not creatable yet.
    const early = await lsb.rpc('report_create', { p_case: caseId, p_template: KEY, p_kind: 'initial', p_fields: {} })
    expect(early.error).not.toBeNull()
    expect(early.error!.message).toMatch(/unknown report template/i)

    const pub = await director.rpc('report_template_publish', { p_version: res.version_id, p_note: stamp })
    expect(pub.error, pub.error?.message).toBeNull()
    expect(pub.data as PubRes).toMatchObject({ ok: true, version_id: res.version_id })
    firstPublishedId = res.version_id!
    const all = await versions(bcb, templateId)
    expect(all.filter((v) => v.status === 'published')).toHaveLength(1)
    expect(all.find((v) => v.id === firstPublishedId)!.status).toBe('published')
    // Publishing a published version is not a thing.
    const again = await director.rpc('report_template_publish', { p_version: firstPublishedId })
    expect(again.error).not.toBeNull()

    const rep = await lsb.rpc('report_create', { p_case: caseId, p_template: KEY, p_kind: 'initial', p_fields: { case_number: `V187A-${tag}` } })
    expect(rep.error, rep.error?.message).toBeNull()
    expect(rep.data).toMatchObject({ template: KEY, template_version_id: firstPublishedId, review_status: 'draft', finalized: false, author_id: ids.lsb })
    pinnedReportId = rep.data!.id
  })

  it('a Bureau Lead proposes a draft on the existing key (one draft per template — a second save replaces it) but cannot publish', async () => {
    const first = await save(lead, KEY, `${stamp} lead proposal`)
    expect(first.error, first.error?.message).toBeNull()
    expect(first.data as SaveRes).toMatchObject({ ok: true, template_id: templateId })
    const second = await save(lead, KEY, `${stamp} lead proposal (revised)`, { p_advisory: ['detective'] })
    expect(second.error, second.error?.message).toBeNull()
    const res = second.data as SaveRes
    expect(res).toMatchObject({ ok: true, template_id: templateId })
    expect(res.version_number).toBe((first.data as SaveRes).version_number)
    const drafts = (await versions(lead, templateId)).filter((v) => v.status === 'draft')
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ id: res.version_id, created_by: ids.lead, advisory: ['detective'] })

    const pub = await lead.rpc('report_template_publish', { p_version: res.version_id })
    expect(pub.error, pub.error?.message).toBeNull()
    expect(pub.data as PubRes).toMatchObject({ ok: false, code: 'denied' })
    expect((await versions(lead, templateId)).find((v) => v.id === res.version_id)!.status).toBe('draft')
    // The proposal is not what reports pin.
    const rep = await lsb.rpc('report_create', { p_case: caseId, p_template: KEY, p_kind: 'supplemental', p_fields: {} })
    expect(rep.error, rep.error?.message).toBeNull()
    expect(rep.data!.template_version_id).toBe(firstPublishedId)
  })

  it('the Director publishes the proposal: the previous version is superseded, the earlier report keeps its pinned version, a new report pins the new one', async () => {
    const draft = (await versions(director, templateId)).find((v) => v.status === 'draft')!
    const pub = await director.rpc('report_template_publish', { p_version: draft.id, p_note: `${stamp} v-next` })
    expect(pub.error, pub.error?.message).toBeNull()
    expect(pub.data as PubRes).toMatchObject({ ok: true, version_id: draft.id, superseded_version_id: firstPublishedId })
    secondPublishedId = draft.id
    const all = await versions(bcb, templateId)
    expect(all.find((v) => v.id === firstPublishedId)!.status).toBe('superseded')
    expect(all.filter((v) => v.status === 'published').map((v) => v.id)).toEqual([secondPublishedId])
    expect(all.find((v) => v.id === secondPublishedId)!.version_number).toBeGreaterThan(all.find((v) => v.id === firstPublishedId)!.version_number)

    const pinned = await lsb.from('reports').select('template_version_id').eq('id', pinnedReportId).single()
    expect(pinned.data).toEqual({ template_version_id: firstPublishedId })
    const rep = await lsb.rpc('report_create', { p_case: caseId, p_template: KEY, p_kind: 'followup', p_fields: {} })
    expect(rep.error, rep.error?.message).toBeNull()
    expect(rep.data!.template_version_id).toBe(secondPublishedId)
  })

  it('a malformed schema raises; a required key outside the schema raises; nothing is written', async () => {
    const before = (await versions(director, templateId)).length
    const bad = await director.rpc('report_template_save', { p_key: KEY, p_name: `${stamp} bad`, p_schema: { title: 'x', subtitle: 'y', sections: 'nope' }, p_required: [] })
    expect(bad.error).not.toBeNull()
    const badType = await director.rpc('report_template_save', {
      p_key: KEY, p_name: `${stamp} bad type`, p_required: [],
      p_schema: { title: 'x', subtitle: 'y', sections: [{ id: 'a', label: 'A', type: 'kv', fields: [{ key: 'k', label: 'K', type: 'bogus' }] }] },
    })
    expect(badType.error).not.toBeNull()
    const badKey = await director.rpc('report_template_save', { p_key: KEY, p_name: `${stamp} bad key`, p_schema: schema('x'), p_required: ['nowhere'] })
    expect(badKey.error).not.toBeNull()
    expect((await versions(director, templateId)).length).toBe(before)
  })

  it('report_template_discard: an outsider is denied, the author discards their own draft, the Director discards anyone\'s; a published version cannot be discarded', async () => {
    const mine = await save(lead, KEY, `${stamp} to discard`)
    expect(mine.error, mine.error?.message).toBeNull()
    const draftId = (mine.data as SaveRes).version_id!
    const outsider = await bcb.rpc('report_template_discard', { p_version: draftId })
    expect(outsider.error, outsider.error?.message).toBeNull()
    expect(outsider.data).toMatchObject({ ok: false, code: 'denied' })
    const own = await lead.rpc('report_template_discard', { p_version: draftId })
    expect(own.error, own.error?.message).toBeNull()
    expect(own.data).toMatchObject({ ok: true })
    expect((await versions(lead, templateId)).find((v) => v.id === draftId)).toBeUndefined()

    const theirs = await save(lead, KEY, `${stamp} director discards`)
    const theirsId = (theirs.data as SaveRes).version_id!
    const byDirector = await director.rpc('report_template_discard', { p_version: theirsId })
    expect(byDirector.error, byDirector.error?.message).toBeNull()
    expect(byDirector.data).toMatchObject({ ok: true })
    expect((await versions(lead, templateId)).filter((v) => v.status === 'draft')).toHaveLength(0)

    const published = await director.rpc('report_template_discard', { p_version: secondPublishedId })
    expect(published.error !== null || (published.data as SaveRes)?.ok === false).toBe(true)
    expect((await versions(bcb, templateId)).find((v) => v.id === secondPublishedId)!.status).toBe('published')
  })

  /* ============ the trigger pin + unknown keys ============ */

  it('report_create with an unknown key raises; a direct INSERT pins a known key and leaves an unknown one NULL', async () => {
    const unknown = await lsb.rpc('report_create', { p_case: caseId, p_template: `nope_${tag}`, p_kind: 'initial', p_fields: {} })
    expect(unknown.error).not.toBeNull()
    expect(unknown.error!.message).toMatch(/unknown report template/i)

    const known = await lsb.from('reports').insert({ case_id: caseId, template: 'incident_followup', kind: 'initial', fields: {} }).select('id, template_version_id').single()
    expect(known.error, known.error?.message).toBeNull()
    expect(known.data!.template_version_id).toBeTruthy()
    const seeded = await template(lsb, 'incident_followup')
    const pv = (await versions(lsb, seeded!.id)).find((v) => v.status === 'published')!
    expect(known.data!.template_version_id).toBe(pv.id)

    const legacy = await lsb.from('reports').insert({ case_id: caseId, template: 'initial', kind: 'initial', fields: {} }).select('id, template_version_id').single()
    expect(legacy.error, legacy.error?.message).toBeNull()
    expect(legacy.data!.template_version_id).toBeNull()
    // A client cannot choose the pin.
    const forged = await lsb.from('reports').update({ template_version_id: pv.id }).eq('id', legacy.data!.id).select('id')
    expect(forged.error !== null || (forged.data ?? []).length === 0).toBe(true)
  })

  it('retiring the fixture key (report_template_update, Director only) hides it from report_create; the catalog row stays readable', async () => {
    const asLead = await lead.rpc('report_template_update', { p_template: templateId, p_patch: { active: false } })
    expect(asLead.error, asLead.error?.message).toBeNull()
    expect(asLead.data).toMatchObject({ ok: false, code: 'denied' })
    const unknownKey = await director.rpc('report_template_update', { p_template: templateId, p_patch: { key: 'renamed' } })
    expect(unknownKey.error !== null || (unknownKey.data as SaveRes)?.ok === false).toBe(true)

    const r = await director.rpc('report_template_update', { p_template: templateId, p_patch: { active: false, description: `${stamp} retired by the suite` } })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ ok: true })
    expect(await template(bcb, KEY)).toMatchObject({ active: false })
    const retired = await lsb.rpc('report_create', { p_case: caseId, p_template: KEY, p_kind: 'initial', p_fields: {} })
    expect(retired.error).not.toBeNull()
    expect(retired.error!.message).toMatch(/unknown report template/i)
    // The reports created while it was live keep their pins.
    expect((await lsb.from('reports').select('template_version_id').eq('id', pinnedReportId).single()).data).toEqual({ template_version_id: firstPublishedId })
  })
})

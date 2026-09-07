/** v1.88c — Intel triage: groups, extended claim links and convert (Portal
 *  Improvements P6-03 / P6-04, migration 20261031120000_intel_groups_convert).
 *
 *  What the CID fixtures prove (lsb — the MCB detective who authors the
 *  records and the registry rows; bcb — the SCB detective, the other reader
 *  and the owner of an unreadable case; lead — command; inactive; owner
 *  optional — audit reads):
 *   · intel_group_suggest names the other readable records sharing a
 *     signal by NUMBER (never a summary), and the live groups they belong to;
 *   · intel_group_create with two members → a group readable by bcb and
 *     invisible to the inactive account; the lead is always a member;
 *   · add / remove: a duplicate live member, a draft, a missing reason and
 *     the lead itself ('the lead record stays in its group') are refused; a
 *     removed member keeps its row with removed_*; re-adding clears them;
 *   · link_case is a group fact: a visible case links once, bcb's SCB case
 *     is refused, unlink needs a reason; close / reopen are the creator's or
 *     command's (bcb → P0403) and a closed group takes no members;
 *   · intel_group_summary counts claims / decided over readable members;
 *   · no client INSERT / UPDATE / DELETE on the three tables (42501);
 *   · field_submission_delete refuses a live group member ('intel groups');
 *   · field_claim_link: item → narcotic allowed (claim_item_id), person →
 *     narcotic refused ('a person claim cannot be linked to a narcotic'),
 *     an indicator on bcb's case refused, a duplicate refused;
 *   · field_submission_convert: a person claim with a name matching an
 *     existing person answers {ok:false, code:'duplicate', matches}; with a
 *     reason it creates the persons row with source_submission_id, links
 *     the claim and audits FIELD_CLAIM_CONVERTED; an item converts to a
 *     narcotic; an unknown payload key, a wrong pair and a draft raise; the
 *     inactive account gets {ok:false, code:'denied'}.
 *
 *  Authority refusals raise P0403; no audit row is asserted for them.
 *  Records '[rls-test] v188c …' (city) are lsb's; the cases are swept by
 *  rls_test_cleanup as lsb AND bcb; the registry rows (persons / narcotics)
 *  are removed by the lead in afterAll. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.inactive)
if (!enabled) console.warn('[rls:v188c] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Suggest = { groups: { id: string; title: string; lead_submission_no: string | null; members: number; shared: string[] }[]; submissions: { id: string; submission_no: string | null; status: string; shared: string[] }[] }
type Summary = { id: string; title: string; lead_submission_id: string; members: { submission_id: string; submission_no: string | null; status: string; added_at: string; note: string | null }[]; hidden: number; claims: number; decided: number; cases: { case_id: string; case_number: string | null; title: string | null }[] }
type Convert = { ok: boolean; id?: string; kind?: string; code?: string; message?: string; matches?: { id: string; label: string; sublabel?: string | null; signal: string }[] }
type Link = { id: string; submission_id: string; claim_person_id: string | null; claim_item_id: string | null; person_id: string | null; narcotic_id: string | null; indicator_id: string | null; linked_by: string | null }

describe.skipIf(!enabled)('v1.88c — intel triage: groups (suggest / create / add / remove / cases / close), extended links, convert with provenance', () => {
  let lsb: C, bcb: C, lead: C, inactive: C, owner: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v188c ${tag}`
  const claimant = `RLS Test Kaplan ${tag}`
  let caseId = '', bcbCaseId = ''
  let g1 = '', g2 = '', g3 = '', draftId = ''
  const nos: Record<string, string> = {}
  let g1Person = '', g1Item = '', g2Person = ''
  let narcoticId = '', dupPersonId = '', myIndicator = '', theirIndicator = ''
  let groupId = ''
  const registryRows: { table: 'persons' | 'narcotics'; id: string }[] = []
  const created: string[] = []

  const send = async (label: string, persons: string[], withItem = false): Promise<{ id: string; person: string; item: string }> => {
    const ins = await lsb.from('field_submissions').insert({ summary: `${stamp} ${label}`, details: 'rls pin', jurisdiction: 'city', status: 'draft' }).select('id').single()
    if (ins.error) throw new Error(`record ${label}: ${ins.error.message}`)
    const id = ins.data!.id as string
    created.push(id)
    let person = '', item = ''
    for (const name of persons) {
      const p = await lsb.from('field_submission_persons').insert({ submission_id: id, full_name: name }).select('id').single()
      if (p.error) throw new Error(`person claim: ${p.error.message}`)
      if (!person) person = p.data!.id
    }
    if (withItem) {
      const i = await lsb.from('field_submission_items').insert({ submission_id: id, category: 'narcotics', description: `${stamp} blue crystals`, suspected_substance: 'meth' }).select('id').single()
      if (i.error) throw new Error(`item claim: ${i.error.message}`)
      item = i.data!.id
    }
    const up = await lsb.from('field_submissions').update({ status: 'new' }).eq('id', id).select('id, submission_no')
    if (up.error || !up.data?.length) throw new Error(`send ${label}: ${up.error?.message ?? 'zero rows'}`)
    nos[id] = up.data[0].submission_no as string
    return { id, person, item }
  }
  const linksOf = async (c: C, submissionId: string): Promise<Link[]> => {
    const r = await c.from('field_claim_links').select('id, submission_id, claim_person_id, claim_item_id, person_id, narcotic_id, indicator_id, linked_by').eq('submission_id', submissionId)
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as Link[]
  }
  const members = async (c: C, gid: string) => {
    const r = await c.from('intel_group_members').select('submission_id, removed_at, removed_by, remove_reason, added_by, note').eq('group_id', gid)
    expect(r.error, r.error?.message).toBeNull()
    return r.data ?? []
  }
  const summary = async (c: C, gid: string): Promise<Summary> => {
    const r = await c.rpc('intel_group_summary', { p_group: gid })
    expect(r.error, r.error?.message).toBeNull()
    return r.data as unknown as Summary
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); inactive = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
      [inactive, 'rls-test-inactive@cidportal.test', PW.inactive!, 'inactive'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    if (PW.owner) { owner = mk(); ids.owner = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    for (const [c, who] of [[lsb, 'lsb'], [bcb, 'bcb']] as const) {
      const pre = await c.rpc('rls_test_cleanup')
      if (pre.error) throw new Error(`pre-run cleanup (${who}) failed: ${pre.error.message}`)
    }
    const mkCase = async (c: C, n: string, bureau: string) => {
      const r = await c.from('cases').insert({ case_number: `V188C-${tag}-${n}`, title: `${stamp} case ${n}`, bureau }).select('id').single()
      if (r.error) throw new Error(`case ${n}: ${r.error.message}`)
      return r.data!.id as string
    }
    caseId = await mkCase(lsb, 'A', 'major_crimes')
    bcbCaseId = await mkCase(bcb, 'SCB', 'street_crimes')
    const ind = await lsb.from('indicators').insert({ case_id: caseId, kind: 'phone', value: `555-${tag.slice(0, 4)}` }).select('id').single()
    if (ind.error) throw new Error(`indicator: ${ind.error.message}`)
    myIndicator = ind.data!.id
    const theirs = await bcb.from('indicators').insert({ case_id: bcbCaseId, kind: 'phone', value: `555-${tag.slice(2, 6)}` }).select('id').single()
    if (theirs.error) throw new Error(`bcb indicator: ${theirs.error.message}`)
    theirIndicator = theirs.data!.id
    const n = await lsb.from('narcotics').insert({ name: `RLS Test Narcotic ${tag}`, category: 'stimulant' }).select('id').single()
    if (n.error) throw new Error(`narcotic: ${n.error.message}`)
    narcoticId = n.data!.id; registryRows.push({ table: 'narcotics', id: narcoticId })
    const dup = await lsb.from('persons').insert({ name: `RLS Test Dup ${tag}` }).select('id').single()
    if (dup.error) throw new Error(`person: ${dup.error.message}`)
    dupPersonId = dup.data!.id; registryRows.push({ table: 'persons', id: dupPersonId })
    // Three sent records naming the same person; G1 also carries an item claim, G2 the duplicate's name.
    const a = await send('group lead', [claimant], true); g1 = a.id; g1Person = a.person; g1Item = a.item
    const b = await send('second sighting', [`RLS Test Dup ${tag}`, claimant]); g2 = b.id; g2Person = b.person
    const d = await send('third sighting', [claimant]); g3 = d.id
    const draft = await lsb.from('field_submissions').insert({ summary: `${stamp} draft`, details: 'rls pin', jurisdiction: 'city' }).select('id').single()
    if (draft.error) throw new Error(`draft: ${draft.error.message}`)
    draftId = draft.data!.id; created.push(draftId)
  }, 180_000)

  afterAll(async () => {
    if (!lsb) return
    for (const c of [lsb, bcb]) {
      const { data, error } = await c.rpc('rls_test_cleanup')
      if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
      console.info('[rls:v188c] cleanup:', JSON.stringify(data))
    }
    if (created.length) {
      const del = await lead.from('field_submissions').delete().in('id', created)
      if (del.error) console.warn('[rls:v188c] lead delete:', del.error.message)
    }
    for (const row of registryRows) {
      const del = await lead.from(row.table).delete().eq('id', row.id)
      if (del.error) console.warn(`[rls:v188c] ${row.table} cleanup failed:`, del.error.message)
    }
    await Promise.all([lsb, bcb, lead, inactive, owner].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 90_000)

  /* ============ P6-03 groups ============ */

  it('suggest names the other records by number (never a summary); create with two members; the group reads for bcb and not the inactive; the lead is a member', async () => {
    const before = await lsb.rpc('intel_group_suggest', { p_submission: g1 })
    expect(before.error, before.error?.message).toBeNull()
    const s0 = before.data as unknown as Suggest
    expect(s0.groups).toEqual([])
    expect(s0.submissions.map((x) => x.id).sort()).toEqual([g2, g3].sort())
    for (const x of s0.submissions) {
      expect(x.submission_no).toBe(nos[x.id])
      expect(x.shared).toContain(claimant)
    }
    expect(JSON.stringify(s0)).not.toContain(stamp)

    const noTitle = await lsb.rpc('intel_group_create', { p_title: '  ', p_lead: g1 })
    expect(noTitle.error).not.toBeNull()
    const draftMember = await lsb.rpc('intel_group_create', { p_title: `${stamp} group`, p_lead: g1, p_members: [draftId] })
    expect(draftMember.error).not.toBeNull()
    expect(draftMember.error!.message).toMatch(/not been sent yet/i)
    const asInactive = await inactive.rpc('intel_group_create', { p_title: `${stamp} group`, p_lead: g1 })
    expect(asInactive.error).not.toBeNull()
    expect(asInactive.error!.code).toBe('P0403')

    const ok = await lsb.rpc('intel_group_create', { p_title: `${stamp} pier crew`, p_lead: g1, p_members: [g2] })
    expect(ok.error, ok.error?.message).toBeNull()
    groupId = ok.data as unknown as string
    expect(groupId).toMatch(/^[0-9a-f-]{36}$/)
    const g = await bcb.from('intel_groups').select('id, title, lead_submission_id, created_by, closed_at').eq('id', groupId).maybeSingle()
    expect(g.error, g.error?.message).toBeNull()
    expect(g.data).toMatchObject({ title: `${stamp} pier crew`, lead_submission_id: g1, created_by: ids.lsb, closed_at: null })
    expect((await members(bcb, groupId)).map((m) => m.submission_id).sort()).toEqual([g1, g2].sort())
    expect((await inactive.from('intel_groups').select('id').eq('id', groupId)).data ?? []).toEqual([])
    expect((await inactive.from('intel_group_members').select('id').eq('group_id', groupId)).data ?? []).toEqual([])
    const after = await lsb.rpc('intel_group_suggest', { p_submission: g3 })
    expect(after.error, after.error?.message).toBeNull()
    const s1 = after.data as unknown as Suggest
    expect(s1.groups.map((x) => x.id)).toContain(groupId)
    expect(s1.groups.find((x) => x.id === groupId)).toMatchObject({ title: `${stamp} pier crew`, lead_submission_no: nos[g1], members: 2 })
    if (owner) {
      const a = await owner.from('audit_log').select('action').eq('entity_id', groupId)
      expect(a.error, a.error?.message).toBeNull()
      expect(a.data!.map((x) => x.action)).toContain('INTEL_GROUP_CREATED')
    }
  })

  it('add / remove: duplicate, draft, the lead and a missing reason are refused; a removed member keeps its row; re-adding clears removed_*', async () => {
    const add = await bcb.rpc('intel_group_add', { p_group: groupId, p_submission: g3, p_note: `${stamp} same name` })
    expect(add.error, add.error?.message).toBeNull()
    expect((await members(lsb, groupId)).map((m) => m.submission_id).sort()).toEqual([g1, g2, g3].sort())
    const dup = await lsb.rpc('intel_group_add', { p_group: groupId, p_submission: g3 })
    expect(dup.error).not.toBeNull()
    expect(dup.error!.message).toMatch(/already in this group/i)
    const draft = await lsb.rpc('intel_group_add', { p_group: groupId, p_submission: draftId })
    expect(draft.error).not.toBeNull()
    const noReason = await lsb.rpc('intel_group_remove', { p_group: groupId, p_submission: g3 })
    expect(noReason.error).not.toBeNull()
    const leadOut = await lsb.rpc('intel_group_remove', { p_group: groupId, p_submission: g1, p_reason: `${stamp} lead` })
    expect(leadOut.error).not.toBeNull()
    expect(leadOut.error!.message).toMatch(/lead record stays in its group/i)
    const rm = await lsb.rpc('intel_group_remove', { p_group: groupId, p_submission: g3, p_reason: `${stamp} different Kaplan` })
    expect(rm.error, rm.error?.message).toBeNull()
    const gone = (await members(lsb, groupId)).find((m) => m.submission_id === g3)!
    expect(gone).toMatchObject({ removed_by: ids.lsb, remove_reason: `${stamp} different Kaplan` })
    expect(gone.removed_at).toBeTruthy()
    expect((await summary(lsb, groupId)).members.map((m) => m.submission_id).sort()).toEqual([g1, g2].sort())
    const back = await lsb.rpc('intel_group_add', { p_group: groupId, p_submission: g3 })
    expect(back.error, back.error?.message).toBeNull()
    const rows = (await members(lsb, groupId)).filter((m) => m.submission_id === g3)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ removed_at: null, removed_by: null, remove_reason: null })
  })

  it('summary counts claims / decided over readable members and names the linked cases; link_case is a group fact; an unreadable case is refused; unlink needs a reason', async () => {
    const d = await lsb.rpc('field_claim_decide', { p_kind: 'person', p_claim: g1Person, p_verdict: 'verified' })
    expect(d.error, d.error?.message).toBeNull()
    let s = await summary(bcb, groupId)
    expect(s).toMatchObject({ id: groupId, lead_submission_id: g1, hidden: 0, decided: 1, cases: [] })
    expect(s.claims).toBe(5) // G1: person + item, G2: two persons, G3: one person
    expect(s.members.every((m) => m.submission_no === nos[m.submission_id] && m.status === 'new')).toBe(true)
    expect(JSON.stringify(s)).not.toContain('rls pin')

    const link = await lsb.rpc('intel_group_link_case', { p_group: groupId, p_case: caseId, p_note: `${stamp} same crew` })
    expect(link.error, link.error?.message).toBeNull()
    expect(link.data).toMatch(/^[0-9a-f-]{36}$/)
    const again = await lsb.rpc('intel_group_link_case', { p_group: groupId, p_case: caseId })
    expect(again.error).not.toBeNull()
    expect(again.error!.message).toMatch(/already linked/i)
    const foreign = await lsb.rpc('intel_group_link_case', { p_group: groupId, p_case: bcbCaseId })
    expect(foreign.error).not.toBeNull()
    expect(foreign.error!.message).toMatch(/no such case|access/i)
    s = await summary(lsb, groupId)
    expect(s.cases).toEqual([{ case_id: caseId, case_number: `V188C-${tag}-A`, title: `${stamp} case A` }])
    // Members are NOT individually linked.
    expect((await lsb.from('field_submission_cases').select('id').eq('case_id', caseId)).data ?? []).toEqual([])
    const cases = await bcb.from('intel_group_cases').select('case_id, linked_by, note, unlinked_at').eq('group_id', groupId)
    expect(cases.error, cases.error?.message).toBeNull()
    expect(cases.data).toEqual([{ case_id: caseId, linked_by: ids.lsb, note: `${stamp} same crew`, unlinked_at: null }])
    const noReason = await lsb.rpc('intel_group_unlink_case', { p_group: groupId, p_case: caseId })
    expect(noReason.error).not.toBeNull()
    const un = await lsb.rpc('intel_group_unlink_case', { p_group: groupId, p_case: caseId, p_reason: `${stamp} wrong case` })
    expect(un.error, un.error?.message).toBeNull()
    expect((await lsb.from('intel_group_cases').select('unlinked_at, unlink_reason').eq('group_id', groupId).single()).data).toMatchObject({ unlink_reason: `${stamp} wrong case` })
    expect((await summary(lsb, groupId)).cases).toEqual([])
  })

  it('no client writes on the three tables (42501); a live member cannot be soft-deleted (\'intel groups\')', async () => {
    const forgedGroup = await lsb.from('intel_groups').insert({ title: `${stamp} forged`, lead_submission_id: g1 }).select('id')
    expect(forgedGroup.error).not.toBeNull()
    expect(forgedGroup.error!.code).toBe('42501')
    const forgedMember = await lsb.from('intel_group_members').insert({ group_id: groupId, submission_id: draftId }).select('id')
    expect(forgedMember.error).not.toBeNull()
    expect(forgedMember.error!.code).toBe('42501')
    const forgedCase = await lsb.from('intel_group_cases').insert({ group_id: groupId, case_id: caseId }).select('id')
    expect(forgedCase.error).not.toBeNull()
    expect(forgedCase.error!.code).toBe('42501')
    const upd = await lsb.from('intel_groups').update({ title: 'renamed' }).eq('id', groupId).select('id')
    expect(upd.error).not.toBeNull()
    const del = await lead.from('intel_groups').delete().eq('id', groupId).select('id')
    expect(del.error).not.toBeNull()
    expect((await lsb.from('intel_groups').select('title').eq('id', groupId).single()).data).toEqual({ title: `${stamp} pier crew` })
    const softDelete = await lead.rpc('field_submission_delete', { p_submission: g3, p_reason: `${stamp} try` })
    expect(softDelete.error).not.toBeNull()
    expect(softDelete.error!.message).toMatch(/intel groups/i)
    expect((await lsb.from('field_submissions').select('deleted_at').eq('id', g3).single()).data).toEqual({ deleted_at: null })
  })

  it('close / reopen: bcb (neither creator nor command) gets P0403; the creator closes with a reason; a closed group takes no members; the lead reopens', async () => {
    const asOther = await bcb.rpc('intel_group_close', { p_group: groupId, p_reason: `${stamp} done` })
    expect(asOther.error).not.toBeNull()
    expect(asOther.error!.code).toBe('P0403')
    const noReason = await lsb.rpc('intel_group_close', { p_group: groupId })
    expect(noReason.error).not.toBeNull()
    const closed = await lsb.rpc('intel_group_close', { p_group: groupId, p_reason: `${stamp} folded into the case` })
    expect(closed.error, closed.error?.message).toBeNull()
    expect((await lsb.from('intel_groups').select('closed_by, close_reason').eq('id', groupId).single()).data).toEqual({ closed_by: ids.lsb, close_reason: `${stamp} folded into the case` })
    const twice = await lsb.rpc('intel_group_close', { p_group: groupId, p_reason: 'x' })
    expect(twice.error).not.toBeNull()
    const addClosed = await lsb.rpc('intel_group_add', { p_group: groupId, p_submission: g3 })
    expect(addClosed.error).not.toBeNull()
    expect(addClosed.error!.message).toMatch(/closed/i)
    const reopen = await lead.rpc('intel_group_reopen', { p_group: groupId, p_reason: `${stamp} new sighting` })
    expect(reopen.error, reopen.error?.message).toBeNull()
    expect((await lsb.from('intel_groups').select('closed_at, closed_by, close_reason').eq('id', groupId).single()).data).toEqual({ closed_at: null, closed_by: null, close_reason: null })
    if (owner) {
      const a = await owner.from('audit_log').select('action').eq('entity_id', groupId)
      expect(a.error, a.error?.message).toBeNull()
      const actions = a.data!.map((x) => x.action)
      for (const expected of ['INTEL_GROUP_MEMBER_ADDED', 'INTEL_GROUP_MEMBER_REMOVED', 'INTEL_GROUP_CASE_LINKED', 'INTEL_GROUP_CASE_UNLINKED', 'INTEL_GROUP_CLOSED', 'INTEL_GROUP_REOPENED']) expect(actions).toContain(expected)
    }
  })

  /* ============ P6-04 extended links ============ */

  it('field_claim_link: item → narcotic allowed (claim_item_id), person → narcotic refused, an indicator on another bureau\'s case refused, a duplicate refused', async () => {
    const ok = await lsb.rpc('field_claim_link', { p_kind: 'item', p_claim: g1Item, p_target_kind: 'narcotic', p_target: narcoticId })
    expect(ok.error, ok.error?.message).toBeNull()
    const links = await linksOf(lsb, g1)
    expect(links.find((l) => l.narcotic_id === narcoticId)).toMatchObject({ claim_item_id: g1Item, claim_person_id: null, linked_by: ids.lsb })
    const dup = await lsb.rpc('field_claim_link', { p_kind: 'item', p_claim: g1Item, p_target_kind: 'narcotic', p_target: narcoticId })
    expect(dup.error).not.toBeNull()
    expect(dup.error!.message).toMatch(/already linked/i)
    const wrongPair = await lsb.rpc('field_claim_link', { p_kind: 'person', p_claim: g1Person, p_target_kind: 'narcotic', p_target: narcoticId })
    expect(wrongPair.error).not.toBeNull()
    expect(wrongPair.error!.message).toMatch(/person claim cannot be linked to a narcotic/i)
    const hiddenCase = await lsb.rpc('field_claim_link', { p_kind: 'person', p_claim: g1Person, p_target_kind: 'indicator', p_target: theirIndicator })
    expect(hiddenCase.error).not.toBeNull()
    const mine = await lsb.rpc('field_claim_link', { p_kind: 'person', p_claim: g1Person, p_target_kind: 'indicator', p_target: myIndicator })
    expect(mine.error, mine.error?.message).toBeNull()
    expect((await linksOf(bcb, g1)).find((l) => l.indicator_id === myIndicator)).toMatchObject({ claim_person_id: g1Person })
    // field_claim_link's inactive check is a plain raise ('not authorized'); only the read wall is P0403.
    const asInactive = await inactive.rpc('field_claim_link', { p_kind: 'item', p_claim: g1Item, p_target_kind: 'indicator', p_target: myIndicator })
    expect(asInactive.error).not.toBeNull()
    expect(asInactive.error!.message).toMatch(/not authorized/i)
    // The repeat signal gains the linked basis for another record on the same narcotic.
    const other = await send('same narcotic', [], true)
    const link2 = await lsb.rpc('field_claim_link', { p_kind: 'item', p_claim: other.item, p_target_kind: 'narcotic', p_target: narcoticId })
    expect(link2.error, link2.error?.message).toBeNull()
    const rep = await lsb.rpc('field_submission_repeats', { p_submission: other.id })
    expect(rep.error, rep.error?.message).toBeNull()
    const linked = (rep.data ?? []).find((r: { basis: string; records: string[] }) => r.basis === 'linked' && r.records.includes(nos[g1]))
    expect(linked).toBeTruthy()
  })

  /* ============ P6-04 convert ============ */

  it('convert: a person claim whose name matches an existing person answers duplicate; with a reason the persons row carries source_submission_id and the claim is linked; the audit row follows', async () => {
    const dup = await lsb.rpc('field_submission_convert', { p_kind: 'person', p_claim_kind: 'person', p_claim: g2Person, p_payload: { name: `RLS Test Dup ${tag}` } })
    expect(dup.error, dup.error?.message).toBeNull()
    const answer = dup.data as unknown as Convert
    expect(answer).toMatchObject({ ok: false, code: 'duplicate' })
    expect(answer.message).toMatch(/already exists/i)
    expect(answer.matches!.map((m) => m.id)).toContain(dupPersonId)
    expect((await lsb.from('persons').select('id').eq('source_submission_id', g2)).data ?? []).toEqual([])

    const ok = await lsb.rpc('field_submission_convert', {
      p_kind: 'person', p_claim_kind: 'person', p_claim: g2Person,
      p_payload: { name: `RLS Test Dup ${tag}`, alias: 'Dupe', notes: `${stamp} seen at the pier` }, p_reason: `${stamp} different DOB on the MDT`,
    })
    expect(ok.error, ok.error?.message).toBeNull()
    const res = ok.data as unknown as Convert
    expect(res).toMatchObject({ ok: true, kind: 'person' })
    expect(res.id).toMatch(/^[0-9a-f-]{36}$/)
    registryRows.push({ table: 'persons', id: res.id! })
    const person = await lsb.from('persons').select('name, alias, notes, source_submission_id, created_by').eq('id', res.id!).single()
    expect(person.error, person.error?.message).toBeNull()
    expect(person.data).toMatchObject({ name: `RLS Test Dup ${tag}`, alias: 'Dupe', source_submission_id: g2, created_by: ids.lsb })
    expect(person.data!.notes).toMatch(/Created despite a possible duplicate: .*different DOB on the MDT/)
    expect((await linksOf(lsb, g2)).find((l) => l.person_id === res.id)).toMatchObject({ claim_person_id: g2Person, linked_by: ids.lsb })
    if (owner) {
      const a = await owner.from('audit_log').select('action, detail').eq('entity_id', g2).eq('action', 'FIELD_CLAIM_CONVERTED')
      expect(a.error, a.error?.message).toBeNull()
      expect(a.data).toHaveLength(1)
      expect(a.data![0].detail).toMatchObject({ claim_kind: 'person', claim_id: g2Person, kind: 'person', record_id: res.id, submission_no: nos[g2] })
    }
  })

  it('convert: an item → narcotic (name + category); an unknown payload key, a wrong pair and a draft raise; the inactive account is denied', async () => {
    const other = await send('convert item', [], true)
    const missing = await lsb.rpc('field_submission_convert', { p_kind: 'narcotic', p_claim_kind: 'item', p_claim: other.item, p_payload: { name: `RLS Test Purple ${tag}` } })
    expect(missing.error).not.toBeNull()
    const unknownKey = await lsb.rpc('field_submission_convert', { p_kind: 'narcotic', p_claim_kind: 'item', p_claim: other.item, p_payload: { name: `RLS Test Purple ${tag}`, category: 'synthetic', potency: 'high' } })
    expect(unknownKey.error).not.toBeNull()
    const wrongPair = await lsb.rpc('field_submission_convert', { p_kind: 'narcotic', p_claim_kind: 'person', p_claim: g1Person, p_payload: { name: 'x', category: 'opioid' } })
    expect(wrongPair.error).not.toBeNull()
    expect(wrongPair.error!.message).toMatch(/person claim cannot become a narcotic/i)
    expect(missing.error!.message).toMatch(/category is required/i)
    expect(unknownKey.error!.message).toMatch(/unknown field/i)
    const ok = await lsb.rpc('field_submission_convert', { p_kind: 'narcotic', p_claim_kind: 'item', p_claim: other.item, p_payload: { name: `RLS Test Purple ${tag}`, category: 'synthetic' } })
    expect(ok.error, ok.error?.message).toBeNull()
    const res = ok.data as unknown as Convert
    expect(res).toMatchObject({ ok: true, kind: 'narcotic' })
    registryRows.push({ table: 'narcotics', id: res.id! })
    const n = await lsb.from('narcotics').select('name, category, source_submission_id').eq('id', res.id!).single()
    expect(n.error, n.error?.message).toBeNull()
    expect(n.data).toEqual({ name: `RLS Test Purple ${tag}`, category: 'synthetic', source_submission_id: other.id })
    expect((await linksOf(lsb, other.id)).find((l) => l.narcotic_id === res.id)).toMatchObject({ claim_item_id: other.item })
    // A draft's claim never converts; the inactive account is denied, not raised.
    const dp = await lsb.from('field_submission_persons').insert({ submission_id: draftId, full_name: `RLS Test Draft ${tag}` }).select('id').single()
    expect(dp.error, dp.error?.message).toBeNull()
    const onDraft = await lsb.rpc('field_submission_convert', { p_kind: 'person', p_claim_kind: 'person', p_claim: dp.data!.id, p_payload: { name: 'x' } })
    expect(onDraft.error).not.toBeNull()
    const denied = await inactive.rpc('field_submission_convert', { p_kind: 'person', p_claim_kind: 'person', p_claim: g1Person, p_payload: { name: `RLS Test Nobody ${tag}` } })
    expect(denied.error === null ? (denied.data as unknown as Convert) : { ok: false, code: denied.error.code }).toMatchObject({ ok: false })
    expect((await lsb.from('persons').select('id').eq('name', `RLS Test Nobody ${tag}`)).data ?? []).toEqual([])
  })
})

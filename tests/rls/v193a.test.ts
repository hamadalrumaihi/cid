/** v1.93a — Organization associations and registry intelligence media
 *  (migration 20261106120000_org_associations_registry_intel). Catalog
 *  test_id `v193a`.
 *
 *  The registry could already relate a person to a person and a gang to a
 *  block, but not one organization to another, and it could only store a
 *  photograph against a CASE. This suite pins both new surfaces and, above
 *  all, the rule the intake of 2026-09-11 turned on: an observation is not a
 *  finding. Co-located branding becomes an UNCONFIRMED ASSOCIATION at status
 *  PENDING INVESTIGATION — never an alliance, never a merger — and only an
 *  investigator's explicit decision changes that.
 *
 *  What the CID fixtures prove (lsb — the MCB detective, the submitter; bcb —
 *  the SCB detective, a second member who can see the same registry records;
 *  lead — the MCB Bureau Lead, i.e. command; owner optional — `audit_log`):
 *   · #1 `entity_association_create` lands on `pending_investigation` with
 *     `created_by` = the caller and NO decision, whatever the caller asks for;
 *   · #2 the pair is canonical: the same claim again, and the same claim with
 *     the endpoints reversed, both return the FIRST row with `created:false`
 *     — the intake's "do not overwrite" rule, enforced in the RPC and by the
 *     partial unique index behind it. A DIFFERENT claim on the same pair is a
 *     new row, still pending;
 *   · #3 a record cannot be associated with itself (`bad_request`);
 *   · #4 `entity_associations` is SELECT-only for clients: INSERT, UPDATE and
 *     DELETE all fail (42501), so the RPCs are the only way in;
 *   · #5 `entity_associations_for` resolves the far side in both directions
 *     and names the SUBMITTER (`created_by_name`) — which is not, and must
 *     not be read as, an assignment;
 *   · #6 `entity_association_decide` refuses a confirm or a reject without a
 *     reason (`bad_request`) and an unknown status (`bad_value`); a real
 *     confirmation records who and when and may correct the claim; returning
 *     it to `pending_investigation` CLEARS the decision trail;
 *   · #7 `entity_association_update` amends only note / confidence /
 *     source_type / first_observed / last_confirmed (anything else is
 *     `bad_request`), and only for the author or command — a second member is
 *     refused (P0403) even though they may see and rule on the row;
 *   · #8 a second member who can see both records CAN see and rule on the
 *     association (that is the catalog's "both ends" rule), and cannot
 *     withdraw it;
 *   · #9 Trash round trip: `soft_delete('entity_association', …)` by the
 *     author, the row appears in `trash_list('entity_association')` labelled
 *     by its claim, and `restore_record` brings it back;
 *   · #10 `registry_media_attach` reserves a row and a path under the record
 *     it names — `registry/<kind>/<entity_id>/<media_id>/<file>` — with no
 *     case, no EV number, no hash, no integrity status and no custody chain
 *     (registry intelligence is NOT case evidence); a second attach ADDS a
 *     row rather than replacing the first; an unknown kind is `bad_request`;
 *   · #11 registry media cannot be laundered into the evidence series:
 *     `evidence_register` on a caseless registry row is refused;
 *   · #12 (PART 5) an association may not name a record that does not exist,
 *     and a photograph may not hang on one: `perm_registry_visible` answers
 *     "may the caller see it" and, for the SIU-walled kinds, never reads the
 *     table, so `private.registry_exists` is the half that was missing;
 *   · #13 (PART 5) every vocabulary and every date is refused in the RPC as
 *     `{ok:false, code:'bad_value'}` — an unknown kind, claim, confidence or
 *     source type must not escape as a CHECK violation (23514), and a
 *     malformed date must not escape as a date-parse error (22007).
 *
 *  The storage policies themselves (registry_media_write binding the object
 *  to its own media row and its own record) are not exercised here — an
 *  object upload needs bytes and a live bucket; they were verified live in a
 *  rolled-back transaction when the migration was applied.
 *
 *  Fixtures: two gangs and one place created by lsb, all stamped `[rls-test]`.
 *  `rls_test_cleanup` (spliced by 20261106120000 PART 4) sweeps the
 *  association rows — including any pointing at a fixture record, since the
 *  endpoints are polymorphic and nothing cascades them — and the registry
 *  media objects' rows. */

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
if (!enabled) console.warn('[rls:v193a] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>

describe.skipIf(!enabled)('v1.93a — an association is an observation until an investigator rules on it; registry media is not evidence', () => {
  let lsb: C, bcb: C, lead: C, owner: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v193a ${tag}`
  let gangA = ''
  let gangB = ''
  let place = ''
  let assoc = ''
  let mediaId = ''
  let mediaPath = ''

  const jsonRpc = async (c: C, fn: string, args: Json): Promise<Json> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn}: ${r.error?.message}`).toBeNull()
    return r.data as Json
  }
  const expectP0403 = async (c: C, fn: string, args: Json): Promise<string> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn} should raise`).not.toBeNull()
    expect(r.error!.code, `${fn}: ${r.error!.message}`).toBe('P0403')
    return r.error!.message
  }
  const assocRow = async (c: C, id: string): Promise<Json | null> => {
    const r = await c.from('entity_associations').select('*').eq('id', id).maybeSingle()
    expect(r.error, `entity_associations: ${r.error?.message}`).toBeNull()
    return (r.data ?? null) as Json | null
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

    const a = await lsb.from('gangs').insert({ name: `${stamp} Alpha Cartel`, classification: 'cartel' }).select('id').single()
    if (a.error) throw new Error(`gang A: ${a.error.message}`)
    gangA = a.data!.id
    const b = await lsb.from('gangs').insert({ name: `${stamp} Bravo MC`, classification: 'motorcycle_club' }).select('id').single()
    if (b.error) throw new Error(`gang B: ${b.error.message}`)
    gangB = b.data!.id
    const p = await lsb.from('places').insert({ name: `${stamp} Shared Garage`, location_type: 'other' }).select('id').single()
    if (p.error) throw new Error(`place: ${p.error.message}`)
    place = p.data!.id
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v193a] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, owner].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #1–#3 recording an observation ============ */

  it('#1 create lands on pending_investigation with the caller as submitter and no decision', async () => {
    const out = await jsonRpc(lsb, 'entity_association_create', {
      p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'gang', p_object_id: gangB,
      p_association: 'unconfirmed_association', p_note: `${stamp} branding seen at one property`,
      p_confidence: 'unverified', p_source_type: 'visual_intelligence',
    })
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, created: true, status: 'pending_investigation' })
    assoc = String(out.id)
    const row = await assocRow(lsb, assoc)
    expect(row).toMatchObject({
      subject_kind: 'gang', subject_id: gangA, object_kind: 'gang', object_id: gangB,
      association: 'unconfirmed_association', status: 'pending_investigation',
      confidence: 'unverified', source_type: 'visual_intelligence', created_by: ids.lsb,
    })
    // An observation never decides itself, and never implies alliance or merger.
    expect(row!.decided_by).toBeNull()
    expect(row!.decided_at).toBeNull()
    expect(row!.decision_note).toBeNull()
    expect(row!.last_confirmed).toBeNull()
    expect(row!.deleted_at).toBeNull()
  })

  it.skipIf(!hasOwner)('#1 ENTITY_ASSOCIATION_CREATED is audited under the submitter (Owner)', async () => {
    const r = await owner!.from('audit_log').select('action, actor_id, detail').eq('action', 'ENTITY_ASSOCIATION_CREATED').eq('entity_id', assoc).limit(1)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data?.length).toBe(1)
    expect(r.data![0].actor_id).toBe(ids.lsb)
    expect(r.data![0].detail).toMatchObject({ association: 'unconfirmed_association', status: 'pending_investigation' })
  })

  it('#2 the pair is canonical: the same claim, and the reversed claim, return the first row uncreated; a different claim is a new row', async () => {
    const again = await jsonRpc(lsb, 'entity_association_create', {
      p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'gang', p_object_id: gangB, p_association: 'unconfirmed_association',
    })
    expect(again).toMatchObject({ ok: true, created: false, id: assoc })
    const reversed = await jsonRpc(lsb, 'entity_association_create', {
      p_subject_kind: 'gang', p_subject_id: gangB, p_object_kind: 'gang', p_object_id: gangA, p_association: 'unconfirmed_association',
    })
    expect(reversed).toMatchObject({ ok: true, created: false, id: assoc })
    const other = await jsonRpc(lsb, 'entity_association_create', {
      p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'place', p_object_id: place, p_association: 'observed_at',
    })
    expect(other).toMatchObject({ ok: true, created: true, status: 'pending_investigation' })
    expect(String(other.id)).not.toBe(assoc)
  })

  it('#3 a record cannot be associated with itself', async () => {
    const out = await jsonRpc(lsb, 'entity_association_create', {
      p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'gang', p_object_id: gangA, p_association: 'alliance',
    })
    expect(out).toMatchObject({ ok: false, code: 'bad_request' })
  })

  /* ============ #4–#5 the table is read-only; the reader resolves both ends ============ */

  it('#4 entity_associations refuses every direct client write', async () => {
    const ins = await lsb.from('entity_associations').insert({
      subject_kind: 'gang', subject_id: gangA, object_kind: 'place', object_id: place, association: 'controls', status: 'confirmed',
    })
    expect(ins.error?.code, 'insert should be refused').toBe('42501')
    const upd = await lsb.from('entity_associations').update({ status: 'confirmed' }).eq('id', assoc)
    expect(upd.error?.code, 'update should be refused').toBe('42501')
    const del = await lsb.from('entity_associations').delete().eq('id', assoc)
    expect(del.error?.code, 'delete should be refused').toBe('42501')
    expect((await assocRow(lsb, assoc))!.status).toBe('pending_investigation')
  })

  it('#5 entity_associations_for resolves the far side both ways and names the submitter', async () => {
    const fwd = await lsb.rpc('entity_associations_for', { p_kind: 'gang', p_id: gangA })
    expect(fwd.error, fwd.error?.message).toBeNull()
    const mine = (fwd.data as Json[]).find((r) => r.id === assoc)
    expect(mine, 'the association is listed on the subject').toBeTruthy()
    expect(mine).toMatchObject({ direction: 'subject', other_kind: 'gang', other_id: gangB, association: 'unconfirmed_association', status: 'pending_investigation' })
    expect(String(mine!.other_label)).toContain('Bravo MC')
    // The submitter is a person who reported something, not an assignment.
    expect(mine!.created_by).toBe(ids.lsb)
    expect(String(mine!.created_by_name ?? '')).not.toBe('')
    const back = await lsb.rpc('entity_associations_for', { p_kind: 'gang', p_id: gangB })
    expect(back.error, back.error?.message).toBeNull()
    const theirs = (back.data as Json[]).find((r) => r.id === assoc)
    expect(theirs).toMatchObject({ direction: 'object', other_kind: 'gang', other_id: gangA })
    expect(String(theirs!.other_label)).toContain('Alpha Cartel')
  })

  /* ============ #6–#8 ruling on it ============ */

  it('#6 decide validates, records the decision, and reopening clears it', async () => {
    expect(await jsonRpc(lsb, 'entity_association_decide', { p_id: assoc, p_status: 'confirmed' }))
      .toMatchObject({ ok: false, code: 'bad_request' })
    expect(await jsonRpc(lsb, 'entity_association_decide', { p_id: assoc, p_status: 'rejected' }))
      .toMatchObject({ ok: false, code: 'bad_request' })
    expect(await jsonRpc(lsb, 'entity_association_decide', { p_id: assoc, p_status: 'allies', p_note: 'x' }))
      .toMatchObject({ ok: false, code: 'bad_value' })

    const done = await jsonRpc(lsb, 'entity_association_decide', {
      p_id: assoc, p_status: 'confirmed', p_note: 'surveillance corroborated the shared yard',
      p_association: 'business_relationship', p_confidence: 'probable',
    })
    expect(done).toMatchObject({ ok: true, status: 'confirmed' })
    const ruled = await assocRow(lsb, assoc)
    expect(ruled).toMatchObject({ status: 'confirmed', association: 'business_relationship', confidence: 'probable', decided_by: ids.lsb })
    expect(ruled!.decided_at).not.toBeNull()
    expect(ruled!.last_confirmed).not.toBeNull()

    const reopened = await jsonRpc(lsb, 'entity_association_decide', { p_id: assoc, p_status: 'pending_investigation' })
    expect(reopened).toMatchObject({ ok: true, status: 'pending_investigation' })
    const back = await assocRow(lsb, assoc)
    expect(back!.decided_by).toBeNull()
    expect(back!.decided_at).toBeNull()
  })

  it('#7 update amends only the descriptive fields, and only for the author or command', async () => {
    expect(await jsonRpc(lsb, 'entity_association_update', { p_id: assoc, p_patch: { status: 'confirmed' } }))
      .toMatchObject({ ok: false, code: 'bad_request' })
    expect(await jsonRpc(lsb, 'entity_association_update', { p_id: assoc, p_patch: { association: 'alliance' } }))
      .toMatchObject({ ok: false, code: 'bad_request' })
    expect(await jsonRpc(lsb, 'entity_association_update', { p_id: assoc, p_patch: { note: `${stamp} amended` } }))
      .toMatchObject({ ok: true })
    expect((await assocRow(lsb, assoc))!.note).toBe(`${stamp} amended`)
    // command may amend on the author's behalf
    expect(await jsonRpc(lead, 'entity_association_update', { p_id: assoc, p_patch: { confidence: 'possible' } }))
      .toMatchObject({ ok: true })
    // a second member who is neither the author nor command may not
    await expectP0403(bcb, 'entity_association_update', { p_id: assoc, p_patch: { note: 'not mine' } })
  })

  it('#8 a second member who can see both records may read and rule on it, but not withdraw it', async () => {
    const seen = await assocRow(bcb, assoc)
    expect(seen, 'a registry association is visible to any active member who can see both records').toBeTruthy()
    const ruled = await jsonRpc(bcb, 'entity_association_decide', { p_id: assoc, p_status: 'rejected', p_note: 'the branding was a mural, not a claim of presence' })
    expect(ruled).toMatchObject({ ok: true, status: 'rejected' })
    const withdrawn = await jsonRpc(bcb, 'soft_delete', { p_kind: 'entity_association', p_id: assoc, p_reason: 'not mine to withdraw' })
    expect(withdrawn).toMatchObject({ ok: false, code: 'denied' })
    expect((await assocRow(bcb, assoc))!.deleted_at).toBeNull()
    // put it back for the Trash leg
    await jsonRpc(lsb, 'entity_association_decide', { p_id: assoc, p_status: 'pending_investigation' })
  })

  /* ============ #9 the Trash ============ */

  it('#9 the author withdraws it, the Trash lists it by its claim, and a restore brings it back', async () => {
    const gone = await jsonRpc(lsb, 'soft_delete', { p_kind: 'entity_association', p_id: assoc, p_reason: `${stamp} recorded in error` })
    expect(gone, JSON.stringify(gone)).toMatchObject({ ok: true, kind: 'entity_association' })
    expect(await assocRow(lsb, assoc), 'a withdrawn association leaves the live reader').toBeNull()

    const trash = await lsb.rpc('trash_list', { p_kind: 'entity_association', p_limit: 50 })
    expect(trash.error, trash.error?.message).toBeNull()
    const item = (trash.data as Json[]).find((r) => r.id === assoc)
    expect(item, 'the withdrawn association is in the Trash').toBeTruthy()
    expect(String(item!.label)).toMatch(/^association:/)
    expect(item!.restorable).toBe(true)

    const back = await jsonRpc(lsb, 'restore_record', { p_kind: 'entity_association', p_id: assoc })
    expect(back).toMatchObject({ ok: true, kind: 'entity_association' })
    expect(await assocRow(lsb, assoc)).toBeTruthy()
  })

  /* ============ #10–#11 registry media is not evidence ============ */

  it('#10 registry_media_attach reserves a row and a path under the record, adds rather than replaces, and validates the kind', async () => {
    const out = await jsonRpc(lsb, 'registry_media_attach', {
      p_kind: 'gang', p_entity_id: gangA, p_title: `${stamp} territorial graffiti`,
      p_filename: 'Alpha Tag.PNG', p_mime: 'image/png', p_byte_size: 51_200,
      p_category: 'scene', p_caption: 'purple ALPHA graffiti',
    })
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, bucket: 'case-evidence' })
    mediaId = String(out.media_id)
    mediaPath = String(out.storage_path)
    // The path names the record, then the row — the two ids the storage policy binds.
    expect(mediaPath).toBe(`registry/gang/${gangA}/${mediaId}/alpha-tag.png`)

    const m = await lsb.from('media').select('*').eq('id', mediaId).single()
    expect(m.error, m.error?.message).toBeNull()
    expect(m.data).toMatchObject({ gang_id: gangA, case_id: null, uploaded_by: ids.lsb, kind: 'registry_intel', storage_path: mediaPath, mime: 'image/png' })
    // Registry intelligence is NOT case evidence: no series number, no hash,
    // no integrity status, no custodian, no seal.
    for (const col of ['evidence_number', 'sha256', 'integrity_status', 'current_custodian', 'sealed_at', 'external_url']) {
      expect(m.data![col], `${col} must be empty on registry media`).toBeNull()
    }

    // "Do not overwrite existing records" — a second attachment is a second row.
    const second = await jsonRpc(lsb, 'registry_media_attach', {
      p_kind: 'gang', p_entity_id: gangA, p_title: `${stamp} second view`, p_filename: 'alpha2.png', p_mime: 'image/png',
    })
    expect(second).toMatchObject({ ok: true })
    expect(String(second.media_id)).not.toBe(mediaId)
    const all = await lsb.from('media').select('id').eq('gang_id', gangA).eq('kind', 'registry_intel')
    expect(all.error, all.error?.message).toBeNull()
    expect(all.data!.length).toBe(2)

    expect(await jsonRpc(lsb, 'registry_media_attach', { p_kind: 'case', p_entity_id: gangA, p_title: 't', p_filename: 'a.png' }))
      .toMatchObject({ ok: false, code: 'bad_request' })
    expect(await jsonRpc(lsb, 'registry_media_attach', { p_kind: 'gang', p_entity_id: gangA, p_title: '   ', p_filename: 'a.png' }))
      .toMatchObject({ ok: false, code: 'bad_request' })
  })

  it('#11 a registry photograph cannot be laundered into the evidence series', async () => {
    const r = await lsb.rpc('evidence_register', {
      p_media: mediaId, p_sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      p_byte_size: 3, p_mime: 'image/png', p_original_filename: 'alpha-tag.png',
    })
    // Either style of refusal is acceptable; silently minting an EV number is not.
    if (r.error) expect(r.error.code).toBe('P0403')
    else expect(r.data as Json).toMatchObject({ ok: false })
    const m = await lsb.from('media').select('evidence_number, integrity_status').eq('id', mediaId).single()
    expect(m.error, m.error?.message).toBeNull()
    expect(m.data!.evidence_number).toBeNull()
    expect(m.data!.integrity_status).toBeNull()
  })

  /* ============ #12–#13 the PART 5 review fixes ============ */

  it('#12 neither an association nor a photograph may name a record that does not exist', async () => {
    const ghost = randomUUID()
    // perm_registry_visible would pass a uuid that names nothing (it never
    // reads the table for the SIU-walled kinds); registry_exists is the half
    // that was missing. The refusal must not distinguish "hidden" from "gone".
    await expectP0403(lsb, 'entity_association_create', {
      p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'gang', p_object_id: ghost, p_association: 'alliance',
    })
    await expectP0403(lsb, 'entity_association_create', {
      p_subject_kind: 'gang', p_subject_id: ghost, p_object_kind: 'place', p_object_id: place, p_association: 'observed_at',
    })
    await expectP0403(lsb, 'registry_media_attach', { p_kind: 'gang', p_entity_id: ghost, p_title: 'x', p_filename: 'x.png' })
    const stray = await lsb.from('entity_associations').select('id').or(`subject_id.eq.${ghost},object_id.eq.${ghost}`)
    expect(stray.error, stray.error?.message).toBeNull()
    expect(stray.data).toHaveLength(0)
  })

  it('#13 an unknown vocabulary value and a malformed date come back as bad_value, never as a Postgres error', async () => {
    const cases: [string, Json][] = [
      ['record kind', { p_subject_kind: 'band', p_subject_id: gangA, p_object_kind: 'gang', p_object_id: gangB, p_association: 'alliance' }],
      ['association', { p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'gang', p_object_id: gangB, p_association: 'allies' }],
      ['confidence', { p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'gang', p_object_id: gangB, p_association: 'alliance', p_confidence: 'certain' }],
      ['source type', { p_subject_kind: 'gang', p_subject_id: gangA, p_object_kind: 'gang', p_object_id: gangB, p_association: 'alliance', p_source_type: 'rumour' }],
    ]
    for (const [label, args] of cases) {
      const out = await jsonRpc(lsb, 'entity_association_create', args)
      expect(out, `${label}: ${JSON.stringify(out)}`).toMatchObject({ ok: false, code: 'bad_value' })
    }
    expect(await jsonRpc(lsb, 'entity_association_decide', { p_id: assoc, p_status: 'confirmed', p_note: 'x', p_association: 'allies' }))
      .toMatchObject({ ok: false, code: 'bad_value' })
    expect(await jsonRpc(lsb, 'entity_association_update', { p_id: assoc, p_patch: { confidence: 'certain' } }))
      .toMatchObject({ ok: false, code: 'bad_value' })
    expect(await jsonRpc(lsb, 'entity_association_update', { p_id: assoc, p_patch: { first_observed: 'not-a-date' } }))
      .toMatchObject({ ok: false, code: 'bad_value' })
    // none of the refusals wrote anything
    expect((await assocRow(lsb, assoc))!.status).toBe('pending_investigation')
  })
})

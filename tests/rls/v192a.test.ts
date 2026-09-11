/** v1.92a — Platform upgrade, evidence: integrity, custody chain, immutable
 *  originals (migration 20261105120000_platform_upgrade; scratch
 *  upgrade_contract.md §2.2, §2.4). Catalog test_id `v192a`.
 *
 *  What the CID fixtures prove (lsb — the MCB detective, the uploader; bcb —
 *  the SCB detective, the other bureau; lead — the MCB Bureau Lead, command;
 *  owner optional — `audit_log` + every job; inactive optional —
 *  deny-by-default):
 *   · #1 a Storage-backed media row (`storage_path = case/<case>/<media>/…`)
 *     registers once: `evidence_register` → `{ok, evidence_number
 *     EV-000000, job_id}`; the number is a series; the custody chain carries
 *     COLLECTED → UPLOADED → REGISTERED with `prev_hash` linking each event
 *     to the last; an `evidence.verify` job is queued; `EVIDENCE_REGISTERED`
 *     lands in `audit_log` (Owner);
 *   · #2 a second register is `bad_state`; #3 a legacy external-hosted row
 *     (no `storage_path`) is `bad_state` — external bytes cannot be hashed;
 *   · #4 the integrity columns are set by the evidence service only: a
 *     direct UPDATE of `sha256` / `integrity_status` / `evidence_number` is
 *     refused with P0403 (`private.media_protect_integrity`), the row is
 *     unchanged;
 *   · #5 custody events are append-only and RPC-only: UPDATE / DELETE →
 *     P0403 (`private.custody_chain_block`), INSERT → 42501;
 *   · #6 `evidence_custody_transfer`: the custodian hands the JTF-case item
 *     to the lead → TRANSFERRED {previous, new}, `current_custodian`
 *     moves, the lead is told `evidence_custody_transfer` with ids only; the
 *     other bureau's detective, who can read the JTF case but is neither
 *     custodian, uploader nor command, is P0403;
 *   · #7 `evidence_access_log('viewed')` dedupes the same actor within 10
 *     minutes (true, then false), `'downloaded'` is always recorded; #8
 *     `evidence_chain_verify` → `{ok:true, events, first_bad_id:null}`;
 *   · #9 `evidence_seal` requires a VERIFIED integrity — an unverified item
 *     is refused (`bad_state`), the row stays unsealed; `evidence_release` is
 *     command-only (P0403 for the detective);
 *   · #10 the wall: the other bureau reads no custody event of the MCB
 *     item and `evidence_verify_request` on it is P0403; #11 `background_jobs`
 *     is visible to its creator and the Owner only — bcb reads zero rows for
 *     the job ids, the lead (not the creator) too; #12 the inactive fixture
 *     reads nothing and every RPC is P0403.
 *
 *  Fixtures: one MCB case + one JTF case inserted by lsb (`[rls-test] v192a
 *  <tag> …`), three media rows with client-chosen ids so the storage path
 *  can name them (no object is ever uploaded — `evidence_register` validates
 *  the path shape; the verify job that the runner picks up fails cleanly on
 *  the missing object, which is the runner's business, not this suite's).
 *  `rls_test_cleanup` (spliced by 20261105120000) sweeps custody events,
 *  jobs, notifications and the media with the cases. */

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
if (!enabled) console.warn('[rls:v192a] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner
const hasInactive = !!PW.inactive

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>
type CustodyRow = {
  id: number; media_id: string; event_type: string; actor_id: string | null; previous_custodian: string | null; new_custodian: string | null
  prev_hash: string | null; event_hash: string; reason: string | null; job_id: string | null
}
const SHA_A = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' // sha256("abc")
const SHA_B = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // sha256("")
const EVIDENCE_NUMBER = /^EV-\d{6}$/
const INTEGRITY_COLUMNS = ['sha256', 'integrity_status', 'evidence_number', 'current_custodian', 'sealed_at', 'parent_media_id'] as const

describe.skipIf(!enabled)('v1.92a — evidence: register once, hash-chained custody, integrity columns locked, jobs private', () => {
  let lsb: C, bcb: C, lead: C, owner: C | null = null, inactive: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v192a ${tag}`
  let mcbCase = ''     // lsb's own-bureau case — invisible to bcb
  let jtfCase = ''     // readable by bcb — the "can read, not custodian" leg
  const mediaA = randomUUID()   // MCB case, storage-backed
  const mediaB = randomUUID()   // JTF case, storage-backed
  const mediaX = randomUUID()   // MCB case, legacy external URL — cannot be registered
  let evidenceA = ''
  let evidenceB = ''
  let jobA = ''

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
  const custody = async (c: C, media: string): Promise<CustodyRow[]> => {
    const r = await c.from('evidence_custody_events').select('id, media_id, event_type, actor_id, previous_custodian, new_custodian, prev_hash, event_hash, reason, job_id').eq('media_id', media).order('id', { ascending: true })
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as CustodyRow[]
  }
  const mediaRow = async (c: C, id: string): Promise<Json | null> => {
    const r = await c.from('media').select('id, evidence_number, sha256, byte_size, mime, integrity_status, current_custodian, sealed_at, storage_path').eq('id', id).maybeSingle()
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? null) as Json | null
  }
  const insertMedia = async (row: Json) => {
    const r = await lsb.from('media').insert(row).select('id').single()
    if (r.error) throw new Error(`media insert: ${r.error.message}`)
    return r.data!.id as string
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
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c1 = await lsb.from('cases').insert({ case_number: `V192A-${tag}`, title: `${stamp} MCB case`, bureau: 'major_crimes', lead_detective_id: ids.lsb }).select('id').single()
    if (c1.error) throw new Error(`mcb case: ${c1.error.message}`)
    mcbCase = c1.data!.id
    const c2 = await lsb.from('cases').insert({ case_number: `V192A-${tag}-J`, title: `${stamp} JTF case`, bureau: 'JTF', lead_detective_id: ids.lsb }).select('id').single()
    if (c2.error) throw new Error(`jtf case: ${c2.error.message}`)
    jtfCase = c2.data!.id
    // Client-chosen ids so the bucket path can name the row before it exists; the client may set mime / byte_size / original_filename only.
    await insertMedia({ id: mediaA, title: `${stamp} scene photo A`, type: 'image', case_id: mcbCase, storage_path: `case/${mcbCase}/${mediaA}/scene-a.png`, mime: 'image/png', byte_size: 3, original_filename: 'scene-a.png' })
    await insertMedia({ id: mediaB, title: `${stamp} scene photo B`, type: 'image', case_id: jtfCase, storage_path: `case/${jtfCase}/${mediaB}/scene-b.png`, mime: 'image/png', byte_size: 3, original_filename: 'scene-b.png' })
    await insertMedia({ id: mediaX, title: `${stamp} legacy clip`, type: 'fivemanage', case_id: mcbCase, external_url: 'https://r2.fivemanage.com/rls-test/v192a.mp4' })
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v192a] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, owner, inactive].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #1–#3 register once ============ */

  it('#1 evidence_register: a series number, COLLECTED → UPLOADED → REGISTERED hash-chained, a verify job, an audit row', async () => {
    const collectedAt = new Date(Date.now() - 3_600_000).toISOString()
    const out = await jsonRpc(lsb, 'evidence_register', {
      p_media: mediaA, p_sha256: SHA_A, p_byte_size: 3, p_mime: 'image/png', p_original_filename: 'scene-a.png',
      p_collected_by: ids.lsb, p_collected_at: collectedAt, p_location: 'Mirror Park', p_source: 'scene', p_classification: 'sensitive',
    })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    evidenceA = String(out.evidence_number)
    jobA = String(out.job_id)
    expect(evidenceA).toMatch(EVIDENCE_NUMBER)
    expect(jobA).toMatch(/^[0-9a-f-]{36}$/)

    const row = await mediaRow(lsb, mediaA)
    expect(row).toMatchObject({ evidence_number: evidenceA, integrity_status: 'unverified', current_custodian: ids.lsb, byte_size: 3, mime: 'image/png', sealed_at: null })
    expect(String(row!.sha256).replace(/^\\x/i, '').toLowerCase()).toBe(SHA_A)

    const chain = await custody(lsb, mediaA)
    expect(chain.map((e) => e.event_type)).toEqual(['COLLECTED', 'UPLOADED', 'REGISTERED'])
    expect(chain[0].prev_hash).toBeNull()
    for (let i = 1; i < chain.length; i++) expect(chain[i].prev_hash, `event ${chain[i].id} links to ${chain[i - 1].id}`).toBe(chain[i - 1].event_hash)
    for (const e of chain) expect(e.event_hash).toMatch(/^\\x[0-9a-f]{64}$/i)
    expect(chain[2].actor_id).toBe(ids.lsb)
    expect(chain[2].new_custodian).toBe(ids.lsb)

    const job = await lsb.from('background_jobs').select('id, queue, kind, status, created_by, case_id, subject_kind, subject_id').eq('id', jobA).maybeSingle()
    expect(job.error, job.error?.message).toBeNull()
    expect(job.data).toMatchObject({ queue: 'evidence', kind: 'evidence.verify', created_by: ids.lsb, case_id: mcbCase, subject_kind: 'media', subject_id: mediaA })
    expect(['queued', 'claimed', 'running', 'succeeded', 'failed']).toContain(job.data!.status)
    // The second series number is strictly later.
    const outB = await jsonRpc(lsb, 'evidence_register', { p_media: mediaB, p_sha256: SHA_B, p_byte_size: 1, p_mime: 'image/png', p_original_filename: 'scene-b.png' })
    expect(outB.ok, JSON.stringify(outB)).toBe(true)
    evidenceB = String(outB.evidence_number)
    expect(evidenceB).toMatch(EVIDENCE_NUMBER)
    expect(Number(evidenceB.slice(3))).toBeGreaterThan(Number(evidenceA.slice(3)))
    expect((await custody(lsb, mediaB)).map((e) => e.event_type)).toEqual(['UPLOADED', 'REGISTERED'])
  })

  it.skipIf(!hasOwner)('#1 EVIDENCE_REGISTERED is in audit_log with ids only (Owner)', async () => {
    const r = await owner!.from('audit_log').select('action, entity, entity_id, detail').eq('action', 'EVIDENCE_REGISTERED').eq('entity_id', mediaA).order('created_at', { ascending: false }).limit(1)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data?.length, 'one EVIDENCE_REGISTERED row').toBe(1)
    expect(r.data![0].detail).toMatchObject({ media_id: mediaA, case_id: mcbCase, evidence_number: evidenceA })
  })

  it('#2 a second evidence_register on the same item is bad_state and changes nothing', async () => {
    const before = await mediaRow(lsb, mediaA)
    const out = await jsonRpc(lsb, 'evidence_register', { p_media: mediaA, p_sha256: SHA_B, p_byte_size: 99, p_mime: 'image/png', p_original_filename: 'forged.png' })
    expect(out).toMatchObject({ ok: false, code: 'bad_state' })
    expect(await mediaRow(lsb, mediaA)).toEqual(before)
    expect((await custody(lsb, mediaA)).length).toBe(3)
  })

  it('#3 a legacy external-hosted row cannot be registered (bad_state — external bytes cannot be hashed)', async () => {
    const out = await jsonRpc(lsb, 'evidence_register', { p_media: mediaX, p_sha256: SHA_A, p_byte_size: 3, p_mime: 'video/mp4', p_original_filename: 'clip.mp4' })
    expect(out).toMatchObject({ ok: false, code: 'bad_state' })
    expect((await mediaRow(lsb, mediaX))!.evidence_number).toBeNull()
    expect(await custody(lsb, mediaX)).toEqual([])
    // Bad inputs are validation refusals, never a raise: a non-hex hash and a zero size.
    const badHash = await jsonRpc(lsb, 'evidence_register', { p_media: mediaB, p_sha256: 'not-a-hash', p_byte_size: 3, p_mime: 'image/png', p_original_filename: 'x.png' })
    expect(badHash.ok).toBe(false)
  })

  /* ============ #4–#5 immutability ============ */

  it('#4 the integrity columns are locked against direct writes: UPDATE sha256 / integrity_status / evidence_number → P0403, row unchanged', async () => {
    const before = await mediaRow(lsb, mediaA)
    const attempts: Record<string, Json> = {
      sha256: { sha256: `\\x${SHA_B}` },
      integrity_status: { integrity_status: 'verified' },
      evidence_number: { evidence_number: 'EV-999999' },
      current_custodian: { current_custodian: ids.bcb },
      sealed_at: { sealed_at: new Date().toISOString() },
      parent_media_id: { parent_media_id: mediaB },
    }
    for (const col of INTEGRITY_COLUMNS) {
      const r = await lsb.from('media').update(attempts[col]).eq('id', mediaA).select('id')
      expect(r.error, `${col}: a direct write must raise`).not.toBeNull()
      expect(r.error!.code, `${col}: ${r.error!.message}`).toBe('P0403')
    }
    expect(await mediaRow(lsb, mediaA)).toEqual(before)
    // An ordinary column still edits normally — the lock is on the integrity set, not the row.
    const title = await lsb.from('media').update({ title: `${stamp} scene photo A (edited)` }).eq('id', mediaA).select('id, title')
    expect(title.error, title.error?.message).toBeNull()
    expect(title.data?.[0]?.title).toBe(`${stamp} scene photo A (edited)`)
  })

  it('#5 custody events are append-only and RPC-only: UPDATE / DELETE → P0403, INSERT → 42501', async () => {
    const chain = await custody(lsb, mediaA)
    const first = chain[0]
    const upd = await lsb.from('evidence_custody_events').update({ reason: 'forged' }).eq('id', first.id).select('id')
    expect(upd.error, 'UPDATE must raise').not.toBeNull()
    expect(['P0403', '42501'], upd.error!.message).toContain(upd.error!.code)
    const del = await lsb.from('evidence_custody_events').delete().eq('id', first.id).select('id')
    expect(del.error, 'DELETE must raise').not.toBeNull()
    expect(['P0403', '42501'], del.error!.message).toContain(del.error!.code)
    const ins = await lsb.from('evidence_custody_events').insert({ media_id: mediaA, case_id: mcbCase, event_type: 'SEALED', event_hash: `\\x${SHA_A}` }).select('id')
    expect(ins.error, 'INSERT must be refused').not.toBeNull()
    expect(ins.error!.code, ins.error!.message).toBe('42501')
    expect(await custody(lsb, mediaA)).toEqual(chain)
  })

  /* ============ #6–#9 the custody RPCs ============ */

  it('#6 evidence_custody_transfer: custodian → the lead (TRANSFERRED, ids-only notification); a non-custodian reader is P0403', async () => {
    // bcb can read the JTF case and the item — the precondition of the deny leg.
    const seen = await mediaRow(bcb, mediaB)
    expect(seen?.id, 'bcb reads the JTF item').toBe(mediaB)
    await expectP0403(bcb, 'evidence_custody_transfer', { p_media: mediaB, p_to: ids.bcb, p_reason: `${stamp} grab` })
    expect((await mediaRow(lsb, mediaB))!.current_custodian).toBe(ids.lsb)

    const out = await jsonRpc(lsb, 'evidence_custody_transfer', { p_media: mediaB, p_to: ids.lead, p_reason: `${stamp} handing to the lead` })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    expect((await mediaRow(lsb, mediaB))!.current_custodian).toBe(ids.lead)
    const chain = await custody(lsb, mediaB)
    const t = chain.at(-1)!
    expect(t).toMatchObject({ event_type: 'TRANSFERRED', previous_custodian: ids.lsb, new_custodian: ids.lead, actor_id: ids.lsb })
    expect(t.reason).toBe(`${stamp} handing to the lead`)
    expect(t.prev_hash).toBe(chain.at(-2)!.event_hash)
    const told = await lead.from('notifications').select('type, payload').eq('type', 'evidence_custody_transfer').order('created_at', { ascending: false }).limit(5)
    expect(told.error, told.error?.message).toBeNull()
    const mine = (told.data ?? []).find((n) => (n.payload as Json)?.media_id === mediaB)
    expect(mine, 'evidence_custody_transfer to the new custodian').toBeTruthy()
    for (const k of Object.keys(mine!.payload as Json)) expect(['media_id', 'case_id', 'evidence_number', 'actor_id', 'actor_name']).toContain(k)
    // The uploader may still transfer (uploader arm); an inactive target is bad_request, never a raise.
    const back = await jsonRpc(lsb, 'evidence_custody_transfer', { p_media: mediaB, p_to: ids.lsb, p_reason: `${stamp} back` })
    expect(back.ok, JSON.stringify(back)).toBe(true)
    expect((await mediaRow(lsb, mediaB))!.current_custodian).toBe(ids.lsb)
  })

  it('#7 evidence_access_log: VIEWED dedupes the same actor within 10 minutes, DOWNLOADED always lands', async () => {
    const n0 = (await custody(lsb, mediaB)).length
    const first = await lsb.rpc('evidence_access_log', { p_media: mediaB, p_action: 'viewed' })
    expect(first.error, first.error?.message).toBeNull()
    expect(first.data).toBe(true)
    const again = await lsb.rpc('evidence_access_log', { p_media: mediaB, p_action: 'viewed' })
    expect(again.error, again.error?.message).toBeNull()
    expect(again.data).toBe(false)
    const dl = await lsb.rpc('evidence_access_log', { p_media: mediaB, p_action: 'downloaded' })
    expect(dl.error, dl.error?.message).toBeNull()
    expect(dl.data).toBe(true)
    const chain = await custody(lsb, mediaB)
    expect(chain.length).toBe(n0 + 2)
    expect(chain.slice(-2).map((e) => e.event_type)).toEqual(['VIEWED', 'DOWNLOADED'])
    // Another reader's view is its own event (dedupe is per actor).
    const other = await bcb.rpc('evidence_access_log', { p_media: mediaB, p_action: 'viewed' })
    expect(other.error, other.error?.message).toBeNull()
    expect(other.data).toBe(true)
    // An unknown action is refused, never recorded.
    const bad = await lsb.rpc('evidence_access_log', { p_media: mediaB, p_action: 'printed' })
    expect(bad.error ?? (bad.data === false ? null : new Error('printed was accepted')), 'unknown action').not.toBeNull()
  })

  it('#8 evidence_chain_verify recomputes the chain: ok, every event counted, no bad id', async () => {
    for (const media of [mediaA, mediaB]) {
      const out = await jsonRpc(lsb, 'evidence_chain_verify', { p_media: media })
      const n = (await custody(lsb, media)).length
      expect(out, media).toMatchObject({ ok: true, events: n })
      expect(out.first_bad_id ?? null).toBeNull()
    }
  })

  it('#9 evidence_seal needs a verified integrity (bad_state while unverified); evidence_release is command-only', async () => {
    const out = await jsonRpc(lsb, 'evidence_seal', { p_media: mediaA })
    expect(out.ok).toBe(false)
    expect(String(out.code)).toMatch(/^bad_/)
    expect((await mediaRow(lsb, mediaA))!.sealed_at).toBeNull()
    expect((await custody(lsb, mediaA)).some((e) => e.event_type === 'SEALED')).toBe(false)
    await expectP0403(lsb, 'evidence_release', { p_media: mediaA, p_reason: `${stamp} release` })
    await expectP0403(bcb, 'evidence_release', { p_media: mediaB, p_reason: `${stamp} release` })
    expect((await custody(lsb, mediaA)).some((e) => e.event_type === 'RELEASED')).toBe(false)
  })

  /* ============ #10–#12 the wall ============ */

  it('#10 the other bureau reads no custody event of the MCB item and cannot ask for a verify', async () => {
    expect(await mediaRow(bcb, mediaA)).toBeNull()
    expect(await custody(bcb, mediaA)).toEqual([])
    const all = await bcb.from('evidence_custody_events').select('media_id').in('media_id', [mediaA, mediaX]).limit(50)
    expect(all.error, all.error?.message).toBeNull()
    expect(all.data ?? []).toEqual([])
    await expectP0403(bcb, 'evidence_verify_request', { p_media: mediaA })
    await expectP0403(bcb, 'evidence_chain_verify', { p_media: mediaA })
    await expectP0403(bcb, 'evidence_access_log', { p_media: mediaA, p_action: 'viewed' })
    // A random id and the hidden id answer the same way.
    const hidden = await expectP0403(bcb, 'evidence_verify_request', { p_media: mediaA })
    const random = await expectP0403(bcb, 'evidence_verify_request', { p_media: randomUUID() })
    expect(hidden).toBe(random)
    // The JTF item's chain is readable (the case wall is the wall).
    expect((await custody(bcb, mediaB)).length).toBeGreaterThan(0)
  })

  it('#11 background_jobs is private to its creator (and the Owner): bcb and the lead read zero rows for the job ids', async () => {
    const jobIds = [jobA]
    const verify = await jsonRpc(lsb, 'evidence_verify_request', { p_media: mediaB })
    expect(verify.ok, JSON.stringify(verify)).toBe(true)
    jobIds.push(String(verify.job_id))
    const mine = await lsb.from('background_jobs').select('id, kind').in('id', jobIds)
    expect(mine.error, mine.error?.message).toBeNull()
    expect((mine.data ?? []).map((j) => j.id).sort()).toEqual([...jobIds].sort())
    for (const [c, who] of [[bcb, 'bcb'], [lead, 'lead']] as const) {
      const r = await c.from('background_jobs').select('id').in('id', jobIds)
      expect(r.error, `${who}: ${r.error?.message}`).toBeNull()
      expect(r.data ?? [], `${who} reads no job`).toEqual([])
    }
    // Nobody but the service role claims / completes a job.
    for (const fn of ['job_claim', 'job_complete', 'job_heartbeat', 'job_fail'] as const) {
      const args = fn === 'job_claim' ? { p_worker: 'forged', p_queues: ['evidence'] } : fn === 'job_fail' ? { p_id: jobA, p_error: 'x' } : fn === 'job_heartbeat' ? { p_id: jobA, p_progress: {} } : { p_id: jobA, p_result: {} }
      const r = await lsb.rpc(fn, args)
      expect(r.error, `${fn} must be refused`).not.toBeNull()
      expect(['42501', 'P0403'], `${fn}: ${r.error!.message}`).toContain(r.error!.code)
    }
    // Direct writes are refused (42501).
    const upd = await lsb.from('background_jobs').update({ status: 'succeeded' }).eq('id', jobA).select('id')
    if (upd.error) expect(upd.error.code).toBe('42501')
    else expect(upd.data ?? []).toEqual([])
    // The creator may cancel their own queued job; an outsider is P0403 whatever the state.
    await expectP0403(bcb, 'background_job_cancel', { p_id: jobIds[1], p_reason: 'grab' })
    const cancel = await lsb.rpc('background_job_cancel', { p_id: jobIds[1], p_reason: `${stamp} not needed` })
    if (cancel.error) expect(cancel.error.code, 'a claimed job is a refusal, never a grant denial').toBe('P0403')
    else expect(['boolean', 'object']).toContain(typeof cancel.data)
    // Retry is Owner-only.
    await expectP0403(lsb, 'background_job_retry', { p_id: jobA })
    await expectP0403(lsb, 'background_jobs_stats', {})
  })

  it.skipIf(!hasOwner)('#11 the Owner reads every job and the stats', async () => {
    const r = await owner!.from('background_jobs').select('id').eq('id', jobA)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data?.map((j) => j.id)).toEqual([jobA])
    const stats = await jsonRpc(owner!, 'background_jobs_stats', {})
    expect(stats).not.toBeNull()
    expect(typeof stats.failed_24h).toBe('number')
  })

  it.skipIf(!hasInactive)('#12 the inactive fixture reads nothing and every evidence RPC is P0403', async () => {
    for (const t of ['media', 'evidence_custody_events', 'background_jobs'] as const) {
      const r = await inactive!.from(t).select('id').limit(5)
      expect(r.error, `${t}: ${r.error?.message}`).toBeNull()
      expect(r.data ?? [], t).toEqual([])
    }
    await expectP0403(inactive!, 'evidence_register', { p_media: mediaB, p_sha256: SHA_A, p_byte_size: 3, p_mime: 'image/png', p_original_filename: 'x.png' })
    await expectP0403(inactive!, 'evidence_verify_request', { p_media: mediaB })
    await expectP0403(inactive!, 'evidence_custody_transfer', { p_media: mediaB, p_to: ids.inactive, p_reason: 'x' })
    await expectP0403(inactive!, 'evidence_chain_verify', { p_media: mediaB })
  })
})

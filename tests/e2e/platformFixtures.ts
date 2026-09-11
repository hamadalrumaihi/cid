/** Shared fixture helpers for the platform-upgrade E2E specs (evidence,
 *  packets, sources, graph, ci-visibility) — the private helpers of
 *  case-media.spec / informants.spec factored out, nothing new:
 *  authenticated PostgREST inserts / selects, JSON RPC, the crash-safe
 *  `rls_test_cleanup` sweep, the case URL, and "the case workspace is up".
 *
 *  Every row is created by an rls-test-* fixture inside its own case and
 *  swept by `rls_test_cleanup()` (spliced for the platform tables by
 *  20261105120000). No object is ever uploaded to Storage: a media row with
 *  a `storage_path` + `evidence_register` is enough for the integrity /
 *  custody UI, and the runner's verify job failing on the missing object is
 *  the runner's business (the card then shows INTEGRITY FAILURE or
 *  UNVERIFIED — both are asserted as valid states where it matters). */
import { expect, type APIResponse, type Page } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, callRpc, inject, type Live, type LiveAccount } from './liveAuth'
import { grantWithRetry } from './legalFixtures'

export const authHeaders = (live: Live) => ({ apikey: ANON, Authorization: `Bearer ${live.session.access_token}` })

export async function insertRow<T = Record<string, unknown>>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: { ...authHeaders(live), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert ${table} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as T[])[0]
}

export async function selectRows<T = Record<string, unknown>>(live: Live, table: string, query: string): Promise<T[]> {
  const res = await live.ctx.get(`${SUPA_URL}/rest/v1/${table}?${query}`, { headers: authHeaders(live) })
  if (!res.ok()) throw new Error(`select ${table} failed: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T[]
}

/** RPC that must succeed at the HTTP level; the jsonb `{ok:false}` shape is the caller's to read. */
export async function rpcJson<T = Record<string, unknown>>(live: Live, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res: APIResponse = await callRpc(live, fn, args)
  if (!res.ok()) throw new Error(`${fn} failed: ${res.status()} ${await res.text()}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

/** RPC whose HTTP status is part of the assertion (P0403 → 400 with code). */
export async function rpcRaw(live: Live, fn: string, args: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> | unknown[] | null }> {
  const res = await callRpc(live, fn, args)
  const text = await res.text()
  let body: Record<string, unknown> | unknown[] | null = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { status: res.status(), body }
}

export async function sweep(live: Live, who: string, label: string): Promise<void> {
  try {
    const res = await callRpc(live, 'rls_test_cleanup', {})
    if (!res.ok()) console.warn(`[e2e:${label}] cleanup (${who}) failed:`, res.status(), await res.text())
    else console.info(`[e2e:${label}] cleanup (${who}):`, await res.text())
  } catch (e) { console.warn(`[e2e:${label}] cleanup (${who}) threw:`, e) }
}

export async function grantAll<K extends string>(accounts: Record<K, LiveAccount>): Promise<Record<K, Live>> {
  const out = {} as Record<K, Live>
  for (const key of Object.keys(accounts) as K[]) out[key] = await grantWithRetry(accounts[key])
  return out
}

export async function disposeAll(lives: Record<string, Live>): Promise<void> {
  await Promise.all(Object.values(lives).map((l) => l.ctx.dispose().catch(() => {})))
}

export const tagOf = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 7).toUpperCase()}`

export const caseUrl = (id: string, tab?: string, extra = '') =>
  `/cases?case=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}${extra}`

/** The shell is up once the persistent brand heading is present (roles.spec idiom). */
export const shellReady = (page: Page) => expect(page.getByRole('heading', { name: /CID Portal/i })).toBeVisible({ timeout: 30_000 })

/** Signed-in page → case URL, wait for the tab strip to mount. */
export async function openCase(page: Page, live: Live, id: string, tab?: string, extra = '') {
  await inject(page, live)
  await page.goto(caseUrl(id, tab, extra))
  await expect(page.getByRole('tablist', { name: 'Case sections' })).toBeVisible({ timeout: 30_000 })
}

export interface CaseFixture { id: string; case_number: string }

/** A case the fixture leads; `bureau` 'JTF' is readable by every active member. */
export async function createCase(live: Live, tag: string, title: string, bureau: 'major_crimes' | 'JTF' = 'JTF'): Promise<CaseFixture> {
  return insertRow<CaseFixture>(live, 'cases', {
    case_number: `E2E-${tag}${bureau === 'JTF' ? '-J' : ''}`, title, bureau, lead_detective_id: live.session.user?.id,
  })
}

/** A Storage-backed media row registered as evidence (no bytes uploaded). */
export async function registerEvidence(live: Live, caseId: string, title: string, opts: { mime?: string; type?: 'image' | 'document'; sha256?: string } = {}): Promise<{ mediaId: string; evidenceNumber: string; jobId: string }> {
  const mediaId = crypto.randomUUID()
  const mime = opts.mime ?? 'image/png'
  const ext = mime === 'application/pdf' ? 'pdf' : 'png'
  const path = `case/${caseId}/${mediaId}/${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${ext}`
  await insertRow(live, 'media', { id: mediaId, title, type: opts.type ?? (mime === 'application/pdf' ? 'document' : 'image'), case_id: caseId, storage_path: path, mime, byte_size: 3, original_filename: `${title}.${ext}` })
  const out = await rpcJson<{ ok: boolean; evidence_number?: string; job_id?: string; code?: string; message?: string }>(live, 'evidence_register', {
    p_media: mediaId, p_sha256: opts.sha256 ?? 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', p_byte_size: 3, p_mime: mime, p_original_filename: `${title}.${ext}`,
  })
  if (!out.ok || !out.evidence_number) throw new Error(`evidence_register refused: ${JSON.stringify(out)}`)
  return { mediaId, evidenceNumber: out.evidence_number, jobId: String(out.job_id) }
}

export { LIVE }

/** Shared live-project fixture pipeline for the report-builder functional
 *  E2E (Portal Improvements Phase 5, `tests/e2e/reports.spec.ts`). Builds one
 *  [rls-test] case per run for the lsb author plus the lead reviewer, reads
 *  the published template catalog the UI renders from, and sweeps everything
 *  through rls_test_cleanup() — the same accounts and cleanup the RLS suite
 *  uses (tests/rls/README.md).
 *
 *  Safety rails (live project):
 *   - rls_test_cleanup() runs FIRST (purges leftovers from crashed runs) and
 *     again in teardown; the case is created by lsb so cleanup owns it;
 *   - crash safety: if any build step throws AFTER sign-in, the same teardown
 *     runs best-effort BEFORE the error is rethrown. */
import { ANON, LIVE, SUPA_URL, callRpc, pwOf, type Live, type LiveAccount } from './liveAuth'
import { grantWithRetry } from './legalFixtures'

export interface TemplateSummary {
  key: string
  name: string
  required: string[]
  reviewRequired: boolean
}

export interface ReportFixtures {
  tag: string
  caseId: string
  caseNumber: string
  /** The published catalog (active templates), in sort order. */
  templates: TemplateSummary[]
  actors: { lsb: Live; lead: Live }
}

export const FIXTURE_ACCOUNTS: LiveAccount[] = [LIVE.lsb, LIVE.lead]
export const fixturesEnabled = (): boolean => !!ANON && FIXTURE_ACCOUNTS.every((a) => !!pwOf(a))

async function insertRow<T = Record<string, unknown>>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert ${table} failed: ${res.status()} ${await res.text()}`)
  const body = (await res.json()) as T[]
  return body[0]
}

async function select<T = Record<string, unknown>>(live: Live, table: string, query: string): Promise<T[]> {
  const res = await live.ctx.get(`${SUPA_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}` },
  })
  if (!res.ok()) throw new Error(`select ${table} failed: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T[]
}

async function sweep(lsb: Live): Promise<void> {
  try {
    const res = await callRpc(lsb, 'rls_test_cleanup', {})
    if (!res.ok()) console.warn('[e2e:reports] cleanup failed:', res.status(), await res.text())
    else console.info('[e2e:reports] cleanup:', await res.text())
  } catch (e) {
    console.warn('[e2e:reports] cleanup threw:', e)
  }
}

const disposeAll = (lives: Live[]) => Promise.all(lives.map((a) => a.ctx.dispose().catch(() => {})))

export async function buildReportFixtures(): Promise<ReportFixtures> {
  const tag = `E2E${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const granted: Live[] = []
  let lsb: Live | null = null
  try {
    lsb = await grantWithRetry(LIVE.lsb)
    granted.push(lsb)
    const lead = await grantWithRetry(LIVE.lead)
    granted.push(lead)

    const pre = await callRpc(lsb, 'rls_test_cleanup', {})
    if (!pre.ok()) throw new Error(`pre-run cleanup failed: ${pre.status()} ${await pre.text()}`)

    const caseRow = await insertRow<{ id: string; case_number: string }>(lsb, 'cases', {
      case_number: `RPT-${tag}`, title: `[rls-test] ${tag} report builder E2E case`, bureau: 'major_crimes',
    })

    // The catalog the Reports tab renders: active templates + their published version.
    type TplRow = { id: string; key: string; name: string; sort_order: number }
    type VerRow = { template_id: string; required: string[]; review_required: boolean }
    const tpls = await select<TplRow>(lsb, 'report_templates', 'select=id,key,name,sort_order&active=eq.true&order=sort_order.asc')
    const vers = await select<VerRow>(lsb, 'report_template_versions', 'select=template_id,required,review_required&status=eq.published')
    const templates: TemplateSummary[] = tpls.flatMap((t) => {
      const v = vers.find((x) => x.template_id === t.id)
      return v ? [{ key: t.key, name: t.name, required: v.required, reviewRequired: v.review_required }] : []
    })
    if (!templates.some((t) => t.key === 'incident_followup')) throw new Error('incident_followup is not published — the Phase 5 seed is missing')

    return { tag, caseId: caseRow.id, caseNumber: caseRow.case_number, templates, actors: { lsb, lead } }
  } catch (err) {
    if (lsb) {
      console.warn('[e2e:reports] fixture build failed — running crash-safety cleanup before rethrow')
      await sweep(lsb)
    }
    await disposeAll(granted)
    throw err
  }
}

export async function teardownReportFixtures(f: ReportFixtures | null): Promise<void> {
  if (!f) return
  await sweep(f.actors.lsb)
  await disposeAll(Object.values(f.actors))
}

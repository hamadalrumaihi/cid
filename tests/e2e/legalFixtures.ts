/** Shared live-project fixture pipeline for the DOJ-redesign functional E2E
 *  and the screenshot harness. Builds a deterministic set of legal requests
 *  through the SAME definer RPCs the RLS suite exercises (create_legal_request,
 *  add_legal_exhibit, submit_legal_request_to_cid, review_legal_request_as_cid,
 *  claim_legal_request_as_judge, decide_legal_request_as_judge,
 *  issue_legal_request) — never direct table writes to workflow columns.
 *
 *  Safety rails (live project):
 *   - rls_test_cleanup() runs FIRST (purges leftovers from crashed runs) and
 *     again in teardown; registry rows (person/vehicle/place) are deleted by
 *     the director fixture per the v122/v128/v136 convention.
 *   - DOJ-stage fixtures (parked / claimed / approved) are built ONLY when the
 *     LSB bureau has no real routing ADA — otherwise CID approval would assign
 *     live work to a real member. `dojAvailable=false` makes those specs skip
 *     with a documented reason instead.
 *   - The adaLsb awareness assignment is SUPPORTING (never routes), so it can
 *     never pull a request away from a real prosecutor. */
import { ANON, LIVE, SUPA_URL, callRpc, grant, pwOf, type Live, type LiveAccount } from './liveAuth'

export interface FixtureRequest {
  id: string
  number: string
  title: string
}

export interface LegalFixtures {
  tag: string
  caseId: string
  caseNumber: string
  personId: string
  personName: string
  vehicleId: string
  vehiclePlate: string
  placeId: string
  placeName: string
  /** Draft search warrant carrying structured vehicle+place targets (never submitted). */
  entityDraft: FixtureRequest
  /** Arrest warrant sitting in cid_supervisor_review. */
  cidReview: FixtureRequest
  /** Arrest warrant returned_by_cid to the lsb creator. */
  returned: FixtureRequest
  /** Parked at DOJ (submitted_to_doj, unassigned) — awareness + claim-lane rendering. */
  parkedAware: FixtureRequest | null
  /** Parked at DOJ — consumed by the judge UI claim flow. */
  parkedClaim: FixtureRequest | null
  /** Judge-claimed → judicially approved → issued search warrant. */
  approved: FixtureRequest | null
  /** False when LSB already has a real routing ADA — DOJ-stage flows skip. */
  dojAvailable: boolean
  /** Why dojAvailable is false (skip reason). */
  dojUnavailableReason: string | null
  actors: {
    lsb: Live
    lead: Live
    director: Live
    da: Live
    judge: Live
    adaLsb: Live
  }
}

/** All fixture passwords this pipeline needs. */
export const FIXTURE_ACCOUNTS: LiveAccount[] = [
  LIVE.lsb, LIVE.lead, LIVE.director, LIVE.da, LIVE.judge, LIVE.adaLsb,
]
export const fixturesEnabled = (): boolean =>
  !!ANON && FIXTURE_ACCOUNTS.every((a) => !!pwOf(a))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Password grant with backoff — several grants in a row can trip GoTrue's
 *  per-IP burst limit (same rationale as tests/rls/auth.ts). */
export async function grantWithRetry(account: LiveAccount, tries = 4): Promise<Live> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await grant(account)
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      if (/invalid login credentials/i.test(msg)) break
      await sleep(1500 * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Authenticated PostgREST INSERT returning the created row. */
async function insertRow<T = Record<string, unknown>>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${live.session.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert ${table} failed: ${res.status()} ${await res.text()}`)
  const body = (await res.json()) as T[]
  return body[0]
}

/** RPC that must succeed — throws with the server message otherwise. */
async function rpcOk<T = Record<string, unknown>>(live: Live, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await callRpc(live, fn, args)
  if (!res.ok()) throw new Error(`${fn} failed: ${res.status()} ${await res.text()}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

type ReqRow = { id: string; request_number: string; title: string; review_status: string; assigned_ada_id: string | null }
const asFixture = (r: ReqRow): FixtureRequest => ({ id: r.id, number: r.request_number, title: r.title })

export async function buildLegalFixtures(): Promise<LegalFixtures> {
  const tag = `E2E${Math.random().toString(36).slice(2, 7).toUpperCase()}`

  // Sequential grants (rate limit).
  const lsb = await grantWithRetry(LIVE.lsb)
  const lead = await grantWithRetry(LIVE.lead)
  const director = await grantWithRetry(LIVE.director)
  const da = await grantWithRetry(LIVE.da)
  const judge = await grantWithRetry(LIVE.judge)
  const adaLsb = await grantWithRetry(LIVE.adaLsb)
  const actors = { lsb, lead, director, da, judge, adaLsb }

  // Purge leftovers from any crashed prior run FIRST — stale bureau
  // assignments would silently reroute the parked fixtures.
  await rpcOk(lsb, 'rls_test_cleanup', {})

  // Registry fixtures (director-deleted in teardown — cleanup never sweeps them).
  const caseRow = await insertRow<{ id: string; case_number: string }>(lsb, 'cases', {
    case_number: `LGL-${tag}`, title: `[rls-test] ${tag} DOJ redesign E2E case`, bureau: 'LSB',
  })
  const person = await insertRow<{ id: string; name: string }>(lsb, 'persons', {
    name: `RLS Test Suspect ${tag}`,
  })
  const vehicle = await insertRow<{ id: string; plate: string }>(lsb, 'vehicles', {
    plate: `E2${tag.slice(3)}`, model: `${tag} sedan`,
  })
  const place = await insertRow<{ id: string; name: string }>(lsb, 'places', {
    name: `[rls-test] ${tag} stash house`, type: 'stash_house',
  })

  // Coverage guard: only build DOJ-stage fixtures when LSB has no live routing
  // ADA (post-cleanup, a covered LSB means a REAL prosecutor would receive the
  // work — never do that from a test).
  let dojAvailable = true
  let dojUnavailableReason: string | null = null
  const coverage = await rpcOk<{ bureau: string; covered: boolean }[]>(da, 'doj_bureau_coverage', {})
  const lsbCov = coverage.find((b) => b.bureau === 'LSB')
  if (lsbCov?.covered) {
    dojAvailable = false
    dojUnavailableReason = 'LSB already has a live routing ADA (real coverage) — DOJ-stage fixtures would assign work to a real member'
  }

  // Awareness lane: adaLsb gets a SUPPORTING LSB assignment (visible bureau,
  // never routes). Swept by rls_test_cleanup (created by a test actor).
  const adaId = adaLsb.session.user?.id
  if (adaId) {
    await rpcOk(da, 'assign_ada_to_bureau', { p_prosecutor: adaId, p_bureau: 'LSB', p_type: 'supporting' })
  }

  const createWarrant = async (subtype: 'arrest_warrant' | 'search_warrant', title: string, opts: {
    person?: boolean
    form?: Record<string, string>
    classification?: string
  } = {}): Promise<ReqRow> =>
    rpcOk<ReqRow>(lsb, 'create_legal_request', {
      p_case: caseRow.id,
      p_request_type: 'warrant',
      p_subtype: subtype,
      p_title: `[rls-test] ${tag} ${title}`,
      p_priority: 'Medium',
      p_narrative: `Probable cause narrative for the ${tag} DOJ-redesign E2E fixture.`,
      ...(opts.person ? { p_person: person.id } : {}),
      ...(opts.form ? { p_form: opts.form } : {}),
      ...(opts.classification ? { p_classification: opts.classification } : {}),
    })

  const submit = (id: string) => rpcOk<ReqRow>(lsb, 'submit_legal_request_to_cid', { p_request: id })
  const attachLink = (id: string) =>
    rpcOk(lsb, 'add_legal_exhibit', { p_request: id, p_type: 'external_link', p_meta: { url: `https://evidence.example/${tag}` } })

  // 1 · entityDraft — structured vehicle+place targets on a DRAFT (safe
  //     regardless of coverage: never submitted, visible to its creator).
  const entityDraftRow = await createWarrant('search_warrant', 'entity-targets draft', {
    form: { search_targets: `Vehicle: ${vehicle.plate}\nPlace: ${place.name}`, items_sought: 'Ledgers and burner phones' },
  })
  await rpcOk(lsb, 'add_legal_exhibit', {
    p_request: entityDraftRow.id, p_type: 'vehicle', p_source_id: vehicle.id,
    p_rationale: 'Seen leaving the scene on both nights.',
  })
  await rpcOk(lsb, 'add_legal_exhibit', {
    p_request: entityDraftRow.id, p_type: 'place', p_source_id: place.id,
    p_rationale: 'Suspected stash location per CI report.',
  })

  // 2 · cidReview — waiting on a CID supervisor. Classification 'standard' so
  //     the supervisor can VIEW it (KNOWN GAP: can_view_legal_request has no
  //     CID-supervisor branch, so a pending 'classified'/'restricted' request
  //     is invisible to the reviewer even though review_legal_request_as_cid
  //     accepts them — reported, not worked around silently).
  const cidReviewRow = await createWarrant('arrest_warrant', 'cid-review warrant', { person: true, classification: 'standard' })
  await attachLink(cidReviewRow.id)
  await submit(cidReviewRow.id)

  // 3 · returned — returned_by_cid to the creator.
  const returnedRow = await createWarrant('arrest_warrant', 'returned warrant', { person: true })
  await attachLink(returnedRow.id)
  await submit(returnedRow.id)
  await rpcOk(lead, 'review_legal_request_as_cid', {
    p_request: returnedRow.id, p_decision: 'return', p_note: 'Tighten the probable-cause statement (E2E fixture).',
  })

  // 4-6 · DOJ-stage fixtures — only with no real LSB coverage.
  let parkedAware: FixtureRequest | null = null
  let parkedClaim: FixtureRequest | null = null
  let approved: FixtureRequest | null = null
  if (dojAvailable) {
    const approve = async (id: string): Promise<ReqRow> =>
      rpcOk<ReqRow>(lead, 'review_legal_request_as_cid', { p_request: id, p_decision: 'approve', p_signature: 'RLS Lead' })

    const mkParked = async (title: string): Promise<ReqRow | null> => {
      const row = await createWarrant('search_warrant', title, {
        form: { search_targets: `Place: ${place.name}`, items_sought: 'Stolen property' },
      })
      await attachLink(row.id)
      await submit(row.id)
      const ap = await approve(row.id)
      if (ap.review_status !== 'submitted_to_doj' || ap.assigned_ada_id) {
        // Routed instead of parking — coverage raced in; stop building DOJ fixtures.
        dojAvailable = false
        dojUnavailableReason = `approval routed to an ADA (${ap.review_status}) instead of parking — live coverage appeared mid-run`
        return null
      }
      return row
    }

    const aware = await mkParked('parked warrant (awareness)')
    parkedAware = aware ? asFixture(aware) : null
    if (dojAvailable) {
      const claim = await mkParked('parked warrant (judge claim)')
      parkedClaim = claim ? asFixture(claim) : null
    }
    if (dojAvailable) {
      const appRow = await mkParked('approved warrant (issued)')
      if (appRow) {
        await rpcOk(judge, 'claim_legal_request_as_judge', { p_request: appRow.id })
        await rpcOk(judge, 'decide_legal_request_as_judge', {
          p_request: appRow.id, p_decision: 'approve', p_note: 'Approved for the E2E fixture.',
          p_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), p_signature: 'RLS Judge',
        })
        await rpcOk(lsb, 'issue_legal_request', { p_request: appRow.id })
        approved = asFixture(appRow)
      }
    }
  }

  return {
    tag,
    caseId: caseRow.id,
    caseNumber: caseRow.case_number,
    personId: person.id,
    personName: person.name,
    vehicleId: vehicle.id,
    vehiclePlate: vehicle.plate,
    placeId: place.id,
    placeName: place.name,
    entityDraft: asFixture(entityDraftRow),
    cidReview: asFixture(cidReviewRow),
    returned: asFixture(returnedRow),
    parkedAware,
    parkedClaim,
    approved,
    dojAvailable,
    dojUnavailableReason,
    actors,
  }
}

/** Cleanup mirror of the RLS suites: rls_test_cleanup sweeps every rls-test
 *  case/request/assignment; the director removes the registry fixtures
 *  (person/vehicle/place) the RPC deliberately never touches. */
export async function teardownLegalFixtures(f: LegalFixtures | null): Promise<void> {
  if (!f) return
  const { lsb, director } = f.actors
  try {
    const res = await callRpc(lsb, 'rls_test_cleanup', {})
    if (!res.ok()) console.warn('[e2e:legal] cleanup failed:', res.status(), await res.text())
    else console.info('[e2e:legal] cleanup:', await res.text())
  } catch (e) {
    console.warn('[e2e:legal] cleanup threw:', e)
  }
  const del = async (table: string, id: string) => {
    const res = await director.ctx.delete(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${director.session.access_token}` },
    })
    if (!res.ok()) console.warn(`[e2e:legal] ${table} fixture delete failed:`, res.status(), await res.text())
  }
  await del('vehicles', f.vehicleId)
  await del('places', f.placeId)
  await del('persons', f.personId)
  await Promise.all(Object.values(f.actors).map((a) => a.ctx.dispose().catch(() => {})))
}

/** Shared live-project fixture pipeline for the legal-workflow functional E2E
 *  and the screenshot harness. Builds a deterministic set of legal requests
 *  through the SAME definer RPCs the RLS suite exercises (create_legal_request,
 *  add_legal_exhibit, submit_legal_request_to_cid, review_legal_request_as_cid,
 *  issue_legal_request) — never direct table writes to workflow columns.
 *
 *  Minimal-DOJ revival (migration 20260816120000_minimal_doj_revival): a
 *  Bureau Lead+ 'approve' via review_legal_request_as_cid is no longer
 *  terminal — it hands the request to the shared PROSECUTOR QUEUE
 *  (review_status='prosecutor_queue'), and reaching 'approved' (and therefore
 *  issue_legal_request) requires an active prosecutor + judge. The CID
 *  fixtures cannot ride that pipeline (justice_appoint refuses is_test
 *  accounts by design), so the furthest deterministic state this builder can
 *  produce is `queuedWarrant` — a warrant sitting in prosecutor_queue with a
 *  frozen cid_approved version. E2E specs that need an ISSUED warrant are
 *  skipped until the DOJ fixture accounts exist (see the provisioning
 *  contract in tests/rls/v163.test.ts).
 *
 *  Safety rails (live project):
 *   - rls_test_cleanup() runs FIRST (purges leftovers from crashed runs) and
 *     again in teardown; registry rows (person/vehicle/place) are deleted by
 *     the director fixture per the v122/v128/v136 convention.
 *   - Crash safety: if any build step throws AFTER sign-in, the same teardown
 *     (rls_test_cleanup + registry deletes for whatever was created) runs
 *     best-effort BEFORE the error is rethrown — a failed build can never
 *     leak [rls-test] rows into the live project. */
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
  /** Search warrant past Bureau Lead approval, sitting in the shared
   *  prosecutor queue (review_status='prosecutor_queue', unissued, with a
   *  frozen cid_approved version). Reaching 'approved'/issued requires the
   *  DOJ fixture accounts — see tests/rls/v163.test.ts. */
  queuedWarrant: FixtureRequest
  actors: {
    lsb: Live
    lead: Live
    director: Live
  }
}

/** All fixture passwords this pipeline needs. */
export const FIXTURE_ACCOUNTS: LiveAccount[] = [LIVE.lsb, LIVE.lead, LIVE.director]
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

type ReqRow = { id: string; request_number: string; title: string; review_status: string }
const asFixture = (r: ReqRow): FixtureRequest => ({ id: r.id, number: r.request_number, title: r.title })

type Actors = LegalFixtures['actors']
type RegistryRow = { table: 'vehicles' | 'places' | 'persons'; id: string }

/** The one cleanup path (shared by teardown AND the crash-safety catch):
 *  rls_test_cleanup sweeps every [rls-test] case/request the RPC covers; the
 *  director removes whichever registry fixtures were actually created. */
async function sweep(actors: Actors, registry: RegistryRow[]): Promise<void> {
  try {
    const res = await callRpc(actors.lsb, 'rls_test_cleanup', {})
    if (!res.ok()) console.warn('[e2e:legal] cleanup failed:', res.status(), await res.text())
    else console.info('[e2e:legal] cleanup:', await res.text())
  } catch (e) {
    console.warn('[e2e:legal] cleanup threw:', e)
  }
  for (const { table, id } of registry) {
    try {
      const res = await actors.director.ctx.delete(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
        headers: { apikey: ANON, Authorization: `Bearer ${actors.director.session.access_token}` },
      })
      if (!res.ok()) console.warn(`[e2e:legal] ${table} fixture delete failed:`, res.status(), await res.text())
    } catch (e) {
      console.warn(`[e2e:legal] ${table} fixture delete threw:`, e)
    }
  }
}

const disposeAll = (lives: Live[]) =>
  Promise.all(lives.map((a) => a.ctx.dispose().catch(() => {})))

export async function buildLegalFixtures(): Promise<LegalFixtures> {
  const tag = `E2E${Math.random().toString(36).slice(2, 7).toUpperCase()}`

  // Crash-safety bookkeeping: everything created so far lives out here so the
  // catch below can tear down partial state before rethrowing.
  const granted: Live[] = []
  let actors: Actors | null = null
  const registry: RegistryRow[] = []

  try {
    // Sequential grants (rate limit).
    const lsb = await grantWithRetry(LIVE.lsb)
    granted.push(lsb)
    const lead = await grantWithRetry(LIVE.lead)
    granted.push(lead)
    const director = await grantWithRetry(LIVE.director)
    granted.push(director)
    actors = { lsb, lead, director }

    // Purge leftovers from any crashed prior run FIRST.
    await rpcOk(lsb, 'rls_test_cleanup', {})

    // Registry fixtures (director-deleted in teardown — cleanup never sweeps them).
    const caseRow = await insertRow<{ id: string; case_number: string }>(lsb, 'cases', {
      case_number: `LGL-${tag}`, title: `[rls-test] ${tag} legal workflow E2E case`, bureau: 'LSB',
    })
    const person = await insertRow<{ id: string; name: string }>(lsb, 'persons', {
      name: `RLS Test Suspect ${tag}`,
    })
    registry.push({ table: 'persons', id: person.id })
    const vehicle = await insertRow<{ id: string; plate: string }>(lsb, 'vehicles', {
      plate: `E2${tag.slice(3)}`, model: `${tag} sedan`,
    })
    registry.push({ table: 'vehicles', id: vehicle.id })
    const place = await insertRow<{ id: string; name: string }>(lsb, 'places', {
      name: `[rls-test] ${tag} stash house`, type: 'stash_house',
    })
    registry.push({ table: 'places', id: place.id })

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
        p_narrative: `Probable cause narrative for the ${tag} legal-workflow E2E fixture.`,
        ...(opts.person ? { p_person: person.id } : {}),
        ...(opts.form ? { p_form: opts.form } : {}),
        ...(opts.classification ? { p_classification: opts.classification } : {}),
      })

    const submit = (id: string) => rpcOk<ReqRow>(lsb, 'submit_legal_request_to_cid', { p_request: id })
    const attachLink = (id: string) =>
      rpcOk(lsb, 'add_legal_exhibit', { p_request: id, p_type: 'external_link', p_meta: { url: `https://evidence.example/${tag}` } })

    // 1 · entityDraft — structured vehicle+place targets on a DRAFT (never
    //     submitted, visible to its creator).
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

    // 2 · cidReview — waiting on the Bureau Lead. Classification 'standard' so
    //     the reviewer can VIEW it (KNOWN GAP: can_view_legal_request has no
    //     reviewer branch for pending 'classified'/'restricted' requests even
    //     though review_legal_request_as_cid accepts them — reported, not
    //     worked around silently).
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

    // 4 · queuedWarrant — the minimal-DOJ CID handoff: submit → Bureau Lead+
    //     approve (review_legal_request_as_cid 'approve') → prosecutor_queue.
    //     Issuance is NOT possible here: review_legal_request_as_cid no longer
    //     terminates at 'approved' (20260816120000_minimal_doj_revival), and
    //     the prosecutor/judge stages need DOJ fixture accounts the build
    //     doesn't have. Fail fast on contract drift either way.
    const queuedRow = await createWarrant('search_warrant', 'queued warrant (prosecutor queue)', {
      form: { search_targets: `Place: ${place.name}`, items_sought: 'Stolen property' },
    })
    await attachLink(queuedRow.id)
    await submit(queuedRow.id)
    const decided = await rpcOk<ReqRow>(lead, 'review_legal_request_as_cid', {
      p_request: queuedRow.id, p_decision: 'approve', p_signature: 'RLS Lead',
    })
    if (decided.review_status !== 'prosecutor_queue') {
      throw new Error(`queuedWarrant fixture: expected review_status 'prosecutor_queue', got '${decided.review_status}'`)
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
      queuedWarrant: asFixture(queuedRow),
      actors,
    }
  } catch (err) {
    // The build failed mid-flight: tear down whatever exists so the crashed
    // run cannot leak [rls-test] rows, then surface the ORIGINAL error.
    if (actors) {
      console.warn('[e2e:legal] fixture build failed — running crash-safety cleanup before rethrow')
      await sweep(actors, registry).catch((e) => console.warn('[e2e:legal] crash-safety cleanup threw:', e))
    }
    await disposeAll(granted)
    throw err
  }
}

/** Cleanup mirror of the RLS suites: rls_test_cleanup sweeps every rls-test
 *  case/request; the director removes the registry fixtures
 *  (person/vehicle/place) the RPC deliberately never touches. */
export async function teardownLegalFixtures(f: LegalFixtures | null): Promise<void> {
  if (!f) return
  await sweep(f.actors, [
    { table: 'vehicles', id: f.vehicleId },
    { table: 'places', id: f.placeId },
    { table: 'persons', id: f.personId },
  ])
  await disposeAll(Object.values(f.actors))
}

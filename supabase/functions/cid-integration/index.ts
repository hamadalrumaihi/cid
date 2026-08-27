// cid-integration — UNDEPLOYED SKELETON of the CID-lane integration surface.
//
// ██ NOT DEPLOYED. DO NOT DEPLOY. ██
// Deploying this function IS the activation step for the CID lane and
// requires its own review (see README.md beside this file and the dormancy
// statement in docs/integration/CID-INTEGRATION-API.md). Until that review:
//   * every handler below returns 501 { error: 'not_activated' };
//   * no secret exists, no source is enabled (integration_sources ships
//     empty with enabled=false default), so there is nothing to authenticate
//     against even if someone deployed it by mistake;
//   * this file makes NO network calls and holds NO credentials, hostnames,
//     or project references.
//
// WHAT THIS FILE IS
// The SHAPE of the contract in docs/integration/CID-INTEGRATION-API.md,
// expressed as code: the operation catalog as a routing table, the
// authentication envelope, and the idempotency envelope — each as a stub
// whose comment names the contract section it implements. The activation
// pass fills the stubs; the shape (op names, envelope fields, error
// vocabulary) is the contract and should not drift from the doc.
//
// AUTH MODEL (contract §"Authentication and identity")
//   1. The city-hosted CID Integration Service authenticates to THIS surface
//      with a shared secret (integration_sources.secret_ref names where that
//      secret lives on the SERVICE host — never in the database, never in a
//      FiveM client resource). Mirror of the sops-sync precedent: if this is
//      ever deployed with verify_jwt disabled, the shared-secret check MUST
//      be active first.
//   2. CID-lane operations execute as the OFFICER: the service exchanges an
//      external_officer_identities mapping for a short-lived per-officer
//      session, and all casework runs under auth.uid() with unchanged RLS.
//   3. service_role is used ONLY for the explicitly granted machine RPCs
//      (bridge_ingest_event today; the future activation RPCs). Raw
//      service-role table writes are FORBIDDEN by contract: the portal's
//      guard triggers are current_user-based and service_role is transparent
//      to them.

/** Stable error vocabulary — contract §"Error vocabulary". Clients branch on
 *  `error`, never on `message`. */
type ErrorCode =
  | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'duplicate'
  | 'validation_failed' | 'rate_limited' | 'internal'

const HTTP: Record<ErrorCode, number> = {
  unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409,
  duplicate: 200, validation_failed: 422, rate_limited: 429, internal: 500,
}

function err(code: ErrorCode, message: string): Response {
  return Response.json({ error: code, message }, { status: HTTP[code] })
}

/** The one response every stub returns while dormant. 501 = "the server does
 *  not support the functionality required" — deliberately outside the
 *  contract's error vocabulary so a misdeployed skeleton is unmistakable. */
function notActivated(): Response {
  return Response.json(
    { error: 'not_activated', message: 'cid-integration is a dormant skeleton; activation requires its own review' },
    { status: 501 },
  )
}

/** Request envelope — contract §"Idempotency rules". Mutating ops MUST carry
 *  externalRequestId; reads carry none. officerId is the CITY identity the
 *  service already authenticated (step 1 above), to be mapped through
 *  external_officer_identities. */
interface Envelope {
  op: string
  source: string                 // e.g. 'fivem-main' — must exist AND be enabled
  officerId?: string             // external officer id (city-side identity)
  externalRequestId?: string     // idempotency key component (mutations only)
  payload?: Record<string, unknown>
}

/* ── Stub: shared-secret + source lookup — contract §"Source identity, ──────
 *    secrets, rotation, rate limits, auditing".
 * Activation shape:
 *   1. Read the x-integration-secret header; constant-time-compare against
 *      the secret named by integration_sources.secret_ref for env.source
 *      (the secret VALUE lives in this function's environment / app_secrets,
 *      NEVER in integration_sources itself).
 *   2. Look up integration_sources: unknown or enabled=false ⇒ unauthorized.
 *   3. Enforce rate_limit_per_min for the source ⇒ rate_limited.
 * Dormant: there is no secret and no enabled source; always not-activated. */
function authenticateSource(_req: Request, _env: Envelope): Response | null {
  return notActivated()
}

/* ── Stub: idempotency envelope — contract §"Idempotency rules". ────────────
 * Activation shape (mutating ops only):
 *   1. Require externalRequestId ⇒ else validation_failed.
 *   2. Probe integration_events on UNIQUE (source, external_event_id):
 *      processed/duplicate ⇒ replay the stored outcome as `duplicate`
 *      (HTTP 200, no second write); failed/retryable ⇒ proceed (legitimate
 *      retry); pending/quarantined ⇒ conflict (in flight / held).
 *   3. Record the attempt with SAFE payload_meta only (sizes, kinds,
 *      external ids, timing) — never raw city payloads.
 * Dormant: no writer exists for integration_events; always not-activated. */
function checkIdempotency(_env: Envelope): Response | null {
  return notActivated()
}

/* ── Per-operation stubs — contract §"Operations catalog". ──────────────────
 * Naming = the catalog's operation names. Each comment states lane, executing
 * identity, and backing per the contract tables; the activation pass replaces
 * bodies without changing names or envelope fields. */
const OPERATIONS: Record<string, (env: Envelope) => Response> = {
  // City-owned reads — identity: service; backing: provider adapters
  // (CitizenProvider / VehicleProvider / PropertyProvider / OfficerProvider /
  // PenalCodeProvider). These never touch the portal database; whether they
  // route through this function or stay entirely city-side is an activation
  // decision — the ops are listed so the routing table equals the catalog.
  'citizens.search':   () => notActivated(),
  'citizens.get':      () => notActivated(),
  'vehicles.search':   () => notActivated(), // normalized-plate semantics
  'vehicles.get':      () => notActivated(),
  'properties.for':    () => notActivated(),
  'properties.get':    () => notActivated(),
  'officers.search':   () => notActivated(),
  'officers.get':      () => notActivated(),
  'penal.search':      () => notActivated(), // the CITY's code, not CID's catalog

  // CID case operations — identity: officer (minted per-officer session,
  // auth.uid() = mapped profile). Backing: shared-service RPCs
  // (case_create / case_set_status / case_set_lead / case_access_decide /
  // case_timeline / report_create) or the portal's own RLS paths.
  'case.create':       () => notActivated(), // shared-service RPC case_create; idempotent
  'case.setStatus':    () => notActivated(), // case_set_status; conflict on illegal transition
  'case.setLead':      () => notActivated(), // case_set_lead
  'case.accessDecide': () => notActivated(), // case_access_decide
  'case.get':          () => notActivated(), // RLS read; not_found includes invisible-by-RLS
  'case.timeline':     () => notActivated(), // case_timeline
  'case.addPerson':    () => notActivated(), // portal RLS write path
  'case.addVehicle':   () => notActivated(), // portal RLS write path
  'case.addCharge':    () => notActivated(), // portal RLS path; ExternalCharge snapshot may ride along
  'task.create':       () => notActivated(), // portal RLS write path
  'report.create':     () => notActivated(), // shared-service RPC report_create; idempotent

  // External references — identity: officer; backing: ACTIVATION RPCs
  // (future) over external_links / external_storage_refs / external_media_refs.
  // Those RPCs do not exist yet; the tables ship RLS-sealed on purpose.
  'evidence.attach':   () => notActivated(),
  'storage.attach':    () => notActivated(),
  'media.attach':      () => notActivated(),

  // Surveillance — identity: service_role (machine); backing: the EXISTING
  // bridge_ingest_event RPC (idempotent on (source, source_event_id),
  // quarantine-not-discard, unverified by default). Deliberately not an
  // officer op — see docs/MDT-BRIDGE-CONTRACT.md §Inbound contract.
  'surveillance.ingest': () => notActivated(),

  // Legal — identity: officer; backing: existing RPCs (create_legal_request,
  // update_legal_draft, submit_legal_request_to_cid/_to_doj,
  // withdraw_legal_request — the portal's legal state machine, unchanged).
  'legal.create':      () => notActivated(),
  'legal.update':      () => notActivated(),

  // FUTURE — documented gaps (contract catalog): no interview model exists,
  // and legal comments ride transition notes today. Routed so the city app
  // gets a stable validation_failed rather than not_found, per the contract.
  'interview.create':  () => err('validation_failed', 'no interview model exists yet (documented gap)'),
  'legal.addComment':  () => err('validation_failed', 'legal comments ride transition notes today (documented gap)'),
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return err('validation_failed', 'POST only')

  let env: Envelope
  try {
    env = await req.json()
  } catch {
    return err('validation_failed', 'body must be a JSON envelope')
  }
  if (!env?.op || typeof env.op !== 'string') return err('validation_failed', 'missing op')

  const handler = OPERATIONS[env.op]
  if (!handler) return err('validation_failed', `unknown op '${env.op}'`)

  // Dormant short-circuits: both stubs return not_activated today, so no
  // request of any shape does anything. On activation they return null on
  // success and an error Response on failure, in this order.
  const authFail = authenticateSource(req, env)
  if (authFail) return authFail
  const idemFail = checkIdempotency(env)
  if (idemFail) return idemFail

  return handler(env)
})

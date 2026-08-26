# CID Integration API — Contract (the CID lane)

**Status: forward-looking. Nothing in this document is live.** The data layer
it builds on shipped dormant (migration `20261002120000_fivem_integration_prep`
— empty registry, RLS-sealed tables, no RPCs, no grants), the TypeScript
contracts live in `src/lib/integration/` (consumed only by unit tests and the
mock adapter), and the edge-function skeleton in
`supabase/functions/cid-integration/` is **not deployed**. Activation is a
separately-reviewed pass; see [Dormancy](#dormancy-statement).

Companion documents:

- [docs/MDT-BRIDGE-CONTRACT.md](../MDT-BRIDGE-CONTRACT.md) — the **patrol
  lane** (unchanged by anything here).
- `integration-package/` — the standalone package a city developer receives
  *without* this repository; it restates the public half of this contract.

## Purpose and the two lanes

The portal will eventually talk to the city (a FiveM server) over exactly two
lanes with deliberately different trust models:

1. **The patrol lane** — machine-to-machine, minimal, sanitized. Outbound:
   `mdt_patrol_feed()` (a nine-column structural allowlist; no case ids, no
   entity FKs, snapshot text only). Inbound: `bridge_ingest_event(...)`
   (surveillance observations, quarantine-not-discard, unverified by
   default). Bookkeeping: `mdt_bridge_ack(...)`. All three are
   service_role-only and fully specified in
   [MDT-BRIDGE-CONTRACT.md](../MDT-BRIDGE-CONTRACT.md). **This lane does not
   change and never widens.** Sensitive CID/SIB data never crosses it — that
   is a structural property of the feed's column list, not a policy request.

2. **The CID lane** (this document) — authenticated, per-officer,
   investigative. An in-city CID app lets a detective who *is* a real portal
   member do real casework from the city: search city records, open cases,
   file reports, attach city-held evidence references. Every operation
   executes as **that officer's own portal identity**, so everything the
   portal already enforces — SIB compartmentalization, sealed records, bureau
   scope, joint-case access, audit attribution — holds automatically and
   identically.

The lanes never mix. A patrol MDT never gains CID reach; the CID lane never
relaxes the patrol feed's allowlist.

## Architecture

```
FiveM client (CID app NUI)          — no secrets, no Supabase access, ever
        │  (in-city RPC/HTTP to the city's own server side)
        ▼
CID Integration Service             — city-hosted, server-side; holds the
        │                             integration credentials; enforces rate
        │                             limits; owns the city-side adapters
        │                             (citizens/vehicles/media/storage reads)
        ▼
Supabase backend  ◄──────────────►  OOC portal (the existing web app)
```

**One shared backend.** The in-city app and the OOC portal read and write the
same cases, the same reports, the same RLS. There is no second copy of CID, no
sync between "city CID" and "portal CID", and no city-side cache of portal
data. City-owned records (citizens, vehicles, properties, the city's penal
code, media hosts, evidence lockers) are read by the integration service
through provider adapters (`src/lib/integration/providers.ts`) and are never
mirrored into the portal — see [External-ID rules](#external-id-and-ownership-rules).

The **CID Integration Service** is the only component with credentials. It is
hosted server-side by the city (alongside or near the FiveM server), it is the
only holder of the integration secret, and it is where
`rate_limit_per_min` is enforced. FiveM *client* resources hold nothing:
no secret, no Supabase URL, no key of any kind.

## Authentication and identity

This is the project's core design call: **the CID lane authenticates each
in-city officer as their real portal identity.** There is no shared "game
server" actor for casework.

The exchange, per officer:

1. The FiveM server authenticates the player by its own means and asserts a
   city officer identity to the integration service (server-to-server,
   in-city).
2. The integration service resolves that identity through
   `public.external_officer_identities` — `(source, external_officer_id) →
   profile_id`, `active = true` required. No mapping row, or an inactive one,
   means no access (`forbidden`). The mapping is command-managed; `active`
   defaults false.
3. The service mints a **short-lived, per-officer Supabase session/JWT
   server-side** for the mapped `profile_id`. (Mechanism is an activation
   decision — e.g. admin-API session minting — and is out of scope here; the
   contract point is that the result is a real `authenticated` session for
   that one profile, with a short TTL and no refresh handed to the client.)
4. Every CID-lane operation then executes under that session — `auth.uid()`
   is the officer — through exactly the read paths, RLS policies, and
   SECURITY DEFINER RPCs the portal frontend uses. **No RLS policy, no RPC
   guard, and no authority boundary changes for this lane.** A detective in
   the city can do precisely what that detective can do at a browser: sealed
   cases stay sealed, SIB stays compartmentalized, bureau scope and joint
   access apply, and the audit log attributes every act to the real person.

For temporary joint-agency officers (mapped but not permanent members), the
reserved `case_assignments.assignment_source = 'manual_access'` lane grants
per-case access without ever touching `profiles.role`/`division` — which
`guard_profile` freezes anyway.

### The service_role hazard (audited — this is a hard rule)

The portal's guard triggers are `current_user`-based, and **service_role is
transparent to them**: a raw service-role table write bypasses the guards
that make portal writes safe. Therefore, by contract:

- **Raw service-role table writes are FORBIDDEN.** The integration service
  must never use the service_role key for direct PostgREST table DML on any
  portal table, under any circumstances.
- service_role may only call the **explicitly EXECUTE-granted machine RPCs**:
  today `mdt_patrol_feed`, `bridge_ingest_event`, `mdt_bridge_ack`; in the
  future, the activation-pass RPCs this contract names. Those RPCs validate,
  audit, and quarantine internally — that is what makes a machine identity
  safe.
- The service_role key **never ships in a FiveM client resource**, a browser,
  or the portal runtime. It lives only in the city-hosted integration
  service's server-side configuration.

Per-officer sessions are the reason this rule costs nothing: the CID lane
does not need service_role for casework, because casework runs as the
officer.

### Source identity, secrets, rotation, rate limits, auditing

- The FiveM deployment is one registered caller: `integration_sources` row
  `id = 'fivem-main'` (`kind = 'fivem_server'`). `enabled` defaults **false**;
  a disabled source authenticates nothing even after activation code ships.
  The registry ships empty — no row, no trusted caller.
- **Secrets live outside the database.** `integration_sources.secret_ref` is
  a *name/pointer* (an env-var name or vault key on the integration-service
  host), never the secret itself. Nothing secret is ever stored in a portal
  table.
- **Rotation** is an operational act on the service host: replace the secret
  the ref points at, stamp `secret_rotated_at`. The column exists so command
  can see staleness, not so the database participates in rotation.
- **Rate limiting**: `integration_sources.rate_limit_per_min` is the per-source
  budget, **enforced in the integration service** (the component that sees
  every request). PostgREST/platform limits remain a backstop, not the
  mechanism.
- **Request auditing**: every inbound mutating request lands one
  `integration_events` row (see [Idempotency](#idempotency-rules)).
  `payload_meta` carries **safe metadata only** — sizes, kinds, external ids,
  timing — never raw city payloads, which can contain citizen data that has
  no business persisting in a portal audit envelope. Command/owner read this
  surface; nothing else does.

## Error vocabulary

Eight stable codes. Every operation returns either a result or exactly one of
these; the integration package restates this table verbatim for the city
developer.

| code | meaning | typical HTTP |
|---|---|---|
| `unauthorized` | Caller not authenticated: missing/bad integration secret, unknown or disabled `source`, expired officer session. | 401 |
| `forbidden` | Authenticated, but this officer (or this machine identity) may not perform the operation — RLS/RPC authority said no, or no active `external_officer_identities` mapping exists. | 403 |
| `not_found` | The addressed record does not exist **or is invisible to this officer** — the CID lane never distinguishes "hidden" from "absent" (same posture as portal RLS). | 404 |
| `conflict` | Valid request, but state forbids it (e.g. status transition not allowed, uniqueness slot occupied). | 409 |
| `duplicate` | Idempotent replay detected: this `(source, external_request_id)` was already processed. **Not a failure** — the stored outcome of the original request is returned alongside the code; no second write occurs. | 200 |
| `validation_failed` | Payload malformed or fails domain validation (missing fields, bad enum, unknown external type). | 422 |
| `rate_limited` | Source over its `rate_limit_per_min` budget. Retry later; retrying does not risk double-writes (see idempotency). | 429 |
| `internal` | Unexpected failure. Safe to retry with the same `external_request_id`. | 500 |

Rules: codes are stable strings — clients branch on the code, never on
message text. Messages are for humans and may change. `not_found` vs
`forbidden`: when revealing existence would leak (sealed cases, SIB), the
answer is `not_found`, exactly as the portal behaves.

## Operations catalog

Legend for **backing**:

- *provider* — a city-owned read served by the city's own adapter behind the
  provider interfaces (`src/lib/integration/providers.ts`); never touches the
  portal database.
- *RLS read/write* — the same PostgREST read/write path the portal frontend
  uses, executed as the officer's session.
- *existing RPC* — a portal RPC that exists today.
- *shared-service RPC* — the shared operations layer being authored for
  portal + integration use (`case_create`, `case_set_status`, `case_set_lead`,
  `case_access_decide`, `case_timeline`, `report_create`); referenced here by
  name, defined in the services layer.
- *machine RPC* — service_role-only, per the hazard rule above.
- *activation RPC (future)* — a SECURITY DEFINER RPC the activation pass will
  add over the dormant tables; named here so the contract is complete, but it
  does not exist yet.

**Executing identity** is `officer` (the minted per-officer session,
`auth.uid()` = the mapped profile), `service` (the integration service acting
city-side only, no Supabase identity involved), or `service_role (machine)`.

### City-owned reads (never touch the portal database)

| operation | identity | backing | idempotency | notable errors |
|---|---|---|---|---|
| search citizens | service | provider `CitizenProvider.searchCitizens` | none (read) | `validation_failed` (blank query policy is the adapter's), `rate_limited` |
| get citizen | service | provider `CitizenProvider.getCitizen` | none | `not_found` |
| search vehicles | service | provider `VehicleProvider.searchVehicles` (normalized-plate semantics: `ab-123` finds `AB123`) | none | `not_found`, `rate_limited` |
| get vehicle | service | provider `VehicleProvider.getVehicle` | none | `not_found` |
| get properties | service | provider `PropertyProvider.getPropertiesFor` / `getProperty` | none | `not_found` |
| get officer / search officers | service | provider `OfficerProvider` | none | `not_found` |
| search penal code | service | provider `PenalCodeProvider.searchCharges` — the **city's** code; CID's own penal catalog stays separately authored | none | `not_found` |

These reads are still gated: the integration service requires an
authenticated officer session before serving them (a city record lookup is an
investigative act and is rate-limit-accounted to the source), but the portal
backend is not involved.

### CID case operations (per-officer, full portal authority)

| operation | identity | backing | idempotency | notable errors |
|---|---|---|---|---|
| create case | officer | shared-service RPC `case_create` | **required** — `external_request_id` | `forbidden`, `validation_failed`, `duplicate` |
| update case (status) | officer | shared-service RPC `case_set_status` | required | `forbidden`, `conflict` (illegal transition), `not_found` |
| update case (lead) | officer | shared-service RPC `case_set_lead` | required | `forbidden`, `not_found` |
| decide case access | officer | shared-service RPC `case_access_decide` | required | `forbidden`, `conflict` |
| get case | officer | RLS read (same portal read path) | none | `not_found` (includes invisible-by-RLS) |
| get timeline | officer | shared-service RPC `case_timeline` | none | `not_found` |
| add case person | officer | RLS write path (same table path the portal's entity-select uses) | required | `forbidden`, `not_found`, `conflict` (already linked) |
| add case vehicle | officer | RLS write path (portal's vehicle-link path) | required | `forbidden`, `not_found`, `conflict` |
| add charge | officer | RLS write path (portal's case-charge path); a city penal charge may ride along as an `ExternalCharge` snapshot on the link | required | `forbidden`, `validation_failed` |
| create task | officer | RLS write path (portal's task path) | required | `forbidden`, `validation_failed` |
| create report | officer | shared-service RPC `report_create` | **required** | `forbidden`, `validation_failed`, `duplicate` |
| create interview | — | **FUTURE — documented gap.** No interview model exists in the portal today; nothing backs this operation. It is listed so the city app can plan UI, and it returns `validation_failed` until a portal interview domain exists and this contract is revised. | — | — |

### External references (city evidence, storage, media)

CID **references, never owns**, city-held items. These operations write the
dormant reference tables and are backed by activation RPCs that do not exist
yet — the tables shipped sealed precisely so these rows cannot appear early.

| operation | identity | backing | idempotency | notable errors |
|---|---|---|---|---|
| attach evidence reference | officer | activation RPC (future) over `external_links` (`external_type = 'evidence'`) + provider `EvidenceProvider` for the snapshot read | required | `forbidden`, `not_found` (case), `conflict` (link exists) |
| attach storage item | officer | activation RPC (future) over `external_storage_refs`; snapshot custody facts (`collector_snapshot`, `chain_of_custody`) captured at link time | required | `forbidden`, `not_found`, `conflict` (unique `(source, external_id, case_id)`) |
| attach media | officer | activation RPC (future) over `external_media_refs`; `url` is a durable pointer, never a copy; `access_classification = 'restricted'` maps to break-glass handling | required | `forbidden`, `validation_failed` (bad media_type), `conflict` (unique `(source, external_id)`) |

### Surveillance and legal

| operation | identity | backing | idempotency | notable errors |
|---|---|---|---|---|
| create surveillance entry | service_role (machine) | **existing machine RPC** `bridge_ingest_event` — this is deliberately *not* an officer operation: automated observations enter unverified, quarantine-not-discard, and can only become investigative facts through detective review (Action Center) | built in: `(source, source_event_id)` unique; replay ⇒ `{"status":"duplicate"}` | `unauthorized` (not service_role), quarantined-not-errored for bad payloads |
| create legal request | officer | existing RPC `create_legal_request` | required | `forbidden`, `validation_failed` |
| update legal request | officer | existing transition RPCs (`update_legal_draft`, `submit_legal_request_to_cid` / `_to_doj`, `withdraw_legal_request`, …) — the portal's legal state machine, unchanged | required | `forbidden`, `conflict` (illegal transition), `not_found` |
| add legal comment | — | **FUTURE — documented gap.** There is no standalone legal-comment model today; commentary rides the transition notes on the RPCs above. Listed for planning; returns `validation_failed` until the portal grows one and this contract is revised. | — | — |

## Idempotency rules

The pipeline's contract (helpers: `src/lib/integration/idempotency.ts`;
envelope: `integration_events`):

- **Every mutating CID-lane request carries an `external_request_id`** —
  source-scoped, minted by the caller, stable across retries of the same
  logical action. Reads carry none.
- The idempotency key is **`(source, external_request_id)`** — for the
  surveillance machine lane, `(source, source_event_id)`. `UNIQUE (source,
  external_event_id)` on `integration_events` is the database-level backstop.
  A correlation/trace id may also be sent but is deliberately **not** part of
  the key (a resend may mint a new trace id for the same event).
- **Duplicate ⇒ replay of the stored outcome, never a second write.** When a
  key has already reached a resolved success state, the service returns the
  original result with code `duplicate` (HTTP 200) and writes nothing.
  `failed`/`retryable` keys are *not* duplicates — a resend is a legitimate
  retry (`isDuplicateStatus` semantics). `pending`/`quarantined` are
  in-flight/held, not resolved.
- Event statuses: `pending → processed | duplicate | quarantined | failed |
  retryable`, with `retry_count` bookkeeping — the
  `bridge_ingestion_events` + MDT-sync vocabulary, unified.
- Whitespace noise in ids is normalized for matching
  (`normalizeExternalId`); a keyless mutating request fails loudly
  (`validation_failed`), never silently collides.

## External-ID and ownership rules

The ownership principles, restated as contract:

- **City data stays city-authoritative.** CID stores pointers —
  `(source, external_type, external_id)` (`ExternalReference` /
  `external_links`) — never live mirrors of city records. The absence of a
  link row means "no external link"; every portal record that exists today
  needs none.
- **External ids are source-scoped.** `'fivem-main' : citizen : c-100` and
  some other source's `c-100` are unrelated. No external id is ever meaningful
  without its `source`, and no external id is ever used as a portal primary
  key.
- **Snapshots are explicit, deliberate, and marked.** When a workflow needs
  the state of a city record at a point in time (seizure, link, capture), it
  takes a clearly-labeled `snapshot` / `*_snapshot` copy. A snapshot is
  historical by definition: it is never refreshed implicitly (refreshing is
  an explicit future-RPC act), never treated as current, and **never written
  back** to the city. `external_updated_at` is for staleness display, not
  sync.
- **Media is referenced, not copied.** `external_media_refs.url` is a durable
  pointer; hosts that mint expiring links resolve lazily via
  `MediaProvider.resolveUrl` so an expiring URL is never stored as if
  durable. `checksum` lets a future pass detect the referenced object
  changing underneath us.
- **The flow is one-way.** The CID lane reads city systems and writes CID
  records. It never updates a city record, and the patrol lane's outbound
  feed remains the only portal→city data flow.

## Dormancy statement

Nothing in this document is live:

- The schema is inert: empty `integration_sources` registry (no trusted
  caller exists), RLS-sealed tables, no seeds, no activation RPCs, no grants
  beyond command/owner read on the two audit surfaces.
- `supabase/functions/cid-integration/` is an **undeployed skeleton**; every
  handler returns `not_activated`. Deploying it *is* the activation step and
  requires its own review (see that function's README).
- The shared-service RPCs are referenced by name; their definitions belong to
  the services layer and ship on their own review track.
- The identity-exchange minting mechanism, the `external_officer_identities`
  management surface, and the activation RPCs over the reference tables are
  all future work, each gated on the same activation review.
- The patrol lane's dormancy guarantees (service_role-only grants, asserted
  by the RLS suite) are unaffected.

Until an activation pass ships — a separate migration + deployment,
separately reviewed — the portal behaves exactly as if none of this existed.

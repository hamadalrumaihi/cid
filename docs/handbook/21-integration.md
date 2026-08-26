# Chapter 21 — City Integration & Bridges

[← Handbook index](README.md)

Everything that connects (or is prepared to connect) the portal to the city
— the FiveM server, its patrol MDT, its evidence storage and media hosts.
**Status: dormant.** Every surface in this chapter ships in code and schema
but nothing is live: no consumer is deployed, no external caller is
registered, and the portal behaves exactly as if none of it existed. This
chapter is the map; the contracts themselves live in
[`docs/MDT-BRIDGE-CONTRACT.md`](../MDT-BRIDGE-CONTRACT.md) and
[`docs/integration/CID-INTEGRATION-API.md`](../integration/CID-INTEGRATION-API.md)
— read those, don't duplicate them.

## 21.1 The two lanes

1. **Patrol lane** — machine-to-machine, minimal, sanitized (wanted/BOLO
   data out, automated surveillance observations in). Never carries case
   data.
2. **CID lane** — authenticated, per-officer casework from a future in-city
   CID app. Every operation runs as the officer's own portal identity, so
   all existing RLS/RPC authority applies unchanged.

The lanes never mix: a patrol MDT never gains CID reach, and the CID lane
never widens the patrol feed's allowlist.

## 21.2 The patrol bridge (the three machine functions)

| Function | Direction | What it does |
|---|---|---|
| `mdt_patrol_feed()` | outbound | The nine-column read surface: snapshot text only — no case ids, no entity FKs. The allowlist is structural (the feed *selects* only those columns), so sensitive CID/SIB data cannot cross by construction. |
| `bridge_ingest_event(...)` | inbound | Surveillance observations: idempotent on `(source, source_event_id)`, malformed payloads quarantined (never discarded), everything unverified until detective review in the Action Center. |
| `mdt_bridge_ack(...)` | bookkeeping | Stamps sync outcomes onto `mdt_exports` / `mdt_wanted_projections` (`20261002120000` fixed the wanted-branch CHECK to admit `'retryable'`). |

**Dormancy mechanism**: all three are SECURITY DEFINER with EXECUTE granted
to `service_role` **only** — revoked from `authenticated`/`anon`, so they
are unreachable from the browser and the app runtime; the RLS suite asserts
this. No sync service is deployed. Full field semantics, expiry rules and
consumer expectations: [MDT-BRIDGE-CONTRACT.md](../MDT-BRIDGE-CONTRACT.md).

## 21.3 The integration data layer (six tables, `20261002120000`)

The dormant schema the CID lane will write. Two postures:

| Table | Purpose | Posture |
|---|---|---|
| `integration_sources` | registry of trusted external callers; `enabled` defaults false; `secret_ref` is a *pointer* to a secret held outside the DB, never the secret | **read-only** (command/owner SELECT; no write policies) |
| `integration_events` | idempotency + audit envelope, `UNIQUE (source, external_event_id)`; `payload_meta` carries safe metadata only, never raw city payloads | **read-only** (command/owner SELECT; no write policies) |
| `external_links` | generic CID record → city record reference `(entity, source, external_type, external_id)` + deliberate `snapshot` | **sealed** |
| `external_storage_refs` | case → city physical-storage item (CID references, never owns; frozen custody facts) | **sealed** |
| `external_media_refs` | city-hosted media reference (durable URL pointer, never a copy) | **sealed** |
| `external_officer_identities` | city officer → portal profile mapping; `active` defaults false; pairs with the reserved `case_assignments.assignment_source='manual_access'` lane | **sealed** |

**Sealed** = RLS enabled, zero policies, every privilege revoked from
`authenticated`/`anon` (the `app_secrets` /`field_submission_sources`
posture) — unreachable through PostgREST at any rank. No table is seeded,
none is in the realtime publication, and no RPC writes any of them; the
absence of rows means the absence of integration. A future activation pass
(separate migration, separately reviewed) adds the definer RPCs and
entity-scoped read policies.

## 21.4 Shared case services (`20261002130000`)

Six SECURITY DEFINER RPCs that moved the worst component-embedded case
operations server-side, so the portal and the future city lane run **one
implementation per operation, never two**. The portal is rewired onto them
via [`src/lib/services/cases.ts`](../../src/lib/services/cases.ts) /
[`reports.ts`](../../src/lib/services/reports.ts); each gates on the same
`private.*` predicate its old client path passed through:

| RPC | Replaces | Gained |
|---|---|---|
| `case_create` | CaseModal's non-atomic insert + checklist | one transaction, collision-safe number minting (an explicit-number collision now errors — never a timestamp fallback), server-held lead rule |
| `case_set_status` | three direct `cases.status` update sites | validated vocabulary, explicit `CASE_STATUS_CHANGED` audit; `closed_at` stays trigger-owned |
| `case_set_lead` | HandoverModal's raw update + client notifies | lead-or-command gate server-side, server-sent handover notifications, audit |
| `case_access_decide` | AccessDecisionModal's two non-atomic writes | atomic grant + stamp, closes the unaudited-grant gap |
| `case_timeline` | TimelineTab's 11 parallel client reads | one definer read model exposing exactly what the client reads exposed |
| `report_create` | ReportsTab's insert with client seq/author | server-computed seq under an advisory lock, author pinned to `auth.uid()` |

Details per function (parameters, gates, audit actions): the migration
header of
[`20261002130000_shared_case_services.sql`](../../supabase/migrations/20261002130000_shared_case_services.sql)
and the [Ch. 7](07-api.md) table.

## 21.5 The CID lane contract and the developer package

- **Contract**: [docs/integration/CID-INTEGRATION-API.md](../integration/CID-INTEGRATION-API.md)
  — identity exchange, the service-role raw-write prohibition, the error
  vocabulary, the operations catalog, idempotency and external-ID/ownership
  rules. `supabase/functions/cid-integration/` is its **undeployed**
  code-shaped counterpart (every handler returns `not_activated`; deploying
  it *is* the activation step — see that function's README).
- **TypeScript contracts**: [`src/lib/integration/`](../../src/lib/integration/index.ts)
  — `External*` record shapes, provider interfaces, idempotency helpers and
  a mock adapter. Nothing in app code imports this directory **by design**;
  only the unit tests and mock consume it.
- **Developer package**: [`integration-package/`](../../integration-package/README.md)
  — the standalone handoff a city developer receives *without* this repo:
  the public half of the contract, self-contained types, examples, adapter
  guides, a zero-dependency mock, and a server-side FiveM resource skeleton.
  No credentials, hostnames or project references anywhere in it.

**The hard rules**, wherever activation lands: secrets live outside the
database; the service-role key never ships in a FiveM client resource, a
browser, or the portal runtime; raw service-role table writes are forbidden
(guard triggers are `current_user`-based and transparent to service_role);
and city data is referenced, never mirrored — snapshots are explicit and
deliberate.

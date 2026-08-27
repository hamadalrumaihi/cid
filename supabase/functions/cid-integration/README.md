# cid-integration — UNDEPLOYED skeleton

**This edge function is NOT deployed. Deploying it is the activation step for
the CID integration lane and requires its own review.** It exists so the
contract in [docs/integration/CID-INTEGRATION-API.md](../../../docs/integration/CID-INTEGRATION-API.md)
has a code-shaped counterpart: the operation routing table, the
authentication envelope, and the idempotency envelope — every handler returns
`501 { error: 'not_activated' }`.

## Dormancy guarantees

- No secret exists anywhere for it; `integration_sources` ships **empty** and
  `enabled` defaults false, so even an accidental deployment has nothing to
  authenticate against and every request dead-ends in `not_activated`.
- The file makes no network calls and contains no credentials, hostnames, or
  project references.
- The activation-pass RPCs it references (over `external_links`,
  `external_storage_refs`, `external_media_refs`) do not exist; those tables
  are RLS-sealed.

## Activation checklist (each item is review-gated — none may be skipped)

1. Separate review of the activation migration (definer RPCs + entity-scoped
   read policies) and of the per-officer session-minting mechanism.
2. Provision the shared secret **on the service host / function environment**
   and point `integration_sources.secret_ref` at its *name*. The secret value
   is never stored in the database and never ships in a FiveM client
   resource.
3. Register and enable the source row (e.g. `'fivem-main'`) — a deliberate,
   audited command act; `enabled=false` remains the kill switch.
4. **verify_jwt rule (sops-sync precedent):** this function must never be
   deployed with `--no-verify-jwt` unless the shared-secret check in
   `authenticateSource` is implemented and active. A no-JWT deployment with a
   stubbed secret check would be an open unauthenticated endpoint — the
   sops-sync function only runs `--no-verify-jwt` because its `SYNC_SECRET`
   gate rejects every unsigned request first. Same bar here, no exceptions.
5. Only after all of the above: `supabase functions deploy cid-integration`.

## Hard rules carried from the contract

- Raw service-role table writes are **forbidden** (the portal's guard
  triggers are `current_user`-based and transparent to service_role).
  service_role may only call the explicitly granted machine RPCs.
- CID casework executes as the **officer's own session** (`auth.uid()`),
  with all existing RLS/RPC authority unchanged.
- The patrol lane (`mdt_patrol_feed` / `bridge_ingest_event` /
  `mdt_bridge_ack`, [docs/MDT-BRIDGE-CONTRACT.md](../../../docs/MDT-BRIDGE-CONTRACT.md))
  is unaffected and never widens.

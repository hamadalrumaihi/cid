# CID Lane — API Contract (city-developer edition)

**Status: forward-looking. Nothing here is live yet.** The portal side is
dormant; activation happens in a separately-reviewed step on the portal side.
This document is the public half of the contract — what your integration
service sends and receives. Portal internals are deliberately out of scope.

## Architecture

```
FiveM client (CID app NUI)        — no secrets, no backend access, ever
        │  (in-city RPC/HTTP to your own server side)
        ▼
CID Integration Service           — YOU host this, server-side. It holds the
        │                           credentials, enforces rate limits, and
        │                           owns the adapters onto your city systems.
        ▼
CID Portal backend  ◄──────────►  the out-of-city portal web app
```

**One shared backend.** The in-city app and the portal operate on the same
records. There is no city-side copy of CID data and no sync process — an
officer's action in the city is instantly the same record the portal shows.

## Authentication: officers, not servers

The CID lane authenticates **each in-city officer as their real portal
identity**. There is no shared "game server" actor for casework.

1. Your FiveM server authenticates the player (your mechanism) and asserts a
   city officer identity to your integration service — server-to-server,
   in-city.
2. The integration service authenticates to the portal surface with the
   integration secret and presents `(source, officerId)`. The portal resolves
   this through a command-managed officer mapping; **an unmapped or inactive
   officer gets `forbidden`** — mappings are provisioned by CID command, not
   by the city.
3. The portal mints a short-lived per-officer session. Every subsequent
   operation for that officer runs under it — with exactly the access that
   officer has in the portal itself. Sealed or compartmentalized material an
   officer cannot see at a browser is equally invisible in the city (surfaced
   as `not_found`, never distinguished from "does not exist").

Credential rules (hard requirements):

- The integration secret lives only in your integration service's
  server-side configuration (`config.example.json` shows the shape). It is
  **never** placed in a FiveM client resource, a NUI page, or any file a
  player can obtain.
- Rotation: replace the secret in your configuration when the portal team
  rotates it; the portal tracks rotation time on its side.
- Rate limiting: the portal assigns your source a per-minute budget; your
  service should enforce it before forwarding (over-budget requests get
  `rate_limited`).
- Every mutating request is audit-logged portal-side (safe metadata only).

## Error vocabulary

Stable codes — branch on `error`, never on message text.

| code | meaning | HTTP |
|---|---|---|
| `unauthorized` | Bad/missing secret, unknown or disabled source, expired officer session. | 401 |
| `forbidden` | Authenticated, but this officer may not do this (or is unmapped/inactive). | 403 |
| `not_found` | Record absent **or invisible to this officer** — never distinguished. | 404 |
| `conflict` | Valid request, state forbids it (illegal transition, slot occupied). | 409 |
| `duplicate` | Idempotent replay: the stored outcome of the original request is returned; no second write. Not a failure. | 200 |
| `validation_failed` | Malformed payload / failed domain validation. | 422 |
| `rate_limited` | Source over budget. Safe to retry later. | 429 |
| `internal` | Unexpected failure. Safe to retry with the same `externalRequestId`. | 500 |

## Operations catalog

Envelope for every call (see `types/operations.ts` for the normative shapes):

```json
{
  "op": "case.create",
  "source": "fivem-main",
  "officerId": "officer-external-id",
  "externalRequestId": "required-on-mutations",
  "payload": { }
}
```

### City-owned reads — served by YOUR adapters, not the portal

`citizens.search`, `citizens.get`, `vehicles.search` (normalized-plate
semantics: `ab-123` must find `AB123`), `vehicles.get`, `properties.for`,
`properties.get`, `officers.search`, `officers.get`, `penal.search` (your
city's penal code).

These read your systems through the provider interfaces
(`types/providers.ts`). The portal backend is not involved; an authenticated
officer session is still required, and calls count against the rate budget.

### CID casework — per-officer, portal authority applies

| op | idempotency | notes |
|---|---|---|
| `case.create` | **required** | |
| `case.setStatus` | required | `validation_failed` on an unknown status. The backend enforces NO transition graph today — any of open/active/cold/closed is accepted from any state; do not rely on server-side transition rejection |
| `case.setLead` | required | |
| `case.accessDecide` | required | |
| `case.get` | none | `not_found` includes invisible-to-officer |
| `case.timeline` | none | |
| `case.addPerson` | required | `conflict` if already linked |
| `case.addVehicle` | required | `conflict` if already linked |
| `case.addCharge` | required | may carry a city penal charge snapshot |
| `task.create` | required | |
| `report.create` | **required** | |
| `interview.create` | — | **FUTURE** — no interview model exists yet; returns `validation_failed` until the contract is revised |

### External references — CID points at YOUR records

| op | idempotency | notes |
|---|---|---|
| `evidence.attach` | required | link a city evidence record to a case |
| `storage.attach` | required | link a locker/storage item; custody facts snapshotted at link time |
| `media.attach` | required | link city-hosted media; the URL is a durable pointer, never a copy |

CID **references, never owns**, these items — see
[EXTERNAL-IDS.md](EXTERNAL-IDS.md).

### Surveillance and legal

| op | idempotency | notes |
|---|---|---|
| `surveillance.ingest` | built-in on `(source, sourceEventId)` | machine-lane, **not** an officer op: automated observations enter unverified and only become investigative facts after detective review; malformed/unknown payloads are quarantined, not errored |
| `legal.create` | required | |
| `legal.update` | required | `conflict` on an illegal transition |
| `legal.addComment` | — | **FUTURE** — commentary rides transition notes today; returns `validation_failed` until the contract is revised |

## See also

- [ERROR-CODES.md](ERROR-CODES.md) — the vocabulary with client guidance.
- [IDEMPOTENCY.md](IDEMPOTENCY.md) — retry and replay rules.
- [EXTERNAL-IDS.md](EXTERNAL-IDS.md) — id scoping, snapshots, ownership.
- `types/` — normative TypeScript shapes.
- `examples/` — worked request/response pairs (fictional data).

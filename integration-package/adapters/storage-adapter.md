# Storage Adapter Contract

What you implement to expose your evidence locker / physical-storage system
to the CID lane. Normative interfaces: `StorageProvider` and
`EvidenceProvider` in [types/providers.ts](../types/providers.ts); record
shapes: `ExternalStorageItem`, `ExternalEvidence`, `ExternalCustodyEntry` in
[types/integration.ts](../types/integration.ts).

## What CID does with your data

CID **references, never owns**, physical items. Your locker system remains
the system of record for the object itself; a CID case stores your
`externalId`, CID-specific context (why the item matters to that case), and a
**frozen snapshot** of custody facts as they were at link time. CID never
writes to your system — no check-in/check-out, no custody mutation, nothing.

## Methods

### `getStorageItem(externalId) → ExternalStorageItem | null`

- Return `null` for an unknown id. **Never throw for "not found"** — throw
  only for genuine upstream failures (DB down, timeout).
- `label` is the only required descriptive field. Return what your system
  knows; never fabricate fields to fill the shape (sparse beats invented).
- `chainOfCustody` entries are your system's transfer log, oldest first, each
  with `at` (ISO-8601), `actor`, `action`, optional `note`.
- `evidenceId` links the item to your evidence record when the two are
  distinct systems; omit it otherwise.

### `searchStorageItems(q, opts) → ExternalStorageItem[]`

- Case-insensitive substring over the obvious display fields (label, item
  type, locker location) is the baseline; richer matching is welcome.
- **Always bound results**, even when `opts.limit` is absent (the reference
  mock caps at 20). Blank query may return the bounded pool or `[]` — pick
  one and be consistent.

### `EvidenceProvider.getEvidence` / optional `searchEvidence`

Same rules. `searchEvidence` is optional — omit it if your evidence system
only supports direct id fetches; do not emulate search badly.

## Operational rules

- Adapters run **inside your integration service only** — server-side, never
  reachable from a game client.
- Ids you return are treated as opaque, source-scoped, possibly
  case-sensitive strings ([EXTERNAL-IDS.md](../contract/EXTERNAL-IDS.md)).
  They must be stable: a re-fetch of the same physical item must return the
  same `externalId`.
- Timestamps are ISO-8601 strings from **your** clock; CID displays them and
  never uses them to sync.
- Verify behavior against the reference implementation in
  [mock/mockAdapter.mjs](../mock/mockAdapter.mjs) (`storage`, `evidence`).

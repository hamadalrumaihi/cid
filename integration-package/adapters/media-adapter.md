# Media Adapter Contract

What you implement to expose your media hosting (bodycam clips, scene
photos, screenshots — whatever the city hosts) to the CID lane. Normative
interface: `MediaProvider` in [types/providers.ts](../types/providers.ts);
record shape: `ExternalMedia` in [types/integration.ts](../types/integration.ts).

## What CID does with your media

CID **references, never copies**. Media bytes stay on your host; CID stores
your `externalId` plus a pointer and renders the reference. CID never
uploads, edits, or deletes media through this contract.

## Methods

### `getMedia(externalId) → ExternalMedia | null`

- `null` for an unknown id; throw only for genuine upstream failures.
- `mediaType` is required (`bodycam | screenshot | photo | video | audio |
  scene | evidence | other`); pick `other` rather than guessing.
- `url` semantics — the one decision that matters:
  - If your host serves **durable** URLs, set `url` and CID stores it as a
    durable pointer.
  - If your host mints **expiring/signed** links, **omit `url`** and
    implement `resolveUrl` instead. Never return an expiring link in `url` —
    CID would store it as if durable, and it would rot.
- `accessClassification: 'restricted'` marks material that needs elevated
  handling; CID maps it to its restricted-access flow (extra gating and
  audit on view). When unsure, `restricted` is the safe default.
- `checksum` (e.g. `sha256:…`), when you can provide it, lets CID detect the
  referenced object changing underneath a case.

### `resolveUrl(externalId) → string | null` (optional)

- Called at **access time** to mint a fresh fetchable URL.
- Return `null` when the asset is unknown **or gone** — CID renders a
  "reference unavailable" state; do not throw for absence.
- Minted links should be short-lived and scoped to the one asset. The
  request reaches you from the integration service (server-side); the
  resulting URL is shown to an already-authorized officer.

## Operational rules

- Adapters run **inside your integration service only** — never client-side.
- `externalId` values are opaque, source-scoped, stable
  ([EXTERNAL-IDS.md](../contract/EXTERNAL-IDS.md)).
- Timestamps (`capturedAt`) are ISO-8601 from your clock, display-only.
- Verify behavior against the reference implementation in
  [mock/mockAdapter.mjs](../mock/mockAdapter.mjs) (`media` — note the seeded
  asset without a `url`, which exercises the `resolveUrl` null arm).

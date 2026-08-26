# CID Integration Package

The standalone handoff for a **city developer** integrating a FiveM server
with the CID Portal's future CID lane. Everything you need to build against
the contract is in this directory — you do **not** receive, and do not need,
the portal's source code.

**Status: forward-looking. Nothing in this contract is live yet.** The
portal side is dormant by design; activation is a separately-reviewed step on
the portal side. You can build and test your half today against the mock
(`mock/`, see [TESTING.md](TESTING.md)) with no city systems and no portal.

## What this package IS

| dir | contents |
|---|---|
| `contract/` | The API contract: operations, [error codes](contract/ERROR-CODES.md), [idempotency rules](contract/IDEMPOTENCY.md), [external-ID and ownership rules](contract/EXTERNAL-IDS.md). |
| `types/` | Self-contained TypeScript declarations: the `External*` record shapes, the provider interfaces you implement, and the operation request/response envelopes. No external imports. |
| `examples/` | Example request/response JSON per major operation. All data is fictional. |
| `fivem-resource/` | A **server-side** FiveM resource skeleton showing where the integration-service URL and secret are configured. Placeholders only. |
| `adapters/` | What you implement against **your** city systems: [storage-adapter.md](adapters/storage-adapter.md), [media-adapter.md](adapters/media-adapter.md). |
| `mock/` | A runnable in-memory provider set (plain Node, zero dependencies) for local development. |
| `config.example.json` | Configuration shape with placeholder values. Copy, fill, keep out of version control. |

## What this package is NOT

- **No portal source.** The portal's internals (schema, row-level security,
  service code) are not included and are not part of your contract surface —
  you integrate against the operations in `contract/`, nothing else.
- **No credentials.** Nothing in this package is, or contains, a secret, a
  key, a real hostname, or a project reference. Placeholder values like
  `SET_ME` are exactly that.
- **No client-side anything.** Every credential-bearing component runs
  server-side. **FiveM client scripts must never hold the integration secret
  or any backend URL** — see `fivem-resource/`.

## The two lanes, in one paragraph

The **patrol lane** is a minimal, sanitized machine feed (wanted/BOLO data
out; automated surveillance observations in) and is specified separately by
the portal team — it never carries investigative case data. The **CID lane**
(this package) is authenticated, per-officer casework: every operation runs
as the real, individually-mapped officer, and the portal's own access rules
apply unchanged. Your integration service authenticates officers, not a
server-wide "game" identity.

## Where to start

1. Read [contract/API-CONTRACT.md](contract/API-CONTRACT.md).
2. Skim `types/` — the shapes there are normative.
3. Run the mock (`TESTING.md`) and build your adapters against
   `types/providers.ts`, checking behavior against `mock/mockAdapter.mjs`.
4. Wire the FiveM resource skeleton to **your** integration service (never
   directly to the portal backend).

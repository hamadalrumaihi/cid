# Testing Locally

How to exercise this package with **nothing but Node** — no city systems, no
portal, no network, no credentials.

## Prerequisites

- Node.js 18+ (the mock is plain ESM JavaScript; no install step, no
  dependencies, no build).

## Run the mock walkthrough

From this directory:

```sh
node mock/demo.mjs
```

Expected output: a line per contract check (`ok …`) ending in
`all checks passed`, exit code 0. The walkthrough covers the behaviors your
real adapters must reproduce:

- substring search + `null` (never throw) for unknown ids;
- normalized-plate vehicle matching (`ab-123` finds `AB123`);
- owner-keyed property lookups;
- custody chains on storage items;
- `resolveUrl` returning the durable URL, and `null` for a known asset with
  no URL;
- role-filtered legal-actor listings.

## Develop your adapters against the mock

`mock/mockAdapter.mjs` implements the full `IntegrationProviderSet`
(see `types/providers.ts`). The recommended loop:

1. Start from the mock's semantics — they are the reference behavior.
2. Implement one provider at a time against your real system, keeping the
   mock for every domain you haven't reached yet (the set composes: pass
   your own pools/providers where you have them).
3. Point your test suite at both and assert the same behaviors demo.mjs
   asserts: unknown id ⇒ `null`, blank query bounded, plates normalized,
   results always capped.

You can also seed the mock with your own fixtures:

```js
import { createMockProviders } from './mock/mockAdapter.mjs'

const providers = createMockProviders({
  citizens: [{ source: 'mock', externalId: 'c-1', fullName: 'Test Person' }],
})
```

A pool you pass replaces that default pool wholesale.

## What you cannot test yet

The portal side of the CID lane is **dormant**: there is no live endpoint to
call, and no test credentials exist (none will ever ship in this package).
Until activation, integration tests end at your integration service's
boundary — assert the envelopes you would send (see `examples/`) and the
error handling per [contract/ERROR-CODES.md](contract/ERROR-CODES.md),
including the `501 not_activated` response your service should surface
gracefully.

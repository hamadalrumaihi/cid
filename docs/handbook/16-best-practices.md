# Chapter 16 — Best Practices

[← Handbook index](README.md)

## Always

- **Trust the database, not the client.** Add/extend RLS first; UI gates
  second. If a rule matters, it must exist in SQL.
- **Surface every write failure.** `res.error` → toast; empty-data
  updates → warn. Silence is the enemy (this repo's worst historical bugs
  were silent no-ops).
- **Keep migrations additive** and move `database.types.ts` in the same
  PR.
- **Copy the nearest good pattern.** The registry-view skeleton, the
  refresh idiom, FK-preservation options, sequence guards — they exist in
  ~10 places each; consistency IS the maintainability strategy.
- **Run the four gates before pushing** — CI will catch you anyway, but
  slower.
- **Give destructive actions an Undo** (`deleteWithUndo`) and a confirm.
- **Test realtime with two browsers** when you touch data flows.

## Never

- Never put the `service_role` key anywhere in this repo or bundle.
- Never write sign-off/finalize/role columns directly — RPCs only
  (triggers will reject you anyway; don't fight them).
- Never `dangerouslySetInnerHTML`, `innerHTML`, or unsanitized hrefs.
- Never auto-retry a mutation.
- Never rename `Store` keys or nav slugs casually — they're contracts
  (legacy app, deep links).
- Never edit `guideContent.ts` by hand (generated) or let it drift from
  `docs/USER-GUIDE.md`.
- Never "clean up" the deferred-effect pattern, Modal's ref-routing, or a
  sequence guard because it looks redundant — each fixes a real bug.

## Patterns worth imitating (real examples)

| Pattern | Where to see it |
|---|---|
| Zero-rows-means-blocked surfaced as a warning | `RecordsView.save` |
| Delete-then-reinsert children with rollback on partial failure | `NarcoticsView` save |
| Scan failure ≠ "no matches" (no false negatives) | `VehiclesView` cross-ref panel |
| Compare-and-swap so two tabs can't double-fire | `CasesView` stale escalation |
| Partial-tolerant aggregation ("a partial packet beats none") | `lib/packet.gatherCasePacket` |
| Server-stamped identity (unforgeable authorship) | `create_notification` RPC + stamp triggers |
| Public-data honesty (existence-only leak, explicit stubs) | Indicators 🔒 stubs, `mo_crossref` |

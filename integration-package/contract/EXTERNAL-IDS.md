# External IDs, Snapshots, and Ownership

The principles that keep two systems of record from corrupting each other.

## The city stays authoritative

City data — citizens, vehicles, properties, officers, your penal code, your
evidence lockers, your media hosts — remains **city-authoritative, always**.
CID never becomes a second system of record for a city object:

- CID stores **pointers**, `(source, externalType, externalId)`, never live
  mirrors of city records.
- The CID lane **never writes back** to a city record. The flow is one-way:
  it reads your systems (through your adapters) and writes CID records.
- Deleting or changing a record on your side is your call; CID's pointer
  simply goes stale and renders as such.

## External ids are source-scoped

- An external id is only meaningful **with its `source`**:
  `fivem-main : citizen : c-100` and any other source's `c-100` are
  unrelated.
- Ids are treated as opaque, possibly case-sensitive strings. Matching
  normalizes whitespace noise only; it never case-folds or restructures your
  ids.
- An external id is never used as a CID primary key.

## Snapshots are explicit, deliberate, and historical

Sometimes an investigation needs the state of a city record **at a point in
time** — what the vehicle registration said at seizure, who the custody chain
listed at link time. For that, and only that, CID takes a **snapshot**:

- A snapshot is clearly marked as a snapshot, stamped with when it was taken.
- It is **historical by definition**: never refreshed implicitly, never
  treated as current, and never written back to your systems. Refreshing a
  snapshot is an explicit officer act, not a background sync.
- Your record's own `updatedAt` (when you provide one) is carried for
  staleness display only — it is never used to drive synchronization.

## Media is referenced, not copied

- CID stores your media **URL as a durable pointer**, never a copy of the
  bytes. Display renders the reference.
- Hosts that mint short-lived links implement `resolveUrl` (see
  [media-adapter.md](../adapters/media-adapter.md)) so an expiring URL is
  never stored as if durable.
- An optional `checksum` lets CID detect the referenced object changing
  underneath a case.

## Sparse over fabricated

Your adapters return what your systems actually know. Every field beyond
identity is optional in the `External*` shapes precisely so a sparse record
is always preferable to invented data. Never fabricate a field to satisfy a
shape.

# Chapter 17 — Performance Notes

[← Handbook index](README.md)

## Already good

Static pre-rendering (instant first paint); React Flow and @react-pdf are
dynamic-imported (out of the main bundle); 68 FK covering indexes +
pg_trgm search indexes server-side; one realtime channel per table;
memoized heavy derivations; slim `select` projections on picker queries.

## Known considerations, in priority order

1. **Whole-table refetch on every change.** The version-counter pattern
   refetches entire tables per subscribed view on any single row change.
   Fine at division scale (hundreds of rows); will not scale to tens of
   thousands. The upgrade path (server-side pagination/filtering) is
   parked in `docs/DEFERRED.md` — revisit at ~10× data.
2. **Client-side scanners.** The vehicles cross-ref scan is
   O(vehicles × cases) with regexes over report text; InboxView JSON-scans
   messages for mentions. Bounded today (limits on messages); keep limits
   when touching them.
3. **Large files as edit-risk hotspots**: `GangsView` (~690 lines) — and
   formerly `CaseDetail.tsx`, whose 12 lazy-fetching tabs were split into
   one file each (`cases/tabs/`) in v1.1.0. Runtime is fine; review
   care isn't.
4. **Re-render sources**: the 1s tick in Trackers (small, fine);
   AuthProvider re-rendering on hourly token refresh (mitigated by
   Modal's ref design — preserve it).
5. **Images**: external mugshots/media are plain `<img>` — no next/image
   optimization for arbitrary hosts. Acceptable; know it.
6. **Non-published tables** (`feedback`, `watchlist`, `operations`)
   refresh on remount only — deliberate trade, not a bug.

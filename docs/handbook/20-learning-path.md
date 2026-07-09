# Chapter 20 — Learning Path

[← Handbook index](README.md)

Each step depends only on the previous ones. Checkboxes for your first
two weeks:

- [ ] **1. The mental model** — [Ch. 1](01-overview.md) + [Ch. 9](09-auth.md).
  *Why first*: "the database is the authority" reframes everything; skip
  it and every view looks over-engineered.
- [ ] **2. Use the app as a user** — the in-app guide (Reference → User
  Guide) or `docs/USER-GUIDE.md`. *Why*: you can't debug flows you've
  never run.
- [ ] **3. The three foundation files** — `lib/supabase.ts` → `lib/db.ts`
  → `lib/auth.tsx` (~450 lines total). *Why*: after these, every view's
  first 30 lines read themselves.
- [ ] **4. One registry view end-to-end** — `vehicles/VehiclesView.tsx`,
  then diff against `IndicatorsView`. *Why*: the whole idiom in one
  self-contained file, and proof of how uniform the pattern is. **You can
  take registry tickets now.**
- [ ] **5. The shell** — `useNav` → `AppShell` → `Sidebar` →
  `SearchPalette`. *Why*: how a URL becomes a screen; how ⌘K routes.
- [ ] **6. Realtime + state** — [Ch. 10](10-state.md) + `lib/realtime.ts`.
  *Why*: demystifies the "live" magic before you meet it in big views.
- [ ] **7. Cases, one tab at a time** — `CasesView` → `CaseModal` →
  `CaseDetail` (Overview → Tasks → Evidence → Reports → Sign-off last,
  with `lib/signoff.ts` and [Ch. 7](07-api.md) beside you). **You can
  take case features now.**
- [ ] **8. The database for real** — [Ch. 8](08-database.md) with the
  Supabase dashboard open; read `cases` and `case_intel_links` policies.
- [ ] **9. Specialists last** — CaseGraphTab, HeatmapView, InboxView,
  packet/pdf/docx. *Why last*: intricate but leaf-node; nothing else
  depends on them.

Keep [Ch. 12](12-change-impact.md) and the [FAQ](appendix-faq.md) open in
a tab throughout.

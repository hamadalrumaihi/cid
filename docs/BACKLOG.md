# Feature Backlog — CID Portal

Shipping incrementally on `claude/cid-rebuild`. ✅ done · 🟡 in progress · ⛔ blocked · ⬜ todo.

## Done
- ✅ **Warrant templates** — Arrest, Search, Wiretap (fillable; added a `checks` checkbox field type).
- ✅ **Subpoena template** (fillable).
- ✅ **Surveillance Report template** (fillable).
- ✅ **Penal-code charges system** — `penal.js` catalog; Charges tab per case with picker, stacking, totals (sentence/fines/RICO), recommendations. Migration `case_charges` applied to live.
- ✅ **Name autocomplete in reports** — suggests matching persons; auto-add/auto-create on save; suspect recommendations.
- ✅ **Media tags** — tag media (Mugshot/Scene/Weapon…); chips + filter in case media and the Media Vault.
- ✅ **Tag/reference reports inside other reports** — cross-reference chips between reports in the same case.
- ✅ **Chat edit/delete** — edit & delete messages; remove mention/linked-case chips. Migration `case_messages_edit_delete` applied.
- ✅ **Quick status change** on the case header + **copy buttons**.
- ✅ **Bulk multi-select delete** on the Persons list (command-gated).
- ✅ **Link intel (person/gang/place) directly to a case** — case **Intel tab** (link/unlink + kind/entity/role picker); direct links also surface in the person/gang intel-profile "Linked cases" rollup. `case_intel_links` join table — migration `20260622120000` **applied to live**.
- ✅ **Penal code Titles 5–10** — extended `penal.js` to the full San Andreas Penal Code (162 charges): Title 4 (4)24–(4)36 + new Titles 5 (firearms), 6 (controlled substances), 7 (wildlife), 8 (commercial vehicles), 9 (traffic), 10 (RICO modifiers). Added a `modifier` flag (MOD chip in the Charges list/picker).
- ✅ **RICO tab in each case** — embedded the RICO builder (enterprise · predicate pattern · readiness meter) as a per-case detail tab; Charges "open RICO Builder" now jumps to it in-place.
- ✅ **Player properties on profiles** — `persons.properties` jsonb (migration `20260622130000`, **applied to live**); modal editor, card 🏠 chip, intel-profile section, and a properties hint under person-linked form fields (subpoena/wiretap).
- ✅ **Undo on delete** — `deleteWithUndo` + 6s Undo toast (re-insert preserving id). Wired into persons (single/modal/bulk), gang members, commendations.

## Next up
- ⬜ **Extend undo-on-delete coverage** — apply `deleteWithUndo` to more leaf/SET-NULL deletes (places, media, evidence, reports). Skip cascade parents (cases, gangs) unless we restore children too.

## Bigger / refactor
- ⬜ **True soft-delete** — a `deleted_at` column + query filters would make undo survive page reloads and cover cascade parents, at the cost of a cross-cutting migration on every table. Current undo is client-side re-insert (works within the session only).

## Notes
- Penal code now covers Titles 1–10 (crimes + firearm/drug classifications live as the Title 5/6 charge tables). Modifiers (Title 5/6/10) carry the `modifier` flag; stacking keys off `stack`, so modifiers get no count stepper.
- Deferred items (SheetJS vendoring, server-side filtering, Pro-gated hardening) are tracked in `DEFERRED.md`.

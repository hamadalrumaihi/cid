# Feature Backlog — CID Portal

Shipping incrementally on `claude/cid-rebuild`. ✅ done · 🟡 in progress · ⛔ blocked · ⬜ todo.

## Done this session
- ✅ **Warrant templates** — Arrest, Search, Wiretap (fillable; added a `checks` checkbox field type).
- ✅ **Subpoena template** (fillable).
- ✅ **Surveillance Report template** (fillable).
- ✅ **Penal-code charges system** — `penal.js` catalog (Titles 1–4); Charges tab per case with picker, stacking, totals (sentence/fines/RICO), recommendations. Migration `case_charges` **applied to live**.
- ✅ **Name autocomplete in reports** — typing a name suggests matching persons; auto-add/auto-create on save; suspect recommendations.
- ✅ **Media tags** — tag media (Mugshot/Scene/Weapon…); chips + filter in case media and the Media Vault.
- ✅ **Tag/reference reports inside other reports** — cross-reference chips between reports in the same case.
- ✅ **Chat edit/delete** — edit & delete messages; remove mention/linked-case chips. Migration `case_messages_edit_delete` applied.
- ✅ **Quick status change** on the case header + **copy buttons** (case #, etc.).
- ✅ **Bulk multi-select delete** on the Persons list (command-gated).

## Next up
- 🟡 **Link intel (person/gang/place) directly to a case** — case **Intel tab** with link/unlink + a kind/entity/role picker; direct links also surface in the person/gang intel-profile "Linked cases" rollup. Backed by a new `case_intel_links` join table. Migration `20260622120000_case_intel_links.sql` is **prepped in-repo, NOT yet applied to live** — the tab shows a "run migration" banner and degrades gracefully until it is. (Reclassified from "no migration": a real many-to-many person/gang→case link needs a join table.)

## Bigger / refactor
- ⬜ **RICO tab in each case** — embed the RICO builder per case (Charges tab already surfaces RICO predicates + links to it).
- ⬜ **Undo on delete** — soft-delete + 5s "Undo" toast (cross-cutting).

## Needs a migration (prep .sql + approval)
- ⬜ **Player properties on profiles** — owned properties on a person; surface in Search/Subpoena warrants. (persons.properties jsonb or person_properties table.)

## Notes
- Penal code: only Titles 1–4 (crimes) are in `penal.js`; Titles 5/6 are classifications (firearm/drug). Add Title 7+/traffic/drug-charge tables if you send them.

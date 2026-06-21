# Feature Backlog — CID Portal

Shipping incrementally on `claude/cid-rebuild`. ✅ done · 🟡 in progress · ⛔ blocked · ⬜ todo.

## Done this session
- ✅ **Warrant templates** — Arrest, Search, Wiretap (fillable; added a `checks` checkbox field type).
- ✅ **Subpoena template** (fillable).
- ✅ **Surveillance Report template** (fillable).
- ✅ **Penal-code charges system** — `penal.js` catalog (Titles 1–4); Charges tab per case with picker, stacking, totals (sentence/fines/RICO), recommendations. Migration `case_charges` **applied to live**.

## Next up (no migration)
- ⬜ **Name autocomplete in reports** — typing a name suggests matching persons from the DB (partial match); option to **auto-create** the person if new when the report is saved.
- ⬜ **Media tags** — tag media (e.g. "Mugshot", "Scene", "Weapon"); filter by tag in case media + the Media Vault. (`media.tags` jsonb already exists.)
- ⬜ **Tag/reference reports inside other reports** — link a report to other reports in the same case (cross-reference chips).
- ⬜ **Delete chat mentions / linked-case chips**; **edit & delete chat messages**.
- ⬜ **Quick status change** on case cards/header; **Copy buttons** (case #, phone, badge).
- ⬜ **Bulk multi-select delete** on lists.
- ⬜ **Link intel (person/gang/place) directly to a case**.

## Bigger / refactor
- ⬜ **RICO tab in each case** — embed the RICO builder per case (Charges tab already surfaces RICO predicates + links to it).
- ⬜ **Undo on delete** — soft-delete + 5s "Undo" toast (cross-cutting).

## Needs a migration (prep .sql + approval)
- ⬜ **Player properties on profiles** — owned properties on a person; surface in Search/Subpoena warrants. (persons.properties jsonb or person_properties table.)

## Notes
- Penal code: only Titles 1–4 (crimes) are in `penal.js`; Titles 5/6 are classifications (firearm/drug). Add Title 7+/traffic/drug-charge tables if you send them.

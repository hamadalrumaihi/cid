# Feature Backlog — CID Portal (requested 2026-06-21)

Selected via triage. Shipping incrementally on `claude/cid-rebuild`. Status keys:
✅ done · 🟡 in progress · ⛔ blocked · ⬜ todo.

## Big features
- ⬜ **RICO tab in each case** — embed the RICO builder (rico_cases + predicate_acts, already per-case in Supabase) as a tab inside case detail. Likely **no migration**. Keep the standalone RICO tab or redirect it.
- 🟡 **Subpoena fillable template** — same engine as the warrants. (this batch)
- ⬜ **Player properties on profiles** — owned properties on a person; surface in Search/Subpoena warrants. **Needs migration** (persons.properties jsonb, or a `person_properties` table).
- ⛔ **Penal-code charges system** — charges catalog + attach-to-case (`case_charges`) + "recommended charges" + RICO link. **BLOCKED: need the actual charges list.** The CSV provided was only the Information/definitions tab, not the offense table (names, class, fine, sentence). Re-request the Penal Code sheet.

## Quick wins (no migration)
- ⬜ **Delete chat mentions / linked-case chips** — let author/command remove a mention or linked-case chip from a message.
- ⬜ **Edit & delete chat messages** — authors edit/delete own; command removes any.
- ⬜ **Bulk multi-select delete** — checkbox-select multiple persons/gangs/places/etc., delete in one action (command-gated).
- ⬜ **Quick status change on case cards/header** — open→active→closed/cold without the full edit modal.

## Polish
- ⬜ **Copy buttons** — one-click copy for case #, phone, badge #, etc.
- ⬜ **Link intel directly to a case** — attach person/gang/place to a case from its detail (case ↔ intel links). May reuse existing attach flows or need a links table.
- ⬜ **Undo on delete** — soft-delete + 5s "Undo" toast instead of immediate permanent delete (cross-cutting).

## Suggested sequence
1. Subpoena template (cheap) → 2. Quick status change + Copy buttons (cheap, visible) →
3. Chat: delete mentions/links + edit/delete messages → 4. Bulk multi-select delete →
5. RICO-in-case (refactor) → 6. Link intel to case → 7. Undo on delete →
8. Player properties (migration) → 9. Penal-code charges (needs data + migration).

_Charges + properties need migrations (apply to live `cid` with approval, per the established flow)._

# Appendix — FAQ

[← Handbook index](README.md)

**Where should I add a new page/screen?**
Four places, all required: (1) `src/components/<feature>/<Feature>View.tsx`
(copy `VehiclesView` as a template); (2) `src/lib/nav.ts` — a `PAGE_META`
entry, the slug in a category's `tabs`, a `TAB_LABEL`; (3) the switch in
`src/app/(app)/[tab]/page.tsx`; (4) `docs/USER-GUIDE.md` + regenerate
`guideContent.ts`. Miss (2) or (3) and the tab redirects or renders a
placeholder. Full recipe: [Ch. 14](14-development-workflow.md).

**How do permissions work?**
Three layers: `useAuth()`'s booleans hide buttons (cosmetic), RLS policies
refuse rows (the real wall), guard triggers lock specific columns even for
allowed writers. If a rule matters, put it in SQL first. [Ch. 9](09-auth.md).

**Where are the database queries?**
Only in `src/lib/db.ts` calls inside each view (`list`, `insert`, …).
There is no other query layer — no ORM, no /api routes. Reads throw;
writes return `{error}`. [Ch. 3, Block 4](03-architecture.md).

**Where do I change navigation?**
`src/lib/nav.ts` (the model) and `src/components/shell/` (the rendering).
Never rename existing slugs — they're deep-link contracts.

**Where are environment variables used?**
Only `src/lib/supabase.ts` and `src/lib/fivemanage.ts`. Values are
duplicated in `vercel.json` and `.github/workflows/ci.yml`. All public;
changing one requires a rebuild. [Quick Reference](appendix-quick-reference.md).

**How do I add a new feature with a new table?**
Additive migration on the live project → RLS policies (copy the closest
pattern) → realtime publication → FK indexes → hand-add to
`database.types.ts` → build the view → wire nav → docs. [Ch. 14](14-development-workflow.md).

**Why does my write "succeed" but change nothing?**
RLS blocked it: mutations return `{error}` OR zero rows with no error.
Check `res.error` and, for updates that might be scope-blocked, empty
`data` (see `RecordsView.save`). [Ch. 13](13-debugging.md).

**Why doesn't my screen update live?**
Either the table isn't in the realtime publication ([Ch. 8.6](08-database.md))
or the view's effect deps don't include `useTableVersion('table')`.

**Why is everything blue-classed but rendering amber?**
The accent system: `globals.css` remaps blue-* utilities to the user's
chosen accent. Intended. [Ch. 15](15-conventions.md).

**Where is the sign-off logic?**
In the database (`signoff_*` RPCs + `private.signoff_route/pick`). The
client only calls RPCs and renders vocabulary from `lib/signoff.ts`.
Don't implement chain logic client-side — triggers reject direct writes.

**How do notifications get created?**
Only via `lib/notify.ts` → the `create_notification` RPC (the actor is
stamped server-side; failures are deliberately swallowed). Rendering
vocabulary: `lib/notifText.ts`.

**What should I avoid changing first?**
`CaseDetail.tsx`, `lib/db.ts`, `lib/auth.tsx`, `globals.css`'s accent/
collapse blocks, `next.config.ts` (CSP), anything under `supabase/` —
learn steps 1–6 of the [Learning Path](20-learning-path.md) first. Safe
starter areas: `PenalView`, `GuideView`, any registry view.

**Where do I put temporary/draft user input?**
Modals guard dirty state automatically. For persistence there's
`lib/drafts.ts` — currently unwired (zero importers) — or the `Store`
blob for preferences. Don't invent a third mechanism.

**How do I test realtime behavior?**
Two browsers (or one normal + one incognito) signed in as different
users; change data in one, watch the other. Preview deployments work too.

**Who can delete things?**
Command only, everywhere (RLS `can_delete()`), always with Undo. If Undo
restores a parent without its children, the `deleteWithUndo` cascade
config is missing entries — fix the config, not the pattern.

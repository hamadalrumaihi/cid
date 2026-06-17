# Archived migrations (NOT replayed)

These files belong to the **original `sahp-rbac` project (`nuujdewnkovtdvlbfzdx`)** and a
schema that was superseded before the current `cid` project (`jhxuflzmqspidkvjckox`) was
built. They were **never applied to the live `cid` database** — the production migration
history starts at `cid_records` and the real base schema is
`20260616090000_platform.sql` (live `platform_schema_rls`).

They are kept here for historical reference only. The Supabase CLI does not replay
files in subdirectories, so `supabase db reset` ignores them.

| File | Why retired |
|------|-------------|
| `20260615120000_init_schema_rls.sql` | Old RBAC model (`officer_rank` enum: director/deputy_director/lead_detective/detective/analyst). Replaced by the 5-role `app_role` model (`detective`, `senior_detective`, `bureau_lead`, `deputy_director`, `director`) in `platform.sql`. Re-running it would collide with `platform.sql` (duplicate `public.bureau` type, duplicate `profiles` table). |
| `20260615120100_storage.sql` | Supabase Storage buckets (`evidence`/`mugshots`/`backups`) + path-bureau policies. **The live app stores media as external URLs (FiveManage) — there are no storage buckets in production and the client never calls the Storage API.** Nothing to rebase. |
| `20260615120200_seed_catalogs.sql` | Seeded `report_templates` + `rico_predicate_catalog` tables. **The live app ships these as client-side constants** (`REPORT_TEMPLATES` / `RICO_PREDICATES` in `persons.js`); neither table exists in production. RICO uses the live `rico_cases` + `predicate_acts` tables instead. Nothing to rebase. |

See `20260615120300_reconcile_retired_init.sql` for the (intentionally empty) reconcile
migration that documents this in the live lineage.

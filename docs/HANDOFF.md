# CID Portal — Session Handoff / Memory

> Read this first in a new chat. It captures architecture, what's built, what's live,
> the workflow, and the open backlog so work can continue without re-discovery.

## Project at a glance
- **App:** CID Portal — a Criminal Investigation Division ops tool for an SA-RP community ("State of San Andreas"). Cases, evidence, intel (persons/gangs/places), reports/forms, RICO, Drive, chat.
- **Stack:** Vanilla ES2017, **classic scripts sharing ONE global lexical scope** (no build step, no modules). Precompiled Tailwind in `styles.css`. Supabase backend with RLS.
- **Supabase project:** `cid` = `jhxuflzmqspidkvjckox` (org `nvxxnximnedwwzoxoceq`, **Free** plan). Other projects (leqat-platform, sahp-rbac) are unrelated/paused.
- **Repo:** GitHub `hamadalrumaihi/cid` (the MCP scope registers it as `hamadalrumaihi/sahp.` — note trailing dot). Dev branch **`claude/cid-rebuild`**; production tracks **`main`** (Vercel).
- **Deployed:** `cidportal-ody.vercel.app` (Vercel builds `main`; PR previews build the branch).

## Critical architecture rules (don't break these)
- **Shared global scope:** every top-level `const`/`let`/`function` is global across all `*.js`. Names must be unique across files. **Verify every change two ways:**
  1. `node --check <file>` per changed file.
  2. Concatenate all `<script src>` files in `index.html` load order and `node --check` the concatenation (catches cross-file `const` collisions). One-liner used all session:
     `files=$(grep -oE '<script src="[a-z0-9_]+\.js"></script>' index.html | sed -E 's/.*"([^"]+)".*/\1/'); :> /tmp/c.js; for f in $files; do cat "$f">>/tmp/c.js; echo>>/tmp/c.js; done; node --check /tmp/c.js`
- **Precompiled Tailwind:** classes not already used in the app may be **absent** from `styles.css` (e.g. `max-w-sm` was missing → broke a dialog). For new/uncommon utilities, prefer **inline `style=`** for critical layout (width/z-index), or reuse classes known to exist.
- **Migrations:** applied to live `cid` via the Supabase MCP `apply_migration`, **each shown + user-approved first** (auto-mode classifier blocks unapproved prod writes). Keep the `.sql` in `supabase/migrations/`.
- **RLS model:** `private.is_active()`, `private.is_command()` (bureau_lead/deputy_director/director), `private.can_delete()` (=command), `private.can_access_case()`, `private.can_create_case(bureau)`, `private.can_access_case_row(...)`. Function-grant gaps bite: policy functions must have EXECUTE for `authenticated` (a missing grant on `can_create_case` once broke ALL case creation).
- **DB layer:** `DB().list(table,{eq,order,ascending,select})`, `DB().insert/update/remove`, `DB().from(table)` (raw supabase builder), `DB().rpc(fn,args)`. `DB().me` = profile; `canEdit()`=active, `canDelete()`/`isAdmin()`=command.
- **Forms engine** (`drive.js` + `core.js FORM_SCHEMAS`): section types `kv|grid|textarea|note`; field types `text|select|textarea|date|money|checks`(checkbox group)`. Field flag `person:true` → autocomplete vs Persons + auto-add. A documents row renders as a fillable form when `formSchemaIdFor(doc)` matches (by `content.form` or name contains a `FORM_NAME_MAP` title). `REPORT_TEMPLATES` (persons.js) drives the per-case Reports tab launcher.

## Shipped this session (all merged to main via PRs, except the latest commit)
- Waves 0–4 completed earlier (security, cases/sign-off, intel profiles + network graph, command scorecards + heatmap, branded exports + Drive search/versions).
- **Fillable forms:** Arrest/Search/Wiretap warrants, Subpoena, Surveillance Report (+ a `checks` checkbox field type).
- **Penal-code charges:** `penal.js` catalog (Titles 1–4, ~75 charges; stack/arrest/RICO flags) → **Charges tab** per case (picker, stacking, totals incl. RICO predicates, keyword "Recommended", RICO jump, charge descriptions). Stored in `cases.charges` jsonb.
- **Reports:** name autocomplete vs Persons; "Suspects on this case" quick-fill chips (from gang_members/media/prior reports) incl. DOB; opt-in **auto-add new persons** on save; **cross-reference other reports** (`fields._refs`).
- **Media:** case Evidence "Linked Media" (thumbnails, +Add link, Upload photos [multi, FiveManage], Attach from Vault, Detach); **tags/labels** (Mugshot/Scene/… presets, chips, vault label filters).
- **Quality-of-life:** themed `uiConfirm`/`uiPrompt` replacing native dialogs; evidence Delete; roster **Remove (deactivate)**; chat **edit/delete + remove mention/link chips**; quick **case status** dropdown; **copy** buttons (`copyText`); **bulk multi-select delete on Persons**.
- Fixed: case-creation grant bug; fillable-form name-prefix matching; dialog width (Tailwind gap).

## Migrations applied to live `cid` this session (all verified)
- `cid_records_lock` (was committed-but-never-applied; closed anon read) · `wave0_advisor_followup` (search_path + dup index) · `documents_versions` · `case_charges` (cases.charges jsonb) · `case_messages_edit_delete` (cm_upd/cm_del).
- In-repo, **not yet applied**: none pending right now.

## Workflow that's been working
- Build on `claude/cid-rebuild` → commit (per feature) → push → **owner opens/merges PR to `main` and deletes the branch** (so the next push recreates it). Production reflects `main`.
- Migrations: I prep `.sql`, show it, **AskUserQuestion to approve**, then `apply_migration` + verify.

## Open backlog (next chat: pick up here)
- 🟡 **Bulk multi-select delete** — done for Persons; **replicate to Gangs + Places** (same pattern: `personSel` Set + `.p-check` + sticky bar in `renderGangs`/`renderPlaces`).
- ⬜ Link intel (person/gang/place) directly to a case.
- ⬜ **RICO tab in each case** (RICO is already per-case Supabase data; embed as a case-detail tab; Charges tab already surfaces RICO predicates + links to it).
- ⬜ Undo-on-delete (soft-delete + 5s undo toast; cross-cutting).
- ⬜ Edit tags on existing media (no edit-media modal yet).
- ⬜ **Player properties on profiles** — owned properties on a person, surfaced in Search/Subpoena warrants. **Needs migration** (persons.properties jsonb or person_properties table).
- See `docs/BACKLOG.md` and `docs/DEFERRED.md` for the full lists + the Pro-gated/network-blocked items (SheetJS repo-vendoring, server-side case filtering).

## Pre-pitch / known gaps (from the audit)
- Roster is tiny (Tom Wood = director/SAB + 1 detective). No bureau_lead/deputy or non-SAB users → can't demo the 3-tier sign-off live. **Seed a realistic roster before pitching.**
- Narcotics tab is empty; reports/chat/evidence are thin. Intel (persons/gangs/places) is rich.
- Leaked-password protection: enable in Supabase Auth (dashboard toggle) if not already.
- Penal code: only Titles 1–4 (crimes) loaded; Titles 5/6 are classifications. Send more titles/traffic/drug charge tables to extend.

_Last updated this session (2026-06-21)._

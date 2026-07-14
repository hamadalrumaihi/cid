# react-rebuild BRANCH NOTE

> Development tooling only. This file guides development tools and human
> contributors working on the repo; it is not a runtime dependency and does
> not provide AI features inside the CID Portal.

On THIS branch the repo root is a Next.js 16 app (src/, package.json). The
legacy static-site files (index.html, the 30 *.js, styles.css) are still
present but INERT here — they stay live from `main` until cutover. Do not
edit them on this branch.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# AGENTS.md — CID Portal (orientation & audit for developers)

> Audience: developers and maintainers working in this repo. Read this before editing.
> It encodes the architecture, the conventions every module follows, the
> data-layer contract, and a full audit (findings + remediation). Last full
> audit: 2026-06-16.

---

## 1. What this is

A single-page web app for the "Criminal Investigation Division" (a GTA-RP
roleplay org). It's an **operations portal**: cases, persons, gangs, narcotics,
ballistics, reports, RICO builder, personnel, a shared document "Drive", live
records, and a central command dashboard.

**Stack — deliberately build-free:**
- Vanilla ES2017 JS in IIFEs. **No bundler, no framework, no npm install, no test runner.**
- Tailwind via Play CDN (utility classes inline in markup; config in `index.html`).
- Supabase JS v2 (CDN) for auth, Postgres (RLS), and realtime.
- jsPDF (CDN) for `.docx`/PDF-style exports.
- Hosting: static files. Open `index.html` / serve the folder; there is nothing to compile.

Because there is no build step, **everything you write ships as-authored**.
Keep it framework-free and match the surrounding style.

---

## 2. File map

| File | Role |
|---|---|
| `index.html` | App shell + **every view** (`<section id="view-*">`), nav (`.nav-link`/`.bnav-link`), Tailwind config, CDN scripts, and `window.CID_SUPABASE` config. |
| `supabase.js` | The data layer. Builds the Supabase client and exposes **`window.CIDDB`** (auth + thin CRUD + realtime). Loaded first. |
| **feature `*.js`** | The app, **split by feature** (see below). All are **classic scripts that share one global lexical scope** — `const`/`let`/`function` declared in one are visible in the others. **No bundler; load order matters** (set in `index.html`). |
| `auth.js` | Login gate. Drives `body[data-auth]` (`out`/`in`); shows login / pending-approval / app. Calls `window.CIDApp.onAuthed()` once a user is approved. Loads **last**. |
| `styles.css` | Small amount of custom CSS (animations, `data-auth` shell hiding, print rules). |
| `supabase/migrations/*.sql` | Postgres schema, RLS, triggers, realtime. |
| `README.md`, `SETUP.md`, `CHANGELOG.md`, `supabase/*.md`, `docs/` | Human docs. |

### Feature files (load order in `index.html` — shared global scope)
`supabase.js` (IIFE; `window.CIDDB` client + data layer) →
`core.js` (data models, utilities incl. `esc`/`escapeHTML` alias + `debounce`, **bulk-import helpers** incl. `.xlsx`, router/shell + `PAGE_META`, modal engine) →
`casefiles.js` (cases + evidence + custody + timeline; declares `DB()`/`dbReady()`/`casesCache`; **defines `window.CIDApp.onAuthed`** = fetch-all + realtime subscriptions) →
`command.js` (Central Command, trackers, `PROFILES`, `notify`, `officerName`) → `narcotics.js` → `ballistics.js` →
`personnel.js` (roster/commendations/media) → `modus.js` (M.O. detector + cross-case alert) → `drive.js` (CID General) →
`persons.js` → `gangs.js` → `places.js` → `reports.js` → `rico.js` → `docx.js` (dependency-free OOXML writer) → `records.js` →
`signoff.js` (sign-off chain + LOA; `ROLE_LABEL`, routing, `setMyLoa`) →
`collab.js` (officer info card, in-case chat, case access requests/grants, announcements) →
`app.js` (notifications/admin/case-packet export + global search + `init()` boot on `DOMContentLoaded`) →
`auth.js` (IIFE; login gate; calls `window.CIDApp.onAuthed`).

> History note: the split originally (a) dropped `casefiles.js` from `index.html` and (b) referenced `escapeHTML` while only `esc` was defined — both broke the app on this branch and are now fixed (`casefiles.js` is wired; `escapeHTML = esc` alias in `core.js`). Keep `casefiles.js` loaded and before `command.js`.

**Why this works without a build step:** for non-module scripts, top-level `let`/`const`/`class`
go into the *shared* global lexical environment and `function`/`var` go onto the global object —
so every file sees every other file's declarations. The split is a **byte-for-byte contiguous
slice** of the original single IIFE, loaded in original order, so behavior is identical.

**Rules when editing across files:**
- **Keep load order = original code order.** Don't reorder `<script>` tags; a top-level statement that runs at load (there are only 3: a nav-wiring line in `core.js`, a global click handler in `personnel.js`, and the `DOMContentLoaded` listener in `app.js`) must not reference a symbol declared in a *later* file.
- Identifiers are **global** — names must stay unique across all files (no redeclaring).
- Function-to-function calls across files resolve at **runtime** (after all scripts load), so they're order-independent. Only *load-time* references care about order.
- `casefiles.js` defines `window.CIDApp.onAuthed` (fetch-all + subscriptions); `collab.js` defines `window.CIDApp.refreshAuthBar`; both must load **before** `auth.js`, which calls `onAuthed`. `app.js` `init()` runs on `DOMContentLoaded`.

---

## 3. Auth & RBAC model (read before touching data access)

**Authentication** (`supabase.js` + `auth.js`): Supabase Auth with Google OAuth,
Discord OAuth, and email magic-link (OTP). No passwords.

**Approval gate (deny-by-default):** a new sign-in gets a `profiles` row with
`role='detective', active=false` and sees **nothing** until a Command/Director
flips `active=true`. `body[data-auth]` is `out` (login/pending) or `in` (app).

**Roles** (`app_role` enum): `detective`, `supervisor`, `director`, `command`.

| Capability | Rule | Enforced by |
|---|---|---|
| Read any entity | `active = true` | `private.is_active()` in RLS `SELECT` |
| Insert / update | `active = true` | `private.is_active()` in RLS `INSERT`/`UPDATE` |
| Delete | role ∈ {`director`,`command`} | `private.can_delete()` in RLS `DELETE` |
| Manage members | role ∈ {`command`} (+`director` via `is_command`) | `public.assign_member()` rpc, internally guarded |

- Security-definer helpers live in the **non-exposed `private` schema** with
  `search_path=''`. RLS expressions call them as the caller.
- Bootstrap the first admin once: `select public.bootstrap_command('email@x');`.
- **The client mirrors these rules for UX only** via `DB().canEdit()` /
  `DB().canDelete()` (to show/hide buttons). **RLS is the real boundary** — never
  rely on the client checks for security.

---

## 4. Data-layer contract — `window.CIDDB` (alias `DB()` in app.js)

`supabase.js` is the **only** place that talks to Supabase directly. Everything
else goes through this surface:

```js
DB().ready                  // bool: client configured & key present
DB().me                     // cached current profile (set by auth.js)
DB().canEdit()              // me.active
DB().canDelete()            // me.role is director|command
DB().role()

DB().list(table, {          // → Promise<rows[]> (throws on error)
  select, order, ascending, eq:{col:val}
})
DB().insert(table, row)     // → {data, error}  (returns inserted rows via .select())
DB().update(table, id, patch) // → {data, error}  (matches on id)
DB().remove(table, id)      // → {error}
DB().rpc(fn, args)          // → {data, error}
DB().subscribe(table, cb)   // realtime: postgres_changes '*' on public.<table>
DB().from(table)            // escape hatch: raw PostgREST builder
```

In `app.js`: `const DB = () => window.CIDDB;` and
`const dbReady = () => !!(DB() && DB().ready);`.

**Conventions when calling it:**
- `list` **throws**; wrap in `try/catch`. `insert/update/remove` **return `{error}`**; check it and `toast` on failure.
- Always guard with `dbReady()` first; render a "Sign in…" notice when not ready.
- After a successful write: `closeModal()`, `toast(...)`, then re-`fetch*()` (realtime will also fire, but the explicit refetch keeps the initiating client snappy).

---

## 5. The module pattern (every entity module follows this — copy it)

Each domain (cases, gangs, narcotics, …) is a cluster of functions in `app.js`
with the **same shape**. To add or modify a module, mirror it exactly:

```js
let GANGS = [];                              // 1. module-level cache

async function fetchGangs() {                // 2. fetch → cache → render
  if (!dbReady()) { renderGangs(); return; }
  try { GANGS = await DB().list('gangs', { order: 'name' }); } catch (e) {}
  renderGangs();
}

function renderGangs() {                      // 3. pure render from cache
  const g = $('#gang-grid'); if (!g) return;
  const canEdit = DB() && DB().canEdit();
  $('#add-gang')?.classList.toggle('hidden', !canEdit);   // gate write UI
  if (!dbReady()) { g.innerHTML = '<p>Sign in…</p>'; return; }
  g.innerHTML = '';
  GANGS.forEach((row) => g.appendChild(el('div', {…}, `${esc(row.name)}`)));
}

function openGangModal(record) {              // 4. create/edit modal → DB write
  if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
  /* build node, then: */
  const res = record?.id ? await DB().update('gangs', record.id, patch)
                         : await DB().insert('gangs', patch);
  if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
  closeModal(); toast('Saved', 'success'); fetchGangs();
}

function onEnterGangs() { if (dbReady()) fetchGangs(); else /* notice */; }  // 5. router hook
```

Wiring points:
- **Router**: in `navigate(tab)` (in `core.js`) add `if (tab === 'x') onEnterX();`. Tab name = `data-tab` attribute on the nav button.
- **onAuthed** (in `app.js`): add `fetchX();` and, if the view should live-update, `DB().subscribe('x', fetchX);`.
- **init** (in `app.js`): wire button click handlers (`$('#add-x').addEventListener('click', …)`) and call the initial `renderX()`.
- Put the module's functions in the matching feature file (or a new one added to the `index.html` load order in the right position).
- **Bulk import**: add the module to `wireAllImports()` (in `core.js`) with `{ table, label, allow, required, num/bool/lower/upper, after }` to get a CSV/JSON Import button next to its "+ New" action.

**Cross-entity lookups** resolve FK ids to labels from caches, e.g.
`caseNumById(id)` (from `casesCache`), `officerName(id)` (from `PROFILES`),
`gangNameById(id)` (from `GANGS`). Reuse these instead of re-querying.

---

## 6. UI / code conventions

- `$(sel, ctx)` = querySelector, `$$(sel, ctx)` = querySelectorAll→Array.
- `el(tag, attrs, innerHTML)` builds elements (`class`, `on*` handlers, attrs).
- **`esc(str)` every piece of user/DB data** interpolated into an HTML string. This is the XSS boundary — do not skip it.
- `toast(msg, type)` with type ∈ `info|success|warn|danger`.
- Modals: `openModal(node, { wide })` / `closeModal()`. Convention: a `.close-x` button wired to `closeModal`.
- **`Store` (localStorage) is for UI prefs ONLY** — `tab`, `collapsed`, `theme`, `benchType`. **No domain data lives in localStorage** anymore (that migration is complete). Do not reintroduce data caching in `Store`.
- Routing is hash-based (`#tab`); `navigate()` toggles `.view.active` and `.nav-link.active`.
- Money: `fmtUSD`. Dates: `timeAgo`, `todayISO`. Exports: `downloadDocx`, `downloadCsv`, `exportDocText`.

### Adding a new table + module — checklist
1. New migration `supabase/migrations/<UTCstamp>_<name>.sql`: `create table` + `enable row level security` + the 4 standard policies (`is_active` select/insert/update, `can_delete` delete) + `touch`/`audit` triggers + `alter publication supabase_realtime add table`. Copy an existing table block in `20260616090000_platform.sql`.
2. Apply it to the live `cid` project (see §8).
3. Add the cache + `fetch*`/`render*`/`open*Modal`/`onEnter*` cluster in `app.js` (§5).
4. Add the `<section id="view-*">` + nav buttons in `index.html`.
5. Wire router + `onAuthed` + `init` (§5).

---

## 7. Schema overview (live `cid` project)

Canonical schema is **`20260616090000_platform.sql`** (applied as `platform_schema_rls`).
~31 tables, all RLS-enabled. Grouped:

- **Identity/RBAC:** `profiles`.
- **Cases:** `cases`, `case_assignments`, `case_files` (Drive-per-case attachments).
- **People/Orgs:** `persons`, `gangs`, `gang_ranks`, `gang_members`, `gang_turf`.
- **Domain intel:** `narcotics`, `narcotic_precursors`, `narcotic_hotspots`, `places`, `place_process_steps`, `ballistics_benches`, `ballistic_footprints`, `evidence`, `custody_chain`, `mo_profiles`.
- **Casework:** `reports`, `trackers`, `rico_cases`, `predicate_acts`, `raid_compensations`, `tickets`.
- **Sign-off + collab (Phases 5–6):** `case_signoff_history` (append-only; `cases` also carries `signoff_status/stage/assignee/submitted_by/at`), `case_messages` (in-case chat), `case_access_requests` + `case_access_grants` (cross-case access), `announcements`. `profiles` carries `loa/loa_since`.
- **Content:** `media` (evidence vault — URL/embed based), `documents` (CID General "Drive"; folders are client config in `FOLDER_META`, files are rows keyed `(folder,name)`), `commendations`.
- **System:** `notifications`, `audit_log`, plus `cid_records` (bespoke "Live Records" module).

Helper fns (security-definer, `search_path=''`): `private.is_active/role/can_delete`, `is_command` (now **director OR command**), `can_access_case`, `can_grant_case`, `can_announce`.

Enums: `app_role` (detective, **senior_detective**, supervisor, **bureau_lead**, **deputy_director**, command, director), `bureau (LSB/BCB/SAB/JTF)`, `case_status, report_kind, threat_level, density, location_type, media_type, tracker_status, bench_type, evidence_tamper, doc_kind`. Sign-off chain maps: Bureau Lead = `bureau_lead`/`supervisor`, Deputy Director = `deputy_director`/`command`, Director = `director`.

---

## 8. Migrations & live-project facts

- **Live project used by the app:** Supabase project **`cid`** = `jhxuflzmqspidkvjckox` (region ap-northeast-1). URL hardcoded in `index.html` → `window.CID_SUPABASE.url`. The anon/publishable key is also there (public by design; RLS protects data).
- **Apply migrations** via the Supabase MCP `apply_migration` (web/remote env has no Supabase CLI). After DDL, run `get_advisors` (security + performance).
- **Applied history** (in order): `cid_records`, `cid_records_owner_update`, `cid_touch_search_path`, `case_files`, `platform_schema_rls`, `harden_definer_grants`, `gang_turf_and_member_rank`, `commendations`, `documents_seed`.
- ⚠️ **Orphaned migration files** (present in repo, **NOT applied** to `cid`, superseded by the platform migration — they describe an older "sahp-rbac" design with different table names like `locations`/`case_reports`/`rico_predicate_catalog`/`activity_log`):
  - `20260615120000_init_schema_rls.sql`
  - `20260615120100_storage.sql` (storage buckets `evidence`/`mugshots`/`backups` — **not created** on `cid`)
  - `20260615120200_seed_catalogs.sql`
  Do **not** assume these are live. If you need their objects, port them into a fresh migration against the platform schema.
- **Migration filename vs applied version can differ** — e.g. `commendations` is `20260616145910` in the DB but `..._commendations.sql` locally. Don't rename applied migrations to "fix" this; just keep new stamps monotonic.

---

## 9. AUDIT FINDINGS (2026-06-16)

Severity: 🔴 act soon · 🟡 worth fixing · 🟢 informational / by-design.

### Security
1. 🟡 **`case_files.cf_delete` policy is `USING (true)`** — *any active member* can delete case-file attachments, contradicting the deny-by-default delete model (every other table restricts DELETE to `can_delete()` = director/command). Live advisor flags this (`rls_policy_always_true`). **Fix:** change to `using ( private.can_delete() )` (or owner-or-command) in a new migration. File: `20260615160000_case_files.sql:44`.
2. 🟢 **`assign_member` is a SECURITY DEFINER fn executable by `authenticated`** — flagged by the advisor but **by design**: it raises unless `private.is_command()`. `anon/public` execute is already revoked. Optionally also revoke from non-command, but functionally safe.
3. 🟢 **Leaked-password protection disabled** (auth advisor) — **N/A**: the app uses OAuth + email magic-link only; there are no passwords. Ignore unless password auth is added.

### Performance (advisor; all low-impact today — most tables have 0 rows)
4. 🟡 **`auth_rls_initplan` on `cid_records` and `case_files`** — their policies call `auth.uid()` per-row instead of `(select auth.uid())`. Platform tables already use the `(select …)` form. **Fix** when convenient: wrap `auth.<fn>()` in a scalar subquery in those two migrations.
5. 🟢 **~50 unindexed foreign keys** across entity tables (`*_case_id`, `*_created_by`, etc.). No impact at current scale; add covering indexes if any table grows large.
6. 🟢 **Multiple permissive policies on `profiles`** (`profiles_command` + `profiles_sel`/`profiles_upd_self` for the same role/action) and a few **unused indexes**. Micro-optimizations only.

### Code / repo health
7. 🟡 **Orphaned migration files** not applied to live (see §8) — risk that a developer reads them as truth. Consider deleting or moving to `docs/` to avoid confusion.
8. 🟢 ~~`app.js` is a ~2470-line monolith~~ **RESOLVED** — split into 16 feature files (shared global scope, no build step). See §2.
9. 🟢 **A couple of hardcoded display strings in `index.html`** (e.g. the Drive header "11 folders") are not data-driven; harmless but can drift from `FOLDER_META`.
10. 🟢 **CI Risk Matrix** in the Drive is a *live computed read-only view* from a static `CI_MATRIX` array (no CI table exists). If CIs become real data, add a table and replace the `content.view='matrix'` special-case in `openDocument`.

### Verified healthy ✅
- Every domain module is Supabase-backed, RLS-protected, and realtime-subscribed; **no domain data in localStorage**.
- Deny-by-default read gate + role-based delete enforced in the DB (not just client).
- `private` helpers use `search_path=''` (search-path-injection safe).
- `esc()` is used consistently on interpolated DB/user content.
- `app.js` passes `node --check`.

---

## 10. Footguns (things that will bite you)

- **Don't edit `supabase.js` to add table-specific logic** — keep it generic; module logic belongs in `app.js`.
- **`DB().list` throws, writes return `{error}`** — two different error idioms; handle each correctly.
- **Realtime won't fire for the writer's own optimistic UI reliably enough** — always re-`fetch*()` after a write.
- **New tables need all of: RLS policies + triggers + realtime publish** or the module will silently fail to read/write/update-live. Copy a full table block from the platform migration.
- **The anon key in `index.html` is public on purpose.** Don't "fix" it by hiding it; security is RLS. Do not paste a `service_role` key anywhere client-side.
- **`window.CID_SUPABASE.url` points at one specific project.** If you spin up a new Supabase project, update it there.
- No tests exist. Validate JS with `node --check app.js` and validate DB changes with `get_advisors` after applying.

# Case Files (Google Drive per case) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone "Case Files" tab where signed-in members attach Google Drive files to a case (one folder per case number), backed by a new Supabase table with live sync.

**Architecture:** All UI/logic lives in the single `index.html`. A new `public.case_files` table (authenticated-only read) stores Drive file *metadata* (link + name), never the file itself. Files are chosen via the Google Picker using least-privilege `drive.file` scope; the existing Supabase client/auth session is reused. Realtime keeps all clients in sync.

**Tech Stack:** Static HTML + precompiled Tailwind, `@supabase/supabase-js@2` (CDN), Google Identity Services (`gsi/client`) + Google Picker (`apis.google.com/js/api.js`), Supabase Postgres + RLS + Realtime (project `cid` / `jhxuflzmqspidkvjckox`).

**Project testing note:** there is no JS unit-test harness in this repo. "Verify" steps use: `node --check` on the extracted inline script for syntax; Supabase MCP (`execute_sql`) for DB/RLS assertions; and manual/Playwright for the UI. Commit after each task. Do the work on a feature branch (`feat/case-files-drive`).

**XSS note:** rendering follows the repo's established escaped-template pattern — build each markup string with every interpolated value passed through `esc()` (HTML-escape) and every URL through `safeUrl()` (http/https only), then assign it to the container element. Never inject raw user/DB text.

---

## File structure

- **Modify:** `index.html` — the entire feature (config block, shared client refactor, nav entries, new `#view-case-files` section, JS module `CASE FILES`, `init()` wiring, routing).
- **Create:** `supabase/migrations/<ts>_case_files.sql` — table + RLS + index + realtime. Also applied to the live project via Supabase MCP.
- **Modify:** `.gitleaks.toml` — allowlist the public Google client id / API key.
- **Create:** `supabase/CASE_FILES_SETUP.md` — the Google Cloud click-by-click + key-paste steps.

JS lives in one `CASE FILES` section in `index.html` (mirrors the existing `LIVE CID RECORDS` section) so related code stays together.

---

## Task 1: Database — case_files table + RLS

**Files:**
- Create: `supabase/migrations/<ts>_case_files.sql` (timestamp e.g. `20260615160000`)
- Apply to project `jhxuflzmqspidkvjckox` via Supabase MCP `apply_migration`.

- [ ] **Step 1: Write the migration file** (table, index, RLS, realtime)

SQL: create `public.case_files` ( id uuid pk default gen_random_uuid(); case_number text not null; drive_file_id text not null; name text not null; mime_type text; icon_url text; web_view_link text not null; added_by uuid references auth.users on delete set null; created_at timestamptz not null default now() ). Index on (case_number). enable row level security. Policies (drop-if-exists then create): `cf_read` for select to authenticated using (true); `cf_insert` for insert to authenticated with check (auth.uid() = added_by); `cf_delete` for delete to authenticated using (true). Then `alter publication supabase_realtime add table public.case_files;`.

- [ ] **Step 2: Apply via Supabase MCP** — `apply_migration` (project jhxuflzmqspidkvjckox, name case_files). Expected `{"success":true}`.
- [ ] **Step 3: Verify** — `list_tables` shows `public.case_files`, rls_enabled true; `get_advisors` (security) returns no new lints.
- [ ] **Step 4: Commit** the migration file (`feat: add case_files table (auth-only read, owner-stamped insert)`).

---

## Task 2: Google config block + gitleaks allowlist

- [ ] **Step 1:** In `index.html`, immediately after the `window.CID_SUPABASE = {...}` block, add a `window.CID_GOOGLE = { clientId, apiKey, appId }` block with `PASTE_*` placeholders.
- [ ] **Step 2:** In `.gitleaks.toml` add regexes for `[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com` and `AIza[0-9A-Za-z_-]{35}`.
- [ ] **Step 3:** Verify gitleaks clean: `gitleaks detect --source . --no-git -f json -r gl.json; python -c "import json;print(len(json.load(open('gl.json'))))"; rm gl.json` -> 0.
- [ ] **Step 4: Commit** (`feat: add Google Picker config block + gitleaks allowlist`).

---

## Task 3: Share the Supabase client/session across modules

Reuse the one client/session the records module creates (no second login).

- [ ] **Step 1:** Add module-scope accessors near the records section: `cidClient()` returns `sb`; `cidSession()` returns `recSession`; `cidConfigured()` returns the existing config check.
- [ ] **Step 2:** Make `recConfigured()` delegate to `cidConfigured()`.
- [ ] **Step 3:** In `initRecords` auth handlers (both the initial `getSession().then` and `onAuthStateChange`), after setting `recSession`, call `window.renderCaseFiles?.()` and `window.renderCaseFilesAuth?.()` (guarded).
- [ ] **Step 4: Verify syntax** — `sed -n '523,2300p' index.html > /tmp/app.js && node --check /tmp/app.js && echo OK`.
- [ ] **Step 5: Commit** (`refactor: share supabase client/session for case files reuse`).

---

## Task 4: New "Case Files" tab — nav, view container, routing

- [ ] **Step 1:** Sidebar: add a `data-tab="case-files"` nav button (icon 🗂️, label "Case Files") after the `drive` button.
- [ ] **Step 2:** Bottom nav: add a matching `data-tab="case-files"` button (label "Files").
- [ ] **Step 3:** Add `<section id="view-case-files" class="view">` after `#view-drive` containing: header, `#cf-auth`, hidden `#cf-notice`, hidden `#cf-toolbar` (with `#cf-case` input + `#cf-case-list` datalist, `#cf-attach` button, `#cf-search` input), and `#cf-grid`. Every dynamic value rendered later goes through `esc()`/`safeUrl()`.
- [ ] **Step 4:** Add `'case-files': { title: 'Case Files', sub: 'Google Drive files per case' }` to `PAGE_META`.
- [ ] **Step 5:** Add a global-search route: `else if (/case file|attachment|drive file|evidence file/.test(q)) navigate('case-files');`.
- [ ] **Step 6: Verify** — syntax via node --check; manual: tab switches, no console errors.
- [ ] **Step 7: Commit** (`feat: scaffold Case Files tab (nav, view, routing)`).

---

## Task 5: Case Files JS module — auth gating, known-case combobox, fetch + render

Add a `CASE FILES` JS section after the records section.

- [ ] **Step 1:** Module state: `cfCache = []`, `cfChannel = null`, and `fileEmoji(mime)` helper (pdf/image/sheet/doc/folder/default).
- [ ] **Step 2:** `cfCaseOptions()` — build the datalist from `window.ACTIVE_CASES` ∪ distinct `cid_records.case_number` (fetched via `cidClient()`) ∪ case numbers already in `cfCache`; render escaped `<option>`s. NOTE: ensure `ACTIVE_CASES` is reachable — expose `window.ACTIVE_CASES = ACTIVE_CASES;` at its definition if needed.
- [ ] **Step 3:** `renderCaseFilesAuth()` — show signed-in identity or a "sign in on CID Records tab" hint; toggle `#cf-toolbar` visibility on session presence.
- [ ] **Step 4:** `fetchCaseFiles()` — if no session, clear cache and render; else `select('*').order('case_number').order('created_at')`; on error show `#cf-notice`. `renderCaseFiles()` — group `cfCache` by `case_number` into folder cards; each file is a row with a `safeUrl(web_view_link)` link + `esc(name)` + a `.cf-del` button carrying `data-id`; wire delete buttons to `cfRemove`. Empty/sign-in states handled.
- [ ] **Step 5: Verify syntax** — node --check.
- [ ] **Step 6: Commit** (`feat: case files module (auth gating, case combobox, render)`).

---

## Task 6: Google Picker — lazy load, OAuth token, open picker

- [ ] **Step 1:** `loadScript(src)` promise helper; `cfGoogleConfigured()` (keys present, not `PASTE_`); `cfEnsureGoogle()` loads `https://accounts.google.com/gsi/client` then `https://apis.google.com/js/api.js`, runs `gapi.load('picker')`, and inits `google.accounts.oauth2.initTokenClient({ client_id, scope: 'https://www.googleapis.com/auth/drive.file' })` (cache the promise).
- [ ] **Step 2:** `cfGetToken()` — set `cfTokenClient.callback` to resolve with `resp.access_token` (reject on `resp.error`), call `requestAccessToken({ prompt: cfAccessToken ? '' : 'consent' })`.
- [ ] **Step 3:** `cfOpenPicker(token, onPicked)` — `PickerBuilder().setAppId(appId).setOAuthToken(token).setDeveloperKey(apiKey)` with a DOCS view + a folders view, `MULTISELECT_ENABLED`, callback fires `onPicked(documents)` when `ACTION === PICKED`.
- [ ] **Step 4: Verify syntax** — node --check.
- [ ] **Step 5: Commit** (`feat: lazy-load Google Picker + drive.file token flow`).

---

## Task 7: Attach + remove flows

- [ ] **Step 1:** `cfAttach()` — require session + a non-empty `#cf-case`; if `!cfGoogleConfigured()` show notice; else `await cfEnsureGoogle()`, `await cfGetToken()`, `cfOpenPicker(token, docs => ...)`. Map each picked doc to a row `{ case_number, drive_file_id: ID, name: NAME, mime_type: MIME_TYPE, icon_url: ICON_URL, web_view_link: URL, added_by: session.user.id }` and `insert` via `cidClient()`. Toast result; `fetchCaseFiles()`.
- [ ] **Step 2:** `cfRemove(id)` — require session; `delete().eq('id', id)`; toast; `fetchCaseFiles()`.
- [ ] **Step 3: Verify syntax** — node --check.
- [ ] **Step 4: Commit** (`feat: attach (picker to insert) and remove case files`).

---

## Task 8: Init wiring + realtime

- [ ] **Step 1:** `initCaseFiles()` — expose `window.renderCaseFiles`/`window.renderCaseFilesAuth`; wire `#cf-attach` click to `cfAttach`, `#cf-search` input to `renderCaseFiles`; initial `renderCaseFilesAuth()` + `renderCaseFiles()`; if configured, `cfCaseOptions()`, fetch when signed in, and subscribe a realtime channel `case_files_live` on `case_files` changes to `fetchCaseFiles`.
- [ ] **Step 2:** Call `initCaseFiles();` from `init()` right after `initRecords();`.
- [ ] **Step 3: Verify syntax** — node --check.
- [ ] **Step 4: Commit** (`feat: init case files + realtime sync`).

---

## Task 9: Google Cloud setup docs

- [ ] **Step 1:** Create `supabase/CASE_FILES_SETUP.md` with click-by-click: create/choose GCP project (note project number = appId); enable Picker API + Drive API; OAuth consent screen (External + test users or publish); API key restricted by HTTP referrer to Pages origin + localhost and to the Picker API; OAuth Web Client ID with authorized JS origins = Pages URL + localhost; paste the 3 values into `window.CID_GOOGLE`. Document the two-login note and the Drive-sharing caveat (teammates can open a file only if it is shared in Drive).
- [ ] **Step 2: Commit** (`docs: Google Cloud setup for Case Files picker`).

---

## Task 10: End-to-end verification

- [ ] **Step 1:** JS syntax — `sed -n '523,2450p' index.html > /tmp/app.js && node --check /tmp/app.js && echo OK`.
- [ ] **Step 2:** RLS via Supabase MCP `execute_sql`: query `pg_policies` for `case_files` → expect `cf_read` (authenticated), `cf_insert`, `cf_delete`. (SQL editor runs as service role, so verify the auth-only behavior in-app, not via raw SQL.)
- [ ] **Step 3:** Manual/Playwright: sign in (CID Records) → Case Files → toolbar appears → pick a case → Attach from Drive → Google consent → Picker → pick file → chip appears. 2nd browser (other user) sees it via realtime and can remove. Sign out → only the sign-in prompt shows (auth-only read).
- [ ] **Step 4:** Regression: CID Records, existing CID General tab, routing/global-search unaffected.
- [ ] **Step 5: Commit** any verification fixes.

---

## Self-review notes

- **Spec coverage:** Task 1 = data model/RLS (auth-only read, owner-stamped insert, any-member delete, realtime); Tasks 4–8 = standalone tab, combobox (known ∪ free), Picker (`drive.file`), attach/remove, realtime; Task 9 = guided Google setup; Task 2 = public-key allowlist; Task 10 = testing incl. caveats. All spec sections mapped.
- **Open items:** migration timestamp assigned in Task 1; "restrict delete later" remains an explicit future option, not in scope.
- **Naming consistency:** `cidClient()`/`cidSession()`/`cidConfigured()`, `fetchCaseFiles()`/`renderCaseFiles()`/`renderCaseFilesAuth()`, `cfAttach()`/`cfRemove()`, table `case_files`, channel `case_files_live` — consistent across tasks.
- **Assumption to verify during execution:** `ACTIVE_CASES` scope (Task 5 Step 2).

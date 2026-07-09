# Case Files — Google Drive attachments per case (design)

**Date:** 2026-06-15
**Status:** Approved (pending spec review)
**Project:** CID Portal (`index.html`, static site + Supabase project `cid` / `jhxuflzmqspidkvjckox`)

## Summary

Add a new, standalone **Case Files** tab to the portal: a shared set of
per-case folders where signed-in members attach **Google Drive** files to a
case. Files live in Google Drive (we store only the link + metadata); the
links/metadata live in a new Supabase table and sync live to all open clients.

This is **decoupled** from the live CID Records tab (its own table, keyed by
case number) and sits **alongside** the existing mock "CID General" tab (which
is unchanged local paperwork).

## Goals

- A "Case Files" tab showing one folder per case number, files listed inside.
- Signed-in members attach Drive files via the Google **Picker** and remove them.
- Live sync across clients (Supabase realtime).
- Least-privilege Google access; public site stays static (no backend server).

## Non-goals

- No file hosting in the app (files stay in Google Drive; we store links only).
- No changes to the existing mock CID General tab or the CID Records tab.
- No managed `cases` table — files are keyed by a free-form case number.
- No automatic Drive sharing/permission management (the user shares in Drive).

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Attach mechanism | Google **Picker** (real Drive API) |
| OAuth scope | `https://www.googleapis.com/auth/drive.file` (least privilege) |
| Shape | Standalone system: new tab + new table, keyed by `case_number` |
| Case association | Pick from known case numbers **+ allow typing a new one** |
| Who attaches/removes | **Any signed-in member** |
| Read visibility | **Authenticated only** (logged-out visitors see nothing) |
| Tab name | "Case Files" (renamable) |

## Data model — `public.case_files`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `default gen_random_uuid()` |
| `case_number` | text not null | e.g. `[LSB] Case-1000001`; indexed for grouping |
| `drive_file_id` | text not null | Google Drive file id |
| `name` | text not null | file name from Picker |
| `mime_type` | text | from Picker |
| `icon_url` | text | from Picker |
| `web_view_link` | text not null | URL to open the file in Drive |
| `added_by` | uuid | FK → `auth.users on delete set null` |
| `created_at` | timestamptz not null | `default now()` |

- Index: `create index on public.case_files (case_number)`.
- RLS (`enable row level security`):
  - **select** → `authenticated` only, `using (true)`. (Not `anon`.)
  - **insert** → `authenticated`, `with check (auth.uid() = added_by)`.
  - **delete** → `authenticated`, `using (true)` (any signed-in member).
  - No update policy (rows are immutable metadata).
- Realtime: `alter publication supabase_realtime add table public.case_files;`
- Trigger function (if any helper is added) pins `search_path = ''`
  (consistent with `cid_touch_updated_at`).

Delivered as a new migration `supabase/migrations/2026XXXXXXXXXX_case_files.sql`
and applied to project `jhxuflzmqspidkvjckox`.

## Google Cloud setup (guided, click-by-click in the impl plan)

1. Create / pick a Google Cloud project; note the **project number** (`appId`).
2. Enable **Google Picker API** and **Google Drive API**.
3. OAuth consent screen: External, add yourself as a test user (or publish).
4. Create an **API key**; restrict it by HTTP referrer to the Pages origin +
   `http://localhost*`, and restrict to the Picker API.
5. Create an **OAuth 2.0 Client ID** (Web application); authorized JS origins =
   the GitHub Pages URL + `http://localhost:<port>`.
6. Paste values into a new public config block in `index.html`:
   ```js
   window.CID_GOOGLE = {
     clientId: '….apps.googleusercontent.com',
     apiKey:   '…',
     appId:    '<project number>'
   };
   ```
   These are public client-side values (like the Supabase publishable key);
   safe to commit. Allowlist the API key / client id pattern in `.gitleaks.toml`.

## Frontend architecture (all in `index.html`)

- **Shared Supabase client:** lift the client/session the records module creates
  (`sb`, `recSession`) into a shared accessor so Case Files reuses one client and
  one auth session (no second Supabase login).
- **Google libraries, lazy-loaded** on first "Attach from Drive" click:
  - Google Identity Services (`https://accounts.google.com/gsi/client`) → OAuth
    token client for the `drive.file` scope.
  - `https://apis.google.com/js/api.js` → `gapi.load('picker')`.
- **New tab** `case-files` registered in `PAGE_META`, nav (sidebar + bottom bar),
  and the `navigate()`/global-search routing.
- **View layout:**
  - Auth-aware: if not signed in, show a "sign in to view case files" notice
    (reusing the records auth bar pattern); fetch nothing.
  - Attach bar: case-number combobox (known numbers = `ACTIVE_CASES` ∪ distinct
    `case_number` from `cid_records`, plus free-entry) + "Attach from Drive".
  - Body: files grouped by `case_number` into folder cards; each file a row
    (icon + name → `web_view_link`) with a × remove control. Search/filter by
    case number. Empty state.

## Flows

**Attach:** pick/enter case number → "Attach from Drive" → ensure `drive.file`
token via GIS → open Picker (DocsView, multi-select allowed) → for each picked
file `{id, name, mimeType, url, iconUrl}`, insert a `case_files` row with
`added_by = session.user.id` → realtime broadcasts → folder updates everywhere.

**Remove:** click × on a file row → delete the `case_files` row by id → realtime
removes it for all clients.

**Render/refresh:** initial fetch ordered by `case_number, created_at`; a
realtime channel on `case_files` re-fetches/patches on any change.

## Security & caveats

- **Read is authenticated-only:** logged-out visitors get nothing for Case Files
  (stricter than the public records board).
- **Insert stamps the adder** (`added_by = auth.uid()`); **any member may delete**
  (accepted trade-off).
- **Two logins:** Supabase (manage) + Google (pick files) — inherent.
- **Cross-account Drive visibility:** we store the link only; **Google enforces
  its own sharing.** A teammate can open a file only if its Drive sharing allows
  them. Surface a one-line hint in the attach UI ("share the file in Drive so the
  team can open it"). `drive.file` means the app cannot change sharing.
- **CSP:** the site ships no CSP today, so Google scripts load fine. If a CSP is
  added later, `script-src`/`connect-src`/`frame-src` must allow
  `apis.google.com`, `accounts.google.com`, `*.googleusercontent.com`,
  `docs.google.com`.
- **Secrets:** `clientId`/`apiKey`/`appId` are public; allowlisted in gitleaks.

## Testing

- **Manual:** sign in → pick a case → attach a Drive file → chip appears under the
  case folder and a row lands in `case_files` → open a 2nd browser, confirm it
  syncs via realtime → remove → confirm gone in both → sign out, confirm the tab
  shows nothing (authenticated-only read).
- **DB / RLS:** anon `select` returns 0 rows; authenticated `insert` with a
  mismatched `added_by` is rejected; authenticated `delete` succeeds for a
  different member's row (by design).
- **Regression:** records tab, existing CID General tab, and routing unaffected.

## Open items

- Exact migration timestamp filename (assigned at implementation).
- Optional later: restrict delete to adder/owner if "any member deletes" proves
  too loose; soft-delete instead of hard delete.

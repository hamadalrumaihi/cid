# Case Files (Google Drive) — setup

The **Case Files** tab lets signed-in members attach Google Drive files to a case
(one folder per case number). Files stay in Google Drive; the portal stores only
the link + metadata in the Supabase table `case_files` (authenticated-only read).

- **Migration:** `supabase/migrations/20260615160000_case_files.sql` (already applied
  to project `cid` / `jhxuflzmqspidkvjckox`).
- **Frontend:** the **Case Files** tab in `index.html`, using the Google Picker
  (`drive.file` scope) + the shared Supabase session from the CID Records tab.

## What you must set (three public values)

In `index.html`, find the `window.CID_GOOGLE` block and replace the placeholders:

```js
window.CID_GOOGLE = {
  clientId: 'PASTE_OAUTH_WEB_CLIENT_ID.apps.googleusercontent.com',
  apiKey:   'PASTE_BROWSER_API_KEY',
  appId:    'PASTE_GCP_PROJECT_NUMBER'
};
```

All three are **public client-side values** — safe to commit (the API key is
referrer-restricted, the OAuth client is origin-restricted, and RLS + Google Drive
sharing protect the actual data). They are allowlisted in `.gitleaks.toml`.

## Google Cloud Console — click by click

1. **Project:** go to https://console.cloud.google.com → create or pick a project.
   Note the **Project number** (Dashboard → "Project info") — that is `appId`.
2. **Enable APIs:** APIs & Services → Library → enable **Google Picker API** and
   **Google Drive API**.
3. **OAuth consent screen:** APIs & Services → OAuth consent screen → User type
   **External** → fill app name / support email → **Scopes:** add
   `.../auth/drive.file` → **Test users:** add each detective's Google email
   (or **Publish** the app once you're ready for everyone).
4. **API key:** APIs & Services → Credentials → Create credentials → **API key**.
   Edit it → **Application restrictions: HTTP referrers** → add your site origin
   (e.g. `https://<user>.github.io/*`) and `http://localhost:*` for local testing →
   **API restrictions:** restrict to **Google Picker API**. This is `apiKey`.
5. **OAuth client ID:** Create credentials → **OAuth client ID** →
   Application type **Web application** → **Authorized JavaScript origins:** add
   your Pages URL (e.g. `https://<user>.github.io`) and `http://localhost:<port>`.
   Copy the **Client ID** → that is `clientId`.
6. **Paste** the three values into `window.CID_GOOGLE` in `index.html`, commit, push.

## Behaviour

- **Read:** authenticated only — logged-out visitors see a sign-in prompt and no data.
- **Sign in** on the **CID Records** tab (Discord or email magic link); the Case
  Files tab shares that session.
- **Attach:** pick a case number (known cases are suggested; you may type a new one)
  → **Attach from Drive** → authorize Google once → pick file(s) in the Picker.
- **Realtime:** attaches/removes broadcast to all open clients.
- **Remove:** any signed-in member can remove a file (× button).

## Caveats (by design)

- **Two logins:** Supabase (to manage) + Google (to pick files) — separate systems.
- **Drive sharing controls access:** the portal stores the link only. A teammate
  can open a file **only if you've shared it in Google Drive** with them (or the
  team). With the `drive.file` scope the app cannot change Drive sharing — set it
  in Drive yourself.
- **Any member can delete** a file entry (the link, not the Drive file). To restrict
  deletes to the adder/owner later, replace the `cf_delete` policy's `using (true)`.

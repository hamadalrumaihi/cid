# SOP sync from Google Drive — setup (one time, ~10 minutes)

The portal pulls SOPs from a Google Drive folder every 15 minutes via the
`sops-sync` edge function (`supabase/functions/sops-sync/index.ts`). Synced docs
appear on Reference > SOPs & Library as readable pages, always current.

## 1. Google service account
1. console.cloud.google.com > create (or reuse) a project > APIs & Services >
   enable **Google Drive API**.
2. IAM & Admin > Service Accounts > Create. No roles needed.
3. Keys > Add key > JSON — download it. You need `client_email` and `private_key`.

## 2. Share the SOP folder
In Google Drive, share the folder that holds the SOP Google Docs with the
service-account email (Viewer). Copy the folder id from its URL
(`drive.google.com/drive/folders/<FOLDER_ID>`).

## 3. Deploy the function + secrets
Dashboard route: supabase.com/dashboard > project `cid` > Edge Functions >
Deploy new function > name `sops-sync`, paste `index.ts`, disable JWT verification.
(CLI route: `supabase functions deploy sops-sync --no-verify-jwt`.)

Then add these secrets (Edge Functions > sops-sync > Secrets):
- `GOOGLE_SA_EMAIL`  = client_email from the JSON
- `GOOGLE_SA_KEY`    = private_key from the JSON (paste as-is)
- `SOPS_FOLDER_ID`   = the folder id
- `SYNC_SECRET`      = the value Claude gave you in chat (already wired into the
  scheduled job; rotate both together if needed)

## 4. Done — verify
The schedule is already running (pg_cron, every 15 min). To test immediately:
`curl -X POST https://jhxuflzmqspidkvjckox.supabase.co/functions/v1/sops-sync -H "x-sync-secret: <SYNC_SECRET>"`
Expected: `{"ok":true,"drive_files":N,"created":...,"updated":...,"skipped":...}`.

Notes: sync is one-way (Drive -> portal) and idempotent; portal-side SOP edits to
synced docs are overwritten on the next Drive change, so treat Drive as the
source of truth for synced SOPs. Docs are matched by Drive file id, renames follow.

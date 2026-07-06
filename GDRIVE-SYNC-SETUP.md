# SOP sync from Google Drive — remaining setup

Server config is already stored in the service-role-only `app_secrets` table
(invisible to app users; verified). The pg_cron job fires every 15 minutes.
Three steps remain, all one-click-ish:

1. **Enable the Drive API** (one click, owner account):
   https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=628249261704
2. **Share the SOP folder** (or individual Google Docs) with
   `service-account@centering-brook-496510-a6.iam.gserviceaccount.com` as Viewer.
   No folder id needed: the sync pulls every Google Doc shared with that account.
   (To pin it to one folder later: `insert into app_secrets(key,value) values ('SOPS_FOLDER_ID','<id>')`.)
3. **Deploy the function** — no secrets to enter:
   Dashboard > Edge Functions > Deploy new function > name `sops-sync`,
   paste `supabase/functions/sops-sync/index.ts`, turn OFF "Verify JWT".
   (CLI: `supabase functions deploy sops-sync --no-verify-jwt`.)

Test: curl -X POST https://jhxuflzmqspidkvjckox.supabase.co/functions/v1/sops-sync \
  -H "x-sync-secret: <SYNC_SECRET from app_secrets>"
Expected: {"ok":true,"drive_files":N,...}. Synced docs appear on Reference >
SOPs & Library as readable pages within 15 minutes of any Drive edit.

Key hygiene: this service-account key was shared in chat and should be treated
as exposed. Rotate it before relying on the sync in production: create a new
JSON key, update `GOOGLE_SA_KEY` in `app_secrets`, verify one sync run, then
delete the old key in Google Cloud IAM. Keep the service account shared only to
the SOP folder or the exact Docs it must read.

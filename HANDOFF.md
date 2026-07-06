# CID Portal — Session Handoff (2026-07-06, current state)

Read this first. Companions: AUDIT-REPORT.md, AUDIT-VERIFY.md, GDRIVE-SYNC-SETUP.md, AGENTS.md.

## Iron rules (unchanged)
Vanilla ES2017, ~33 classic scripts, ONE shared global scope (verify: `cat *.js | node --check`
+ per-file). esc()/escapeHTML() on every interpolation; safeUrl() on user URLs. DB().list()
THROWS; insert/update/remove return {error}. Client gating is UX; RLS + SECURITY DEFINER RPCs
are authority. Bump ?v= stamp (now 20260706f) on every JS/CSS change. No service worker,
framework, or build step. No test data in live DB. Supabase project: jhxuflzmqspidkvjckox.

## Shipped and LIVE on main (all merged, deployed via Vercel)
- Deep audit (45 findings fixed) + verification pass (7 more fixed). Owner-only signoff_submit.
- Tactical UI: obsidian hardware-instrument skin, SVG icon set (tIcon in core.js), View
  Transitions, scroll-timeline, density matrix, phone support, data-stale pulse, sys-telemetry.
- Reference nav category: Penal Code view (penal.js renderPenalView) + SOPs & Library
  (drive.js onEnterSops/sopArticle reader). documents folders 'SOPs'+'Resources' are
  command-write-only (RLS folder guard).
- Google Drive SOP sync: DEPLOYED and VERIFIED ({"ok":true,drive_files:1}). Edge function
  supabase/functions/sops-sync (verify_jwt off) reads config from public.app_secrets
  (RLS deny-all table; holds GOOGLE_SA_EMAIL/KEY, SYNC_SECRET, SOPS_FOLDER_ID =
  SOP/Training folder 1Fyi7NUR8PZ_YlgE_59mbYOQpubV6RUyD). pg_cron job 'sops-sync' every
  15 min via pg_net. One-way Drive->portal, upsert by content.sync.file_id, skip on
  unchanged modifiedTime. SA: service-account@centering-brook-496510-a6.iam.gserviceaccount.com.
- Documents normalized: prose=doc (readable page), tables=sheet, Forms match form schemas
  by NAME (do NOT rename Forms folder docs). SOP/Training folder merged into SOPs.
- Announcement posted+pinned telling testers about Reference tab + new UI.

## Owner's pending clicks (Google side)
1. Rotate the SA key (was pasted in chat) -> update app_secrets.GOOGLE_SA_KEY.
2. Narrow Drive share from '1. CID General' root to SOP/Training only.
3. Move Gang Fact Sheet / CID Roster / Case Building Playbook into SOP/Training (auto-publishes).

## Next builds (agreed, not started)
1. Sheets sync: extend sops-sync — list mimeType spreadsheet, export text/csv, parse to
   {cols,rows}, upsert kind='sheet'; render via existing sheet viewer. Also link-cards for
   images/video in folder (safeUrl'd webViewLink) into Library.
2. AI Analyst: edge function calling Claude API (key in app_secrets), RLS-scoped context
   assembly, "CID Analyst" panel; draft warrants/summaries from case data. Model ids:
   claude-fable-5 / claude-opus-4-8 / claude-sonnet-5.
3. sops-sync recursion (currently direct children of SOPS_FOLDER_ID only — fine for the
   flat SOP/Training folder today).

## Gotchas learned this session
- MCP deploy_edge_function/list_extensions need interactive approval: user deploys via
  dashboard; big payloads into DB: use pg_net http_get server-side, never paste blobs.
- Squash merges: restart branch from origin/main after every merge (branch name
  claude/continue-previous-*; force-with-lease is fine on merged-only history).
- FOLDER_META (core.js) is the Drive top-level list; Reference reads folders directly.

/** Owner Portal static data — distilled from the repository analysis
 *  (docs/handbook). Informational only. Where something is inferred rather
 *  than verified, the text says so. */

/* ---- environment registry (names + purpose only — NEVER values) --------- */

export interface EnvVarDoc {
  name: string
  purpose: string
  required: boolean
  usedIn: string
  ifMissing: string
}

export const ENV_VARS: EnvVarDoc[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', purpose: 'Supabase project API URL', required: true, usedIn: 'src/lib/supabase.ts', ifMissing: 'App renders the setup gate — nothing works' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', purpose: 'Publishable client key (public by design; RLS is the boundary)', required: true, usedIn: 'src/lib/supabase.ts', ifMissing: 'Setup gate; auth failures if wrong' },
  { name: 'NEXT_PUBLIC_FIVEMANAGE_API_KEY', purpose: 'Media upload key (referrer-bound)', required: false, usedIn: 'src/lib/fivemanage.ts', ifMissing: 'Uploads disabled; views show a config banner + paste-URL fallback' },
  { name: 'NEXT_PUBLIC_FIVEMANAGE_BASE_URL', purpose: 'FiveManage API host', required: false, usedIn: 'src/lib/fivemanage.ts', ifMissing: 'Uploads fail' },
]

/* ---- permissions matrix -------------------------------------------------- */

export const PERMISSIONS_MATRIX: { area: string; owner: string; command: string; member: string; inactive: string }[] = [
  { area: 'Work cases / registries (own bureau)', owner: '✓', command: '✓', member: '✓', inactive: '✗' },
  { area: 'Delete registry records (with Undo)', owner: '✓*', command: '✓', member: '✗', inactive: '✗' },
  { area: 'Archive / restore a case', owner: '✓*', command: '✓', member: '✗', inactive: '✗' },
  { area: 'Permanently delete an archived case', owner: '✓ (reason + preview required)', command: '✗', member: '✗', inactive: '✗' },
  { area: 'Approve members / assign roles', owner: '✓*', command: '✓', member: '✗', inactive: '✗' },
  { area: 'Post announcements', owner: '✓*', command: '✓', member: '✗', inactive: '✗' },
  { area: 'Submit feedback', owner: '✓', command: '✓', member: '✓', inactive: '✗' },
  { area: 'View ALL feedback + triage/catalog', owner: '✓', command: '✗', member: 'own only', inactive: '✗' },
  { area: 'Audit Log', owner: '✓', command: '✗', member: '✗', inactive: '✗' },
  { area: 'Developer Handbook (in-app)', owner: '✓', command: '✗', member: '✗', inactive: '✗' },
  { area: 'Owner Portal', owner: '✓', command: '✗', member: '✗', inactive: '✗' },
  { area: 'Grant ownership (is_owner flag)', owner: 'SQL only', command: '✗', member: '✗', inactive: '✗' },
]
export const MATRIX_NOTE =
  '* Owner rights on division data come from the owner account ALSO holding a command role — ownership itself only grants the owner-only areas. Enforcement: profiles.is_owner → private.is_owner() in RLS (audit_log, feedback, feedback_meta) + useAuth().isOwner in the UI. The guard_profile trigger makes is_owner immutable from every client — granting it is a SQL/dashboard operation.'

/* ---- feedback catalog vocabulary ----------------------------------------- */

export const FB_STATUSES = ['new', 'reviewed', 'triaged', 'planned', 'in_progress', 'waiting', 'resolved', 'duplicate', 'rejected', 'archived'] as const
export const FB_TYPES = ['bug', 'suggestion', 'feature_request', 'ux', 'performance', 'security', 'content', 'other'] as const
export const FB_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

export const FB_STATUS_TINT: Record<string, string> = {
  new: 'bg-blue-500/15 text-blue-300', reviewed: 'bg-cyan-500/15 text-cyan-300',
  triaged: 'bg-violet-500/15 text-violet-300', planned: 'bg-indigo-500/15 text-indigo-300',
  in_progress: 'bg-amber-500/15 text-amber-300', waiting: 'bg-slate-500/20 text-slate-300',
  resolved: 'bg-emerald-500/15 text-emerald-300', duplicate: 'bg-slate-500/20 text-slate-400',
  rejected: 'bg-rose-500/15 text-rose-300', archived: 'bg-white/5 text-slate-500',
}
export const FB_PRIORITY_TINT: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-300', medium: 'bg-blue-500/15 text-blue-300',
  high: 'bg-amber-500/15 text-amber-300', critical: 'bg-rose-500/15 text-rose-300',
}
export const fbLabel = (s: string | null | undefined): string =>
  (s ?? '—').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/* ---- suggestions center --------------------------------------------------- */

export interface Suggestion {
  title: string
  group: 'Quick win' | 'Security' | 'Performance' | 'UX & accessibility' | 'Developer experience' | 'Technical debt' | 'Scalability' | 'Testing' | 'Documentation'
  why: string
  files: string
  difficulty: 'S' | 'M' | 'L'
  risk: 'none' | 'low' | 'medium'
  benefit: 'medium' | 'high'
  verify: string
  safeNow: boolean
  /** Release that shipped it (absent = still open). */
  done?: string
}

export const SUGGESTIONS: Suggestion[] = [
  { title: 'Drop unused dependencies (react-hook-form, zod*, @tanstack/react-query)', group: 'Quick win', why: 'Three packages with zero imports inflate install and audit surface. (*or keep zod and adopt it for JSON-column typing.)', files: 'package.json', difficulty: 'S', risk: 'none', benefit: 'medium', verify: 'npm ci && the four gates', safeNow: true , done: 'v1.0.1' },
  { title: 'Drop or verify bootstrap_command/bootstrap_director RPCs', group: 'Security', why: 'Setup-era privileged functions with no app callers — close the door.', files: 'database (migration)', difficulty: 'S', risk: 'none', benefit: 'medium', verify: 'Security advisors re-run; sign-in unaffected', safeNow: true , done: 'v1.0.1' },
  { title: 'Wire or delete lib/drafts.ts', group: 'Quick win', why: 'Good never-lose-work code with zero importers — dead weight or a free feature.', files: 'src/lib/drafts.ts, chat/report editors', difficulty: 'S', risk: 'none', benefit: 'medium', verify: 'Type a chat draft, reload, draft persists', safeNow: true , done: 'v1.0.1' },
  { title: 'Commit the SQL schema to the repo', group: 'Technical debt', why: 'The live DB is the only source of truth; a schema.sql dump + post-folder migration log makes changes reviewable and recoverable.', files: 'supabase/', difficulty: 'M', risk: 'none', benefit: 'high', verify: 'Dump matches live catalog', safeNow: true , done: 'v1.0.1' },
  { title: 'Split CaseDetail.tsx into per-tab files', group: 'Technical debt', why: 'The hottest, largest file (~840 lines, 12 tabs). Mechanical extraction; keep the RicoTab export for RicoView.', files: 'src/components/cases/CaseDetail.tsx', difficulty: 'M', risk: 'low', benefit: 'high', verify: 'All 12 tabs + packet export + RicoView', safeNow: true , done: 'v1.1.0' },
  { title: 'RLS/RPC test suite (two test users)', group: 'Testing', why: 'The security wall had zero automated coverage. Shipped with three rls-test-* accounts; first run caught the missing is_owner EXECUTE grant.', files: 'new tests + Supabase branch', difficulty: 'L', risk: 'low', benefit: 'high', verify: 'Cross-bureau denial, sign-off column locks, owner gates', safeNow: true , done: 'v1.1.1' },
  { title: 'Type the JSON columns with zod at read boundaries', group: 'Developer experience', why: 'reports.fields, media.tags, cases.charges, announcement mentions were unchecked casts. Shipped dependency-free instead of zod: src/lib/jsonShapes.ts parsers at every read boundary.', files: 'src/lib/forms.ts, MediaView, CaseDetail', difficulty: 'M', risk: 'low', benefit: 'medium', verify: 'Old rows still parse; bad shapes surface as toasts', safeNow: true , done: 'v1.1.0' },
  { title: 'Extract a useRegistry hook from the repeated registry skeleton', group: 'Developer experience', why: 'The fetch+version+filter+modal+undo pattern is duplicated ~10×; new registries in minutes. Hook shipped (src/lib/useRegistry.ts); piloted on Indicators + Gangs, rollout ongoing.', files: 'registry views', difficulty: 'M', risk: 'medium', benefit: 'medium', verify: 'Migrate one view, diff behavior, then roll on', safeNow: false, done: 'v1.3.0 (pilot)' },
  { title: 'Server-side pagination for cases & audit', group: 'Scalability', why: 'The whole-table refetch pattern has a ceiling; not needed at current scale (tracked in DEFERRED.md).', files: 'src/lib/db.ts + big views', difficulty: 'L', risk: 'medium', benefit: 'high', verify: 'Board + audit at 10× data volume', safeNow: false },
  { title: 'Nonce-based CSP (drop unsafe-inline for scripts)', group: 'Security', why: 'Defense in depth beyond the current allow-list CSP.', files: 'next.config.ts', difficulty: 'M', risk: 'medium', benefit: 'medium', verify: 'PDF export, realtime, OAuth, theme applier', safeNow: false },
  { title: 'Keyboard path for board status moves + heat-tint labels', group: 'UX & accessibility', why: 'Drag-and-drop and color-only signals have no keyboard/CVD equivalent in two spots.', files: 'CaseBoard, HeatmapView', difficulty: 'M', risk: 'low', benefit: 'medium', verify: 'Keyboard-only case status change', safeNow: true , done: 'v1.1.0' },
  { title: 'Selective realtime payloads (use event rows instead of refetch)', group: 'Performance', why: 'Natural pair with pagination when data grows; today the simple refetch is fine.', files: 'src/lib/realtime.ts + views', difficulty: 'L', risk: 'medium', benefit: 'high', verify: 'Two-browser live updates on every screen', safeNow: false },
  { title: 'E2E smoke test (sign-in → create case → sign-off)', group: 'Testing', why: 'Catches integration regressions the four gates cannot.', files: 'new Playwright suite', difficulty: 'L', risk: 'low', benefit: 'high', verify: 'CI runs it against a preview deploy', safeNow: true , done: 'v1.1.1' },
  { title: 'Archive the historical build-era docs', group: 'Documentation', why: 'HANDOFF/ROADMAP/REACT-PARITY/BACKLOG are stale post-cutover and can mislead.', files: 'docs/', difficulty: 'S', risk: 'none', benefit: 'medium', verify: 'Links from README/handbook still resolve', safeNow: true , done: 'v1.1.0' },
]

/* ---- route registry -------------------------------------------------------- */

export interface RouteDoc { path: string; component: string; access: string; data: string; risk: 'low' | 'medium' | 'high' }

export const ROUTES: RouteDoc[] = [
  { path: '/', component: 'app/page.tsx (redirect shim)', access: 'public (auth callback → /inbox)', data: 'none', risk: 'high' },
  { path: '/inbox', component: 'InboxView (My Desk)', access: 'active member — landing page', data: 'own work queues', risk: 'medium' },
  { path: '/action', component: 'ActionCenterView', access: 'active member', data: 'cross-table action items', risk: 'medium' },
  { path: '/command', component: 'CommandView + widgets', access: 'active member (filter bar command-only)', data: 'cases, evidence, tickets, trackers, raid comp', risk: 'high' },
  { path: '/analytics', component: 'AnalyticsView', access: 'active member', data: 'cases, evidence, persons', risk: 'medium' },
  { path: '/announce', component: 'AnnounceView', access: 'active member (post = command)', data: 'announcements', risk: 'medium' },
  { path: '/heatmap', component: 'HeatmapView', access: 'active member', data: 'cases, turf, places, raids', risk: 'high' },
  { path: '/personnel', component: 'PersonnelView', access: 'active member (read-only roster)', data: 'profiles, commendations', risk: 'medium' },
  { path: '/cases', component: 'CasesView / CaseDetail (12 tabs)', access: 'bureau-scoped; archive = command; permanent delete = owner', data: 'the case constellation', risk: 'high' },
  { path: '/operations', component: 'OperationsView', access: 'active member', data: 'operations, cases', risk: 'medium' },
  { path: '/legal', component: 'LegalView + request dossier', access: 'active member (own/participant scope)', data: 'legal_requests + sub-tables', risk: 'high' },
  { path: '/case-files', component: 'CaseFilesView', access: 'case-number-scoped', data: 'case_files + FiveManage', risk: 'medium' },
  { path: '/rico', component: 'RicoView', access: 'case-scoped', data: 'rico_cases, predicate_acts', risk: 'medium' },
  { path: '/persons /bolo /gangs /places /vehicles /indicators /network /narcotics /ballistics /modus /media /records', component: 'intel registries + dossiers', access: 'active member (delete = command)', data: 'shared intel tables', risk: 'medium' },
  { path: '/penal /sops /guide', component: 'reference views', access: 'active member (SOP writes = command)', data: 'static / documents', risk: 'low' },
  { path: '/calendar /shifts', component: 'oversight views', access: 'active member / self-scoped', data: 'deadlines, shift reports', risk: 'medium' },
  { path: '/justice', component: 'JusticePortalView', access: 'active justice member or owner (manage = DA/AG/owner)', data: 'legal requests, memberships, coverage', risk: 'high' },
  { path: '/command-center', component: 'CommandCenterView', access: 'command or owner', data: 'profiles, requests, transfers + admin RPCs', risk: 'high' },
  { path: '/profile', component: 'ProfileView', access: 'active member (self)', data: 'own profile, appearance', risk: 'low' },
  { path: '/audit', component: 'AuditView', access: 'OWNER ONLY (RLS)', data: 'audit_log', risk: 'medium' },
  { path: '/feedback', component: 'FeedbackView', access: 'active member (triage = owner)', data: 'feedback', risk: 'low' },
  { path: '/devdocs', component: 'DevDocsView', access: 'OWNER ONLY', data: 'generated handbook (static)', risk: 'low' },
  { path: '/owner', component: 'OwnerView', access: 'OWNER ONLY (+ RLS on feedback_meta/audit)', data: 'feedback + meta, counts, status checks', risk: 'medium' },
]

/* ---- realtime documentation ------------------------------------------------ */

export const REALTIME_DOC = {
  how: 'One websocket channel per table (rt_<table>, postgres_changes, schema public), opened once per session by lib/realtime.ts. Events only bump a version counter — views refetch (debounced per table, so bulk writes cost one refresh); payloads are not consumed. Channels are torn down on sign-out (auth.tsx) and the registry reset.',
  notPublished: [
    'app_secrets + deletion_tokens + deleted_member_ledger (owner/definer-only)',
    'feedback + feedback_meta', 'watchlist', 'operations', 'security_test_runs',
    'mdt_wanted_projections (external MDT feed)',
    'document sub-tables (versions, relations, acknowledgements, campaigns, user state)',
    'legal request sub-tables (actions, exhibits, participants, signatures, versions)',
    'history side-tables (membership_request_history, justice_membership_request_history, report_versions)',
  ],
  failures: [
    'Screen stale until remount → table missing from the supabase_realtime publication',
    'No live updates at all → websocket blocked (check CSP connect-src wss) or channels torn down after an auth error',
    'Double refetches → a second channel opened outside subscribeTable (never do this)',
  ],
  security: 'Realtime respects RLS — events only fire for rows the subscriber could read. The version-counter design means even a leaked event would carry no payload the client uses.',
}

/* ---- workflow center --------------------------------------------------------- */

export const WORKFLOW = {
  branch: 'Feature branches off main → PR → review → merge. Production tracks main on Vercel; every PR gets an immutable preview URL (this is the safe development version — never test risky changes on production).',
  gates: 'npm run typecheck && npm run lint && npm test && npm run build — the four core gates, plus CI-enforced drift checks: knip (dead code), bundle budget, schema-sync (types vs snapshot), snapshot freshness (migrations mirrored), handbook + user-guide generation drift, axe accessibility, Lighthouse budget, and the live RLS security-suites job (reports into Security Testing).',
  db: 'Database changes are ADDITIVE-ONLY migrations applied to the live project (open browser tabs keep running the old bundle). Update src/lib/database.types.ts in the same PR. Re-run the Supabase security/performance advisors after.',
  deploy: 'Merge to main → Vercel builds and atomically flips the production alias. Verify the preview BEFORE merging: sign in, exercise the changed feature, test realtime with two browsers.',
  rollback: 'Vercel → Deployments → ⋯ → Instant Rollback (deployments are immutable; seconds, zero downtime). Because migrations are additive, an app rollback never needs a schema rollback.',
  versioning: 'SemVer as of v1.0.0 — release PRs bump package.json and add a CHANGELOG.md entry listing the merged PRs. The merge checklist (.github/PULL_REQUEST_TEMPLATE.md) is the definition of done; CONTRIBUTING.md is the short guide; docs/archive/RELEASE-READINESS.md holds the v1.0.0 stabilization audit.',
  emergency: 'Roll back first, diagnose second. If the DB is implicated: check Supabase logs + advisors; never hot-edit policies without writing the migration down.',
  notVerified: 'GitHub branch protection (require PR + green CI before merge) is NOT verified as configured — it is a repository setting outside this codebase. Recommended: protect main, require the CI check, disallow force-push. Until then, discipline is the guard: never push directly to main.',
}

/* ---- production status: manual actions + recovery ------------------------------ */

/** Hand-maintained checklist of actions that can only be done by a person with
 *  dashboard access — the app cannot verify these itself, so each entry is
 *  STATIC CONFIGURATION, not a live check. When one is completed, update it
 *  here (set done + a date) in the same PR that documents the action.
 *  Recorded 2026-07-18 (remediation close-out, OPERATIONS.md §8). */
export interface ManualAction {
  title: string
  detail: string
  where: string
  status: 'action_required' | 'not_configured' | 'recurring'
  /** Date completed, once done — flips the row green. */
  done?: string
}

export const MANUAL_ACTIONS: ManualAction[] = [
  {
    title: 'Deploy the updated discord-notify function',
    detail: 'The hardened version (DM text always comes from the verified notification row, never the request) is merged in the repo but the live function still runs the previous build.',
    where: 'Supabase dashboard → Edge Functions, or `supabase functions deploy discord-notify`',
    status: 'action_required',
  },
  {
    title: 'Move the FiveManage key to platform settings and rotate it',
    detail: 'NEXT_PUBLIC_FIVEMANAGE_API_KEY is committed in vercel.json and ci.yml. It is referrer-bound, but it belongs in Vercel/GitHub environment settings — move it, rotate the key, then delete the committed copies.',
    where: 'Vercel project settings + GitHub Actions secrets',
    status: 'action_required',
  },
  {
    title: 'Run and log a backup restore drill',
    detail: 'Backups run inside Supabase, but a backup is only proven when a restore has been rehearsed once. No drill has been logged yet.',
    where: 'Supabase dashboard → Database → Backups (restore to a branch/new project)',
    status: 'action_required',
  },
  {
    title: 'Set up an external uptime monitor',
    detail: 'Nothing outside the app currently notices if the site or database goes down while nobody is signed in.',
    where: 'Any uptime service pinging the production URL',
    status: 'not_configured',
  },
  {
    title: 'Rotate the rls-test fixture passwords quarterly',
    detail: 'The 16 test accounts are real sign-in-capable users. Rotation cadence starts from 2026-07 — next due 2026-10. Rotate in Supabase Auth, then update the CI secrets.',
    where: 'Supabase Auth + GitHub Actions secrets (see docs/OPERATIONS.md §8)',
    status: 'recurring',
  },
]

export const RECOVERY_NOTES = {
  backups: 'Backups are managed by Supabase and are not visible to this app — their status here is Unknown by design. Check the Supabase dashboard (Database → Backups) for the schedule and latest snapshot.',
  restore: 'App rollback is instant and independent of the database (Vercel → Instant Rollback; migrations are additive). Database recovery = Supabase restore — which is why the drill above matters.',
}

/* ---- learning center ----------------------------------------------------------- */

export const LEARNING = {
  beginner: [
    { step: 'The mental model', where: 'Handbook: Overview + Auth & Permissions', why: '"The database is the authority" reframes everything else.' },
    { step: 'Use the app as a member', where: 'Reference → User Guide', why: 'You cannot debug flows you have never run.' },
    { step: 'The three foundation files', where: 'lib/supabase.ts → lib/db.ts → lib/auth.tsx', why: '~450 lines that make every view readable.' },
  ],
  intermediate: [
    { step: 'One registry view end-to-end', where: 'vehicles/VehiclesView.tsx (then diff IndicatorsView)', why: 'The whole idiom in one file. You can take registry tickets now.' },
    { step: 'The shell + realtime', where: 'shell/useNav → AppShell → SearchPalette; lib/realtime.ts', why: 'How a URL becomes a screen; how "live" works.' },
    { step: 'Cases, one tab at a time', where: 'CasesView → CaseModal → CaseDetail (Sign-off last)', why: 'The flagship. You can take case features now.' },
  ],
  advanced: [
    { step: 'The database for real', where: 'Handbook: Database Guide + Supabase dashboard', why: 'Read cases + case_intel_links policies in the raw.' },
    { step: 'The specialists', where: 'CaseGraphTab, HeatmapView, InboxView, packet/pdf/docx', why: 'Intricate but leaf-node — nothing else depends on them.' },
  ],
  avoidEarly: ['CaseDetail.tsx', 'lib/db.ts', 'lib/auth.tsx', 'globals.css (accent remap + collapse)', 'next.config.ts (CSP)', 'anything under supabase/'],
  mistakes: [
    'Discarding a mutation’s {error} — silent no-ops were this repo’s worst bug class',
    'Treating zero-rows-no-error as success (it means RLS blocked the write)',
    'Auto-retrying a mutation (withRetry is reads-only)',
    '"Cleaning up" the deferred-effect pattern, Modal’s ref-routing, or a sequence guard',
    'Renaming Store keys or nav slugs (legacy/deep-link contracts)',
    'Adding a table without RLS policies (invisible) or realtime publication (stale)',
  ],
}

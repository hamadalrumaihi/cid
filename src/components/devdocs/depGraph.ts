/** Dependency Explorer data — the load-bearing nodes of the codebase and
 *  how they connect, distilled from the July 2026 repository analysis
 *  (docs/handbook). Informational only: this powers the read-only explorer
 *  in the Developer Handbook. Keep entries coarse (systems, not every
 *  file) so the map stays maintainable. */

export type DepKind = 'lib' | 'component' | 'hook' | 'table' | 'rpc' | 'service' | 'config'

export interface DepNode {
  id: string
  kind: DepKind
  label: string
  /** One-line purpose. */
  about: string
  /** What this node needs to work. */
  dependsOn: string[]
  /** "If I change this…" — what to check afterwards. */
  ifChanged: string
  risk: 'low' | 'medium' | 'high'
}

export const DEP_NODES: DepNode[] = [
  // ---- libs -----------------------------------------------------------
  { id: 'lib/supabase', kind: 'lib', label: 'lib/supabase.ts', about: 'Lazy Supabase client singleton + isConfigured flag.', dependsOn: ['env', 'svc/supabase'], ifChanged: 'Every network path resolves through it — retest sign-in, any read, any write, realtime.', risk: 'high' },
  { id: 'lib/db', kind: 'lib', label: 'lib/db.ts', about: 'THE data layer: list/insert/update/remove/rpc/deleteWithUndo/withRetry.', dependsOn: ['lib/supabase', 'lib/types', 'lib/toast'], ifChanged: 'The throw-vs-return contract is assumed by ~44 components — check every read try/catch and write res.error path.', risk: 'high' },
  { id: 'lib/types', kind: 'lib', label: 'lib/database.types.ts', about: 'Hand-maintained TS mirror of the live schema.', dependsOn: ['svc/supabase'], ifChanged: 'Must move in lockstep with migrations; drift = silent runtime undefined. Grep select projections too.', risk: 'high' },
  { id: 'lib/auth', kind: 'lib', label: 'lib/auth.tsx', about: 'Sign-in state machine, useAuth() context, canEdit/canDelete.', dependsOn: ['lib/supabase', 'lib/roles', 'lib/realtime'], ifChanged: '~40 consumers; retest Gate states (out/pending/error/in), LOA toggle, capability gating.', risk: 'high' },
  { id: 'lib/realtime', kind: 'lib', label: 'lib/realtime.ts', about: 'One channel per table → version counters (useTableVersion).', dependsOn: ['lib/supabase'], ifChanged: 'Freshness of ~35 views; test two-browser live updates and sign-out teardown.', risk: 'high' },
  { id: 'lib/nav', kind: 'lib', label: 'lib/nav.ts', about: 'PAGE_META / categories / TAB_LABEL — the navigation contract.', dependsOn: [], ifChanged: 'Keep the three-way contract + the [tab] switch in sync; slugs are deep-link contracts.', risk: 'high' },
  { id: 'lib/profiles', kind: 'lib', label: 'lib/profiles.ts', about: 'Roster cache + officerName resolution.', dependsOn: ['lib/db', 'tbl/profiles'], ifChanged: 'Name resolution in ~24 views; verify cache-on-error preservation still holds.', risk: 'medium' },
  { id: 'lib/toast', kind: 'lib', label: 'lib/toast.ts', about: 'Toast store + humanizeError (DB errors → human copy).', dependsOn: [], ifChanged: 'Weakening humanizeError leaks raw DB errors app-wide.', risk: 'medium' },
  { id: 'lib/signoff', kind: 'lib', label: 'lib/signoff.ts', about: 'Read-only sign-off vocabulary/tints/court hints.', dependsOn: ['lib/types'], ifChanged: 'Labels/badges must keep matching the server chain (rpc/signoff, hook/navbadges).', risk: 'medium' },
  { id: 'lib/forms', kind: 'lib', label: 'lib/forms.ts', about: '8 report schemas + warrant helpers.', dependsOn: [], ifChanged: 'Field keys ARE the storage format of reports.fields — old reports must still render.', risk: 'medium' },
  { id: 'lib/packet', kind: 'lib', label: 'lib/packet + pdf + docx', about: 'Court-packet gathering + PDF/DOCX renderers.', dependsOn: ['lib/db', 'lib/forms', 'lib/penal', 'cfg/csp'], ifChanged: 'Export all three formats from a real case; PDF needs the CSP wasm allowance.', risk: 'medium' },
  { id: 'lib/safeUrl', kind: 'lib', label: 'lib/safeUrl.ts', about: 'XSS scheme allow-list for DB-sourced URLs.', dependsOn: [], ifChanged: 'Security surface (unit-tested) — 11 views render DB links through it.', risk: 'high' },
  { id: 'lib/store', kind: 'lib', label: 'lib/store.ts', about: 'Shared localStorage blob (legacy-compatible keys).', dependsOn: [], ifChanged: 'Keys are contracts with the legacy app and the pre-hydration theme script.', risk: 'medium' },
  { id: 'lib/search', kind: 'lib', label: 'lib/search.ts', about: 'search_all RPC wrapper + penal hits + recents.', dependsOn: ['lib/db', 'rpc/search_all', 'lib/penal'], ifChanged: 'The ⌘K palette is its only consumer — test query, error state, recents.', risk: 'medium' },
  { id: 'lib/notify', kind: 'lib', label: 'lib/notify.ts', about: 'Notification write path (unforgeable actor) + Discord DM.', dependsOn: ['lib/db', 'rpc/create_notification', 'svc/discord'], ifChanged: 'All notification producers route through it; failures must stay silent.', risk: 'medium' },
  { id: 'lib/penal', kind: 'lib', label: 'lib/penal.ts', about: 'Static penal code (162 charges) + calculators.', dependsOn: [], ifChanged: 'Legal data — affects charges tab, packets, search.', risk: 'medium' },

  // ---- hooks ----------------------------------------------------------
  { id: 'hook/useAuth', kind: 'hook', label: 'useAuth()', about: 'Identity, state machine, capability booleans.', dependsOn: ['lib/auth'], ifChanged: 'Everything gated on canEdit/canDelete.', risk: 'high' },
  { id: 'hook/useTableVersion', kind: 'hook', label: 'useTableVersion(table)', about: 'Realtime version counter per table.', dependsOn: ['lib/realtime'], ifChanged: 'Views stop refreshing live.', risk: 'high' },
  { id: 'hook/useNav', kind: 'hook', label: 'useNav()', about: 'activeTab/category + navigate helpers.', dependsOn: ['lib/nav'], ifChanged: 'All chrome navigation.', risk: 'high' },
  { id: 'hook/navbadges', kind: 'hook', label: 'useNavBadges()', about: 'Command-button badges; mirrors server sign-off routing.', dependsOn: ['lib/db', 'lib/profiles', 'hook/useTableVersion', 'lib/store'], ifChanged: 'Must keep matching the SQL routing rules or leadership sees phantom counts.', risk: 'high' },

  // ---- components -----------------------------------------------------
  { id: 'cmp/Modal', kind: 'component', label: 'ui/Modal', about: 'Focus trap, dirty guard, ref-routed handlers, scroll lock.', dependsOn: ['cmp/dialog'], ifChanged: 'Every modal in the app; effect deps must stay [open] (token-refresh re-renders).', risk: 'high' },
  { id: 'cmp/dialog', kind: 'component', label: 'ui/dialog (uiConfirm/uiPrompt)', about: 'Promise-based confirm/prompt.', dependsOn: [], ifChanged: 'Every destructive confirmation.', risk: 'medium' },
  { id: 'cmp/DataTable', kind: 'component', label: 'ui/DataTable', about: 'Sort/filter/CSV table with injection-guarded export.', dependsOn: ['lib/toast'], ifChanged: 'AuditView; csvCell guard is unit-tested — keep it.', risk: 'medium' },
  { id: 'cmp/RichEditor', kind: 'component', label: 'ui/RichEditor', about: 'Tiptap markdown editor (markdown in/out).', dependsOn: [], ifChanged: 'Case notes + SOPs round-trip; storage must stay plain markdown.', risk: 'medium' },
  { id: 'cmp/CaseDetail', kind: 'component', label: 'cases/CaseDetail', about: 'The case hub — 12 tabs.', dependsOn: ['lib/db', 'lib/forms', 'lib/penal', 'lib/signoff', 'lib/packet', 'cmp/Modal', 'cmp/RichEditor', 'hook/useTableVersion', 'rpc/signoff', 'rpc/report_finalize'], ifChanged: 'Highest-risk file; RicoView imports its RicoTab; delete cascade config must match FKs.', risk: 'high' },
  { id: 'cmp/SearchPalette', kind: 'component', label: 'shell/SearchPalette', about: '⌘K search + quick actions.', dependsOn: ['lib/search', 'hook/useAuth', 'lib/nav'], ifChanged: 'The primary find/navigate surface; keep the sequence guard.', risk: 'high' },
  { id: 'cmp/IntelProfile', kind: 'component', label: 'persons/IntelProfile', about: 'Person/gang roll-up slide-over + dossier export.', dependsOn: ['lib/db', 'lib/packet', 'cmp/Modal'], ifChanged: 'Reused by persons, BOLO, gangs, network.', risk: 'high' },
  { id: 'cmp/Shell', kind: 'component', label: 'shell/AppShell + Sidebar + Header', about: 'The chrome around every screen.', dependsOn: ['hook/useNav', 'hook/useAuth', 'hook/navbadges', 'lib/store'], ifChanged: 'Sidebar collapse is a body-class contract with globals.css and the pre-hydration script.', risk: 'high' },

  // ---- database -------------------------------------------------------
  { id: 'tbl/cases', kind: 'table', label: 'cases', about: 'The hub record; sign-off columns are trigger-locked.', dependsOn: ['tbl/profiles'], ifChanged: 'Satellites cascade from it; additive columns only; update types + projections.', risk: 'high' },
  { id: 'tbl/profiles', kind: 'table', label: 'profiles', about: 'One row per member: role, bureau, active, LOA. Guard trigger blocks self-promotion; email column is command-granted.', dependsOn: [], ifChanged: 'Every RLS helper reads it; the PROFILE_COLS/email constraint must hold.', risk: 'high' },
  { id: 'tbl/case-satellites', kind: 'table', label: 'case satellites (evidence, reports, tasks, messages, intel links…)', about: '17 case-scoped tables, all gated by can_access_case.', dependsOn: ['tbl/cases'], ifChanged: 'deleteWithUndo cascade configs in CaseDetail/GangsView/PlacesView must match the FKs.', risk: 'high' },
  { id: 'tbl/intel', kind: 'table', label: 'shared intel (persons, gangs, vehicles, places, indicators, …)', about: '21 registries: active-member read/write, command delete.', dependsOn: [], ifChanged: 'Registry views + pickers + graph + packets read them.', risk: 'medium' },
  { id: 'tbl/own-row', kind: 'table', label: 'own-row (notifications, watchlist, shift_reports, feedback)', about: 'Keyed to auth.uid().', dependsOn: ['tbl/profiles'], ifChanged: 'Bell/My Desk/shifts flows.', risk: 'medium' },
  { id: 'tbl/audit_log', kind: 'table', label: 'audit_log', about: 'Trigger-written mutation log; owner-only read.', dependsOn: [], ifChanged: 'AuditView + the activity feed read it; never add a client write path.', risk: 'medium' },

  // ---- rpcs -----------------------------------------------------------
  { id: 'rpc/signoff', kind: 'rpc', label: 'signoff_submit / decide / owner_action', about: 'The server-authoritative sign-off chain.', dependsOn: ['tbl/cases', 'tbl/profiles'], ifChanged: 'SECURITY REVIEW: labels (lib/signoff), badges (useNavBadges), notifications, history verbs all track it.', risk: 'high' },
  { id: 'rpc/report_finalize', kind: 'rpc', label: 'report_finalize', about: 'The only way to finalize/e-sign a report.', dependsOn: ['tbl/case-satellites'], ifChanged: 'Trigger-locked column; test finalize + the blocked direct write.', risk: 'high' },
  { id: 'rpc/assign_member', kind: 'rpc', label: 'assign_member / admin_*', about: 'Command-checked roster management.', dependsOn: ['tbl/profiles'], ifChanged: 'SECURITY REVIEW: internal command check is the privilege boundary.', risk: 'high' },
  { id: 'rpc/search_all', kind: 'rpc', label: 'search_all', about: 'pg_trgm fuzzy search, SECURITY INVOKER (RLS-scoped).', dependsOn: ['tbl/cases', 'tbl/intel'], ifChanged: 'The palette; keep INVOKER or results leak across bureaus.', risk: 'high' },
  { id: 'rpc/create_notification', kind: 'rpc', label: 'create_notification', about: 'Insert-for-another-user with server-stamped actor.', dependsOn: ['tbl/own-row'], ifChanged: 'All notification producers; forgery protection lives here.', risk: 'medium' },

  // ---- services & config ---------------------------------------------
  { id: 'svc/supabase', kind: 'service', label: 'Supabase', about: 'Postgres + Auth + PostgREST + Realtime.', dependsOn: [], ifChanged: 'Everything. Dashboard settings (OTP expiry, backups) documented in HARDENING.md.', risk: 'high' },
  { id: 'svc/fivemanage', kind: 'service', label: 'FiveManage', about: 'External media hosting (URLs only in DB).', dependsOn: ['cfg/csp'], ifChanged: 'Uploads in Attachments + Media Vault; connect-src must allow it.', risk: 'medium' },
  { id: 'svc/discord', kind: 'service', label: 'Discord', about: 'OAuth provider + optional DM via edge function.', dependsOn: ['svc/supabase'], ifChanged: 'Sign-in flow + best-effort DMs (failures already swallowed).', risk: 'medium' },
  { id: 'svc/vercel', kind: 'service', label: 'Vercel + GitHub Actions', about: 'Hosting/previews/rollback + the four CI gates.', dependsOn: ['cfg/csp', 'env'], ifChanged: 'vercel.json and ci.yml duplicate the env values — keep them agreeing.', risk: 'medium' },
  { id: 'cfg/csp', kind: 'config', label: 'next.config.ts (CSP)', about: 'Security headers; exact allow-lists.', dependsOn: [], ifChanged: 'Test PDF export (wasm), realtime (wss), uploads, OAuth after ANY edit.', risk: 'high' },
  { id: 'env', kind: 'config', label: 'Environment (NEXT_PUBLIC_*)', about: 'Four public values, inlined at build.', dependsOn: [], ifChanged: 'Rebuild required; update vercel.json AND ci.yml together.', risk: 'medium' },
]

export const DEP_KIND_META: Record<DepKind, { label: string; tint: string }> = {
  lib: { label: 'Library', tint: 'border-blue-400/40 bg-blue-500/10 text-blue-200' },
  component: { label: 'Component', tint: 'border-violet-400/40 bg-violet-500/10 text-violet-200' },
  hook: { label: 'Hook', tint: 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200' },
  table: { label: 'Database', tint: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' },
  rpc: { label: 'RPC', tint: 'border-amber-400/40 bg-amber-500/10 text-amber-200' },
  service: { label: 'Service', tint: 'border-rose-400/40 bg-rose-500/10 text-rose-200' },
  config: { label: 'Config', tint: 'border-slate-400/40 bg-white/5 text-slate-200' },
}

export const depsOf = (id: string): DepNode[] => {
  const n = DEP_NODES.find((x) => x.id === id)
  return n ? n.dependsOn.map((d) => DEP_NODES.find((x) => x.id === d)).filter((x): x is DepNode => !!x) : []
}

export const dependentsOf = (id: string): DepNode[] =>
  DEP_NODES.filter((n) => n.dependsOn.includes(id))

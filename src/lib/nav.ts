/** Two-tier navigation model. Five top-level categories, each a set of leaf
 *  tabs; the router navigates to leaf tabs, categories + the sub-tab strip
 *  are a grouping layer over them. The category set was re-cut in the CI
 *  compartment release (§7.1 of the contract): the personal home is the
 *  Action Center (/inbox), My Dashboard moved to /dashboard, the Cases and
 *  Investigative Tools categories merged into Investigations, and the
 *  Owner-only leaves became their own category. Route ids are deep-link
 *  contracts — a retired id lives on in LEGACY_REDIRECT_TABS, never vanishes. */

import type { DashboardId } from './permissions/capabilities'
import { TOOL_TABS } from './toolsModel'

/* ---- Dashboards (the sidebar's capability-gated leaves) --------------------
 * Formerly components/dash/DashSwitcherView (the Phase-1B chip-row switcher,
 * retired in Phase 7 — the sidebar leaves and the command palette are the
 * only consumers left). 'submitter' is deliberately absent: field officers
 * get a separate shell, never these leaves. */
export type SwitchableId = Exclude<DashboardId, 'submitter'>

export const DASH_LABEL: Record<SwitchableId, string> = {
  my: 'My Dashboard',
  cases: 'Cases',
  command: 'Command Center',
  sib: 'SIB',
  doj: 'Legal Review',
  owner: 'Owner Console',
}

/** Route (leaf tab id) per dashboard — /dashboard, /cases, /command-center,
 *  /siu, /legal, /owner. */
export const DASH_TAB: Record<SwitchableId, string> = {
  my: 'dashboard',
  cases: 'cases',
  command: 'command-center',
  sib: 'siu',
  doj: 'legal',
  owner: 'owner',
}

export interface PageMeta {
  title: string
  sub: string
}

/** The Investigative Tools inside the unified workspace — one title/sub per
 *  tool for the workspace directory cards (components/tools/ToolDirectory).
 *  These are NOT routes any more: their `/<tool>` addresses are legacy
 *  redirects (LEGACY_REDIRECT_TABS) into `/workspace?tool=…`, so they stay
 *  out of PAGE_META and out of the nav/search/palette page lists. */
export const TOOL_META: Record<(typeof TOOL_TABS)[number] | 'tools', PageMeta> = {
  tools:      { title: 'Investigative Tools', sub: 'Intelligence records, operational boards & analysis — one workspace' },
  persons:    { title: 'Persons', sub: 'Suspects & persons of interest (live)' },
  narcotics:  { title: 'Narcotics Intelligence', sub: 'Drug processing & market analytics' },
  ballistics: { title: 'Ballistics & Logistics', sub: 'Weapon benches & component tracing' },
  media:      { title: 'Media Vault', sub: 'Universal media-to-case intake (all detectives)' },
  modus:      { title: 'M.O. Detector', sub: 'Tactical profiling & cross-reference' },
  gangs:      { title: 'Gangs & Turf', sub: 'Organizations, ranks, properties & territory' },
  places:     { title: 'Criminal Places', sub: 'Locations & production processes' },
  network:    { title: 'Investigation Graph', sub: 'What links a person, vehicle, gang, place, narcotic or case — one hop at a time' },
  records:    { title: 'CID Records', sub: 'Live shared division records' },
  vehicles:   { title: 'Vehicle Registry', sub: 'Plates, owners & cross-case matches' },
  indicators: { title: 'Indicators Registry', sub: 'Phones, accounts, serials, aliases & addresses — deconflicted across cases' },
  // One workspace for every kind of intelligence, whoever it came from —
  // patrol, a detective, surveillance or an outside agency.
  'field-review': { title: 'Intelligence', sub: 'Everything that comes into CID as information — patrol, detectives, surveillance and outside agencies' },
  bolo:       { title: 'BOLO Board', sub: 'At-large subjects — be on the lookout' },
  accounts:   { title: 'Account Registry', sub: 'Social-media & online accounts, handle history & ownership' },
}

export const PAGE_META: Record<string, PageMeta> = {
  // The Action Center IS the personal home and the app's default landing
  // (src/app/page.tsx): one prioritized queue of everything awaiting the
  // member, with their role preset applied by default.
  inbox:      { title: 'Action Center', sub: 'Prioritized work requiring your attention across cases, command, and personnel' },
  // The broad personal overview — my cases, jump-back, open workspace tabs,
  // drafts, watched items. The queue itself lives on /inbox.
  dashboard:  { title: 'My Dashboard', sub: 'Your work at a glance' },
  analytics:  { title: 'Division Analytics', sub: 'Caseload, clearance & activity trends' },
  cases:      { title: 'Case Files', sub: 'Live case records, photos & reports' },
  legal:      { title: 'Legal Requests', sub: 'Warrants & subpoenas — drafting, command review & fulfilment' },
  operations: { title: 'Operations', sub: 'Task forces — related cases grouped under one umbrella' },
  // Two Investigations leaves that open the unified workspace on a default
  // tool: everything that comes into CID as information, and the shared
  // registries (persons, vehicles, gangs, places, accounts, indicators).
  intelligence: { title: 'Intelligence', sub: 'Everything that comes into CID as information — patrol, detectives, surveillance and outside agencies' },
  registries: { title: 'Registries', sub: 'Persons, vehicles, gangs, places, accounts & indicators — one master dataset, deconflicted across cases' },
  personnel:  { title: 'Personnel & Roster', sub: 'Roster & digital commendations' },
  rico:       { title: 'RICO Builder', sub: 'Enterprise & predicate-act element tracker' },
  penal:      { title: 'Penal Code', sub: 'San Andreas statutes, sentences & fines' },
  sops:       { title: 'Standard Operating Procedures', sub: 'Division policy & reference library, managed by command staff' },
  devdocs:    { title: 'Developer Handbook', sub: 'How the portal works — architecture, database, every file (owner-only)' },
  announce:   { title: 'Announcements', sub: 'Division-wide notices from command staff' },
  'case-files': { title: 'Case Files — Attachments', sub: 'Files uploaded and linked per case' },
  // Phase 5 report builder: the template catalog's admin surface (Owner
  // category in the nav; the RPCs decide who may propose/publish).
  'report-templates': { title: 'Report Templates', sub: 'Report forms — versions, required fields & review rules (command staff)' },
  heatmap:    { title: 'Commander Heatmap', sub: 'Gang turf, places, raids & case concentration by area' },
  shifts:     { title: 'Weekly Shift Reports', sub: 'Detective activity rolled up to bureau leadership' },
  audit:      { title: 'Audit Log', sub: 'Division-wide action history (owner-only)' },
  // Phase 8 (P8-02): the deleted rows the caller may restore (trash_list);
  // permanent deletion stays the Owner's armed protocol.
  trash:      { title: 'Trash', sub: 'Deleted records you can restore — permanent deletion is the Owner’s armed protocol' },
  feedback:   { title: 'Feedback', sub: 'Suggest a feature or report a bug' },
  owner:      { title: 'Owner Console', sub: 'System administration — accounts, destructive operations, maintenance, configuration, diagnostics (owner-only)' },
  profile:    { title: 'My Profile', sub: 'Your account, appearance and notification settings' },
  'command-center': { title: 'Command Center', sub: 'Command administration — personnel, membership review, promotions, chain of command, trackers & raid comp' },
  guide:      { title: 'User Guide', sub: 'How to sign in, navigate & work a case — new member orientation' },
  calendar:   { title: 'Division Calendar', sub: 'Follow-ups, task deadlines & shift weeks at a glance' },
  // Special Investigations Bureau — a SEPARATE investigative authority, not a CID
  // category. It is deliberately absent from NAV_CATEGORIES: the sidebar
  // renders it as a standalone leaf only for accounts with SIU standing
  // (useSiu()), and the view itself renders the ordinary nothing-here surface
  // for everyone else. RLS is the real wall.
  siu:        { title: 'Special Investigations Bureau', sub: 'SIB investigations, personnel & oversight of CID activity' },
  // Confidential Informants (§6.3). Handlers see their own sources, CI
  // command (bureau leads, deputy directors, director, SIB, Owner) sees all;
  // everyone else gets the ordinary nothing-here surface — RLS is the wall.
  informants: { title: 'Confidential Informants', sub: 'Protected source management — handlers see their own sources, CI command sees all' },
  // The unified workspace (plan §5.5): cases, records and tools side by side
  // in one tab strip. A valid leaf (deep links, the Open workspace tabs
  // panel) that belongs to no category button — the Investigations leaves
  // `intelligence` / `registries` open it on a default tool.
  workspace:  { title: 'Workspace', sub: 'Open cases, records and tools side by side — one tab strip' },
  // The CID-facing door into SIU intake (§14). Deliberately NOT named after
  // SIU: a route labelled for the unit would disclose it to every detective,
  // and to the subjects of its investigations. See ConcernView.
  concern:    { title: 'Report a Concern', sub: 'Confidential reporting outside the ordinary chain of command' },
}

/** Retired route ids that MUST keep resolving (bookmarks, notification deep
 *  links, case cross-links). They are prerendered by generateStaticParams
 *  alongside PAGE_META but carry no page metadata — the [tab] route renders
 *  a client redirect for each:
 *   · action  → /inbox (the Action Center; query preserved)
 *   · command → /command-center (the Division Overview folded into it)
 *   · tools + the 14 tool ids → /workspace?tool=… (ToolTabRedirect)
 *   · reports → /cases (authoring lives in the case-detail Reports tab) */
export const LEGACY_REDIRECT_TABS: readonly string[] = ['action', 'command', 'tools', ...TOOL_TABS, 'reports']

export interface NavCategory {
  id: string
  label: string
  tabs: string[]
}

export const NAV_CATEGORIES: NavCategory[] = [
  // The Action Center (inbox) leads Command — it is the personal home and the
  // app's default landing (src/app/page.tsx); My Dashboard follows it.
  { id: 'command',   label: 'Command',        tabs: ['inbox', 'dashboard', 'analytics', 'announce', 'heatmap', 'personnel'] },
  // Cases + the former Investigative Tools category, as one Investigations
  // group. `intelligence` / `registries` open the workspace on a default
  // tool; `informants` renders only for accounts the CI compartment involves
  // (Sidebar/Subtabs/BottomNav read useCiContext — RLS is the real wall).
  { id: 'cases',     label: 'Investigations', tabs: ['cases', 'operations', 'legal', 'intelligence', 'informants', 'registries', 'rico', 'case-files'] },
  { id: 'reference', label: 'Reference',      tabs: ['penal', 'sops', 'guide'] },
  { id: 'oversight', label: 'Oversight',      tabs: ['calendar', 'shifts', 'trash'] },
  // Owner-only: the shell renders this category only when the signed-in
  // member is the portal owner (the views and RLS self-gate regardless).
  { id: 'owner',     label: 'Owner',          tabs: ['owner', 'audit', 'devdocs', 'report-templates'] },
]

/** Category ids the shell shows only to the portal owner. */
export const OWNER_ONLY_CATEGORIES: ReadonlySet<string> = new Set(['owner', 'siu-owner'])

/** ── Special Investigations Bureau navigation ─────────────────────────────
 *  SIU is a separate DEPARTMENT, so it gets its own navigation rather than a
 *  button inside the CID sidebar. It deliberately reuses the shared registry
 *  routes (persons, vehicles, gangs, places, network, media, legal …) — those
 *  are one master dataset for the whole platform, already RLS-scoped per
 *  viewer — and adds the SIU-owned surfaces on top. Only the department
 *  context, labels and default filters differ; the underlying systems are the
 *  same ones CID uses (§8, §21).
 *
 *  ── Full CID parity ───────────────────────────────────────────────────────
 *  SIU carries CID's entire navigation, tab for tab. That is NAVIGATION, not
 *  access: every one of these routes is the same RLS-scoped view CID uses,
 *  and the database decides what an SIU account sees in it. Concretely —
 *
 *   * SHARED REGISTRIES (persons, gangs, places, vehicles, accounts,
 *     indicators, media, and the analysis screens over them) are one master
 *     dataset for the platform. SIU reads and writes them exactly as CID does;
 *     their policies are `private.is_active()`.
 *   * CASE SURFACES are fully workable: since siu_members_work_cid
 *     (20261001120200) an ACTIVE SIU member is admitted by
 *     `private.can_access_case()` directly and works CID cases as an
 *     ordinary investigator. Only oversight standing (the AG's SIU hat)
 *     remains read-only on the unit's own investigations.
 *   * OWNER/COMMAND-ONLY surfaces (the Owner category, the command staff
 *     parts of the Command Center) self-gate exactly as they do for a CID
 *     detective who lacks the rank. An SIU account sees the ordinary
 *     nothing-here surface, which is existing designed behaviour rather than
 *     a broken screen.
 *
 *  The CID structure above is untouched: a CID member's portal is unchanged. */
export const SIU_NAV_CATEGORIES: NavCategory[] = [
  // The SIU-owned workspace leads. Everything after it is CID's own navigation,
  // tab for tab, in CID's order.
  { id: 'siu-unit',      label: 'Bureau',         tabs: ['siu'] },
  { id: 'siu-command',   label: 'Command',        tabs: ['inbox', 'dashboard', 'analytics', 'announce', 'heatmap', 'personnel'] },
  { id: 'siu-cases',     label: 'Investigations', tabs: ['cases', 'operations', 'legal', 'intelligence', 'informants', 'registries', 'rico', 'case-files'] },
  { id: 'siu-ref',       label: 'Reference',      tabs: ['penal', 'sops', 'guide'] },
  { id: 'siu-oversight', label: 'Oversight',      tabs: ['calendar', 'shifts', 'trash'] },
  { id: 'siu-owner',     label: 'Owner',          tabs: ['owner', 'audit', 'devdocs', 'report-templates'] },
]

/** Labels that differ inside the SIU workspace. Anything absent falls back to
 *  the shared TAB_LABEL, so SIU only overrides what its vocabulary changes. */
export const SIU_TAB_LABEL: Record<string, string> = {
  siu: 'SIB Workspace',
  cases: 'Cases',
  sops: 'SIB SOP',
  legal: 'Legal Requests',
}

export const TAB_LABEL: Record<string, string> = {
  inbox: 'Action Center', dashboard: 'My Dashboard', analytics: 'Analytics', announce: 'Announcements', heatmap: 'Heatmap', personnel: 'Roster & Commendations',
  cases: 'Case Files', operations: 'Operations', legal: 'Legal Requests', intelligence: 'Intelligence', registries: 'Registries', 'case-files': 'Attachments', rico: 'RICO', 'report-templates': 'Report Templates',
  // Tool labels: the workspace tab bar and directory (lib/workspace/model
  // toolLabel) read these; the routes themselves are legacy redirects.
  persons: 'Persons', bolo: 'BOLO Board', gangs: 'Gangs', places: 'Places', vehicles: 'Vehicles', accounts: 'Accounts', indicators: 'Indicators', 'field-review': 'Intelligence',
  network: 'Network', narcotics: 'Narcotics', ballistics: 'Ballistics', modus: 'M.O. Detector',
  media: 'Media Vault', records: 'Records', penal: 'Penal Code', sops: 'SOPs & Library', guide: 'User Guide', devdocs: 'Developer Handbook',
  tools: 'Investigative Tools', workspace: 'Workspace',
  calendar: 'Calendar', shifts: 'Shift Reports', audit: 'Audit Log', trash: 'Trash', owner: 'Owner Console', profile: 'My Profile', 'command-center': 'Command Center', siu: 'Special Investigations Bureau',
  informants: 'Informants',
}

/** Presentational sub-grouping for crowded categories — a visual layer over
 *  the SAME tabs in the SAME order. NAV_CATEGORIES stays the routing truth;
 *  the strip just draws labels/dividers. */
export const SUBTAB_GROUPS: Record<string, { label: string; tabs: string[] }[]> = {
  // (Currently empty: the former Intelligence groupings live in the
  // workspace directory — see lib/toolsModel TOOL_GROUPS.)
}

/** tab → category (or null: a valid route that belongs to NO category — the
 *  Command strip must not light up for it and the sub-tab strip is
 *  suppressed). Covers EVERY PAGE_META tab plus every LEGACY_REDIRECT_TABS
 *  id: category tabs from NAV_CATEGORIES; the workspace, the tools-era
 *  addresses and the 14 legacy tool routes → 'cases' (Investigations — their
 *  routes redirect into the workspace, so the strip highlights the right
 *  category during the hop); `action` → 'command' (it redirects to /inbox);
 *  the standalone surfaces (profile / command-center / concern / siu /
 *  feedback / the retired `command` address) → null. Anything absent from
 *  the map would fall back to 'command' in useNav and mislight the strip. */
export const TAB_CATEGORY: Record<string, string | null> = {
  workspace: 'cases',
  tools: 'cases',
  reports: 'cases',
  action: 'command',
  command: null,
  profile: null,
  'command-center': null,
  concern: null,
  siu: null,
  feedback: null,
}
export const CAT_DEFAULT: Record<string, string> = {}
for (const t of TOOL_TABS) TAB_CATEGORY[t] = 'cases'
for (const c of NAV_CATEGORIES) {
  for (const t of c.tabs) TAB_CATEGORY[t] = c.id
  CAT_DEFAULT[c.id] = c.tabs[0]
}

/** Ownership is a profiles flag now (profiles.is_owner → useAuth().isOwner;
 *  private.is_owner() in RLS). The previous hard-coded owner UUIDs were
 *  migrated into that flag by the owner_role_and_feedback_meta migration. */

/** A routable address: a PAGE_META leaf OR a legacy redirect id. Routing
 *  (useNav, the root shim, the [tab] page) needs both; nav / search / palette
 *  metadata come from PAGE_META alone. */
export const isValidTab = (tab: string): boolean => tab in PAGE_META || LEGACY_REDIRECT_TABS.includes(tab)

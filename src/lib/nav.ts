/** Two-tier navigation model — ported 1:1 from the vanilla router (core.js):
 *  5 top-level categories, each a set of leaf tabs. The router navigates to
 *  leaf tabs; categories + the sub-tab strip are a grouping layer over them.
 *  Route ids, labels and grouping MUST stay identical to vanilla for parity. */

import { TOOL_TABS } from './toolsModel'

export interface PageMeta {
  title: string
  sub: string
}

export const PAGE_META: Record<string, PageMeta> = {
  // Division Overview — the SHARED analytics/trackers dashboard (formerly
  // "Central Command"); the personal home is My Dashboard (inbox) below.
  command:    { title: 'Division Overview', sub: 'Case assignment & operational hub' },
  analytics:  { title: 'Division Analytics', sub: 'Caseload, clearance & activity trends' },
  cases:      { title: 'Case Files', sub: 'Live case records, photos & reports' },
  legal:      { title: 'Legal Requests', sub: 'Warrants & subpoenas — drafting, command review & fulfilment' },
  operations: { title: 'Operations', sub: 'Task forces — related cases grouped under one umbrella' },
  persons:    { title: 'Persons', sub: 'Suspects & persons of interest (live)' },
  narcotics:  { title: 'Narcotics Intelligence', sub: 'Drug processing & market analytics' },
  ballistics: { title: 'Ballistics & Logistics', sub: 'Weapon benches & component tracing' },
  personnel:  { title: 'Personnel & Roster', sub: 'Roster & digital commendations' },
  media:      { title: 'Media Vault', sub: 'Universal media-to-case intake (all detectives)' },
  modus:      { title: 'M.O. Detector', sub: 'Tactical profiling & cross-reference' },
  gangs:      { title: 'Gangs & Turf', sub: 'Organizations, ranks, properties & territory' },
  places:     { title: 'Criminal Places', sub: 'Locations & production processes' },
  network:    { title: 'Relationship Network', sub: 'Gangs, members & properties as a navigable graph' },
  rico:       { title: 'RICO Builder', sub: 'Enterprise & predicate-act element tracker' },
  penal:      { title: 'Penal Code', sub: 'San Andreas statutes, sentences & fines' },
  sops:       { title: 'Standard Operating Procedures', sub: 'Division policy & reference library, managed by command staff' },
  devdocs:    { title: 'Developer Handbook', sub: 'How the portal works — architecture, database, every file (owner-only)' },
  records:    { title: 'CID Records', sub: 'Live shared division records' },
  announce:   { title: 'Announcements', sub: 'Division-wide notices from command staff' },
  'case-files': { title: 'Case Files — Attachments', sub: 'Files uploaded and linked per case' },
  heatmap:    { title: 'Commander Heatmap', sub: 'Gang turf, places, raids & case concentration by area' },
  inbox:      { title: 'My Dashboard', sub: 'Your work at a glance' },
  action:     { title: 'Action Center', sub: 'Prioritized work requiring your attention across cases, command, and personnel' },
  shifts:     { title: 'Weekly Shift Reports', sub: 'Detective activity rolled up to bureau leadership' },
  audit:      { title: 'Audit Log', sub: 'Division-wide action history (owner-only)' },
  feedback:   { title: 'Feedback', sub: 'Suggest a feature or report a bug' },
  owner:      { title: 'Owner Console', sub: 'Project intelligence, feedback triage & engineering operations (owner-only)' },
  profile:    { title: 'My Profile', sub: 'Your account, appearance and notification settings' },
  'command-center': { title: 'Command Center', sub: 'Command administration — personnel, approvals, promotions & chain of command' },
  vehicles:   { title: 'Vehicle Registry', sub: 'Plates, owners & cross-case matches' },
  indicators: { title: 'Indicators Registry', sub: 'Phones, accounts, serials, aliases & addresses — deconflicted across cases' },
  // Reports from SAHP/BCSO/LSPD officers who have no CID access. This replaced
  // the Odyssey ticket queue: a ticket was a request to open a case, a field
  // submission is structured intelligence a reviewer turns into records.
  // One workspace for every kind of intelligence, whoever it came from --
  // patrol, a detective, surveillance or an outside agency. It used to sit
  // beside a separate "Intel Tips" page doing the same job for detectives; a
  // detective had to know which of the two to read.
  'field-review': { title: 'Intelligence', sub: 'Everything that comes into CID as information — patrol, detectives, surveillance and outside agencies' },
  bolo:       { title: 'BOLO Board', sub: 'At-large subjects — be on the lookout' },
  accounts:   { title: 'Account Registry', sub: 'Social-media & online accounts, handle history & ownership' },
  guide:      { title: 'User Guide', sub: 'How to sign in, navigate & work a case — new member orientation' },
  calendar:   { title: 'Division Calendar', sub: 'Follow-ups, task deadlines & shift weeks at a glance' },
  // Special Investigations Bureau — a SEPARATE investigative authority, not a CID
  // category. It is deliberately absent from NAV_CATEGORIES: the sidebar
  // renders it as a standalone leaf only for accounts with SIU standing
  // (useSiu()), and the view itself renders the ordinary nothing-here surface
  // for everyone else. RLS is the real wall.
  siu:        { title: 'Special Investigations Bureau', sub: 'SIB investigations, personnel & oversight of CID activity' },
  // The Intelligence category's 14 tabs, consolidated into one multi-tab
  // workspace (§toolsModel). The old tab ids above stay registered so deep
  // links keep resolving; their routes redirect into /tools.
  tools:      { title: 'Investigative Tools', sub: 'Intelligence records, operational boards & analysis — one workspace' },
  // The CID-facing door into SIU intake (§14). Deliberately NOT named after
  // SIU: a route labelled for the unit would disclose it to every detective,
  // and to the subjects of its investigations. See ConcernView.
  concern:    { title: 'Report a Concern', sub: 'Confidential reporting outside the ordinary chain of command' },
}
// NOTE: vanilla PAGE_META also declares a legacy 'reports' route with no view
// (authoring lives in the case-detail Reports tab); its fallback-to-cases
// behavior is handled in routing, not by carrying the dead entry here.

export interface NavCategory {
  id: string
  label: string
  tabs: string[]
}

export const NAV_CATEGORIES: NavCategory[] = [
  // My Dashboard (inbox) leads the Command group — it is the personal home and
  // the app's default landing (src/app/page.tsx), so the Command category
  // opens there. Division Overview (the shared dashboard) follows it.
  { id: 'command',   label: 'Command',      tabs: ['inbox', 'action', 'command', 'analytics', 'announce', 'heatmap', 'personnel'] },
  { id: 'cases',     label: 'Cases',        tabs: ['cases', 'operations', 'legal', 'case-files', 'rico'] },
  // The 14 intelligence tabs now live INSIDE the Investigative Tools
  // workspace (/tools) — the old leaf routes still resolve and redirect there,
  // so nothing is lost; the category is just one nav item now.
  { id: 'intel',     label: 'Investigative Tools', tabs: ['tools'] },
  { id: 'reference', label: 'Reference',    tabs: ['penal', 'sops', 'guide', 'devdocs'] },
  { id: 'oversight', label: 'Oversight',    tabs: ['calendar', 'shifts', 'audit'] },
]

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
 *  SIU now carries CID's entire navigation, tab for tab. That is NAVIGATION,
 *  not access: every one of these routes is the same RLS-scoped view CID uses,
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
 *   * OWNER/COMMAND-ONLY surfaces (audit, devdocs, and the command staff parts
 *     of Central Command) self-gate exactly as they do for a CID detective who
 *     lacks the rank. An SIU account sees the ordinary nothing-here surface,
 *     which is existing designed behaviour rather than a broken screen.
 *
 *  The CID structure above is untouched: a CID member's portal is unchanged. */
export const SIU_NAV_CATEGORIES: NavCategory[] = [
  // The SIU-owned workspace leads. Everything after it is CID's own navigation,
  // tab for tab, in CID's order.
  { id: 'siu-unit',      label: 'Bureau',       tabs: ['siu'] },
  { id: 'siu-command',   label: 'Command',      tabs: ['inbox', 'action', 'command', 'analytics', 'announce', 'heatmap', 'personnel'] },
  { id: 'siu-cases',     label: 'Cases',        tabs: ['cases', 'operations', 'legal', 'case-files', 'rico'] },
  { id: 'siu-intel',     label: 'Investigative Tools', tabs: ['tools'] },
  { id: 'siu-ref',       label: 'Reference',    tabs: ['penal', 'sops', 'guide', 'devdocs'] },
  { id: 'siu-oversight', label: 'Oversight',    tabs: ['calendar', 'shifts', 'audit'] },
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
  command: 'Division Overview', analytics: 'Analytics', announce: 'Announcements', heatmap: 'Heatmap', personnel: 'Roster & Commendations',
  cases: 'Case Files', operations: 'Operations', legal: 'Legal Requests', 'case-files': 'Attachments', rico: 'RICO',
  persons: 'Persons', bolo: 'BOLO Board', gangs: 'Gangs', places: 'Places', vehicles: 'Vehicles', accounts: 'Accounts', indicators: 'Indicators', 'field-review': 'Intelligence',
  network: 'Network', narcotics: 'Narcotics', ballistics: 'Ballistics', modus: 'M.O. Detector',
  media: 'Media Vault', records: 'Records', penal: 'Penal Code', sops: 'SOPs & Library', guide: 'User Guide', devdocs: 'Developer Handbook',
  tools: 'Investigative Tools',
  inbox: 'My Dashboard', action: 'Action Center', calendar: 'Calendar', shifts: 'Shift Reports', audit: 'Audit Log', owner: 'Owner Console', profile: 'My Profile', 'command-center': 'Command Center', siu: 'Special Investigations Bureau',
}

/** Presentational sub-grouping for crowded categories — a visual layer over
 *  the SAME tabs in the SAME order. NAV_CATEGORIES stays the routing truth
 *  (vanilla parity untouched); the strip just draws labels/dividers. */
export const SUBTAB_GROUPS: Record<string, { label: string; tabs: string[] }[]> = {
  // (Currently empty: the former Intelligence groupings moved into the
  // Investigative Tools directory — see lib/toolsModel TOOL_GROUPS.)
}

/** tab → category (or null: a valid route that belongs to NO category — the
 *  Command strip must not light up for it and the sub-tab strip is
 *  suppressed). Covers EVERY PAGE_META tab: category tabs from
 *  NAV_CATEGORIES, the 14 legacy Intelligence tabs → 'intel' (their routes
 *  redirect into /tools, so the strip highlights Investigative Tools during
 *  the hop instead of mislighting Command), and the standalone surfaces
 *  (profile / owner / command-center / concern / siu / feedback) → null.
 *  Before this, anything absent from the map fell back to 'command' in
 *  useNav and mislit the Command strip. */
export const TAB_CATEGORY: Record<string, string | null> = {
  profile: null,
  owner: null,
  'command-center': null,
  concern: null,
  siu: null,
  feedback: null,
}
export const CAT_DEFAULT: Record<string, string> = {}
for (const t of TOOL_TABS) TAB_CATEGORY[t] = 'intel'
for (const c of NAV_CATEGORIES) {
  for (const t of c.tabs) TAB_CATEGORY[t] = c.id
  CAT_DEFAULT[c.id] = c.tabs[0]
}

/** Ownership is a profiles flag now (profiles.is_owner → useAuth().isOwner;
 *  private.is_owner() in RLS). The previous hard-coded owner UUIDs were
 *  migrated into that flag by the owner_role_and_feedback_meta migration. */

export const isValidTab = (tab: string): boolean => tab in PAGE_META

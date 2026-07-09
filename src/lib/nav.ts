/** Two-tier navigation model — ported 1:1 from the vanilla router (core.js):
 *  5 top-level categories, each a set of leaf tabs. The router navigates to
 *  leaf tabs; categories + the sub-tab strip are a grouping layer over them.
 *  Route ids, labels and grouping MUST stay identical to vanilla for parity. */

export interface PageMeta {
  title: string
  sub: string
}

export const PAGE_META: Record<string, PageMeta> = {
  command:    { title: 'Central Command', sub: 'Case assignment & operational hub' },
  analytics:  { title: 'Division Analytics', sub: 'Caseload, clearance & activity trends' },
  cases:      { title: 'Case Files', sub: 'Live case records, evidence & chain-of-custody' },
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
  inbox:      { title: 'My Desk', sub: 'Everything waiting on you — sign-off, overdue cases, mentions & draft reports' },
  shifts:     { title: 'Weekly Shift Reports', sub: 'Detective activity rolled up to bureau leadership' },
  audit:      { title: 'Audit Log', sub: 'Division-wide action history (owner-only)' },
  feedback:   { title: 'Feedback', sub: 'Suggest a feature or report a bug' },
  owner:      { title: 'Owner Portal', sub: 'Project intelligence, feedback triage & engineering operations (owner-only)' },
  vehicles:   { title: 'Vehicle Registry', sub: 'Plates, owners & cross-case matches' },
  indicators: { title: 'Indicators Registry', sub: 'Phones, accounts, serials, aliases & addresses — deconflicted across cases' },
  bolo:       { title: 'BOLO Board', sub: 'At-large subjects — be on the lookout' },
  guide:      { title: 'User Guide', sub: 'How to sign in, navigate & work a case — new member orientation' },
  calendar:   { title: 'Division Calendar', sub: 'Follow-ups, task deadlines & shift weeks at a glance' },
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
  { id: 'command',   label: 'Command',      tabs: ['command', 'analytics', 'announce', 'heatmap', 'personnel'] },
  { id: 'cases',     label: 'Cases',        tabs: ['cases', 'operations', 'case-files', 'rico'] },
  { id: 'intel',     label: 'Intelligence', tabs: ['persons', 'bolo', 'gangs', 'places', 'vehicles', 'indicators', 'network', 'narcotics', 'ballistics', 'modus', 'media', 'records'] },
  { id: 'reference', label: 'Reference',    tabs: ['penal', 'sops', 'guide', 'devdocs'] },
  { id: 'oversight', label: 'Oversight',    tabs: ['inbox', 'calendar', 'shifts', 'audit'] },
]

export const TAB_LABEL: Record<string, string> = {
  command: 'Dashboard', analytics: 'Analytics', announce: 'Announcements', heatmap: 'Heatmap', personnel: 'Roster & Commendations',
  cases: 'Case Files', operations: 'Operations', 'case-files': 'Attachments', rico: 'RICO',
  persons: 'Persons', bolo: 'BOLO Board', gangs: 'Gangs', places: 'Places', vehicles: 'Vehicles', indicators: 'Indicators',
  network: 'Network', narcotics: 'Narcotics', ballistics: 'Ballistics', modus: 'M.O. Detector',
  media: 'Media Vault', records: 'Records', penal: 'Penal Code', sops: 'SOPs & Library', guide: 'User Guide', devdocs: 'Developer Handbook',
  inbox: 'My Desk', calendar: 'Calendar', shifts: 'Shift Reports', audit: 'Audit Log', owner: 'Owner Portal',
}

export const TAB_CATEGORY: Record<string, string> = {}
export const CAT_DEFAULT: Record<string, string> = {}
for (const c of NAV_CATEGORIES) {
  for (const t of c.tabs) TAB_CATEGORY[t] = c.id
  CAT_DEFAULT[c.id] = c.tabs[0]
}

/** Ownership is a profiles flag now (profiles.is_owner → useAuth().isOwner;
 *  private.is_owner() in RLS). The previous hard-coded owner UUIDs were
 *  migrated into that flag by the owner_role_and_feedback_meta migration. */

export const isValidTab = (tab: string): boolean => tab in PAGE_META

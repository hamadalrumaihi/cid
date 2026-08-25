/** Investigative Tools workspace model — the Intelligence category's 14 tabs
 *  consolidated behind one nav item (`/tools`). This file is DATA ONLY (no
 *  components) so the server route, the redirect shim and the client
 *  workspace can all import it. The tool ids are the existing route ids —
 *  nothing is invented, nothing is dropped; the old routes stay valid and
 *  redirect into the workspace (ToolTabRedirect). All reads behind every tool
 *  remain RLS-scoped exactly as before: this layer is navigation, not access. */

export const TOOL_TABS = [
  'persons', 'bolo', 'gangs', 'places', 'vehicles', 'accounts', 'indicators',
  'field-review', 'network', 'narcotics', 'ballistics', 'modus', 'media', 'records',
] as const

export type ToolId = (typeof TOOL_TABS)[number]

export const isToolTab = (tab: string): tab is ToolId =>
  (TOOL_TABS as readonly string[]).includes(tab)

export interface ToolGroup {
  id: string
  label: string
  tools: readonly ToolId[]
}

/** Directory grouping — a presentation layer over the SAME tools. */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  { id: 'records',     label: 'Intelligence Records', tools: ['persons', 'gangs', 'places', 'vehicles', 'accounts', 'indicators'] },
  { id: 'operational', label: 'Operational Tools',    tools: ['bolo', 'field-review', 'media', 'records'] },
  { id: 'analysis',    label: 'Analysis',             tools: ['network', 'narcotics', 'ballistics', 'modus'] },
]

/** Record query-param each tool's EXISTING view understands (discovered from
 *  the views' `sp.get(...)` reads). Only real ones are listed — a tool absent
 *  here has no record deep-link param today. Used by ToolTabRedirect and
 *  openHref to keep every old bookmark / notification / cross-link working. */
export const RECORD_PARAM: Partial<Record<ToolId, string>> = {
  persons: 'person',
  vehicles: 'vehicle',
  gangs: 'gang',
  places: 'place',
  narcotics: 'drug',
}

/** Tools whose record param maps to a dedicated workspace RECORD TAB (a
 *  standalone profile component with an `id` prop exists — see toolRegistry).
 *  The others keep their original param untouched so their list view's own
 *  deep-link handling (e.g. GangsView's `?gang=`) still works inside /tools. */
export const RECORD_TAB_TOOLS: readonly ToolId[] = ['persons', 'vehicles']

export const hasRecordTabs = (tool: ToolId): boolean => RECORD_TAB_TOOLS.includes(tool)

/** Where a record tab's display title comes from on restore. Persisted state
 *  holds IDS ONLY; the title is re-fetched through the RLS-scoped client on
 *  every restore, and an empty result closes the tab silently (permission-safe
 *  restore — a row the viewer can no longer see simply disappears). */
export const RECORD_TITLE_SOURCE: Partial<Record<ToolId, { table: 'persons' | 'vehicles' | 'gangs' | 'places' | 'narcotics'; column: string }>> = {
  persons: { table: 'persons', column: 'name' },
  vehicles: { table: 'vehicles', column: 'plate' },
  gangs: { table: 'gangs', column: 'name' },
  places: { table: 'places', column: 'name' },
  narcotics: { table: 'narcotics', column: 'name' },
}

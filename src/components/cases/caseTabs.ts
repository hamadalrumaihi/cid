/** The case-detail tab rail — ids, labels and the three-area grouping — as a
 *  standalone module so the in-app User Guide renders the REAL rail instead of
 *  maintaining a hard-coded copy that drifts (the old guide still advertised
 *  "Evidence" and "Files" tabs years after they were renamed). CaseDetail is
 *  the routing consumer; GuideView is the documentation consumer.
 *
 *  Phase 3 (plan §5.5): the entity sections (people, vehicles, gangs,
 *  locations), Notes and Activity join the rail; `media` is labelled
 *  "Evidence" again and `intel` narrows to "Intel" (narcotics and accounts —
 *  notes moved to their own section). */
import type { SectionTabGroup } from '@/components/ui/SectionTabs'

export const CASE_TABS = [
  'overview', 'people', 'vehicles', 'gangs', 'locations', 'intel', 'surveillance', 'extractions', 'timeline', 'graph',
  'media', 'charges', 'rico', 'reports',
  'notes', 'activity', 'legal', 'tasks', 'signoff', 'chat',
] as const
export type CaseTabId = (typeof CASE_TABS)[number]

export const CASE_TAB_LABELS: Record<CaseTabId, string> = {
  overview: 'Brief', people: 'People', vehicles: 'Vehicles', gangs: 'Gangs', locations: 'Locations',
  intel: 'Intel', surveillance: 'Surveillance', extractions: 'Extractions', timeline: 'Timeline', graph: 'Graph',
  media: 'Evidence', charges: 'Charges', rico: 'RICO', reports: 'Reports',
  notes: 'Notes', activity: 'Activity', legal: 'Legal', tasks: 'Tasks', signoff: 'Sign-off', chat: 'Chat',
}

/** Visual grouping only — the three-area case-jacket IA: how a detective
 *  thinks about the work (investigate → evidence & record → coordinate and
 *  close), not twenty peer tabs. `?tab=` URL values match the ids (the legacy
 *  `tab=evidence` link resolves via normalizeCaseTab), so every deep link
 *  keeps working. RICO is conditional (ricoTabVisible): its group simply
 *  skips it when hidden. */
export const CASE_TAB_GROUPS: ReadonlyArray<SectionTabGroup<CaseTabId>> = [
  { label: 'Investigation', tabs: ['overview', 'people', 'vehicles', 'gangs', 'locations', 'intel', 'surveillance', 'extractions', 'timeline', 'graph'] },
  { label: 'Evidence & Case Record', tabs: ['media', 'charges', 'rico', 'reports'] },
  { label: 'Coordination & Closure', tabs: ['notes', 'activity', 'legal', 'tasks', 'signoff', 'chat'] },
]

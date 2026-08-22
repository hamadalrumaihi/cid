/** The case-detail tab rail — ids, labels and the three-area grouping — as a
 *  standalone module so the in-app User Guide renders the REAL rail instead of
 *  maintaining a hard-coded copy that drifts (the old guide still advertised
 *  "Evidence" and "Files" tabs years after they were renamed). CaseDetail is
 *  the routing consumer; GuideView is the documentation consumer. */
import type { SectionTabGroup } from '@/components/ui/SectionTabs'

export const CASE_TABS = ['overview', 'graph', 'media', 'intel', 'surveillance', 'extractions', 'charges', 'rico', 'reports', 'tasks', 'legal', 'signoff', 'chat', 'timeline'] as const
export type CaseTabId = (typeof CASE_TABS)[number]

export const CASE_TAB_LABELS: Record<CaseTabId, string> = {
  overview: 'Brief', graph: 'Graph', media: 'Photos & Media', intel: 'Intel & Notes',
  surveillance: 'Surveillance',
  extractions: 'Extractions', charges: 'Charges', rico: 'RICO', reports: 'Reports', tasks: 'Tasks',
  legal: 'Legal', signoff: 'Sign-off', chat: 'Chat', timeline: 'Timeline',
}

/** Visual grouping only — the three-area case-jacket IA: how a detective
 *  thinks about the work (investigate → evidence & record → coordinate and
 *  close), not fourteen peer tabs. `?tab=` URL values match the ids (legacy
 *  `tab=evidence`/`tab=notes` links resolve via normalizeCaseTab), so every
 *  deep link keeps working. RICO is conditional (ricoTabVisible): its group
 *  simply skips it when hidden. */
export const CASE_TAB_GROUPS: ReadonlyArray<SectionTabGroup<CaseTabId>> = [
  { label: 'Investigation', tabs: ['overview', 'intel', 'surveillance', 'extractions', 'timeline', 'graph'] },
  { label: 'Evidence & Case Record', tabs: ['media', 'charges', 'rico', 'reports'] },
  { label: 'Coordination & Closure', tabs: ['legal', 'tasks', 'signoff', 'chat'] },
]

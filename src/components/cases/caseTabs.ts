/** The case-detail tab rail — ids, labels and the three-area grouping — as a
 *  standalone module so the in-app User Guide renders the REAL rail instead of
 *  maintaining a hard-coded copy that drifts (the old guide still advertised
 *  "Evidence" and "Files" tabs years after they were renamed). CaseDetail is
 *  the routing consumer; GuideView and the phone case screen are the
 *  documentation / mobile consumers.
 *
 *  Phase 3 (plan §5.5): the entity sections (people, vehicles, gangs,
 *  locations), Notes and Activity join the rail; `media` is labelled
 *  "Evidence" again and `intel` narrows to "Intel" (narcotics and accounts —
 *  notes moved to their own section).
 *
 *  CI release: `ci` ("CI Intelligence") is a CONDITIONAL tab — CaseDetail
 *  lists it only when `useCiCaseCount(id) > 0` (never a lock, placeholder or
 *  zero pill; RLS is the wall), and it never appears on the phone screen or
 *  in the documented rail. Rarely-populated tabs (CASE_TAB_OPTIONAL) fold
 *  into a "More…" chip while their count is 0.
 *
 *  Platform upgrade: `media` is labelled "Evidence & Media" (the integrity /
 *  custody surface) and `documents` joins the Evidence & Case Record group —
 *  reports, evidence documents, legal documents, generated documents, case
 *  packets and document tools. It is OPTIONAL: it folds into More… until the
 *  case has a document or a packet (count = live case_packets + media rows
 *  that are documents or generated derivatives). */
import type { SectionTabGroup } from '@/components/ui/SectionTabs'

export const CASE_TABS = [
  'overview', 'people', 'vehicles', 'gangs', 'locations', 'intel', 'ci', 'surveillance', 'extractions', 'timeline', 'graph',
  'media', 'documents', 'charges', 'rico', 'reports',
  'notes', 'activity', 'legal', 'tasks', 'signoff', 'chat',
] as const
export type CaseTabId = (typeof CASE_TABS)[number]

export const CASE_TAB_LABELS: Record<CaseTabId, string> = {
  overview: 'Brief', people: 'People', vehicles: 'Vehicles', gangs: 'Gangs', locations: 'Locations',
  intel: 'Intel', ci: 'CI Intelligence', surveillance: 'Surveillance', extractions: 'Extractions', timeline: 'Timeline', graph: 'Graph',
  media: 'Evidence & Media', documents: 'Documents', charges: 'Charges', rico: 'RICO', reports: 'Reports',
  notes: 'Notes', activity: 'Activity', legal: 'Legal', tasks: 'Tasks', signoff: 'Sign-off', chat: 'Chat',
}

/** Tabs that exist only when they have something to show — present with a
 *  count or absent entirely (never in More…, never on mobile, never in the
 *  documented rail). Today: `ci`. */
export const CASE_TAB_CONDITIONAL: ReadonlySet<CaseTabId> = new Set<CaseTabId>(['ci'])

/** Tabs CaseDetail folds into the "More…" chip while their count is 0 and
 *  they are not the active tab. `ci` is deliberately NOT here — it is either
 *  present with a count or absent. */
export const CASE_TAB_OPTIONAL: ReadonlySet<CaseTabId> = new Set<CaseTabId>([
  'graph', 'charges', 'rico', 'legal', 'surveillance', 'extractions', 'timeline', 'documents',
])

/** Visual grouping only — the three-area case-jacket IA: how a detective
 *  thinks about the work (investigate → evidence & record → coordinate and
 *  close), not twenty peer tabs. `?tab=` URL values match the ids (the legacy
 *  `tab=evidence` link resolves via normalizeCaseTab), so every deep link
 *  keeps working. RICO and `ci` are conditional: their group simply skips
 *  them when hidden. This is the COMPLETE rail (every CASE_TABS id) —
 *  CaseDetail's desktop strip. */
export const CASE_TAB_GROUPS_ALL: ReadonlyArray<SectionTabGroup<CaseTabId>> = [
  { label: 'Investigation', tabs: ['overview', 'people', 'vehicles', 'gangs', 'locations', 'intel', 'ci', 'surveillance', 'extractions', 'timeline', 'graph'] },
  { label: 'Evidence & Case Record', tabs: ['media', 'documents', 'charges', 'rico', 'reports'] },
  { label: 'Coordination & Closure', tabs: ['notes', 'activity', 'legal', 'tasks', 'signoff', 'chat'] },
]

/** The documented rail — the same groups without the conditional tabs. The
 *  in-app User Guide and the phone case screen render THIS: a tab that only
 *  exists for the accounts a compartment involves is not orientation copy. */
export const CASE_TAB_GROUPS: ReadonlyArray<SectionTabGroup<CaseTabId>> = CASE_TAB_GROUPS_ALL.map((g) => ({
  label: g.label,
  tabs: g.tabs.filter((t) => !CASE_TAB_CONDITIONAL.has(t)),
}))

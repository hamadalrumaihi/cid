import { describe, expect, it } from 'vitest'
import { CASE_TABS, CASE_TAB_GROUPS, CASE_TAB_LABELS } from './caseTabs'

/** The in-app User Guide renders the rail from these definitions, so this pin
 *  is what keeps the guide honest: every routed tab must appear in exactly one
 *  visual group with a label, and no group may invent a tab that cannot be
 *  routed to. (SectionTabs appends any ungrouped tab as a trailing section,
 *  which would silently hide a grouping mistake — hence the exact check.) */
describe('case tab rail', () => {
  it('every tab is grouped exactly once', () => {
    const grouped = CASE_TAB_GROUPS.flatMap((g) => g.tabs)
    expect([...grouped].sort()).toEqual([...CASE_TABS].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('every tab has a label, and the obsolete names are gone', () => {
    for (const t of CASE_TABS) expect(CASE_TAB_LABELS[t]).toBeTruthy()
    const labels = Object.values(CASE_TAB_LABELS)
    // The pre-redesign guide advertised these long after they were renamed.
    expect(labels).not.toContain('Evidence')
    expect(labels).not.toContain('Files')
    expect(labels).not.toContain('Overview')
  })

  it('the three-area IA is the one the guide documents', () => {
    expect(CASE_TAB_GROUPS.map((g) => g.label)).toEqual([
      'Investigation', 'Evidence & Case Record', 'Coordination & Closure',
    ])
  })
})

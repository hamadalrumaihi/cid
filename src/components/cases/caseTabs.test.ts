import { describe, expect, it } from 'vitest'
import {
  CASE_TABS, CASE_TAB_CONDITIONAL, CASE_TAB_GROUPS, CASE_TAB_GROUPS_ALL, CASE_TAB_LABELS, CASE_TAB_OPTIONAL,
} from './caseTabs'

/** The in-app User Guide renders the rail from these definitions, so this pin
 *  is what keeps the guide honest: every routed tab must appear in exactly one
 *  visual group with a label, and no group may invent a tab that cannot be
 *  routed to. (SectionTabs appends any ungrouped tab as a trailing section,
 *  which would silently hide a grouping mistake — hence the exact check.) */
describe('case tab rail', () => {
  it('every tab is grouped exactly once in the complete rail', () => {
    const grouped = CASE_TAB_GROUPS_ALL.flatMap((g) => g.tabs)
    expect([...grouped].sort()).toEqual([...CASE_TABS].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('the documented rail is the complete rail minus the conditional tabs, same groups, same order', () => {
    expect(CASE_TAB_GROUPS.map((g) => g.label)).toEqual(CASE_TAB_GROUPS_ALL.map((g) => g.label))
    const documented = CASE_TAB_GROUPS.flatMap((g) => g.tabs)
    const all = CASE_TAB_GROUPS_ALL.flatMap((g) => g.tabs)
    expect(documented).toEqual(all.filter((t) => !CASE_TAB_CONDITIONAL.has(t)))
    for (const t of CASE_TAB_CONDITIONAL) expect(documented).not.toContain(t)
  })

  it('every tab has a label, and the obsolete names are gone', () => {
    for (const t of CASE_TABS) expect(CASE_TAB_LABELS[t]).toBeTruthy()
    const labels = Object.values(CASE_TAB_LABELS)
    // The pre-redesign guide advertised these long after they were renamed.
    expect(labels).not.toContain('Files')
    expect(labels).not.toContain('Overview')
    expect(labels).not.toContain('Intel & Notes')
    expect(labels).not.toContain('Photos & Media')
    // Platform upgrade: the media section is "Evidence & Media" (integrity,
    // custody, derivatives) and Documents sits beside it.
    expect(CASE_TAB_LABELS.media).toBe('Evidence & Media')
    expect(CASE_TAB_LABELS.documents).toBe('Documents')
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('carries the Phase 3 sections (entity sections, Notes, Activity)', () => {
    for (const t of ['people', 'vehicles', 'gangs', 'locations', 'notes', 'activity'] as const) {
      expect(CASE_TABS).toContain(t)
    }
  })

  it('Documents sits in Evidence & Case Record, right after Evidence & Media', () => {
    const record = CASE_TAB_GROUPS_ALL[1].tabs
    expect(record[record.indexOf('media') + 1]).toBe('documents')
    expect(CASE_TAB_CONDITIONAL.has('documents')).toBe(false)
  })

  it('the three-area IA is the one the guide documents', () => {
    expect(CASE_TAB_GROUPS.map((g) => g.label)).toEqual([
      'Investigation', 'Evidence & Case Record', 'Coordination & Closure',
    ])
  })

  it("the CI tab is conditional ('CI Intelligence', Investigation group right after intel) and never optional", () => {
    expect(CASE_TAB_LABELS.ci).toBe('CI Intelligence')
    expect(CASE_TAB_CONDITIONAL.has('ci')).toBe(true)
    expect(CASE_TAB_OPTIONAL.has('ci')).toBe(false)
    const investigation = CASE_TAB_GROUPS_ALL[0].tabs
    expect(investigation[investigation.indexOf('intel') + 1]).toBe('ci')
  })

  it('the More… fold covers exactly the rarely-populated tabs', () => {
    expect([...CASE_TAB_OPTIONAL].sort()).toEqual(['charges', 'documents', 'extractions', 'graph', 'legal', 'rico', 'surveillance', 'timeline'])
    // The fold never hides a section that every case needs.
    for (const t of ['overview', 'people', 'media', 'reports', 'notes', 'tasks', 'signoff', 'chat'] as const) {
      expect(CASE_TAB_OPTIONAL.has(t)).toBe(false)
    }
  })
})

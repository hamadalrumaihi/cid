import { describe, expect, it } from 'vitest'
import {
  RECORD_PARAM, RECORD_TAB_TOOLS, RECORD_TITLE_SOURCE, TOOL_GROUPS, TOOL_TABS,
  hasRecordTabs, isToolTab, type ToolId,
} from './toolsModel'
import { PAGE_META, TAB_LABEL, isValidTab } from './nav'

/** The Investigative Tools workspace consolidated the Intelligence category's
 *  14 leaf tabs behind `/tools`. This pin is what keeps that consolidation
 *  honest: the directory groups exactly the routed tools (nothing invented,
 *  nothing dropped), every tool still resolves as a legacy route, and the
 *  record deep-link maps only name tools that really exist. */
describe('toolsModel — TOOL_TABS', () => {
  it('is the 14 legacy Intelligence tabs, no duplicates', () => {
    expect(TOOL_TABS).toHaveLength(14)
    expect(new Set(TOOL_TABS).size).toBe(TOOL_TABS.length)
    expect([...TOOL_TABS].sort()).toEqual([
      'accounts', 'ballistics', 'bolo', 'field-review', 'gangs', 'indicators',
      'media', 'modus', 'narcotics', 'network', 'persons', 'places',
      'records', 'vehicles',
    ])
  })

  it('every tool keeps its PAGE_META entry and TAB_LABEL (legacy routes stay registered)', () => {
    for (const t of TOOL_TABS) {
      expect(PAGE_META[t], `PAGE_META['${t}']`).toBeTruthy()
      expect(PAGE_META[t].title, `PAGE_META['${t}'].title`).toBeTruthy()
      expect(PAGE_META[t].sub, `PAGE_META['${t}'].sub — the directory renders it`).toBeTruthy()
      expect(TAB_LABEL[t], `TAB_LABEL['${t}']`).toBeTruthy()
      // Deep links (`/persons?person=…` etc.) must keep resolving: the [tab]
      // route only renders the redirect shim for tabs isValidTab admits.
      expect(isValidTab(t), `isValidTab('${t}')`).toBe(true)
    }
  })
})

describe('toolsModel — TOOL_GROUPS (directory grouping)', () => {
  it('groups exactly TOOL_TABS — every tool in exactly one group, none invented', () => {
    const grouped = TOOL_GROUPS.flatMap((g) => g.tools)
    expect(new Set(grouped).size).toBe(grouped.length) // no duplicates across groups
    expect([...grouped].sort()).toEqual([...TOOL_TABS].sort()) // no inventions, none dropped
  })

  it('group ids are unique and every group carries a label', () => {
    const ids = TOOL_GROUPS.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const g of TOOL_GROUPS) {
      expect(g.label, `label of group '${g.id}'`).toBeTruthy()
      expect(g.tools.length, `group '${g.id}' must not be empty`).toBeGreaterThan(0)
    }
  })
})

describe('toolsModel — record deep-link maps', () => {
  it('RECORD_PARAM names only real tools, each with a non-empty param', () => {
    for (const [tool, param] of Object.entries(RECORD_PARAM)) {
      expect(isToolTab(tool), `RECORD_PARAM key '${tool}' must be a tool`).toBe(true)
      expect(param, `RECORD_PARAM['${tool}']`).toBeTruthy()
    }
    // The params are distinct — the redirect shim translates by name, so two
    // tools sharing a param would make old bookmarks ambiguous.
    const params = Object.values(RECORD_PARAM)
    expect(new Set(params).size).toBe(params.length)
  })

  it('RECORD_TITLE_SOURCE names only real tools, each with table + column', () => {
    for (const [tool, src] of Object.entries(RECORD_TITLE_SOURCE)) {
      expect(isToolTab(tool), `RECORD_TITLE_SOURCE key '${tool}' must be a tool`).toBe(true)
      expect(src?.table, `RECORD_TITLE_SOURCE['${tool}'].table`).toBeTruthy()
      expect(src?.column, `RECORD_TITLE_SOURCE['${tool}'].column`).toBeTruthy()
    }
  })

  it('every record-tab tool has BOTH a record param and a title source', () => {
    // Without the param the redirect shim cannot translate `?person=` into
    // `?record=`; without the title source a restored tab could never verify
    // its row through RLS (the permission-safe-restore contract).
    for (const t of RECORD_TAB_TOOLS) {
      expect(isToolTab(t), `RECORD_TAB_TOOLS entry '${t}'`).toBe(true)
      expect(RECORD_PARAM[t], `RECORD_PARAM['${t}']`).toBeTruthy()
      expect(RECORD_TITLE_SOURCE[t], `RECORD_TITLE_SOURCE['${t}']`).toBeTruthy()
    }
  })

  it('hasRecordTabs is true exactly for RECORD_TAB_TOOLS', () => {
    for (const t of TOOL_TABS) {
      expect(hasRecordTabs(t), `hasRecordTabs('${t}')`).toBe(RECORD_TAB_TOOLS.includes(t))
    }
    // The current contract: standalone record profiles exist for persons and
    // vehicles only (toolRegistry). Growing this list is fine — deliberately.
    expect([...RECORD_TAB_TOOLS].sort()).toEqual(['persons', 'vehicles'])
  })
})

describe('toolsModel — isToolTab', () => {
  it('accepts all 14 tools and only them', () => {
    for (const t of TOOL_TABS) expect(isToolTab(t)).toBe(true)
    for (const bad of ['tools', 'cases', 'legal', 'command', 'siu', '', 'PERSONS', 'person', ' persons']) {
      expect(isToolTab(bad), `isToolTab('${bad}')`).toBe(false)
    }
  })

  it('narrows to ToolId (type-level check exercised at runtime)', () => {
    const raw: string = 'persons'
    if (isToolTab(raw)) {
      const id: ToolId = raw // compiles only if the guard narrows
      expect(id).toBe('persons')
    } else {
      expect.unreachable('persons must be a tool tab')
    }
  })
})

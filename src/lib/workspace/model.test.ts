import { describe, expect, it } from 'vitest'
import {
  CASE_TAB_CAP, CASE_TITLE_PLACEHOLDER, EMPTY_WORKSPACE, activate, anyDirty, caseKey, caseTabs, closeAll, closeOthers,
  closeTabs, mirrorParams, openCase, openRecord, openTool, parseLegacyTools, parseStored, recordKey, reorder,
  restore, serialize, setDirty, setScroll, setSection, setTitle, toolKey, workspaceCaseHref, type WorkspaceState,
} from './model'

const openCases = (n: number, from = 1): WorkspaceState => {
  let s = EMPTY_WORKSPACE
  for (let i = from; i < from + n; i++) s = openCase(s, `c${i}`).state
  return s
}

describe('workspace model — keys and open', () => {
  it('opens tool, record and case tabs under their key scheme', () => {
    let s = openTool(EMPTY_WORKSPACE, 'persons')
    s = openRecord(s, 'persons', 'p1', 'Marcus Reed')
    s = openCase(s, 'c1', { title: 'CID-26-0140', section: 'tasks' }).state
    expect(s.tabs.map((t) => t.key)).toEqual(['tool:persons', 'record:persons:p1', 'case:c1'])
    expect(s.activeKey).toBe(caseKey('c1'))
    expect(s.tabs[2]).toMatchObject({ kind: 'case', id: 'c1', title: 'CID-26-0140', section: 'tasks' })
  })

  it('dedupes: reopening focuses and keeps state; a record title upgrade is applied', () => {
    let s = openRecord(EMPTY_WORKSPACE, 'persons', 'p1')
    expect(s.tabs[0].title).toBe('Persons')
    s = openTool(s, 'gangs')
    s = openRecord(s, 'persons', 'p1', 'Marcus Reed')
    expect(s.tabs).toHaveLength(2)
    expect(s.activeKey).toBe(recordKey('persons', 'p1'))
    expect(s.tabs[0].title).toBe('Marcus Reed')
  })

  it('a tool without record tabs opens its list tab instead', () => {
    const s = openRecord(EMPTY_WORKSPACE, 'places', 'x')
    expect(s.tabs.map((t) => t.key)).toEqual([toolKey('places')])
  })

  it('rejects unknown tools and empty ids', () => {
    expect(openTool(EMPTY_WORKSPACE, 'nope' as never)).toBe(EMPTY_WORKSPACE)
    expect(openRecord(EMPTY_WORKSPACE, 'persons', '')).toBe(EMPTY_WORKSPACE)
    expect(openCase(EMPTY_WORKSPACE, '').state).toBe(EMPTY_WORKSPACE)
  })
})

describe('workspace model — the case cap', () => {
  it(`allows ${CASE_TAB_CAP} distinct cases and flags the next one as capped`, () => {
    const s = openCases(CASE_TAB_CAP)
    expect(caseTabs(s)).toHaveLength(CASE_TAB_CAP)
    const ninth = openCase(s, 'c9')
    expect(ninth.capped).toBe(true)
    expect(ninth.state).toBe(s) // untouched — the UI asks which tab to close
  })

  it('re-focusing an already open case never counts against the cap', () => {
    const s = openCases(CASE_TAB_CAP)
    const again = openCase(s, 'c3', { section: 'reports' })
    expect(again.capped).toBe(false)
    expect(again.state.activeKey).toBe(caseKey('c3'))
    expect(again.state.tabs.find((t) => t.id === 'c3')?.section).toBe('reports')
  })

  it('tool and record tabs do not count toward the case cap', () => {
    let s = openCases(CASE_TAB_CAP)
    s = openTool(s, 'persons')
    s = openRecord(s, 'vehicles', 'v1')
    expect(s.tabs).toHaveLength(CASE_TAB_CAP + 2)
    expect(openCase(s, 'c9').capped).toBe(true)
    const freed = closeTabs(s, [caseKey('c1')])
    expect(openCase(freed, 'c9').capped).toBe(false)
  })
})

describe('workspace model — suspend / section memory', () => {
  it('keeps section and scroll on a suspended case tab and restores them on re-activation', () => {
    let s = openCase(EMPTY_WORKSPACE, 'c1').state
    s = setSection(s, caseKey('c1'), 'tasks')
    s = setScroll(s, caseKey('c1'), 420)
    s = openCase(s, 'c2').state
    expect(s.activeKey).toBe(caseKey('c2'))
    s = activate(s, caseKey('c1'))
    expect(s.tabs.find((t) => t.id === 'c1')).toMatchObject({ section: 'tasks', scroll: 420 })
  })

  it('a deep link with a section overrides the remembered one; without a section memory wins', () => {
    let s = openCase(EMPTY_WORKSPACE, 'c1', { section: 'tasks' }).state
    s = openCase(s, 'c1', { section: 'legal' }).state
    expect(s.tabs[0].section).toBe('legal')
    s = openCase(s, 'c1').state
    expect(s.tabs[0].section).toBe('legal')
  })

  it('field patches are identity-stable when nothing changes', () => {
    const s = openCase(EMPTY_WORKSPACE, 'c1', { section: 'tasks' }).state
    expect(setSection(s, caseKey('c1'), 'tasks')).toBe(s)
    expect(setTitle(s, caseKey('c1'), CASE_TITLE_PLACEHOLDER)).toBe(s)
    expect(setDirty(s, caseKey('c1'), false)).toBe(s)
    expect(setTitle(s, 'case:missing', 'x')).toBe(s)
  })
})

describe('workspace model — close semantics', () => {
  it('closing the active record returns to its list tab when open, else the nearest neighbour', () => {
    let s = openTool(EMPTY_WORKSPACE, 'persons')
    s = openRecord(s, 'persons', 'p1')
    s = closeTabs(s, [recordKey('persons', 'p1')])
    expect(s.activeKey).toBe(toolKey('persons'))

    let t = openCase(EMPTY_WORKSPACE, 'c1').state
    t = openCase(t, 'c2').state
    t = openCase(t, 'c3').state
    t = activate(t, caseKey('c2'))
    t = closeTabs(t, [caseKey('c2')])
    expect(t.activeKey).toBe(caseKey('c3')) // after wins over before
    t = closeTabs(t, [caseKey('c3')])
    expect(t.activeKey).toBe(caseKey('c1'))
    t = closeTabs(t, [caseKey('c1')])
    expect(t).toEqual({ tabs: [], activeKey: null })
  })

  it('closeOthers / closeAll / activate(null)', () => {
    const s = openCases(3)
    const others = closeOthers(s, caseKey('c1'))
    expect(others.tabs.map((t) => t.id)).toEqual(['c1'])
    expect(others.activeKey).toBe(caseKey('c1'))
    expect(closeAll(s)).toEqual({ tabs: [], activeKey: null })
    expect(closeAll(EMPTY_WORKSPACE)).toBe(EMPTY_WORKSPACE)
    expect(activate(s, null).activeKey).toBeNull()
    expect(activate(s, 'case:nope')).toBe(s)
    expect(closeTabs(s, ['case:nope'])).toBe(s)
  })

  it('reorder moves a tab and rejects out-of-range indices', () => {
    const s = openCases(3)
    expect(reorder(s, 0, 2).tabs.map((t) => t.id)).toEqual(['c2', 'c3', 'c1'])
    expect(reorder(s, 2, 0).tabs.map((t) => t.id)).toEqual(['c3', 'c1', 'c2'])
    expect(reorder(s, 0, 0)).toBe(s)
    expect(reorder(s, 0, 9)).toBe(s)
  })
})

describe('workspace model — dirty aggregate', () => {
  it('anyDirty reflects every tab kind', () => {
    let s = openTool(EMPTY_WORKSPACE, 'persons')
    s = openCase(s, 'c1').state
    expect(anyDirty(s)).toBe(false)
    s = setDirty(s, caseKey('c1'), true)
    expect(anyDirty(s)).toBe(true)
    s = setDirty(s, caseKey('c1'), false)
    expect(anyDirty(s)).toBe(false)
    s = setDirty(s, toolKey('persons'), true)
    expect(anyDirty(s)).toBe(true)
    expect(anyDirty(closeTabs(s, [toolKey('persons')]))).toBe(false)
  })
})

describe('workspace model — serialize / parse / restore', () => {
  it('round-trips ids and sections only — never titles, scroll or dirty', () => {
    let s = openTool(EMPTY_WORKSPACE, 'persons')
    s = openRecord(s, 'persons', 'p1', 'Marcus Reed')
    s = openCase(s, 'c1', { title: 'CID-26-0140', section: 'tasks' }).state
    s = setScroll(s, caseKey('c1'), 300)
    s = setDirty(s, caseKey('c1'), true)
    const stored = serialize(s)
    expect(stored).toEqual({
      tabs: [
        { kind: 'tool', id: 'persons', toolId: 'persons' },
        { kind: 'record', id: 'p1', toolId: 'persons' },
        { kind: 'case', id: 'c1', section: 'tasks' },
      ],
      active: caseKey('c1'),
    })
    expect(JSON.stringify(stored)).not.toContain('Marcus')
    expect(JSON.stringify(stored)).not.toContain('CID-26')

    const back = restore(parseStored(JSON.parse(JSON.stringify(stored)))!)
    expect(back.tabs.map((t) => t.key)).toEqual(s.tabs.map((t) => t.key))
    expect(back.activeKey).toBe(caseKey('c1'))
    expect(back.tabs[1].title).toBe('Persons') // placeholder until RLS re-resolution
    expect(back.tabs[2].title).toBe(CASE_TITLE_PLACEHOLDER)
    expect(back.tabs[2].section).toBe('tasks')
    expect(back.tabs[2].scroll).toBeUndefined()
    expect(back.tabs[2].dirty).toBeUndefined()
  })

  it('prunes garbage: unknown kinds/tools, records for list-only tools, duplicates, cases over the cap, dangling active', () => {
    const parsed = parseStored({
      tabs: [
        { kind: 'tool', id: 'persons' },
        { kind: 'tool', id: 'persons' }, // dup
        { kind: 'tool', id: 'nope' },
        { kind: 'record', id: 'x', toolId: 'places' }, // places has no record tab
        { kind: 'record', id: 'v1', toolId: 'vehicles', section: 'sales' },
        { kind: 'alien', id: 'z' },
        { id: 'no-kind' },
        ...Array.from({ length: CASE_TAB_CAP + 2 }, (_, i) => ({ kind: 'case', id: `c${i}` })),
      ],
      active: 'case:c99',
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.tabs.filter((t) => t.kind === 'case')).toHaveLength(CASE_TAB_CAP)
    expect(parsed!.tabs.slice(0, 2)).toEqual([
      { kind: 'tool', id: 'persons', toolId: 'persons' },
      { kind: 'record', id: 'v1', toolId: 'vehicles', section: 'sales' },
    ])
    expect(parsed!.active).toBeNull()
    expect(parseStored(null)).toBeNull()
    expect(parseStored('x')).toBeNull()
    expect(parseStored({ tabs: 'x' })).toBeNull()
  })

  it('adopts the legacy ToolsView payload once (toolId/recordId, colon active key)', () => {
    const parsed = parseLegacyTools({
      tabs: [{ toolId: 'persons' }, { toolId: 'gangs', recordId: 'g1' }, { toolId: 'places', recordId: 'skip' }, { toolId: 'nope' }],
      activeKey: 'gangs:g1',
    })
    expect(parsed).toEqual({
      tabs: [{ kind: 'tool', id: 'persons', toolId: 'persons' }, { kind: 'record', id: 'g1', toolId: 'gangs' }],
      active: recordKey('gangs', 'g1'),
    })
    expect(parseLegacyTools({ tabs: [{ toolId: 'persons' }], activeKey: 'persons' })!.active).toBe(toolKey('persons'))
    expect(parseLegacyTools(undefined)).toBeNull()
  })
})

describe('workspace model — URL contract', () => {
  it('workspaceCaseHref carries the record params in stable order', () => {
    expect(workspaceCaseHref('c1')).toBe('/workspace?case=c1')
    expect(workspaceCaseHref('c1', 'tasks', { task: 't1' })).toBe('/workspace?case=c1&tab=tasks&task=t1')
    expect(workspaceCaseHref('c 1', 'media', { evidence: 'e1', report: 'r1' })).toBe('/workspace?case=c+1&tab=media&report=r1&evidence=e1')
  })

  it('mirrorParams describes the active tab and drops another tab’s record params', () => {
    const c1 = openCase(EMPTY_WORKSPACE, 'c1', { section: 'reports' }).state.tabs[0]
    const c2 = { ...c1, key: caseKey('c2'), id: 'c2', section: 'tasks' }
    const current = new URLSearchParams('case=c1&tab=reports&report=r1&q=warehouse')
    // Same case → keeps its report param; section follows the tab.
    expect(mirrorParams(current, { ...c1, section: 'tasks' }).toString()).toBe('case=c1&tab=tasks&report=r1&q=warehouse')
    // Another case → report param dropped, seeds carried.
    expect(mirrorParams(current, c2).toString()).toBe('q=warehouse&case=c2&tab=tasks')
    // A tool tab → case family cleared.
    const persons = openTool(EMPTY_WORKSPACE, 'persons').tabs[0]
    expect(mirrorParams(current, persons).toString()).toBe('q=warehouse&tool=persons')
    const rec = openRecord(EMPTY_WORKSPACE, 'vehicles', 'v1').tabs[0]
    expect(mirrorParams(new URLSearchParams('tool=persons&section=identity'), rec).toString()).toBe('tool=vehicles&section=identity&record=v1')
    // Directory → nothing tab-related remains.
    expect(mirrorParams(new URLSearchParams('tool=persons&record=p1&case=c1&tab=x&q=1'), null).toString()).toBe('q=1')
  })
})

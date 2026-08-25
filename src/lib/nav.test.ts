import { describe, expect, it } from 'vitest'
import {
  CAT_DEFAULT, NAV_CATEGORIES, PAGE_META, SIU_NAV_CATEGORIES, SIU_TAB_LABEL,
  SUBTAB_GROUPS, TAB_CATEGORY, TAB_LABEL, isValidTab,
} from './nav'
import { TOOL_TABS } from './toolsModel'

/** nav.ts is a three-way contract (PAGE_META keys ↔ category tabs ↔ the [tab]
 *  route switch). After the Investigative Tools consolidation the Intelligence
 *  categories collapsed to the single 'tools' leaf — but the 14 legacy tabs
 *  MUST stay registered so every old deep link still resolves (the [tab] page
 *  redirects unknown slugs to /command, which would silently eat bookmarks). */
describe('nav — Investigative Tools consolidation', () => {
  it("registers the 'tools' leaf in PAGE_META and TAB_LABEL", () => {
    expect(isValidTab('tools')).toBe(true)
    expect(PAGE_META.tools.title).toBe('Investigative Tools')
    expect(PAGE_META.tools.sub).toBeTruthy()
    expect(TAB_LABEL.tools).toBe('Investigative Tools')
  })

  it("the CID intel category is exactly ['tools']", () => {
    const intel = NAV_CATEGORIES.find((c) => c.id === 'intel')
    expect(intel).toBeTruthy()
    expect(intel!.tabs).toEqual(['tools'])
    expect(intel!.label).toBe('Investigative Tools')
  })

  it("the SIU siu-intel category is exactly ['tools'] (CID parity)", () => {
    const intel = SIU_NAV_CATEGORIES.find((c) => c.id === 'siu-intel')
    expect(intel).toBeTruthy()
    expect(intel!.tabs).toEqual(['tools'])
  })

  it('all 14 legacy Intelligence tabs remain valid — deep links must resolve', () => {
    for (const t of TOOL_TABS) expect(isValidTab(t), `isValidTab('${t}')`).toBe(true)
  })

  it('no legacy Intelligence tab is listed in any nav category (they live inside /tools)', () => {
    const tools = new Set<string>(TOOL_TABS)
    for (const c of [...NAV_CATEGORIES, ...SIU_NAV_CATEGORIES]) {
      for (const t of c.tabs) {
        expect(tools.has(t), `'${t}' must not appear in category '${c.id}'`).toBe(false)
      }
    }
  })

  it('derived maps follow: tools belongs to intel, and intel opens on tools', () => {
    expect(TAB_CATEGORY.tools).toBe('intel')
    expect(CAT_DEFAULT.intel).toBe('tools')
  })

  it("legacy Intelligence tabs map to 'intel' (their routes redirect into /tools)", () => {
    for (const t of TOOL_TABS) expect(TAB_CATEGORY[t], `TAB_CATEGORY['${t}']`).toBe('intel')
  })
})

describe('nav — general invariants', () => {
  it('every routed tab in every category exists in PAGE_META and TAB_LABEL', () => {
    for (const c of [...NAV_CATEGORIES, ...SIU_NAV_CATEGORIES]) {
      for (const t of c.tabs) {
        expect(isValidTab(t), `PAGE_META['${t}'] (category '${c.id}')`).toBe(true)
        expect(TAB_LABEL[t] ?? SIU_TAB_LABEL[t], `label for '${t}'`).toBeTruthy()
      }
    }
  })

  it('no tab appears in two CID categories (TAB_CATEGORY would silently keep the last)', () => {
    const tabs = NAV_CATEGORIES.flatMap((c) => c.tabs)
    expect(new Set(tabs).size).toBe(tabs.length)
  })

  it('SUBTAB_GROUPS is a visual layer over real categories and their own tabs', () => {
    // Currently empty (the former Intelligence groupings moved into the tools
    // directory — lib/toolsModel TOOL_GROUPS); this guards any future entry.
    for (const [catId, groups] of Object.entries(SUBTAB_GROUPS)) {
      const cat = NAV_CATEGORIES.find((c) => c.id === catId)
      expect(cat, `SUBTAB_GROUPS['${catId}'] must reference a category`).toBeTruthy()
      for (const g of groups) {
        for (const t of g.tabs) {
          expect(cat!.tabs, `'${t}' grouped under '${catId}'`).toContain(t)
        }
      }
    }
  })

  it('isValidTab rejects the retired/unknown slugs the router falls back on', () => {
    for (const bad of ['reports', 'intel', 'nope', '']) {
      expect(isValidTab(bad), `isValidTab('${bad}')`).toBe(false)
    }
  })

  it('TAB_CATEGORY covers EVERY PAGE_META tab (no silent Command fallback)', () => {
    for (const t of Object.keys(PAGE_META)) {
      expect(TAB_CATEGORY[t] !== undefined, `TAB_CATEGORY['${t}'] must be a category id or null`).toBe(true)
    }
  })

  it('standalone surfaces belong to NO category (null → no strip highlight, no Subtabs)', () => {
    for (const t of ['profile', 'owner', 'command-center', 'concern', 'siu', 'feedback']) {
      expect(TAB_CATEGORY[t], `TAB_CATEGORY['${t}']`).toBeNull()
    }
  })

  it('every non-null TAB_CATEGORY value is a real CID category id', () => {
    const catIds = new Set(NAV_CATEGORIES.map((c) => c.id))
    for (const [t, cat] of Object.entries(TAB_CATEGORY)) {
      if (cat !== null) expect(catIds.has(cat), `TAB_CATEGORY['${t}'] = '${cat}'`).toBe(true)
    }
  })
})

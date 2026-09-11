import { describe, expect, it } from 'vitest'
import { DASH_LABEL, DASH_TAB } from '@/lib/nav'
import {
  CAT_DEFAULT, LEGACY_REDIRECT_TABS, NAV_CATEGORIES, OWNER_ONLY_CATEGORIES, PAGE_META, SIU_NAV_CATEGORIES,
  SIU_TAB_LABEL, SUBTAB_GROUPS, TAB_CATEGORY, TAB_LABEL, TOOL_META, isValidTab,
} from './nav'
import { TOOL_TABS } from './toolsModel'

/** nav.ts is a three-way contract (PAGE_META keys ↔ category tabs ↔ the [tab]
 *  route switch) plus the legacy list: retired ids MUST stay routable so every
 *  old deep link still resolves (the [tab] page redirects unknown slugs to
 *  /inbox, which would silently eat bookmarks). */
describe('nav — legacy redirect routes', () => {
  it('the retired ids are exactly action, command, tools, the 14 tool routes and reports', () => {
    expect([...LEGACY_REDIRECT_TABS]).toEqual(['action', 'command', 'tools', ...TOOL_TABS, 'reports'])
  })

  it('legacy ids are routable (isValidTab) but carry NO page metadata', () => {
    for (const t of LEGACY_REDIRECT_TABS) {
      expect(isValidTab(t), `isValidTab('${t}')`).toBe(true)
      expect(t in PAGE_META, `PAGE_META['${t}'] must not exist`).toBe(false)
    }
  })

  it('the tool directory keeps a title/sub per tool (TOOL_META) and a label (TAB_LABEL)', () => {
    expect(TOOL_META.tools.title).toBe('Investigative Tools')
    for (const t of TOOL_TABS) {
      expect(TOOL_META[t]?.title, `TOOL_META['${t}']`).toBeTruthy()
      expect(TAB_LABEL[t], `TAB_LABEL['${t}']`).toBeTruthy()
    }
  })

  it("registers the 'workspace' leaf (the unified workspace) in PAGE_META and TAB_LABEL", () => {
    expect(isValidTab('workspace')).toBe(true)
    expect(PAGE_META.workspace.title).toBe('Workspace')
    expect(TAB_LABEL.workspace).toBe('Workspace')
  })

  it('no legacy id is listed in any nav category (they redirect, they are not destinations)', () => {
    const legacy = new Set<string>(LEGACY_REDIRECT_TABS)
    for (const c of [...NAV_CATEGORIES, ...SIU_NAV_CATEGORIES]) {
      for (const t of c.tabs) {
        expect(legacy.has(t), `'${t}' must not appear in category '${c.id}'`).toBe(false)
      }
    }
  })

  it('legacy ids light the category they redirect into (no silent Command fallback in useNav)', () => {
    expect(TAB_CATEGORY.workspace).toBe('cases')
    expect(TAB_CATEGORY.tools).toBe('cases')
    expect(TAB_CATEGORY.reports).toBe('cases')
    expect(TAB_CATEGORY.action).toBe('command')
    expect(TAB_CATEGORY.command).toBeNull()
    for (const t of TOOL_TABS) expect(TAB_CATEGORY[t], `TAB_CATEGORY['${t}']`).toBe('cases')
  })
})

/** The CI-release IA: the Action Center is the personal home and default
 *  landing (/inbox), My Dashboard moved to /dashboard, Cases + Investigative
 *  Tools merged into Investigations, and the Owner leaves form a category. */
describe('nav — categories', () => {
  it('the category ids, labels and tab order are pinned', () => {
    expect(NAV_CATEGORIES.map((c) => [c.id, c.label, c.tabs])).toEqual([
      ['command', 'Command', ['inbox', 'dashboard', 'analytics', 'announce', 'heatmap', 'personnel']],
      ['cases', 'Investigations', ['cases', 'operations', 'legal', 'intelligence', 'informants', 'registries', 'rico', 'case-files']],
      ['reference', 'Reference', ['penal', 'sops', 'guide', 'undergrnd']],
      ['oversight', 'Oversight', ['calendar', 'shifts', 'trash']],
      ['owner', 'Owner', ['owner', 'audit', 'devdocs', 'report-templates']],
    ])
  })

  it("inbox is the 'Action Center' and leads Command (the landing default)", () => {
    expect(PAGE_META.inbox.title).toBe('Action Center')
    expect(TAB_LABEL.inbox).toBe('Action Center')
    expect(CAT_DEFAULT.command).toBe('inbox')
  })

  it("dashboard is 'My Dashboard' and the dashboard switcher's personal entry", () => {
    expect(PAGE_META.dashboard.title).toBe('My Dashboard')
    expect(PAGE_META.dashboard.sub).toBe('Your work at a glance')
    expect(TAB_LABEL.dashboard).toBe('My Dashboard')
    expect(DASH_TAB.my).toBe('dashboard')
  })

  it('intelligence and registries are PAGE_META leaves with labels (they open the workspace on a tool)', () => {
    expect(PAGE_META.intelligence.title).toBe('Intelligence')
    expect(PAGE_META.registries.title).toBe('Registries')
    expect(TAB_LABEL.intelligence).toBe('Intelligence')
    expect(TAB_LABEL.registries).toBe('Registries')
  })

  it("the Owner category is Owner-only and 'owner' is no longer a standalone leaf", () => {
    expect(OWNER_ONLY_CATEGORIES.has('owner')).toBe(true)
    expect(OWNER_ONLY_CATEGORIES.has('siu-owner')).toBe(true)
    expect(TAB_CATEGORY.owner).toBe('owner')
    expect(TAB_CATEGORY.audit).toBe('owner')
    expect(TAB_CATEGORY.devdocs).toBe('owner')
    expect(CAT_DEFAULT.owner).toBe('owner')
    expect(PAGE_META.owner.sub).toBe('System administration — accounts, destructive operations, maintenance, configuration, diagnostics (owner-only)')
  })

  it("there is no 'intel' category any more; the workspace belongs to Investigations without a button", () => {
    expect(NAV_CATEGORIES.some((c) => c.id === 'intel')).toBe(false)
    expect(TAB_CATEGORY.workspace).toBe('cases')
    expect(NAV_CATEGORIES.flatMap((c) => c.tabs)).not.toContain('workspace')
  })

  it('SIU mirrors the CID categories tab for tab (after its own Bureau leaf)', () => {
    const [unit, ...rest] = SIU_NAV_CATEGORIES
    expect(unit).toEqual({ id: 'siu-unit', label: 'Bureau', tabs: ['siu'] })
    expect(rest.map((c) => c.tabs)).toEqual(NAV_CATEGORIES.map((c) => c.tabs))
    expect(rest.map((c) => c.label)).toEqual(NAV_CATEGORIES.map((c) => c.label))
  })

  it('command-center stays a standalone (per-user-gated) leaf, not a category tab', () => {
    expect(TAB_CATEGORY['command-center']).toBeNull()
    expect(isValidTab('command-center')).toBe(true)
  })

  it('every dashboard-switcher entry routes to a registered tab, spec label set pinned', () => {
    for (const t of Object.values(DASH_TAB)) expect(t in PAGE_META, `DASH_TAB → '${t}'`).toBe(true)
    expect(DASH_LABEL).toEqual({
      my: 'My Dashboard',
      cases: 'Cases',
      command: 'Command Center',
      sib: 'SIB',
      doj: 'Legal Review',
      owner: 'Owner Console',
    })
  })
})

describe('nav — general invariants', () => {
  it('every routed tab in every category exists in PAGE_META and TAB_LABEL', () => {
    for (const c of [...NAV_CATEGORIES, ...SIU_NAV_CATEGORIES]) {
      for (const t of c.tabs) {
        expect(t in PAGE_META, `PAGE_META['${t}'] (category '${c.id}')`).toBe(true)
        expect(TAB_LABEL[t] ?? SIU_TAB_LABEL[t], `label for '${t}'`).toBeTruthy()
      }
    }
  })

  it('no tab appears in two CID categories (TAB_CATEGORY would silently keep the last)', () => {
    const tabs = NAV_CATEGORIES.flatMap((c) => c.tabs)
    expect(new Set(tabs).size).toBe(tabs.length)
  })

  it('SUBTAB_GROUPS is a visual layer over real categories and their own tabs', () => {
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

  it('isValidTab rejects retired category ids and unknown slugs', () => {
    for (const bad of ['intel', 'nope', '', 'PERSONS']) {
      expect(isValidTab(bad), `isValidTab('${bad}')`).toBe(false)
    }
  })

  it('TAB_CATEGORY covers EVERY PAGE_META tab and every legacy id (no silent Command fallback)', () => {
    for (const t of [...Object.keys(PAGE_META), ...LEGACY_REDIRECT_TABS]) {
      expect(TAB_CATEGORY[t] !== undefined, `TAB_CATEGORY['${t}'] must be a category id or null`).toBe(true)
    }
  })

  it('standalone surfaces belong to NO category (null → no strip highlight, no Subtabs)', () => {
    for (const t of ['profile', 'command-center', 'concern', 'siu', 'feedback']) {
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

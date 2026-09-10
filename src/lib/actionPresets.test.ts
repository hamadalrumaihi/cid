/** Preset availability + the default pick are pure functions of the viewer's
 *  flags — pinned here so a role change in the menu is a deliberate edit. */
import { describe, expect, it } from 'vitest'
import { SOURCE_TYPE_LABEL } from './actionItems'
import {
  ACTION_PRESETS, ACTION_STATUS_KEYS, ACTION_TYPE_FILTERS, ALL_SECTIONS, availablePresets, defaultPresetFor, presetById,
  type PresetViewer,
} from './actionPresets'

describe('ACTION_TYPE_FILTERS — every queue kind has exactly one chip', () => {
  it('covers every SOURCE_TYPE_LABEL key once', () => {
    const seen = new Map<string, string>()
    for (const g of ACTION_TYPE_FILTERS) {
      for (const t of g.types) {
        expect(seen.has(t), `${t} is in both ${seen.get(t)} and ${g.key}`).toBe(false)
        seen.set(t, g.key)
      }
    }
    for (const t of Object.keys(SOURCE_TYPE_LABEL)) expect(seen.has(t), `${t} has no chip`).toBe(true)
  })
  it('chip keys are unique and labelled', () => {
    const keys = ACTION_TYPE_FILTERS.map((g) => g.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const g of ACTION_TYPE_FILTERS) expect(g.label.length).toBeGreaterThan(0)
  })
  it('every preset filter names a real chip / status key', () => {
    for (const p of ACTION_PRESETS) {
      if (p.config.f) expect(ACTION_TYPE_FILTERS.some((g) => g.key === p.config.f), p.id).toBe(true)
      if (p.config.s) expect(ACTION_STATUS_KEYS).toContain(p.config.s)
    }
  })
})

const NO_SIB = { canAccess: false, isAgent: false, isCommand: false }
const viewer = (over: Partial<PresetViewer>): PresetViewer => ({
  role: null, isCommand: false, isOwner: false, justiceRole: null, sib: NO_SIB, ...over,
})

const detective = viewer({ role: 'detective' })
const bureauLead = viewer({ role: 'bureau_lead', isCommand: true })
const director = viewer({ role: 'director', isCommand: true })
const ownerDirector = viewer({ role: 'director', isCommand: true, isOwner: true })
const ownerOnly = viewer({ isOwner: true })
const judge = viewer({ justiceRole: 'judge' })
const dualJudge = viewer({ role: 'detective', justiceRole: 'judge' })
const sibAgent = viewer({ role: 'detective', sib: { canAccess: true, isAgent: true, isCommand: false } })
const nobody = viewer({})

const ids = (v: PresetViewer) => availablePresets(v).map((p) => p.id)

describe('ACTION_PRESETS', () => {
  it('has the six ids, unique, each with a label, hint and a self-referencing config', () => {
    expect(ACTION_PRESETS.map((p) => p.id)).toEqual(['detective', 'bureau_lead', 'command', 'judge', 'sib', 'owner'])
    for (const p of ACTION_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.hint.length).toBeGreaterThan(0)
      expect(p.config.preset).toBe(p.id)
      for (const s of p.config.sections ?? []) expect(ALL_SECTIONS).toContain(s)
    }
    expect(presetById('command')?.id).toBe('command')
    expect(presetById('nope')).toBeNull()
    expect(presetById(null)).toBeNull()
  })

  it('availability follows standing, never widening', () => {
    expect(ids(detective)).toEqual(['detective'])
    expect(ids(bureauLead)).toEqual(['detective', 'bureau_lead', 'command'])
    expect(ids(director)).toEqual(['detective', 'bureau_lead', 'command'])
    expect(ids(ownerDirector)).toEqual(['detective', 'bureau_lead', 'command', 'owner'])
    expect(ids(ownerOnly)).toEqual(['command', 'owner'])
    expect(ids(judge)).toEqual(['judge'])
    expect(ids(dualJudge)).toEqual(['detective', 'judge'])
    expect(ids(sibAgent)).toEqual(['detective', 'sib'])
    expect(ids(nobody)).toEqual([])
  })
})

describe('defaultPresetFor', () => {
  it('ranks Command above Bureau Lead above SIB above Judge / Owner above Detective', () => {
    expect(defaultPresetFor(director)).toBe('command')
    expect(defaultPresetFor(ownerDirector)).toBe('command')
    expect(defaultPresetFor(bureauLead)).toBe('bureau_lead')
    expect(defaultPresetFor(sibAgent)).toBe('sib')
    expect(defaultPresetFor(judge)).toBe('judge')
    expect(defaultPresetFor(dualJudge)).toBe('detective')
    expect(defaultPresetFor(ownerOnly)).toBe('owner')
    expect(defaultPresetFor(detective)).toBe('detective')
  })

  it('an inactive command role (isCommand false) is not offered Command', () => {
    const inactiveDirector = viewer({ role: 'director', isCommand: false })
    expect(defaultPresetFor(inactiveDirector)).toBe('detective')
    expect(ids(inactiveDirector)).toEqual(['detective'])
  })

  it('is null when nothing is available', () => {
    expect(defaultPresetFor(nobody)).toBeNull()
  })

  it('always returns an available preset', () => {
    for (const v of [detective, bureauLead, director, ownerDirector, ownerOnly, judge, dualJudge, sibAgent]) {
      const d = defaultPresetFor(v)
      expect(d).not.toBeNull()
      expect(ids(v)).toContain(d)
    }
  })
})

/* ── L3: stored / URL configs are shape-checked before the view reads them ── */
import { normalizeActionConfig } from './actionPresets'

describe('normalizeActionConfig', () => {
  it('passes a well-formed config through unchanged', () => {
    expect(normalizeActionConfig({ f: 'task', s: 'overdue', b: 'narcotics', sections: ['overdue', 'personal'], showSnoozed: true, preset: 'detective' }))
      .toEqual({ f: 'task', s: 'overdue', b: 'narcotics', sections: ['overdue', 'personal'], showSnoozed: true, preset: 'detective' })
  })

  it('non-object input → the empty (full-queue) config', () => {
    const empty = { f: null, s: null, b: null, sections: null, showSnoozed: false, preset: null }
    expect(normalizeActionConfig(null)).toEqual(empty)
    expect(normalizeActionConfig(undefined)).toEqual(empty)
    expect(normalizeActionConfig('sections')).toEqual(empty)
    expect(normalizeActionConfig(42)).toEqual(empty)
    expect(normalizeActionConfig(['overdue'])).toEqual(empty)
  })

  it('coerces f / b / preset to non-empty strings or null', () => {
    const c = normalizeActionConfig({ f: 7, b: '', preset: { id: 'x' } })
    expect(c.f).toBeNull()
    expect(c.b).toBeNull()
    expect(c.preset).toBeNull()
    expect(normalizeActionConfig({ f: 'legal' }).f).toBe('legal')
  })

  it('s must be a real status key', () => {
    expect(normalizeActionConfig({ s: 'command' }).s).toBe('command')
    expect(normalizeActionConfig({ s: 'bogus' }).s).toBeNull()
    expect(normalizeActionConfig({ s: 1 }).s).toBeNull()
    for (const k of ACTION_STATUS_KEYS) expect(normalizeActionConfig({ s: k }).s).toBe(k)
  })

  it('sections: non-array → null (every lane); arrays keep only known lanes', () => {
    expect(normalizeActionConfig({ sections: 'overdue' }).sections).toBeNull()
    expect(normalizeActionConfig({ sections: { overdue: true } }).sections).toBeNull()
    expect(normalizeActionConfig({ sections: null }).sections).toBeNull()
    expect(normalizeActionConfig({ sections: ['overdue', 'nope', 3, null, 'drafts'] }).sections).toEqual(['overdue', 'drafts'])
    expect(normalizeActionConfig({ sections: [...ALL_SECTIONS] }).sections).toEqual([...ALL_SECTIONS])
    // The guard the reviewer flagged: the view's `new Set(config.sections)` never sees a non-iterable.
    expect(() => new Set(normalizeActionConfig({ sections: 5 }).sections ?? [])).not.toThrow()
  })

  it('showSnoozed is a strict boolean', () => {
    expect(normalizeActionConfig({ showSnoozed: 'yes' }).showSnoozed).toBe(false)
    expect(normalizeActionConfig({ showSnoozed: 1 }).showSnoozed).toBe(false)
    expect(normalizeActionConfig({ showSnoozed: true }).showSnoozed).toBe(true)
  })

  it('every preset config is already normal', () => {
    for (const p of ACTION_PRESETS) {
      const n = normalizeActionConfig(p.config)
      expect(n.f).toBe(p.config.f ?? null)
      expect(n.s).toBe(p.config.s ?? null)
      expect(n.sections).toEqual(p.config.sections ?? null)
      expect(n.preset).toBe(p.id)
    }
  })
})

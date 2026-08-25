/** Saved-views pure shaping — offline-safe. The store/network side degrades
 *  (loadViews falls back locally, tested at the end); RLS ownership of
 *  user_prefs is the database's job, not this suite's. */
import { describe, expect, it } from 'vitest'
import {
  MAX_VIEWS_PER_SECTION, MAX_VIEW_NAME_LEN,
  defaultViewOf, legacyCaseViewsToSaved, loadViews, parseViewsValue,
  removeViewIn, renameViewIn, upsertViewIn, viewsFitLimit, viewsPrefKey,
  withDefault, type SavedView,
} from './savedViews'

const v = (name: string, config: unknown = {}, isDefault?: boolean): SavedView =>
  isDefault ? { name, config, isDefault } : { name, config }

describe('parseViewsValue — tolerant server-value parsing', () => {
  it('accepts the canonical shape and preserves order', () => {
    const out = parseViewsValue({ views: [v('A', { x: 1 }), v('B', { y: 2 })] })
    expect(out.map((x) => x.name)).toEqual(['A', 'B'])
    expect(out[0].config).toEqual({ x: 1 })
  })

  it('rejects garbage wholesale and bad entries individually', () => {
    expect(parseViewsValue(null)).toEqual([])
    expect(parseViewsValue('nope')).toEqual([])
    expect(parseViewsValue({ views: 'nope' })).toEqual([])
    const out = parseViewsValue({ views: [null, 42, { name: 7, config: {} }, { name: '  ', config: {} }, { name: 'ok', config: {} }, { name: 'no-config' }] })
    expect(out).toEqual([v('ok')])
  })

  it('dedupes names (first wins), trims and caps name length', () => {
    const long = 'x'.repeat(MAX_VIEW_NAME_LEN + 20)
    const out = parseViewsValue({ views: [v(' A ', 1), v('A', 2), v(long, 3)] })
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(v('A', 1))
    expect(out[1].name).toHaveLength(MAX_VIEW_NAME_LEN)
  })

  it('keeps at most ONE default — the first marked', () => {
    const out = parseViewsValue({ views: [v('A'), v('B', {}, true), v('C', {}, true)] })
    expect(out.filter((x) => x.isDefault).map((x) => x.name)).toEqual(['B'])
  })

  it('caps the list at the per-section maximum', () => {
    const many = Array.from({ length: MAX_VIEWS_PER_SECTION + 5 }, (_, i) => v(`v${i}`))
    expect(parseViewsValue({ views: many })).toHaveLength(MAX_VIEWS_PER_SECTION)
  })
})

describe('upsertViewIn / renameViewIn / removeViewIn', () => {
  it('appends a new view and replaces an existing one in place', () => {
    let views = upsertViewIn([v('A', 1)], 'B', 2)
    expect(views.map((x) => x.name)).toEqual(['A', 'B'])
    views = upsertViewIn(views, 'A', 9)
    expect(views[0].config).toBe(9)
    expect(views).toHaveLength(2)
  })

  it('replacing the default view keeps it the default', () => {
    const views = upsertViewIn([v('A', 1, true), v('B', 2)], 'A', 3)
    expect(views[0]).toEqual({ name: 'A', config: 3, isDefault: true })
  })

  it('rename moves the name and overwrites a colliding target', () => {
    expect(renameViewIn([v('A'), v('B')], 'A', 'C').map((x) => x.name)).toEqual(['C', 'B'])
    // Rename onto an existing name = replace-by-name (target removed).
    expect(renameViewIn([v('A', 1), v('B', 2)], 'A', 'B')).toEqual([v('B', 1)])
    // No-ops: unknown source, identical name.
    const base = [v('A')]
    expect(renameViewIn(base, 'Z', 'Q')).toBe(base)
    expect(renameViewIn(base, 'A', 'A')).toBe(base)
  })

  it('remove drops exactly the named view', () => {
    expect(removeViewIn([v('A'), v('B')], 'A')).toEqual([v('B')])
    expect(removeViewIn([v('A')], 'Z')).toEqual([v('A')])
  })
})

describe('withDefault / defaultViewOf — one default max', () => {
  it('setting a default clears any previous one', () => {
    const views = withDefault([v('A', {}, true), v('B')], 'B')
    expect(views.filter((x) => x.isDefault).map((x) => x.name)).toEqual(['B'])
    expect('isDefault' in views[0]).toBe(false)
  })

  it('null clears the default entirely', () => {
    const views = withDefault([v('A', {}, true), v('B')], null)
    expect(views.some((x) => x.isDefault)).toBe(false)
    expect(defaultViewOf(views)).toBeNull()
  })

  it('defaultViewOf finds the marked view', () => {
    expect(defaultViewOf([v('A'), v('B', 7, true)])?.name).toBe('B')
  })
})

describe('legacy cases migration shaping', () => {
  it('lifts {name, filters, scope?, q?} into SavedView config', () => {
    const out = legacyCaseViewsToSaved([
      { name: 'Mine', filters: { status: 'open' }, scope: 'mine', q: 'rico' },
      { name: 'Bare', filters: {} },
    ])
    expect(out).toEqual([
      { name: 'Mine', config: { filters: { status: 'open' }, scope: 'mine', q: 'rico' } },
      { name: 'Bare', config: { filters: {} } },
    ])
  })

  it('drops malformed legacy entries and non-arrays', () => {
    expect(legacyCaseViewsToSaved(null)).toEqual([])
    expect(legacyCaseViewsToSaved({})).toEqual([])
    expect(legacyCaseViewsToSaved([{ filters: {} }, 'x', { name: 'ok' }])).toEqual([
      { name: 'ok', config: { filters: {} } },
    ])
  })
})

describe('storage guardrails', () => {
  it('key naming stays under the 100-char user_prefs cap for real sections', () => {
    for (const s of ['cases', 'persons', 'legal', 'bolo']) {
      expect(viewsPrefKey(s)).toBe(`views:${s}`)
      expect(viewsPrefKey(s).length).toBeLessThanOrEqual(100)
    }
  })

  it('viewsFitLimit accepts normal lists and rejects oversized payloads', () => {
    expect(viewsFitLimit([v('A', { filters: { status: 'open' } })])).toBe(true)
    expect(viewsFitLimit([v('huge', { blob: 'x'.repeat(40_000) })])).toBe(false)
  })
})

describe('offline degrade', () => {
  it('loadViews resolves (empty) with no Supabase client configured', async () => {
    // No session/client in unit tests: the fetch path throws internally and
    // must fall back — never reject. 'persons' has no legacy local fallback.
    await expect(loadViews('persons')).resolves.toEqual([])
  })
})

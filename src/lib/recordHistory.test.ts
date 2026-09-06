/** Pins the client mirror of the server's version coalescing rule
 *  (private.version_row, 20261011120000): same actor, plain edits, inside
 *  five minutes of the previous version's LAST save. */
import { describe, expect, it } from 'vitest'
import { COALESCE_WINDOW_MS, historyRows, versionChanges, wouldCoalesce } from './recordHistory'

const t0 = '2026-09-06T04:00:00.000Z'
const at = (ms: number) => new Date(Date.parse(t0) + ms).toISOString()
const prev = { actor_id: 'u1', source: 'edit', updated_at: t0 }

describe('wouldCoalesce — the five-minute same-actor rule', () => {
  it('folds a same-actor edit inside the window', () => {
    expect(wouldCoalesce(prev, { actor_id: 'u1', source: 'edit', at: at(60_000) })).toBe(true)
    expect(wouldCoalesce(prev, { actor_id: 'u1', source: 'edit', at: at(COALESCE_WINDOW_MS - 1) })).toBe(true)
  })
  it('starts a new version at the window edge and beyond', () => {
    expect(wouldCoalesce(prev, { actor_id: 'u1', source: 'edit', at: at(COALESCE_WINDOW_MS) })).toBe(false)
    expect(wouldCoalesce(prev, { actor_id: 'u1', source: 'edit', at: at(6 * 60_000) })).toBe(false)
  })
  it('never folds a different actor', () => {
    expect(wouldCoalesce(prev, { actor_id: 'u2', source: 'edit', at: at(1_000) })).toBe(false)
    expect(wouldCoalesce({ ...prev, actor_id: null }, { actor_id: null, source: 'edit', at: at(1_000) })).toBe(true)
  })
  it('never folds a restore, in either direction', () => {
    expect(wouldCoalesce(prev, { actor_id: 'u1', source: 'restore', at: at(1_000) })).toBe(false)
    expect(wouldCoalesce({ ...prev, source: 'restore' }, { actor_id: 'u1', source: 'edit', at: at(1_000) })).toBe(false)
  })
  it('measures from the previous version\'s LAST save, not its first', () => {
    // A burst that started 20 minutes ago but was last touched 1 minute ago
    // is still open for the same actor.
    expect(wouldCoalesce({ ...prev, updated_at: at(19 * 60_000) }, { actor_id: 'u1', source: 'edit', at: at(20 * 60_000) })).toBe(true)
  })
})

describe('versionChanges / historyRows', () => {
  it('lists one change per changed field in the server\'s order', () => {
    const v = { old: { name: 'A', alias: null }, new: { name: 'B', alias: 'Bee' }, changed_fields: ['alias', 'name'] }
    expect(versionChanges(v)).toEqual([
      { field: 'alias', from: null, to: 'Bee' },
      { field: 'name', from: 'A', to: 'B' },
    ])
  })
  it('orders newest first and marks bursts', () => {
    const rows = historyRows([
      { version_no: 1, created_at: t0, updated_at: t0 },
      { version_no: 2, created_at: at(1_000), updated_at: at(90_000) },
    ])
    expect(rows.map((r) => r.version_no)).toEqual([2, 1])
    expect(rows.map((r) => r.burst)).toEqual([true, false])
  })
})

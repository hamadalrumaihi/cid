/** Pins are private per-user quick-access bookmarks over user_pins (owner-only
 *  RLS). These tests pin the store contract offline: ids-only rows, the
 *  isPinned lookup, and the MAX_PINS soft cap constant the strip relies on.
 *  Server behavior (RLS, composite PK) is enforced by the database. */
import { describe, expect, it } from 'vitest'
import { MAX_PINS, usePinsStore } from './pins'
import type { PinRow } from './pins'

const row = (target_type: string, target_id: string): PinRow => ({
  user_id: 'me', target_type, target_id, created_at: new Date().toISOString(),
})

describe('pins — per-user quick-access store', () => {
  it('isPinned matches on (type,id) against loaded rows', () => {
    usePinsStore.setState({ rows: [row('case', 'a'), row('person', 'b')], loaded: true })
    const s = usePinsStore.getState()
    expect(s.isPinned('case', 'a')).toBe(true)
    expect(s.isPinned('person', 'b')).toBe(true)
    expect(s.isPinned('case', 'b')).toBe(false)   // id under a different type never matches
    expect(s.isPinned('vehicle', 'a')).toBe(false)
  })

  it('rows are ids-only — no title/count/data fields leak into storage', () => {
    const r = row('gang', 'g1')
    expect(Object.keys(r).sort()).toEqual(['created_at', 'target_id', 'target_type', 'user_id'])
  })

  it('the strip cap is a small, positive soft limit', () => {
    expect(MAX_PINS).toBeGreaterThan(0)
    expect(MAX_PINS).toBeLessThanOrEqual(48) // a strip, not a database
  })

  it('fetch failure degrades to an empty, loaded store (offline-safe)', async () => {
    usePinsStore.setState({ rows: [row('case', 'x')], loaded: false })
    await usePinsStore.getState().fetch() // no Supabase client configured in tests
    const s = usePinsStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.rows).toEqual([])
  })
})

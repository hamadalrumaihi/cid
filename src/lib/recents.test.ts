// @vitest-environment happy-dom
/** The recently-opened trail is ids-only by contract — these tests pin the
 *  dedupe/cap/clear behavior and that nothing but {type,id,at} is stored
 *  (titles resolve through RLS at render, never from this trail).
 *  happy-dom: the trail lives in localStorage via the Store blob. */
import { beforeEach, describe, expect, it } from 'vitest'
import { clearRecents, dropRecent, pushRecent, recentRecords } from './recents'

describe('recents — ids-only recently-opened trail', () => {
  beforeEach(() => { localStorage.clear() })

  it('pushes most-recent-first and dedupes on (type,id)', () => {
    pushRecent('case', 'a')
    pushRecent('person', 'b')
    pushRecent('case', 'a') // re-open moves it back to the front, no duplicate
    const rows = recentRecords()
    expect(rows.map((r) => `${r.type}:${r.id}`)).toEqual(['case:a', 'person:b'])
  })

  it('stores only type/id/at — never titles or data', () => {
    pushRecent('vehicle', 'v1')
    const [row] = recentRecords()
    expect(Object.keys(row).sort()).toEqual(['at', 'id', 'type'])
  })

  it('caps the trail at 20 entries', () => {
    for (let i = 0; i < 25; i++) pushRecent('case', `c${i}`)
    expect(recentRecords()).toHaveLength(20)
    expect(recentRecords()[0].id).toBe('c24')
  })

  it('dropRecent removes one entry (the lost-access path); clearRecents wipes', () => {
    pushRecent('case', 'a')
    pushRecent('gang', 'g')
    dropRecent('case', 'a')
    expect(recentRecords().map((r) => r.id)).toEqual(['g'])
    clearRecents()
    expect(recentRecords()).toEqual([])
  })

  it('ignores an empty id and survives a corrupted blob', () => {
    pushRecent('case', '')
    expect(recentRecords()).toEqual([])
    localStorage.setItem('cid-portal-v3', '{"recentRecords":"not-an-array"}')
    expect(recentRecords()).toEqual([])
  })
})

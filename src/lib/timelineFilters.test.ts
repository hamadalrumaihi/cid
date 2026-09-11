import { describe, expect, it } from 'vitest'
import {
  ALL_TIMELINE_GROUPS, filterTimelineEvents, laneGroup, readTimelineFilters, TIMELINE_FILTER_STORAGE_KEY, timelineGroupOf,
  toggleTimelineGroup, writeTimelineFilters, type TimelineGroup,
} from './timelineFilters'

const mem = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } => {
  const data: Record<string, string> = {}
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v } }
}

describe('laneGroup — the chip a lane filters under', () => {
  it('maps every lane onto the six groups', () => {
    expect(laneGroup('opened')).toBe('investigation')
    expect(laneGroup('followup')).toBe('investigation')
    expect(laneGroup('task')).toBe('investigation')
    expect(laneGroup('signoff')).toBe('investigation')
    expect(laneGroup('report')).toBe('investigation')
    expect(laneGroup('evidence')).toBe('evidence')
    expect(laneGroup('media')).toBe('evidence')
    expect(laneGroup('custody')).toBe('custody')
    expect(laneGroup('hold')).toBe('legal')
    expect(laneGroup('restricted')).toBe('legal')
    expect(laneGroup('source')).toBe('intelligence')
    expect(laneGroup('document')).toBe('documents')
    expect(laneGroup('packet')).toBe('documents')
  })

  it('an explicit group overrides the lane (surveillance on the task lane)', () => {
    expect(timelineGroupOf({ type: 'task', group: 'intelligence' })).toBe('intelligence')
    expect(timelineGroupOf({ type: 'task' })).toBe('investigation')
  })
})

describe('filterTimelineEvents', () => {
  const events = [
    { id: 1, type: 'opened' as const },
    { id: 2, type: 'custody' as const },
    { id: 3, type: 'task' as const, group: 'intelligence' as const },
    { id: 4, type: 'packet' as const },
  ]
  it('every group on is a passthrough', () => {
    expect(filterTimelineEvents(events, new Set(ALL_TIMELINE_GROUPS)).map((e) => e.id)).toEqual([1, 2, 3, 4])
  })
  it('keeps only enabled groups, honouring explicit groups', () => {
    expect(filterTimelineEvents(events, new Set<TimelineGroup>(['custody', 'intelligence'])).map((e) => e.id)).toEqual([2, 3])
    expect(filterTimelineEvents(events, new Set<TimelineGroup>(['investigation'])).map((e) => e.id)).toEqual([1])
  })
  it('an empty selection shows nothing (the chips make that state obvious)', () => {
    expect(filterTimelineEvents(events, new Set())).toEqual([])
  })
})

describe('persistence', () => {
  it('round-trips through the storage key', () => {
    const s = mem()
    writeTimelineFilters(s, new Set<TimelineGroup>(['evidence', 'legal']))
    expect(JSON.parse(s.data[TIMELINE_FILTER_STORAGE_KEY])).toEqual(['evidence', 'legal'])
    expect([...readTimelineFilters(s)]).toEqual(['evidence', 'legal'])
  })
  it('missing / malformed / unknown values fall back to everything on', () => {
    expect(readTimelineFilters(null).size).toBe(ALL_TIMELINE_GROUPS.length)
    const s = mem()
    expect(readTimelineFilters(s).size).toBe(ALL_TIMELINE_GROUPS.length)
    s.data[TIMELINE_FILTER_STORAGE_KEY] = '{not json'
    expect(readTimelineFilters(s).size).toBe(ALL_TIMELINE_GROUPS.length)
    s.data[TIMELINE_FILTER_STORAGE_KEY] = JSON.stringify(['evidence', 'bogus', 42])
    expect([...readTimelineFilters(s)]).toEqual(['evidence'])
  })
  it('toggle returns a fresh set', () => {
    const base = new Set<TimelineGroup>(['evidence'])
    const next = toggleTimelineGroup(base, 'legal')
    expect([...next]).toEqual(['evidence', 'legal'])
    expect([...toggleTimelineGroup(next, 'evidence')]).toEqual(['legal'])
    expect([...base]).toEqual(['evidence'])
  })
})

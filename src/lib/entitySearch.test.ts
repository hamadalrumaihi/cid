import { describe, expect, it } from 'vitest'
import {
  normalizeQuery, normHandle, normPhone, normPlate, rankPersonRows,
  searchChargeHits, searchEntities, searchMemberHits,
} from './entitySearch'
import { setPenalCatalog, type PenalCharge } from './penal'
import { useProfilesStore, type RosterProfile } from './profiles'

/** Normalizers are for MATCHING only (display values are never altered) and
 *  return null for a value that normalizes to nothing, so "no usable term"
 *  can never be confused with a real normalized value. */
describe('normalizers', () => {
  it('normPlate mirrors SQL private.norm_plate (upper, strip non-alnum)', () => {
    expect(normPlate('ab-123')).toBe('AB123')
    expect(normPlate('AB 123')).toBe('AB123')
    expect(normPlate('ab123')).toBe('AB123')
    expect(normPlate(' a.b_1*2#3 ')).toBe('AB123')
    expect(normPlate('---')).toBeNull()
    expect(normPlate('')).toBeNull()
    expect(normPlate(null)).toBeNull()
    expect(normPlate(undefined)).toBeNull()
  })

  it('normPhone keeps digits plus a leading +', () => {
    expect(normPhone('+1 (555) 010-2000')).toBe('+15550102000')
    expect(normPhone('555 010 2000')).toBe('5550102000')
    expect(normPhone('555-0100')).toBe('5550100')
    // '+' only survives in the leading position.
    expect(normPhone('55+50100')).toBe('5550100')
    expect(normPhone('call me')).toBeNull()
    expect(normPhone('+')).toBeNull()
    expect(normPhone('')).toBeNull()
    expect(normPhone(null)).toBeNull()
  })

  it('normHandle lowers, trims and strips the leading @', () => {
    expect(normHandle(' @CoolGuy ')).toBe('coolguy')
    expect(normHandle('@@Stacked')).toBe('stacked')
    expect(normHandle('Plain')).toBe('plain')
    expect(normHandle('@')).toBeNull()
    expect(normHandle('  ')).toBeNull()
    expect(normHandle(null)).toBeNull()
  })

  it('normalizeQuery lowers, collapses whitespace and trims', () => {
    expect(normalizeQuery('  FoO   Bar ')).toBe('foo bar')
    expect(normalizeQuery('')).toBe('')
    expect(normalizeQuery(null)).toBe('')
  })
})

describe('rankPersonRows — exact matches first, then RPC rank, stable', () => {
  const row = (id: string, over: Partial<{ name: string | null; alias: string | null; phone: string | null }> = {}) =>
    ({ id, name: null, alias: null, phone: null, ...over })

  it('promotes an exact normalized name match over a better RPC rank', () => {
    const rows = [
      row('a', { name: 'Marcus Bell Junior' }), // RPC's top hit, partial match
      row('b', { name: 'Marcus Bell' }),        // exact — must win
    ]
    const order = new Map([['a', 0], ['b', 1]])
    expect(rankPersonRows(rows, order, ' marcus  BELL ').map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('matches exact alias and exact normalized phone too', () => {
    const rows = [row('a', { name: 'Other' }), row('b', { alias: 'Ghost' }), row('c', { phone: '(555) 010-2000' })]
    const order = new Map([['a', 0], ['b', 1], ['c', 2]])
    expect(rankPersonRows(rows, order, 'ghost').map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(rankPersonRows(rows, order, '555.010.2000').map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('keeps RPC rank order among non-exact hits and is stable for unranked rows', () => {
    const rows = [row('x', { name: 'A' }), row('y', { name: 'B' }), row('z', { name: 'C' })]
    const order = new Map([['z', 0], ['x', 1]]) // y unranked → last, original position kept
    expect(rankPersonRows(rows, order, 'nomatch').map((r) => r.id)).toEqual(['z', 'x', 'y'])
  })

  it('multi-token exactness is whitespace- and case-insensitive on aliases too', () => {
    const rows = [
      row('a', { name: 'Lil Ghost Rider' }), // partial — contains the tokens
      row('b', { alias: 'Lil Ghost' }),      // exact normalized alias — wins
    ]
    const order = new Map([['a', 0], ['b', 1]])
    expect(rankPersonRows(rows, order, '  LIL   ghost ').map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('phone exactness compares normalized digits, and a leading + is significant', () => {
    const rows = [
      row('a', { name: 'Phone Partial 555' }),
      row('b', { phone: '+1 (555) 010-2000' }),
    ]
    const order = new Map([['a', 0], ['b', 1]])
    // Same digits, same + prefix → exact regardless of separators.
    expect(rankPersonRows(rows, order, '+1 555 010 2000').map((r) => r.id)).toEqual(['b', 'a'])
    // Digits-only query does NOT equal a stored + number: '+15550102000' vs
    // '15550102000' are different normalized identifiers (normPhone contract),
    // so the RPC rank order stands.
    expect(rankPersonRows(rows, order, '1 (555) 010-2000').map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('an exact name outranks an exact-looking substring even at worse RPC rank', () => {
    const rows = [
      row('a', { name: 'Ghost Writer' }), // best RPC rank, partial
      row('b', { name: 'ghost' }),        // exact after normalization
      row('c', { alias: 'Ghostface' }),   // partial alias
    ]
    const order = new Map([['a', 0], ['c', 1], ['b', 2]])
    expect(rankPersonRows(rows, order, 'Ghost').map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('a blank query promotes nothing (input order by rank only)', () => {
    const rows = [row('a', { name: '' }), row('b', { name: 'Someone' })]
    const order = new Map([['a', 0], ['b', 1]])
    expect(rankPersonRows(rows, order, '   ').map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('searchChargeHits — cached penal catalog', () => {
  const charge = (over: Partial<PenalCharge>): PenalCharge => ({
    id: 'u1', code: 'PC-101', title: 'Assault', level: 'Felony', jail: 18, fine: 2500, ...over,
  })

  it('maps charges to hits with uuid ids and a class · jail · fine sublabel', () => {
    setPenalCatalog([
      charge({}),
      charge({ id: 'u2', code: 'PC-202', title: 'Battery', level: 'Misdemeanor', jail: 6, fine: null, judgeFine: true }),
    ], 'v-test')
    const hits = searchChargeHits('assault')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      id: 'u1', label: 'PC-101 · Assault', sublabel: 'Felony · 1y 6mo · $2,500', meta: { code: 'PC-101' },
    })
    expect(searchChargeHits('battery')[0].sublabel).toBe('Misdemeanor · 6mo · Fine: judge')
  })

  it('blank query returns the whole (bounded) catalog; exclude applies', () => {
    setPenalCatalog([charge({}), charge({ id: 'u2', code: 'PC-202', title: 'Battery' })], 'v-test')
    expect(searchChargeHits('').map((h) => h.id)).toEqual(['u1', 'u2'])
    expect(searchChargeHits('', { exclude: new Set(['u1']) }).map((h) => h.id)).toEqual(['u2'])
    expect(searchChargeHits('', { limit: 1 })).toHaveLength(1)
  })
})

describe('searchMemberHits — roster cache', () => {
  const roster = (over: Partial<RosterProfile>): RosterProfile => ({
    id: 'p1', display_name: 'Ray Vargas', avatar_url: null, badge_number: '4471',
    division: 'major_crimes', role: 'senior_detective', active: true,
    created_at: '', updated_at: '', loa: false, loa_since: null, discord_id: null,
    removed_at: null, is_owner: false, login_denied: false, is_system: false,
    ...over,
  })

  it('matches display name / badge / role / bureau short-code', () => {
    useProfilesStore.setState({
      profiles: [
        roster({}),
        roster({ id: 'p2', display_name: 'Ana Cole', badge_number: '9001', role: 'detective', division: 'street_crimes', loa: true }),
        roster({ id: 'p3', display_name: 'Gone Member', active: false }),
      ],
      loaded: true,
    })
    expect(searchMemberHits('vargas').map((h) => h.id)).toEqual(['p1'])
    expect(searchMemberHits('9001').map((h) => h.id)).toEqual(['p2'])
    expect(searchMemberHits('senior detective').map((h) => h.id)).toEqual(['p1'])
    expect(searchMemberHits('street crimes').map((h) => h.id)).toEqual(['p2'])
    // Inactive members never surface (activeProfiles pool).
    expect(searchMemberHits('gone')).toEqual([])
    expect(searchMemberHits('vargas')[0]).toMatchObject({
      label: 'Ray Vargas',
      sublabel: '4471 · Senior Detective · Major Crimes',
      meta: { active: 'true', loa: 'false' },
    })
    expect(searchMemberHits('cole')[0].meta).toMatchObject({ loa: 'true' })
  })

  it('blank query lists the active pool; exclude and limit apply; empty cache yields nothing', () => {
    useProfilesStore.setState({
      profiles: [roster({}), roster({ id: 'p2', display_name: 'Ana Cole' })],
      loaded: true,
    })
    // activeProfiles() is name-sorted.
    expect(searchMemberHits('').map((h) => h.id)).toEqual(['p2', 'p1'])
    expect(searchMemberHits('', { exclude: new Set(['p2']) }).map((h) => h.id)).toEqual(['p1'])
    expect(searchMemberHits('', { limit: 1 })).toHaveLength(1)
    useProfilesStore.setState({ profiles: [], loaded: false })
    expect(searchMemberHits('vargas')).toEqual([])
  })
})

describe('searchEntities — dispatcher', () => {
  it('routes the client-cache kinds through the same per-kind functions', async () => {
    useProfilesStore.setState({
      profiles: [{
        id: 'p1', display_name: 'Ray Vargas', avatar_url: null, badge_number: '4471',
        division: 'major_crimes', role: 'senior_detective', active: true,
        created_at: '', updated_at: '', loa: false, loa_since: null, discord_id: null,
        removed_at: null, is_owner: false, login_denied: false, is_system: false,
      } as RosterProfile],
      loaded: true,
    })
    await expect(searchEntities('member', 'vargas')).resolves.toEqual(searchMemberHits('vargas'))
    setPenalCatalog([{ id: 'u1', code: 'PC-101', title: 'Assault', level: 'Felony', jail: 18, fine: 2500 }], 'v-test')
    await expect(searchEntities('charge', 'assault')).resolves.toEqual(searchChargeHits('assault'))
  })
})

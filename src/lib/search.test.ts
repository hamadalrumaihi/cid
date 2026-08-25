import { describe, expect, it } from 'vitest'
import { useProfilesStore, type RosterProfile } from './profiles'
import { boloHitSublabel, legalHitSublabel, memberHits, tipHitsFromMatches, SEARCH_KINDS, SEARCH_SECTION_ORDER } from './search'

/** The search_all RPC emits `initcap(request_type) · replace(review_status,
 *  '_', ' ')` for legal hits; the client re-derives the workflow model's human
 *  status label from that token (the RPC itself is untouchable and untouched). */
describe('legalHitSublabel', () => {
  it('maps the machine status token to the model label', () => {
    expect(legalHitSublabel('Warrant · submitted to doj'))
      .toBe('Warrant · Submitted to DOJ — awaiting assignment')
    expect(legalHitSublabel('Subpoena · returned by ada'))
      .toBe('Subpoena · Returned by ADA')
    expect(legalHitSublabel('Warrant · judicial review'))
      .toBe('Warrant · Judicial review')
    expect(legalHitSublabel('Warrant · approved')).toBe('Warrant · Approved')
  })

  it('keeps the type prefix untouched', () => {
    expect(legalHitSublabel('Warrant · denied')).toBe('Warrant · Denied')
  })

  it('passes unknown tokens and non-legal shapes through unchanged', () => {
    expect(legalHitSublabel('Warrant · some future status')).toBe('Warrant · some future status')
    expect(legalHitSublabel('no separator here')).toBe('no separator here')
    expect(legalHitSublabel('')).toBe('')
    expect(legalHitSublabel(null)).toBeNull()
  })
})

/** The bolo arm emits `'BOLO · ' || bolo_risk [ || ' · expired']` with the
 *  raw lowercase risk (possibly empty when the flag has no risk set). */
describe('boloHitSublabel', () => {
  it('re-cases the risk through the status registry', () => {
    expect(boloHitSublabel('BOLO · high')).toBe('BOLO · High')
    expect(boloHitSublabel('BOLO · critical · expired')).toBe('BOLO · Critical · expired')
  })

  it('drops the empty segment when no risk is set', () => {
    expect(boloHitSublabel('BOLO · ')).toBe('BOLO')
    expect(boloHitSublabel('BOLO ·  · expired')).toBe('BOLO · expired')
  })

  it('passes non-bolo shapes through unchanged', () => {
    expect(boloHitSublabel('Warrant · approved')).toBe('Warrant · approved')
    expect(boloHitSublabel(null)).toBeNull()
  })
})

describe('tipHitsFromMatches', () => {
  it('maps submission matches to capped tip hits with no title', () => {
    const m = new Map<string, string[]>([
      ['a', ['a person', 'the thread']],
      ['b', []],
    ])
    const hits = tipHitsFromMatches(m)
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ kind: 'tip', id: 'a', label: 'Intelligence report', sublabel: 'Matched a person, the thread' })
    expect(hits[1].sublabel).toBeNull()
    const many = new Map(Array.from({ length: 10 }, (_, i) => [`id${i}`, []] as [string, string[]]))
    expect(tipHitsFromMatches(many)).toHaveLength(6)
  })
})

describe('memberHits', () => {
  const roster = (over: Partial<RosterProfile>): RosterProfile => ({
    id: 'p1', display_name: 'Ray Vargas', avatar_url: null, badge_number: '4471',
    division: 'major_crimes', role: 'senior_detective', active: true,
    created_at: '', updated_at: '', loa: false, loa_since: null, discord_id: null,
    removed_at: null, is_owner: false, login_denied: false, is_system: false,
    ...over,
  })

  it('matches name / badge / role against the roster cache', () => {
    useProfilesStore.setState({
      profiles: [
        roster({}),
        roster({ id: 'p2', display_name: 'Ana Cole', badge_number: '9001', role: 'detective' }),
        roster({ id: 'p3', display_name: 'Gone Member', active: false }),
      ],
      loaded: true,
    })
    expect(memberHits('vargas').map((h) => h.id)).toEqual(['p1'])
    expect(memberHits('9001').map((h) => h.id)).toEqual(['p2'])
    expect(memberHits('senior detective').map((h) => h.id)).toEqual(['p1'])
    // Inactive members never surface.
    expect(memberHits('gone')).toEqual([])
    const hit = memberHits('vargas')[0]
    expect(hit).toMatchObject({ kind: 'member', label: 'Ray Vargas', sublabel: 'Senior Detective · Major Crimes' })
  })

  it('returns nothing for a blank query or an empty cache', () => {
    expect(memberHits('  ')).toEqual([])
    useProfilesStore.setState({ profiles: [], loaded: false })
    expect(memberHits('vargas')).toEqual([])
  })
})

describe('search section registry', () => {
  it('covers every ordered section (unknown kinds are dropped by the palette)', () => {
    for (const kind of SEARCH_SECTION_ORDER) expect(SEARCH_KINDS[kind]).toBeTruthy()
    // The two RPC additions and the two client-side arms are registered.
    for (const kind of ['task', 'bolo', 'tip', 'member']) {
      expect(SEARCH_KINDS[kind]).toBeTruthy()
      expect(SEARCH_SECTION_ORDER).toContain(kind)
    }
  })
})

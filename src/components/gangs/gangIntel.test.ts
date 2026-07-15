import { describe, expect, it } from 'vitest'
import {
  duplicateMemberIds, findDuplicateMembers, groupByTier, isGangStale, normalizeName,
  parseColors, rankTier,
} from './gangIntel'
import type { GangRow, MemberRow } from './gangShared'

const member = (over: Partial<MemberRow>): MemberRow => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  gang_id: 'g1', rank_id: null, person_id: null, case_id: null,
  name: 'X', callsign: null, ccw: false, vch: 0, felony_count: 0,
  status: null, mugshot_url: null, created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', rank: null, provenance: null,
  ...over,
})

const gang = (over: Partial<GangRow>): GangRow => ({
  id: 'g1', name: 'Test', colors: null, threat_level: 'medium', notes: null,
  created_by: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  aliases: null, classification: null, status: null, confidence: null,
  intelligence_summary: {}, reviewed_at: null, reviewed_by: null,
  next_review_at: null, lead_detective_id: null, ...over,
})

describe('rankTier', () => {
  it('maps leader-ish ranks to leader', () => {
    for (const r of ['Shot Caller', 'OG', 'Boss', 'Kingpin', 'HNA']) expect(rankTier(r)).toBe('leader')
  })
  it('maps command ranks before leader (co-leader, lieutenant)', () => {
    expect(rankTier('Co-Leader')).toBe('command')
    expect(rankTier('Lieutenant')).toBe('command')
    expect(rankTier('Underboss')).toBe('command')
  })
  it('maps senior / member / associate', () => {
    expect(rankTier('Enforcer')).toBe('senior')
    expect(rankTier('Soldier')).toBe('member')
    expect(rankTier('Prospect')).toBe('associate')
  })
  it('unknown/empty ranks fall to unknown (never dropped)', () => {
    expect(rankTier('Wizard')).toBe('unknown')
    expect(rankTier('')).toBe('unknown')
    expect(rankTier(null)).toBe('unknown')
  })
})

describe('groupByTier', () => {
  it('orders tiers and omits empty ones, keeping unknown ranks visible', () => {
    const members = [
      member({ id: 'a', rank: 'Soldier' }),
      member({ id: 'b', rank: 'OG' }),
      member({ id: 'c', rank: 'Wizard' }),
    ]
    const groups = groupByTier(members)
    expect(groups.map((g) => g.tier.id)).toEqual(['leader', 'member', 'unknown'])
    expect(groups.find((g) => g.tier.id === 'unknown')!.members).toHaveLength(1)
  })
})

describe('findDuplicateMembers / duplicateMemberIds', () => {
  it('flags same normalized name within a gang', () => {
    const members = [
      member({ id: 'a', name: 'Trey Sanders' }),
      member({ id: 'b', name: 'trey  sanders' }),
      member({ id: 'c', name: 'Someone Else' }),
    ]
    const clusters = findDuplicateMembers(members)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].members.map((m) => m.id).sort()).toEqual(['a', 'b'])
    expect(duplicateMemberIds(members)).toEqual(new Set(['a', 'b']))
  })
  it('does not flag distinct names, and never mutates input', () => {
    const members = [member({ id: 'a', name: 'A' }), member({ id: 'b', name: 'B' })]
    const before = JSON.stringify(members)
    expect(findDuplicateMembers(members)).toHaveLength(0)
    expect(JSON.stringify(members)).toBe(before)
  })
  it('strengthens the reason when the linked person matches', () => {
    const members = [
      member({ id: 'a', name: 'Trey Sanders', person_id: 'p1' }),
      member({ id: 'b', name: 'Trey Sanders', person_id: 'p1' }),
    ]
    expect(findDuplicateMembers(members)[0].reason).toMatch(/linked person/i)
  })
})

describe('normalizeName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName('  Trey-Sanders! ')).toBe('trey sanders')
    expect(normalizeName(null)).toBe('')
  })
})

describe('isGangStale', () => {
  const NOW = Date.parse('2026-07-15T00:00:00Z')
  it('is stale when never reviewed', () => {
    expect(isGangStale(gang({ reviewed_at: null }), NOW)).toBe(true)
  })
  it('is fresh when reviewed recently', () => {
    expect(isGangStale(gang({ reviewed_at: '2026-07-01T00:00:00Z' }), NOW)).toBe(false)
  })
  it('is stale when past the threshold', () => {
    expect(isGangStale(gang({ reviewed_at: '2026-01-01T00:00:00Z' }), NOW)).toBe(true)
  })
  it('is stale when next_review_at is in the past even if recently reviewed', () => {
    expect(isGangStale(gang({ reviewed_at: '2026-07-14T00:00:00Z', next_review_at: '2026-07-10T00:00:00Z' }), NOW)).toBe(true)
  })
})

describe('parseColors', () => {
  it('splits on separators and maps known color names to hex', () => {
    const sw = parseColors('Black and Gold')
    expect(sw.map((s) => s.name)).toEqual(['Black', 'Gold'])
    expect(sw[0].css).toBeTruthy()
  })
  it('keeps unknown tokens with no css chip', () => {
    const sw = parseColors('Chartreuse')
    expect(sw[0]).toEqual({ name: 'Chartreuse', css: null })
  })
  it('returns [] for empty', () => {
    expect(parseColors(null)).toEqual([])
    expect(parseColors('')).toEqual([])
  })
})

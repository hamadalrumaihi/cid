/** Pins for the UNDERGRND guide content. Two jobs:
 *
 *  1. FIDELITY — the guide may not invent prices, levels, rewards or
 *     mechanics, and it may not quietly lose any either. These assertions are
 *     transcribed from the submitted intelligence, so an edit that changes a
 *     number has to change a test too.
 *  2. The pure helpers the view depends on (matchSections / mediaForGroup /
 *     mediaPathHint) behave.
 */
import { describe, expect, it } from 'vitest'
import {
  ACCESS_FACTS, BOARD_EXAMPLES, BOARD_RULES, CONTRACT_LINES, CURRENCIES, FAQ, FLOW_STEPS, GEAR,
  LINE_LOCKED_TEXT, MEDIA_GROUPS, MEDIA_SHOTS, MILESTONE_CARD_FIELDS, MILESTONE_CATEGORIES,
  MILESTONE_EXAMPLES, MK2_REQUIREMENTS, PRIVACY_RULES, PROGRESSION, RAP_SHEET_EXAMPLES,
  RECOMMENDED_EQUIPMENT, SECTIONS, SECTION_TEXT, matchSections, mediaForGroup, mediaPathHint,
} from './undergrndContent'

describe('content fidelity — confirmed values', () => {
  it('states the access facts exactly once each', () => {
    expect(ACCESS_FACTS.map((f) => f.value)).toEqual(['The Hobo King', 'Postal 9020', '6,000 Bottle Caps'])
  })

  it('keeps the ten-step flow and the three rewards', () => {
    expect(FLOW_STEPS).toHaveLength(10)
    expect(CURRENCIES.map((c) => c.short)).toEqual(['$', 'BJC', 'XP'])
  })

  it('carries the five contract lines with their levels and buy-ins', () => {
    expect(CONTRACT_LINES.map((l) => [l.name, l.level, l.buyIn])).toEqual([
      ['Meter Jacker', 3, 100],
      ['Chop Runs', 4, 200],
      ['Tag Contracts', 5, 250],
      ['Grave Robbing', 5, 300],
      ['Mule Work', 6, 400],
    ])
  })

  it('quotes the locked-line message with the line’s own level', () => {
    expect(LINE_LOCKED_TEXT(3)).toBe('Reach Crime Level 3 first.')
  })

  it('carries the six Quartermaster items with their costs and uses', () => {
    expect(GEAR.map((g) => [g.name, g.cost, g.uses])).toEqual([
      ['Sawzall', 6, 15],
      ['Blowtorch', 7, 25],
      ['Crowbar', 9, 30],
      ['Spray Can', 5, 9],
      ['Shovel', 20, 40],
      // The Mk.II is a permanent device — no use count, so none is invented.
      ['UNDERGRND SIM Mk.II', 1250, null],
    ])
    expect(MK2_REQUIREMENTS[0]).toBe('Required Crime Level: 7+')
  })

  it('keeps the board rules, the eight equipment tips and the seven progression steps', () => {
    expect(BOARD_RULES).toHaveLength(6)
    expect(RECOMMENDED_EQUIPMENT).toHaveLength(8)
    expect(PROGRESSION).toHaveLength(7)
    expect(PRIVACY_RULES).toHaveLength(3)
  })

  it('tracks eleven milestone categories, each described by the same eight fields', () => {
    expect(MILESTONE_CATEGORIES).toHaveLength(11)
    expect(MILESTONE_CARD_FIELDS).toHaveLength(8)
  })

  it('answers all eleven FAQ questions, with unique ids', () => {
    expect(FAQ).toHaveLength(11)
    expect(new Set(FAQ.map((f) => f.id)).size).toBe(11)
    expect(FAQ.every((f) => f.a.trim().length > 0)).toBe(true)
  })
})

describe('content fidelity — screenshot examples stay put', () => {
  it('keeps the three board objectives with their progress and rewards', () => {
    expect(BOARD_EXAMPLES.map((b) => [b.progressText, b.reward.cash, b.reward.bjc, b.reward.xp])).toEqual([
      ['$1,522 / $1,522', '$408', 7, 95],
      ['3 / 14', '$342', 5, 83],
      ['0 / 4', '$465', 9, 93],
    ])
    // Only the first objective was shown as collected.
    expect(BOARD_EXAMPLES.filter((b) => b.status).map((b) => b.status)).toEqual(['Claimed'])
  })

  it('has one milestone example per tracked category, in the same order', () => {
    expect(MILESTONE_EXAMPLES.map((m) => m.name)).toEqual(MILESTONE_CATEGORIES)
  })

  it('keeps the milestone totals and next targets', () => {
    expect(MILESTONE_EXAMPLES.map((m) => [m.currentText, m.targetText])).toEqual([
      ['1', '5'], ['3', '10'], ['58', '75'], ['0', '10'], ['$2,787', '$5,000'], ['21', '25'],
      ['0', '15'], ['0', '5'], ['0', '10'], ['0', '3'], ['0', '3'],
    ])
  })

  it('keeps the five Rap Sheet statistics', () => {
    expect(RAP_SHEET_EXAMPLES.map((s) => [s.label, s.value])).toEqual([
      ['Contracts Closed', '1'],
      ['Catalytic Converters Cut', '3'],
      ['Wire Stripped', '58'],
      ['Boxes Lifted', '0'],
      ['Dirty Money Earned Lifetime', '$2,787'],
    ])
  })
})

describe('section index', () => {
  it('gives every section a unique id and a search haystack', () => {
    const ids = SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(SECTION_TEXT[id], id).toBeTruthy()
  })
})

describe('matchSections', () => {
  it('returns every section for an empty or whitespace query', () => {
    expect(matchSections('')).toEqual(SECTIONS.map((s) => s.id))
    expect(matchSections('   ')).toHaveLength(SECTIONS.length)
  })

  it('matches case-insensitively on the body text', () => {
    expect(matchSections('CROWBAR')).toContain('u-gear')
    expect(matchSections('crowbar')).toContain('u-lines')
    expect(matchSections('crowbar')).not.toContain('u-orgs')
  })

  it('matches section titles too', () => {
    expect(matchSections('leaderboard')).toContain('u-leaderboard')
  })

  it('ANDs the tokens', () => {
    expect(matchSections('shovel cemetery')).toEqual(['u-lines'])
    expect(matchSections('shovel zzzz')).toEqual([])
  })

  it('preserves document order in its results', () => {
    const hits = matchSections('bjc')
    expect(hits).toEqual(SECTIONS.map((s) => s.id).filter((id) => hits.includes(id)))
  })
})

describe('media manifest', () => {
  it('ships empty — no screenshots were supplied and none are fabricated', () => {
    expect(MEDIA_SHOTS).toEqual([])
  })

  it('names the six gallery groups', () => {
    expect(MEDIA_GROUPS.map((g) => g.id)).toEqual([
      'line-buy-ins', 'quartermaster-gear', 'todays-board', 'milestones', 'rap-sheet', 'leaderboard',
    ])
  })

  it('returns nothing per group while the manifest is empty', () => {
    for (const g of MEDIA_GROUPS) expect(mediaForGroup(g.id)).toEqual([])
  })

  it('tells the next editor exactly where the file goes', () => {
    expect(mediaPathHint('rap-sheet')).toBe('public/undergrnd/rap-sheet-1.png')
  })
})

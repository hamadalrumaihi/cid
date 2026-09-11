/** The UNDERGRND guide's content, pinned.
 *
 *  The guide's one hard rule is that nothing on it is invented, so this file
 *  transcribes the supplied reference values a second time, independently, and
 *  asserts the module matches. A silent drift — a price nudged, a level
 *  changed, a reward rounded — fails here rather than shipping.
 *
 *  It also pins the two properties a reader depends on but cannot see: that
 *  the guide needs no imagery at all, and that recorded readings are derived
 *  consistently (a progress bar can never disagree with the numbers beside
 *  it). */
import { describe, expect, it } from 'vitest'
import {
  CONTRACT_LINES, GEAR, MK2_LEVEL, MK2_REQUIREMENT_TEXT,
  RECORDED_BOARD, RECORDED_LEADERBOARD, RECORDED_MILESTONES, RECORDED_POSITION,
  RECORDED_RAP_SHEET, SECTIONS, lineLockedText,
  matchSections, milestoneProgress, quickRefContracts, quickRefGear, quickRefRequirements,
} from './undergrndContent'

describe('sections', () => {
  it('is exactly the eight required sections, in order', () => {
    expect(SECTIONS.map((s) => s.text)).toEqual([
      'Overview', 'Line Buy-Ins', 'Quartermaster Gear', "Today's Board",
      'Milestones', 'Rap Sheet', 'Leaderboard', 'Quick Reference',
    ])
  })

  it('every id is unique — they are DOM ids and anchor targets', () => {
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length)
  })
})

describe('line buy-ins — transcribed, not derived', () => {
  const SOURCE = [
    { name: 'Meter Jacker', level: 3, buyIn: 100, requiredItem: 'Crowbar' },
    { name: 'Chop Runs', level: 4, buyIn: 200, requiredItem: null },
    { name: 'Tag Contracts', level: 5, buyIn: 250, requiredItem: 'Spray Can' },
    { name: 'Grave Robbing', level: 5, buyIn: 300, requiredItem: 'Shovel' },
    { name: 'Mule Work', level: 6, buyIn: 400, requiredItem: null },
  ]

  it('matches the supplied table exactly', () => {
    expect(CONTRACT_LINES.map((l) => ({
      name: l.name, level: l.level, buyIn: l.buyIn, requiredItem: l.requiredItem,
    }))).toEqual(SOURCE)
  })

  it('every line has a concise description and no strategy copy', () => {
    for (const l of CONTRACT_LINES) {
      expect(l.description.length).toBeGreaterThan(0)
      expect(l.description.length).toBeLessThanOrEqual(120)
    }
  })

  it('the locked wording is the system’s own, with the line’s level in it', () => {
    expect(lineLockedText(3)).toBe('Reach crime level 3 first')
    for (const l of CONTRACT_LINES) {
      expect(lineLockedText(l.level)).toBe(`Reach crime level ${l.level} first`)
    }
  })
})

describe('quartermaster gear — transcribed, not derived', () => {
  const SOURCE = [
    { name: 'Sawzall', purpose: 'Catalytic-converter contracts', usesText: '~15', price: 6 },
    { name: 'Blowtorch', purpose: 'Copper-stripping contracts', usesText: '~25', price: 7 },
    { name: 'Crowbar', purpose: 'Parking-meter contracts', usesText: '~30', price: 9 },
    { name: 'Spray Can', purpose: 'Tag contracts', usesText: '~9', price: 5 },
    { name: 'Shovel', purpose: 'Grave contracts', usesText: '~40', price: 20 },
    { name: 'Underground SIM Mk.II', purpose: 'Opens The Cellar and additional content', usesText: 'Permanent device', price: 1250 },
  ]

  it('matches the supplied table exactly', () => {
    expect(GEAR.map((g) => ({
      name: g.name, purpose: g.purpose, usesText: g.usesText, price: g.price,
    }))).toEqual(SOURCE)
  })

  it('the Mk.II is a permanent device at level 7 with the system’s own wording', () => {
    const mk2 = GEAR.find((g) => g.id === 'sim-mk2')
    expect(mk2?.uses).toBeNull()
    expect(MK2_LEVEL).toBe(7)
    expect(MK2_REQUIREMENT_TEXT).toBe("The Quartermaster doesn't know you yet — crime level 7 required")
  })

  it('every required item on a contract line is a real piece of gear', () => {
    const names = new Set(GEAR.map((g) => g.name))
    for (const l of CONTRACT_LINES) {
      if (l.requiredItem) expect(names.has(l.requiredItem), l.requiredItem).toBe(true)
    }
  })
})

describe("today's board — a recorded reading", () => {
  it('matches the supplied values, statuses included', () => {
    expect(RECORDED_BOARD.map((o) => ({
      name: o.name, current: o.current, target: o.target,
      cash: o.reward.cash, bjc: o.reward.bjc, xp: o.reward.xp, status: o.status,
    }))).toEqual([
      { name: 'Move $1522 in dirty cash', current: 1522, target: 1522, cash: '$408', bjc: 7, xp: 95, status: 'CLAIMED' },
      { name: 'Cut 14 converters', current: 3, target: 14, cash: '$342', bjc: 5, xp: 83, status: 'CLAIM' },
      { name: 'Turn over 4 graves', current: 0, target: 4, cash: '$465', bjc: 9, xp: 93, status: 'CLAIM' },
    ])
  })

  it('the completed objective is the one at full progress', () => {
    for (const o of RECORDED_BOARD) {
      expect(o.status === 'CLAIMED').toBe(o.current >= o.target)
    }
  })
})

describe('milestones — a recorded reading', () => {
  const SOURCE = [
    ['Contracts Closed', 0, 1, 5, '$150', 2, 30],
    ['Converters Cut', 0, 3, 10, '$120', 1, 25],
    ['Wire Pulled', 1, 58, 75, '$200', 2, 45],
    ['Boxes Lifted', 0, 0, 10, '$120', 1, 25],
    ['Dirty Money Moved', 2, 2787, 5000, '$450', 4, 80],
    ['BJCOIN Banked', 1, 21, 25, '$300', 4, 60],
    ['Meters Jacked', 0, 0, 15, '$100', 1, 20],
    ['Bikes Chopped', 0, 0, 5, '$150', 2, 30],
    ['Walls Tagged', 0, 0, 10, '$80', 2, 40],
    ['Runs Muled', 0, 0, 3, '$200', 3, 45],
    ['Plots Turned Over', 0, 0, 3, '$250', 3, 50],
  ] as const

  it('is all eleven categories with the supplied tiers, totals and rewards', () => {
    expect(RECORDED_MILESTONES.map((m) => [
      m.name, m.tier, m.current, m.target, m.reward.cash, m.reward.bjc, m.reward.xp,
    ])).toEqual(SOURCE.map((r) => [...r]))
  })

  it('every category is one of ten tiers', () => {
    for (const m of RECORDED_MILESTONES) expect(m.tierOf).toBe(10)
  })

  it('progress is derived from the numbers, so the bar cannot disagree with them', () => {
    expect(milestoneProgress({ current: 58, target: 75 })).toBe(77)
    expect(milestoneProgress({ current: 0, target: 3 })).toBe(0)
    expect(milestoneProgress({ current: 5, target: 5 })).toBe(100)
    // clamped, never negative and never past full
    expect(milestoneProgress({ current: 9, target: 5 })).toBe(100)
    expect(milestoneProgress({ current: -1, target: 5 })).toBe(0)
    expect(milestoneProgress({ current: 1, target: 0 })).toBe(0)
  })
})

describe('rap sheet — a recorded reading', () => {
  it('is the five supplied statistics, with the system’s own labels', () => {
    expect(RECORDED_RAP_SHEET.map((s) => [s.label, s.value])).toEqual([
      ['Contracts Closed', '1'],
      ['Cats Cut', '3'],
      ['Wire Stripped', '58'],
      ['Boxes Lifted', '0'],
      ['Dirty Earned Lifetime', '$2,787'],
    ])
  })

  it('keeps "Cats Cut" verbatim rather than expanding it', () => {
    expect(RECORDED_RAP_SHEET.some((s) => s.label === 'Cats Cut')).toBe(true)
  })
})

describe('leaderboard — a recorded reading', () => {
  it('is the ten supplied rows, ranked and in order', () => {
    expect(RECORDED_LEADERBOARD.map((r) => [r.rank, r.name, r.level, r.jobs, r.xp])).toEqual([
      [1, 'Mr-B', 8, 249, 43815],
      [2, 'Cbass', 7, 255, 35773],
      [3, 'ConnorM', 7, 228, 33396],
      [4, 'Yumi', 7, 148, 32637],
      [5, 'SPIFFy', 7, 218, 31455],
      [6, 'Lucian', 7, 181, 30976],
      [7, 'Archer', 7, 138, 30833],
      [8, 'Mommy', 7, 107, 30474],
      [9, 'Digital', 7, 190, 29923],
      [10, 'Fxn', 7, 171, 29822],
    ])
  })

  it('records the position verbatim', () => {
    expect(RECORDED_POSITION).toBe("YOU'RE #336")
  })
})

describe('quick reference — condensed, never retyped', () => {
  it('derives from the tables, so a price cannot be right in one place and wrong in another', () => {
    const contracts = quickRefContracts()
    expect(contracts).toHaveLength(CONTRACT_LINES.length)
    for (const l of CONTRACT_LINES) {
      const row = contracts.find((r) => r.id === l.id)
      expect(row?.value).toContain(`${l.buyIn} BJC`)
      expect(row?.value).toContain(`Level ${l.level}+`)
    }
    const gear = quickRefGear()
    expect(gear).toHaveLength(GEAR.length)
    for (const g of GEAR) {
      expect(gear.find((r) => r.id === g.id)?.value).toContain(`${g.price} BJC`)
    }
  })

  it('lists a requirement message for every line and for the Mk.II', () => {
    const reqs = quickRefRequirements()
    expect(reqs).toHaveLength(CONTRACT_LINES.length + 1)
    expect(reqs.at(-1)?.value).toBe(MK2_REQUIREMENT_TEXT)
  })
})

describe('in-guide search', () => {
  it('matches everything when the query is empty — the resting state is the whole guide', () => {
    expect(matchSections('').size).toBe(SECTIONS.length)
    expect(matchSections('   ').size).toBe(SECTIONS.length)
  })

  it('finds a section by a value inside it, not just by its heading', () => {
    expect(matchSections('crowbar').has('u-lines')).toBe(true)
    expect(matchSections('sawzall').has('u-gear')).toBe(true)
    expect(matchSections('converters').has('u-board')).toBe(true)
    expect(matchSections('Cats Cut').has('u-rapsheet')).toBe(true)
    expect(matchSections('ConnorM').has('u-leaderboard')).toBe(true)
  })

  it('is case-insensitive and returns nothing for a miss', () => {
    expect(matchSections('SHOVEL').has('u-gear')).toBe(true)
    expect(matchSections('zzzznothing').size).toBe(0)
  })
})

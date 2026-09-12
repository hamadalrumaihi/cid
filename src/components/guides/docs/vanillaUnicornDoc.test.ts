/** Pins for the Vanilla Unicorn system record.
 *
 *  This record was written under explicit handling rules, and most of them are
 *  rules about what must NOT be in it. A prose file cannot enforce that on its
 *  own, so the constraints are pinned here: an edit that quietly turns the
 *  record into a case, attributes an amount to somebody, or promotes an NPC
 *  name into a person fails the suite rather than shipping. */
import { describe, expect, it } from 'vitest'
import { VANILLA_UNICORN_DOC } from './vanillaUnicornDoc'
import { docHeadings, sectionText } from '../guideDoc'
import { GUIDE_BODIES } from '../guideRegistry'

const ANCHORS = [
  'system-overview', 'access-requirement', 'standing-and-progression', 'moving-money',
  'operation-branches', 'unlock-requirements', 'perk-tree', 'system-actors',
  'related-systems', 'supporting-media', 'audit-history',
]

/** Every word of the record, once. */
const ALL = VANILLA_UNICORN_DOC.sections.map(sectionText).join(' ')
const lower = ALL.toLowerCase()
const text = (anchor: string) =>
  sectionText(VANILLA_UNICORN_DOC.sections.find((s) => s.anchor === anchor)!)

describe('the record is registered and structured as specified', () => {
  it('is in the registry under its own body key, with its own revision date', () => {
    const body = GUIDE_BODIES['vanilla-unicorn']
    expect(body, 'registered').toBeTruthy()
    expect(body.doc).toBe(VANILLA_UNICORN_DOC)
    // Its own date: the record was written after the September guide release,
    // and must not inherit that batch's date.
    expect(body.lastUpdated).not.toBe(GUIDE_BODIES['user-guide'].lastUpdated)
  })

  it('has the eleven required sections, in order, with permanent anchors', () => {
    expect(VANILLA_UNICORN_DOC.sections.map((s) => s.anchor)).toEqual(ANCHORS)
    // Anchors are links people send each other; a heading may be reworded, an
    // anchor may not.
    expect(new Set(ANCHORS).size).toBe(ANCHORS.length)
    for (const h of docHeadings(VANILLA_UNICORN_DOC)) expect(h.text.trim()).toBeTruthy()
  })
})

describe('it is a system record, not a case', () => {
  it('carries no case number, incident, suspect, charge or legal request', () => {
    // A case number in this portal looks like CID-2026-0001; any digit run
    // behind a case-ish prefix would be one.
    expect(ALL).not.toMatch(/\b[A-Z]{2,4}-\d{4}-\d+\b/)
    // These words DO appear — in the sentences that rule them out ("carries no
    // case number…", "cannot appear … on a warrant", "do not … seek a charge").
    // What must never appear is an AFFIRMATIVE use, so every sentence that
    // mentions one has to be a sentence that denies it.
    const NEGATED = /\b(no|not|never|neither|nor|without|cannot|nothing)\b/
    const sentences = lower.split(/(?<=[.;:])\s+/)
    for (const term of ['case number', 'incident', 'suspect', 'charge', 'subpoena', 'legal request', 'warrant']) {
      for (const sentence of sentences.filter((x) => x.includes(term))) {
        expect(sentence, `“${term}” is asserted rather than ruled out`).toMatch(NEGATED)
      }
    }
  })

  it('attributes no amount to anyone, and records only displayed system limits', () => {
    // The only money figures allowed are the system's own displayed caps.
    const amounts = ALL.match(/\$[\d,]+/g) ?? []
    expect([...new Set(amounts)].sort()).toEqual(['$210,000', '$35,000'])
    // Each appears as a displayed capability, never as something processed.
    expect(text('moving-money')).toContain('Maximum single parcel')
    expect(text('moving-money')).toContain('Daily books capacity')
    for (const forbidden of ['test amount', 'we processed', 'processed by', 'laundered by', 'his balance', 'her balance']) {
      expect(lower, forbidden).not.toContain(forbidden)
    }
  })

  it('says in its own words that it is not a case and assigns no investigator', () => {
    expect(text('system-overview')).toMatch(/not a case/i)
    expect(text('audit-history')).toMatch(/no case investigator is assigned/i)
  })
})

describe('access requirement', () => {
  it('records the 75-crypto requirement as the system’s, sourced from UNDERGRND', () => {
    const s = text('access-requirement')
    expect(s).toContain('75 crypto')
    expect(s).toMatch(/UNDERGRND/)
    expect(s).toMatch(/not a personal transaction/i)
  })

  it('records the payment as one-time and permanent — confirmed after first writing', () => {
    const s = text('access-requirement')
    expect(s).toMatch(/one-time and permanent/i)
    expect(s).toMatch(/does not (expire|lapse)/i)
  })

  it('still does not claim the payment unlocks every branch', () => {
    // Permanent access and open access are different claims. The three gated
    // branches are earned, and the record has to keep saying so.
    const s = text('access-requirement')
    expect(s).toMatch(/not the same as open access/i)
    expect(s).toMatch(/gate perk and reputation requirement/i)
    expect(lower).not.toMatch(/unlocks (all|every) branch(es)?\b(?!.*not)/)
  })
})

describe('branches and unlock requirements', () => {
  it('documents all four branches', () => {
    const s = text('operation-branches')
    for (const branch of ['The Manager', 'The Floor', 'Bank Runs', 'Nightlife']) {
      expect(s, branch).toContain(branch)
    }
  })

  it('carries the confirmed gate perks at reputation 2, 3 and 6', () => {
    const rows = VANILLA_UNICORN_DOC.sections
      .find((s) => s.anchor === 'unlock-requirements')!.blocks
      .filter((b): b is Extract<typeof b, { kind: 'table' }> => b.kind === 'table')
      .flatMap((b) => b.rows)
    const gate = (perk: string) => rows.find((r) => r.includes(perk))!
    expect(gate('House Rules').at(-1)).toBe('2')
    expect(gate('On The Books').at(-1)).toBe('3')
    expect(gate('Floor Manager').at(-1)).toBe('6')
  })

  it('says the Manager route has no gate perk', () => {
    expect(text('unlock-requirements')).toMatch(/Manager.{0,60}no displayed gate perk/i)
  })

  it('flags the overlapping “The Floor” label rather than silently resolving it', () => {
    expect(text('operation-branches')).toMatch(/overlap/i)
  })
})

describe('perk tree', () => {
  const s = () => text('perk-tree')

  it('lists every displayed perk name across the four branches', () => {
    const perks = [
      // The Owner's Trust
      'Known Quantity', 'Rounding Error', 'Bigger Envelopes', 'No Questions Asked',
      'Front of the Queue', 'Off The Ledger', 'Silent Partner',
      // House Favor
      'House Rules', 'Cooked Books', 'Regular', 'Preferred Customer', 'Make It Rain',
      'Early Close', 'Back Office', 'Big Spender', 'House Partner', 'Good Night',
      // Bank Runner
      'On The Books', 'Runner’s Cut', 'Multi Collection', 'Express Route', 'Ride Along',
      'Trusted Courier', 'Bulk Collection',
      // Nightlife
      'Floor Manager', 'House Cut', 'Good Eye', 'Security Detail', 'Talent Scout',
      'BBL Connection', 'Manager', 'VIP Clients', 'House Driver', 'Headliner',
      'Trusted Collector',
    ]
    for (const perk of perks) expect(s(), perk).toContain(perk)
  })

  it('names all four branches and marks the introductory owned perk', () => {
    for (const branch of ['The Owner’s Trust', 'House Favor', 'Bank Runner', 'Nightlife']) {
      expect(s(), branch).toContain(branch)
    }
    expect(s()).toMatch(/Known Quantity.{0,60}introductory owned perk/i)
  })

  it('invents no perk price, percentage or effect', () => {
    // The only percentages in the whole record are the observed Manager rates.
    const pcts = [...new Set(ALL.match(/\d+%/g) ?? [])].sort()
    expect(pcts).toEqual(['48%', '52%'])
    expect(s()).not.toMatch(/%/)
    expect(s()).not.toMatch(/\$/)
  })
})

describe('system actors are NPC references, never people', () => {
  const s = () => text('system-actors')

  it('records the displayed names with the six specified fields', () => {
    for (const name of ['Mercedes', 'Destiny', 'Candy', 'The Manager']) {
      expect(s(), name).toContain(name)
    }
    expect(s()).toMatch(/three further floor actors/i)
    for (const field of ['Display name', 'System role', 'Associated branch', 'Source interface', 'Notes', 'Confirmed NPC']) {
      expect(s(), field).toContain(field)
    }
  })

  it('states every exclusion, and leaves confirmation Unknown', () => {
    const t = s().toLowerCase()
    for (const rule of ['people registry', 'suspect list', 'warrant', 'charge', 'subpoena', 'organization roster', 'relationship graph']) {
      expect(t, rule).toContain(rule)
    }
    expect(t).toContain('unknown')
    expect(t).toMatch(/not (a )?person|not entity records|never .*person/i)
  })

  it('keeps the names out of every other section of the record', () => {
    for (const anchor of ANCHORS.filter((a) => a !== 'system-actors')) {
      for (const name of ['Mercedes', 'Destiny', 'Candy']) {
        expect(text(anchor), `${name} in ${anchor}`).not.toContain(name)
      }
    }
  })
})

describe('relationships', () => {
  it('records the system relationships, including the UNDERGRND link', () => {
    const s = text('related-systems')
    expect(s).toMatch(/hosts/)
    expect(s).toMatch(/provides access currency for/)
    expect(s).toMatch(/unlocks/)
    expect(s).toMatch(/belong to/)
    expect(s).toMatch(/appear within/)
    expect(s).toContain('UNDERGRND System Guide')
  })

  it('ties the system to no criminal organization and no real person', () => {
    const s = text('related-systems').toLowerCase()
    expect(s).toMatch(/no relationship is recorded between this system and any criminal organization/)
    expect(s).toMatch(/separate evidence/)
  })
})

describe('media and audit', () => {
  it('works without images and promises no placeholder', () => {
    const s = text('supporting-media')
    expect(s).toMatch(/without.{0,20}images/i)
    expect(s).toMatch(/placeholder/i)
    expect(s).toMatch(/audit log/i)
  })

  it('names the submitter and his position, and the server-side access rule', () => {
    const s = text('audit-history')
    expect(s).toContain('Tom Wood')
    expect(s).toContain('X-2 Special Agent')
    expect(s).toMatch(/on the server/i)
  })
})

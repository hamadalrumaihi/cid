/** The registry explainers.
 *
 *  Accounts and Indicators are the two shared registries whose NAMES do not
 *  explain them: "indicator" is analyst vocabulary, and "account" reads like a
 *  portal login. A registry nobody understands gets filled with the wrong
 *  thing or left empty, and both failures cost the division the deconfliction
 *  the registry exists to provide.
 *
 *  What is pinned here is the shape of the explanation — every registry says
 *  what it holds, what does NOT belong in it, and what it buys — because the
 *  middle one is the half that actually prevents misuse, and it is the half a
 *  writer drops first.
 */
import { describe, expect, it } from 'vitest'
import { GUIDE_BODIES } from '@/components/guides/guideRegistry'
import { REGISTRY_PURPOSE } from './registryPurpose'

describe('every registry explains itself the same way', () => {
  it('says what it holds, what belongs elsewhere, and what it buys', () => {
    for (const [id, p] of Object.entries(REGISTRY_PURPOSE)) {
      expect(p.holds, `${id}.holds`).toBeTruthy()
      expect(p.notHere, `${id}.notHere — the half that stops misuse`).toBeTruthy()
      expect(p.payoff, `${id}.payoff`).toBeTruthy()
      expect(p.guide, `${id}.guide`).toBeTruthy()
      expect(p.anchor, `${id}.anchor`).toBeTruthy()
    }
  })

  it('links to a guide section that really exists', () => {
    // The "read the guide" button is a route, and a route to a slug or an
    // anchor that no longer exists fails silently — the reader lands on the
    // library's "not available" answer and reads nothing. So the link is
    // checked against the real registry, not against a copy of it.
    for (const [id, p] of Object.entries(REGISTRY_PURPOSE)) {
      const body = GUIDE_BODIES[p.guide]
      expect(body, `${id}.guide — no such guide in GUIDE_BODIES`).toBeTruthy()
      expect(body.sections.map((s) => s.id), `${id}.anchor`).toContain(p.anchor)
    }
  })

  it('draws the line between an account and the person behind it', () => {
    const a = REGISTRY_PURPOSE.accounts
    expect(`${a.holds} ${a.notHere}`).toMatch(/person/i)
    expect(a.notHere, 'the portal-login misreading is the common one').toMatch(/login/i)
  })

  it('draws the line between an indicator and a note about one', () => {
    expect(REGISTRY_PURPOSE.indicators.notHere).toMatch(/note|narrative|observation/i)
    expect(REGISTRY_PURPOSE.indicators.payoff, 'cross-case matching is the whole point')
      .toMatch(/cross-case|two cases|match/i)
  })
})

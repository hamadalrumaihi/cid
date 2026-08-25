import { describe, expect, it } from 'vitest'
import type { Profile } from './auth'
import { type CapsInput, capsFrom, effectiveDojRole } from './capabilities'

/** Full persona matrix for the pure capability derivation. capsFrom is the
 *  single model every dashboard/nav gate reads, so each spec persona pins its
 *  exact dashboard set — an accidental widening (a detective seeing Command)
 *  or narrowing (the AG losing oversight) fails here before it ships. */

const NO_SIB = { access: false, agent: false, command: false, standing: null } as const

const cid = (role: Profile['role'], division: Profile['division'] = 'major_crimes', extra: Partial<CapsInput> = {}): CapsInput => ({
  state: 'in',
  profile: { active: true, role, division, is_owner: false },
  sib: { ...NO_SIB },
  dojRole: null,
  ready: true,
  ...extra,
})

describe('capsFrom — spec personas', () => {
  it('detective: my + cases only, no command scope', () => {
    const c = capsFrom(cid('detective'))
    expect(c.dashboards).toEqual(['my', 'cases'])
    expect(c.detective).toBe(true)
    expect(c.commandScope).toBeNull()
    expect(c.isOwner).toBe(false)
    expect(c.submitter).toBe(false)
  })

  it('senior detective: same as detective (seniority is not command)', () => {
    const c = capsFrom(cid('senior_detective'))
    expect(c.dashboards).toEqual(['my', 'cases'])
    expect(c.commandScope).toBeNull()
  })

  it('MCB lead: command dashboard scoped to their own bureau', () => {
    const c = capsFrom(cid('bureau_lead', 'major_crimes'))
    expect(c.dashboards).toEqual(['my', 'cases', 'command'])
    expect(c.commandScope).toEqual({ level: 'bureau', bureau: 'major_crimes' })
  })

  it('SCB lead: same shape, their bureau', () => {
    const c = capsFrom(cid('bureau_lead', 'street_crimes'))
    expect(c.commandScope).toEqual({ level: 'bureau', bureau: 'street_crimes' })
  })

  it('deputy director / director: division-wide command scope', () => {
    for (const role of ['deputy_director', 'director'] as const) {
      const c = capsFrom(cid(role))
      expect(c.dashboards, role).toEqual(['my', 'cases', 'command'])
      expect(c.commandScope, role).toEqual({ level: 'division', bureau: null })
    }
  })

  it('SIB agent: my + cases + sib, never command', () => {
    const c = capsFrom(cid('detective', 'special_investigations', {
      sib: { access: true, agent: true, command: false, standing: 'special_agent' },
    }))
    expect(c.dashboards).toEqual(['my', 'cases', 'sib'])
    expect(c.sib).toEqual({ access: true, agent: true, command: false, standing: 'special_agent' })
    expect(c.commandScope).toBeNull()
  })

  it('SIB command (X-1): sib with command standing — still no CID command scope', () => {
    const c = capsFrom(cid('detective', 'special_investigations', {
      sib: { access: true, agent: true, command: true, standing: 'special_agent_in_charge' },
    }))
    expect(c.dashboards).toEqual(['my', 'cases', 'sib'])
    expect(c.sib.command).toBe(true)
    expect(c.commandScope).toBeNull()
  })

  it('prosecutor (dual CID+DOJ — justice-only accounts cannot sign in): + doj', () => {
    const c = capsFrom(cid('detective', 'major_crimes', { dojRole: 'prosecutor' }))
    expect(c.dashboards).toEqual(['my', 'cases', 'doj'])
    expect(c.doj.role).toBe('prosecutor')
  })

  it('attorney general: doj + sib oversight standing', () => {
    const c = capsFrom(cid('detective', 'major_crimes', {
      dojRole: 'attorney_general',
      sib: { access: true, agent: false, command: false, standing: 'oversight' },
    }))
    expect(c.dashboards).toEqual(['my', 'cases', 'sib', 'doj'])
    expect(c.doj.role).toBe('attorney_general')
    expect(c.sib.agent).toBe(false)
  })

  it('judge: doj dashboard with judge role', () => {
    const c = capsFrom(cid('detective', 'major_crimes', { dojRole: 'judge' }))
    expect(c.dashboards).toEqual(['my', 'cases', 'doj'])
    expect(c.doj.role).toBe('judge')
  })

  it("submitter (field officer): 'submitter' alone — never coexists with the rest", () => {
    const c = capsFrom({
      state: 'field',
      profile: null,
      // Even hostile inputs must not leak: field state zeroes everything else.
      sib: { access: true, agent: true, command: true, standing: 'owner' },
      dojRole: 'judge',
      ready: true,
    })
    expect(c.dashboards).toEqual(['submitter'])
    expect(c.submitter).toBe(true)
    expect(c.detective).toBe(false)
    expect(c.sib).toEqual(NO_SIB)
    expect(c.doj.role).toBeNull()
  })

  it('owner: command (operational picture per spec) + owner console, without a command role', () => {
    const c = capsFrom({
      state: 'in',
      profile: { active: true, role: 'detective', division: 'major_crimes', is_owner: true },
      sib: { ...NO_SIB },
      dojRole: null,
      ready: true,
    })
    expect(c.dashboards).toEqual(['my', 'cases', 'command', 'owner'])
    expect(c.isOwner).toBe(true)
    expect(c.commandScope).toBeNull() // owner flag is not a command role
  })

  it('dual CID command + DOJ: command and doj together, in display order', () => {
    const c = capsFrom(cid('bureau_lead', 'street_crimes', { dojRole: 'prosecutor' }))
    expect(c.dashboards).toEqual(['my', 'cases', 'command', 'doj'])
  })
})

describe('capsFrom — gate states and hardening', () => {
  it('non-in, non-field states grant nothing', () => {
    for (const state of ['loading', 'setup', 'out', 'pending', 'error'] as const) {
      const c = capsFrom({
        state,
        profile: { active: true, role: 'director', division: null, is_owner: true },
        sib: { access: true, agent: true, command: true, standing: 'owner' },
        dojRole: 'attorney_general',
        ready: state !== 'loading',
      })
      expect(c.dashboards, state).toEqual([])
      expect(c.detective, state).toBe(false)
      expect(c.commandScope, state).toBeNull()
      expect(c.isOwner, state).toBe(false)
      expect(c.doj.role, state).toBeNull()
    }
  })

  it('an INACTIVE profile grants nothing even in state "in"', () => {
    const c = capsFrom({
      state: 'in',
      profile: { active: false, role: 'director', division: null, is_owner: true },
      sib: { ...NO_SIB },
      dojRole: null,
      ready: true,
    })
    expect(c.dashboards).toEqual([])
    expect(c.isOwner).toBe(false)
  })

  it('ready passes through untouched (boot flicker guard is the caller contract)', () => {
    expect(capsFrom(cid('detective', 'major_crimes', { ready: false })).ready).toBe(false)
    expect(capsFrom(cid('detective')).ready).toBe(true)
  })
})

describe('effectiveDojRole — legacy mapping + unknowns (mirror of legalShared)', () => {
  it('maps legacy ADA/DA to prosecutor and passes modern roles through', () => {
    expect(effectiveDojRole('assistant_district_attorney')).toBe('prosecutor')
    expect(effectiveDojRole('district_attorney')).toBe('prosecutor')
    expect(effectiveDojRole('prosecutor')).toBe('prosecutor')
    expect(effectiveDojRole('attorney_general')).toBe('attorney_general')
    expect(effectiveDojRole('judge')).toBe('judge')
  })
  it('unknown / missing roles read as null', () => {
    expect(effectiveDojRole('paralegal')).toBeNull()
    expect(effectiveDojRole(null)).toBeNull()
    expect(effectiveDojRole(undefined)).toBeNull()
  })
})

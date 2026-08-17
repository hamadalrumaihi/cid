/** Unit tests for the penal-code administration helpers.
 *
 *  The interesting logic here is not the RPC plumbing — it is what the screen
 *  is obliged to SAY before somebody changes the law in force. Publishing is
 *  irreversible in the sense that matters (every unit reads the new code
 *  immediately), so the warnings are the feature, and a missing warning is the
 *  bug worth catching.
 */

import { describe, expect, it } from 'vitest'
import {
  type PenalVersionSummary,
  canPublish,
  canRollBack,
  inForceVersion,
  publishWarnings,
} from './penalAdmin'

const v = (over: Partial<PenalVersionSummary>): PenalVersionSummary => ({
  id: 'v1', name: 'Test Code', status: 'draft', effective_date: '2026-01-01',
  source_file: null, change_summary: null, published_at: null, superseded_at: null,
  active_charges: 100, draft_charges: 0, archived_charges: 0,
  needs_code: 0, rules: 10, schedules: 3, ...over,
})

describe('which versions offer which action', () => {
  it('offers publish for a draft or a superseded version, never the one in force', () => {
    expect(canPublish(v({ status: 'draft' }))).toBe(true)
    expect(canPublish(v({ status: 'superseded' }))).toBe(true)
    expect(canPublish(v({ status: 'published' }))).toBe(false)
  })

  it('refuses to offer publish for a version with nothing selectable', () => {
    // penal_publish_version() raises on this; offering the button would only
    // produce an error the user could not have predicted.
    expect(canPublish(v({ status: 'draft', active_charges: 0 }))).toBe(false)
  })

  it('offers rollback only for a superseded version', () => {
    expect(canRollBack(v({ status: 'superseded' }))).toBe(true)
    expect(canRollBack(v({ status: 'draft' }))).toBe(false)
    expect(canRollBack(v({ status: 'published' }))).toBe(false)
  })

  it('finds the version in force, or says there is none', () => {
    const list = [v({ id: 'a', status: 'draft' }), v({ id: 'b', status: 'published' })]
    expect(inForceVersion(list)?.id).toBe('b')
    expect(inForceVersion([v({ status: 'draft' })])).toBeNull()
    expect(inForceVersion([])).toBeNull()
  })
})

describe('what the confirm step has to say', () => {
  it('warns that codeless charges publish an INCOMPLETE code', () => {
    // This is the one a reviewer is most likely to miss: the version looks
    // published and complete, while N charges silently reach no picker.
    const w = publishWarnings(v({ needs_code: 2 }), null)
    expect(w.join(' ')).toMatch(/2 charges/)
    expect(w.join(' ')).toMatch(/incomplete/i)
  })

  it('uses singular wording for one codeless charge', () => {
    const w = publishWarnings(v({ needs_code: 1 }), null).join(' ')
    expect(w).toContain('1 charge in this version has no code')
    expect(w).toContain('It stays held back')
    expect(w).not.toMatch(/charges|have no code|They stay/)
  })

  it('names the version that will be superseded', () => {
    const inForce = v({ id: 'old', name: 'Legacy Code', status: 'published' })
    const w = publishWarnings(v({ id: 'new' }), inForce)
    expect(w.join(' ')).toContain('Legacy Code')
    expect(w.join(' ')).toMatch(/superseded/i)
  })

  it('reassures that filed charges keep their snapshots', () => {
    // Without this the warning reads as "everything changes", which would make
    // publishing look far more dangerous than it is — cases are snapshotted.
    const w = publishWarnings(v({ id: 'new' }), v({ id: 'old', status: 'published' }))
    expect(w.join(' ')).toMatch(/snapshot/i)
  })

  it('does not claim a version will supersede itself', () => {
    const same = v({ id: 'x', status: 'published', name: 'Same Code' })
    expect(publishWarnings(same, same).join(' ')).not.toMatch(/superseded/i)
  })

  it('warns about a version with no rules and one with nothing selectable', () => {
    expect(publishWarnings(v({ rules: 0 }), null).join(' ')).toMatch(/no court, plea or sentencing rules/i)
    expect(publishWarnings(v({ active_charges: 0 }), null).join(' ')).toMatch(/refuse to publish/i)
  })

  it('says nothing surprising about a clean version', () => {
    expect(publishWarnings(v({ needs_code: 0, rules: 12, active_charges: 162 }), null)).toEqual([])
  })
})

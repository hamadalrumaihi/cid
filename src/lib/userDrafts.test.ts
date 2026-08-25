/** Pure parts of the DB-backed draft layer: the per-user local-mirror key and
 *  the server-payload size guard. The debounced upsert pipeline itself is
 *  network code (exercised through the app); these pin the contracts that
 *  must never drift — namespacing (shared-terminal fix) and the 60 000-byte
 *  UTF-8 ceiling that keeps oversized drafts local-only. */
import { describe, expect, it } from 'vitest'
import { DRAFT_MAX_DB_BYTES, draftKeyFor, oversizedForServer } from './userDrafts'

describe('userDrafts — key namespacing', () => {
  it('namespaces the local mirror per user (u:<uid>:<key>)', () => {
    expect(draftKeyFor('user-1', 'chat:case-9')).toBe('u:user-1:chat:case-9')
  })

  it('two users on one terminal never share a mirror key', () => {
    expect(draftKeyFor('user-1', 'person:new')).not.toBe(draftKeyFor('user-2', 'person:new'))
  })
})

describe('userDrafts — server size guard', () => {
  it('lets ordinary drafts through', () => {
    expect(oversizedForServer({ summary: 'Saw a van behind the warehouse.' })).toBe(false)
  })

  it('flags payloads over the 60 000-byte ceiling', () => {
    expect(oversizedForServer('x'.repeat(DRAFT_MAX_DB_BYTES + 1))).toBe(true)
  })

  it('measures UTF-8 bytes, not characters', () => {
    // 16 000 four-byte emoji ≈ 64 000 bytes — over the cap despite the low
    // character count; the same count of ASCII chars is comfortably under.
    expect(oversizedForServer('🚓'.repeat(16_000))).toBe(true)
    expect(oversizedForServer('x'.repeat(16_000))).toBe(false)
  })

  it('treats an unserialisable payload as oversize (kept local-only)', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(oversizedForServer(cyclic)).toBe(true)
  })
})

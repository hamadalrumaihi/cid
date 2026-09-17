import { afterEach, describe, expect, it } from 'vitest'
import {
  clientPortalMode, getPortalMode, isBlockingMode, isReadOnlyMode, parsePortalMode, portalRefusal,
  portalVerdict, readOnlyVerdict, RETIRED_HEADING, RETIRED_LINES, setPortalModeForTests,
} from './portalMode'
import { READ_RPCS, READ_SIDE_AUDIT_RPCS } from './portalModeReadRpcs'

const SB = 'https://abc.supabase.co'

describe('portal mode — the switch', () => {
  const saved = process.env.PORTAL_MODE
  afterEach(() => {
    if (saved === undefined) delete process.env.PORTAL_MODE
    else process.env.PORTAL_MODE = saved
    setPortalModeForTests(null)
  })

  it('parses the four modes and treats anything else as normal (a typo never takes the portal down)', () => {
    expect(parsePortalMode('retired')).toBe('retired')
    expect(parsePortalMode(' Maintenance ')).toBe('maintenance')
    expect(parsePortalMode('READONLY')).toBe('readonly')
    expect(parsePortalMode('normal')).toBe('normal')
    for (const bad of ['', undefined, null, 'off', 'retire', 'read-only', 42]) expect(parsePortalMode(bad)).toBe('normal')
  })

  it('getPortalMode reads PORTAL_MODE from the server environment', () => {
    delete process.env.PORTAL_MODE
    expect(getPortalMode()).toBe('normal')
    process.env.PORTAL_MODE = 'retired'
    expect(getPortalMode()).toBe('retired')
    process.env.PORTAL_MODE = 'nonsense'
    expect(getPortalMode()).toBe('normal')
  })

  it('classifies blocking and read-only modes', () => {
    expect(isBlockingMode('retired')).toBe(true)
    expect(isBlockingMode('maintenance')).toBe(true)
    expect(isBlockingMode('readonly')).toBe(false)
    expect(isBlockingMode('normal')).toBe(false)
    expect(isReadOnlyMode('readonly')).toBe(true)
    expect(isReadOnlyMode('retired')).toBe(false)
  })

  it('clientPortalMode is normal outside a browser and honours the test seam', () => {
    expect(clientPortalMode()).toBe('normal')
    setPortalModeForTests('readonly')
    expect(clientPortalMode()).toBe('readonly')
  })

  it('carries the retirement text verbatim and a refusal that names the mode and nothing else', () => {
    expect(RETIRED_HEADING).toBe('CID Portal Retired')
    expect(RETIRED_LINES).toEqual([
      'The CID Portal has been retired and is no longer available.',
      'The owner and developer no longer feels that his time, work, and service have been properly appreciated, either within his original department or within CID.',
      'As a result, he will no longer be maintaining, developing, or operating the service.',
    ])
    expect(portalRefusal('retired')).toEqual({ ok: false, code: 'portal_retired', message: expect.stringMatching(/^Portal retired\./) })
    expect(portalRefusal('maintenance').code).toBe('portal_maintenance')
    expect(portalRefusal('readonly').code).toBe('portal_readonly')
    for (const m of ['retired', 'maintenance', 'readonly'] as const) {
      const text = JSON.stringify(portalRefusal(m))
      expect(text).not.toMatch(/PORTAL_MODE|process\.env|supabase|vercel/i)
    }
  })
})

describe('read-only verdict — reads pass, writes are refused, unknown fails closed', () => {
  const allow = (method: string, path: string) => expect(readOnlyVerdict(method, SB + path), `${method} ${path}`).toBe('allow')
  const refuse = (method: string, path: string) => expect(readOnlyVerdict(method, SB + path), `${method} ${path}`).toBe('refuse')

  it('allows every safe method', () => {
    allow('GET', '/rest/v1/cases?select=*')
    allow('HEAD', '/rest/v1/cases?select=id')
    allow('GET', '/storage/v1/object/evidence/x.pdf')
    allow('get', '/functions/v1/anything')
  })

  it('allows session management and realtime', () => {
    allow('POST', '/auth/v1/token?grant_type=refresh_token')
    allow('POST', '/auth/v1/logout')
    allow('PUT', '/auth/v1/user')
    allow('POST', '/realtime/v1/api/broadcast')
  })

  it('refuses PostgREST writes', () => {
    refuse('POST', '/rest/v1/cases')
    refuse('PATCH', '/rest/v1/cases?id=eq.1')
    refuse('DELETE', '/rest/v1/cases?id=eq.1')
    refuse('PUT', '/rest/v1/cases')
    refuse('POST', '/rest/v1/profiles?on_conflict=id')
  })

  it('decides RPCs by name: STABLE reads and the view-audit RPCs pass, everything else is refused', () => {
    for (const name of ['search_all', 'my_permissions', 'case_timeline', 'guides_search', 'ci_get', 'trash_list']) allow('POST', `/rest/v1/rpc/${name}`)
    for (const name of READ_SIDE_AUDIT_RPCS) allow('POST', `/rest/v1/rpc/${name}`)
    for (const name of [
      'case_stage_set', 'case_reassign', 'approve_request', 'soft_delete_record', 'restore_version',
      'permanent_delete_record_execute', 'guide_revision_save', 'ci_create', 'entity_merge', 'not_a_function',
    ]) refuse('POST', `/rest/v1/rpc/${name}`)
    // The two sets are disjoint and the read list is the STABLE list, not a guess.
    for (const name of READ_SIDE_AUDIT_RPCS) expect(READ_RPCS.has(name)).toBe(false)
    expect(READ_RPCS.size).toBe(91)
  })

  it('lets storage produce signed URLs, listings and metadata but never store, move, copy or delete', () => {
    allow('POST', '/storage/v1/object/sign/evidence/case-1/x.pdf')
    allow('POST', '/storage/v1/object/list/evidence')
    allow('POST', '/storage/v1/object/info/evidence/x.pdf')
    refuse('POST', '/storage/v1/object/evidence/case-1/x.pdf')
    refuse('PUT', '/storage/v1/object/evidence/case-1/x.pdf')
    refuse('POST', '/storage/v1/object/upload/sign/evidence/x.pdf')
    refuse('POST', '/storage/v1/object/move')
    refuse('POST', '/storage/v1/object/copy')
    refuse('DELETE', '/storage/v1/object/evidence/x.pdf')
    refuse('POST', '/storage/v1/bucket')
  })

  it('lets only the search/query edge functions run', () => {
    allow('POST', '/functions/v1/search-query')
    allow('POST', '/functions/v1/semantic-query')
    refuse('POST', '/functions/v1/jobs-runner')
    refuse('POST', '/functions/v1/discord-notify')
  })

  it('fails closed on anything it cannot parse', () => {
    expect(readOnlyVerdict('POST', 'not a url at all')).toBe('refuse')
    refuse('POST', '/somewhere/else')
  })
})

describe('portalVerdict — per mode', () => {
  it('normal allows everything', () => {
    expect(portalVerdict('normal', 'DELETE', `${SB}/rest/v1/cases?id=eq.1`)).toBe('allow')
  })
  it('blocking modes allow only session management', () => {
    for (const mode of ['retired', 'maintenance'] as const) {
      expect(portalVerdict(mode, 'POST', `${SB}/auth/v1/logout`)).toBe('allow')
      expect(portalVerdict(mode, 'GET', `${SB}/rest/v1/cases?select=*`)).toBe('refuse')
      expect(portalVerdict(mode, 'POST', `${SB}/rest/v1/rpc/my_permissions`)).toBe('refuse')
      expect(portalVerdict(mode, 'GET', 'garbage')).toBe('refuse')
    }
  })
  it('readonly defers to the read-only verdict', () => {
    expect(portalVerdict('readonly', 'GET', `${SB}/rest/v1/cases`)).toBe('allow')
    expect(portalVerdict('readonly', 'POST', `${SB}/rest/v1/cases`)).toBe('refuse')
  })
})

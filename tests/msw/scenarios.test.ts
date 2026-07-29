/** Scenario coverage: auth sessions per role, network shaping, upload
 *  failure, and the realtime substitute (bump the exported store — realtime
 *  is WebSocket-based and outside MSW's http reach by design). */
import { describe, expect, it } from 'vitest'
import { supabase } from '@/lib/supabase'
import { list, rpc } from '@/lib/db'
import { fmUpload } from '@/lib/fivemanage'
import { useRealtimeStore } from '@/lib/realtime'
import {
  archivedCase, emptyCase, failedUpload, legalHoldCase, offline, populatedCase,
  roleSession, rpcResult, slowNetwork,
} from '@/mocks/scenarios'

describe('roleSession — GoTrue password-grant sessions per role', () => {
  it('mints a session whose user id matches the seeded profile', async () => {
    const { profile, credentials } = roleSession('bureau_lead', { division: 'BCB' })
    const { data, error } = await supabase().auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    })
    expect(error).toBeNull()
    expect(data.session?.user.id).toBe(profile.id)
    expect(profile.role).toBe('bureau_lead')
    expect(profile.division).toBe('BCB')
    expect(profile.active).toBe(true)
    await supabase().auth.signOut()
  })

  it('shapes the applicant (inactive, JTF) and owner (flag-only) profiles', () => {
    const applicant = roleSession('applicant')
    expect(applicant.profile.active).toBe(false)
    expect(applicant.profile.division).toBe('JTF')
    const owner = roleSession('owner')
    expect(owner.profile.is_owner).toBe(true)
    expect(owner.profile.role).toBe('detective') // live owner fixture carries only the flag
  })

  it('rejects wrong credentials with GoTrue invalid_credentials', async () => {
    const { credentials } = roleSession('detective')
    const { error } = await supabase().auth.signInWithPassword({
      email: credentials.email,
      password: 'wrong-password',
    })
    expect(error?.message).toMatch(/Invalid login credentials/)
  })
})

describe('case scenario builders', () => {
  it('archivedCase is invisible to the live filter the app uses', async () => {
    populatedCase()
    archivedCase()
    const live = await list('cases', { is: { archived_at: null } })
    expect(live).toHaveLength(1)
    const all = await list('cases')
    expect(all).toHaveLength(2)
  })

  it('legalHoldCase links an active hold to a pending DOJ request', async () => {
    const { caseRecord, legalHolds, legalRequests } = legalHoldCase()
    const holds = await list('legal_holds', { eq: { case_id: caseRecord.id }, is: { lifted_at: null } })
    expect(holds).toHaveLength(1)
    expect(holds[0].legal_request_id).toBe(legalRequests[0].id)
    expect(legalHolds[0].reason).toContain('DOJ')
  })
})

describe('network shaping', () => {
  it('slowNetwork() delays every mocked response', async () => {
    emptyCase()
    slowNetwork(120)
    const started = Date.now()
    await list('cases')
    expect(Date.now() - started).toBeGreaterThanOrEqual(110)
  })

  // Real client behavior worth knowing: postgrest-js (supabase-js 2.110)
  // retries NETWORK failures up to 3 times with backoff (~7s total) before
  // surfacing "TypeError: Failed to fetch" — hence the raised timeout. HTTP
  // error responses (403 etc.) are never retried.
  it('offline() surfaces as a thrown fetch failure through list()', { timeout: 15_000 }, async () => {
    emptyCase()
    offline()
    await expect(list('cases')).rejects.toThrow(/Failed to fetch/)
  })
})

describe('FiveManage uploads', () => {
  it('fmUpload resolves a hosted URL for an image file', async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'scene.png', { type: 'image/png' })
    const res = await fmUpload(file)
    expect(res.kind).toBe('image')
    expect(res.url).toMatch(/^https:\/\/r2\.fivemanage\.com\/mock\//)
  })

  it('failedUpload() surfaces the server message', async () => {
    failedUpload('Storage quota exceeded')
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })
    await expect(fmUpload(file)).rejects.toThrow(/Storage quota exceeded/)
  })
})

describe('rpcResult — pinning server-authoritative outcomes', () => {
  it('overrides an RPC without re-implementing server logic', async () => {
    rpcResult('next_case_number', 'CID-26-9999')
    const res = await rpc('next_case_number', { p_bureau: 'LSB' })
    expect(res.error).toBeNull()
    expect(res.data).toBe('CID-26-9999')
  })
})

describe('realtime substitute (documented limitation)', () => {
  it('live updates are simulated by bumping useRealtimeStore directly', () => {
    const before = useRealtimeStore.getState().versions['cases'] ?? 0
    useRealtimeStore.getState().bump('cases')
    expect(useRealtimeStore.getState().versions['cases']).toBe(before + 1)
  })
})

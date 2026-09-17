/** Portal mode on the REAL supabase-js / db.ts chain.
 *
 *  The proxy decides what the server does (src/proxy.test.ts); this is the
 *  browser half — the client's guarded fetch and the banner. What is proven:
 *    · read-only lets a select and a read RPC through to the (mock) network and
 *      refuses an insert, an update, a delete, a write RPC, a storage upload
 *      and a media-host upload BEFORE any request is made — MSW never sees them;
 *    · the refusal reaches the caller as the mode sentence, not a stack trace;
 *    · retired/maintenance refuse reads too, but sign-out still works;
 *    · normal changes nothing;
 *    · the banner renders for read-only only. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReadOnlyBanner } from '@/components/shell/ReadOnlyBanner'
import * as db from '@/lib/db'
import { fmUpload } from '@/lib/fivemanage'
import { setPortalModeForTests } from '@/lib/portalMode'
import { supabase } from '@/lib/supabase'
import { emptyCase, rpcResult } from '@/mocks/scenarios'
import { server } from '@/mocks/server'
import { render } from './render'

let requests: string[] = []
const onRequest = ({ request }: { request: Request }) => { requests.push(`${request.method} ${new URL(request.url).pathname}`) }

beforeEach(() => { requests = []; server.events.on('request:start', onRequest) })
afterEach(() => { server.events.removeListener('request:start', onRequest); setPortalModeForTests(null) })

const READONLY = /^Portal is in read-only mode\./

describe('read-only mode', () => {
  beforeEach(() => setPortalModeForTests('readonly'))

  it('lets a select and a read RPC reach the network', async () => {
    emptyCase({ title: 'Viewable', case_number: 'CID-26-0300' })
    rpcResult('my_permissions', [])
    const rows = await db.list('cases')
    expect(rows.map((r) => r.title)).toEqual(['Viewable'])
    const perms = await db.rpc('my_permissions', {})
    expect(perms.error).toBeNull()
    expect(requests).toEqual(['GET /rest/v1/cases', 'POST /rest/v1/rpc/my_permissions'])
  })

  it('refuses insert, update and delete before they leave the browser, with the mode sentence', async () => {
    const { caseRecord: seeded } = emptyCase({ title: 'Untouchable', case_number: 'CID-26-0301' })
    const ins = await db.insert('cases', { title: 'New', case_number: 'CID-26-0302' })
    expect(ins.data).toBeNull()
    expect(ins.error?.message).toMatch(READONLY)
    expect(ins.error?.code).toBe('portal_readonly')
    const upd = await db.update('cases', seeded.id, { title: 'Renamed' })
    expect(upd.error?.message).toMatch(READONLY)
    const del = await db.remove('cases', seeded.id)
    expect(del.error?.message).toMatch(READONLY)
    expect(requests).toEqual([])
    // Nothing changed on the (mock) server either.
    setPortalModeForTests('normal')
    expect((await db.list('cases')).map((r) => r.title)).toEqual(['Untouchable'])
  })

  it('refuses a write RPC by name and lets the view-audit RPC through', async () => {
    rpcResult('perm_denied_ack', true)
    const write = await db.rpc('soft_delete', { p_kind: 'case', p_id: '00000000-0000-0000-0000-000000000001', p_reason: 'x' })
    expect(write.error?.message).toMatch(READONLY)
    const ack = await db.rpc('perm_denied_ack', { p_kind: 'case', p_id: '00000000-0000-0000-0000-000000000001', p_action: 'select' })
    expect(ack.error).toBeNull()
    expect(requests).toEqual(['POST /rest/v1/rpc/perm_denied_ack'])
  })

  it('refuses a storage upload and a media-host upload', async () => {
    const up = await supabase().storage.from('evidence').upload('case/x.txt', new Blob(['x']))
    expect(up.data).toBeNull()
    expect(up.error?.message).toMatch(READONLY)
    await expect(fmUpload(new File(['x'], 'x.png', { type: 'image/png' }))).rejects.toThrow(READONLY)
    expect(requests).toEqual([])
  })

  it('shows the banner', async () => {
    const r = await render(<ReadOnlyBanner />)
    const status = r.container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Read-only mode')
    await r.unmount()
  })
})

describe.each(['retired', 'maintenance'] as const)('%s mode in an already-open tab', (mode) => {
  beforeEach(() => setPortalModeForTests(mode))

  it('refuses even reads, but session management still reaches the auth server', async () => {
    emptyCase({ title: 'Hidden', case_number: 'CID-26-0303' })
    await expect(db.list('cases')).rejects.toThrow(new RegExp(`^Portal ${mode === 'retired' ? 'retired' : 'unavailable'}\\.`))
    // Sign-in/out and token refresh are not CID data — a signed-in browser
    // must be able to end its session whatever the mode.
    await supabase().auth.signInWithPassword({ email: 'nobody@cid.test', password: 'wrong' })
    expect(requests).toEqual(['POST /auth/v1/token'])
  })

  it('shows no read-only banner (the proxy has replaced the page anyway)', async () => {
    const r = await render(<ReadOnlyBanner />)
    expect(r.container.querySelector('[role="status"]')).toBeNull()
    await r.unmount()
  })
})

describe('normal mode', () => {
  it('changes nothing — writes go through and no banner renders', async () => {
    setPortalModeForTests('normal')
    const ins = await db.insert('cases', { title: 'Fine', case_number: 'CID-26-0304' })
    expect(ins.error).toBeNull()
    expect(requests).toEqual(['POST /rest/v1/cases'])
    const r = await render(<ReadOnlyBanner />)
    expect(r.container.querySelector('[role="status"]')).toBeNull()
    await r.unmount()
  })
})

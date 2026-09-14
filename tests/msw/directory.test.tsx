/** The Division Directory, end to end through MSW — the real db.ts /
 *  supabase-js chain against the mock server, the real roster cache, the real
 *  realtime counters and the real screen.
 *
 *  What this file exists to prove is the complaint it was written from: the
 *  roster did not keep up. Two investigators, one directory:
 *
 *    · A performs a transfer, a promotion, an LOA change or a deactivation;
 *    · B already has the directory open and touches nothing;
 *    · B's screen re-reads and shows the new truth, in the right group, in
 *      the right order, exactly once.
 *
 *  The realtime channel itself is the documented substitute — the counter in
 *  useRealtimeStore is bumped directly (tests/msw/scenarios) — because what is
 *  under test is what the SCREEN does with a change notification, not whether
 *  a websocket delivers one. Everything downstream of the bump is real: the
 *  re-read goes through PostgREST to the mock server under the caller's own
 *  session, so what B sees after an event is what the server hands B. */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { DirectoryView } from '@/components/directory/DirectoryView'
import { useProfilesStore } from '@/lib/profiles'
import { useRealtimeStore } from '@/lib/realtime'
import { supabase } from '@/lib/supabase'
import { roleSession } from '@/mocks/scenarios'
import { getRows, seedRows, setDenial, setRows } from '@/mocks/store'
import { render } from './render'

const navigations: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { navigations.push(href) }, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/directory',
}))

/** B — the member reading the directory. The harness has no AuthProvider by
 *  design, so the viewer identity is a prop of the module, not of the row
 *  data: nothing the directory renders depends on who B is beyond "signed
 *  in", which is itself the point (this screen is division-wide). */
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    state: 'in',
    profile: { id: 'viewer-b', display_name: 'B. Reader', role: 'detective' },
    canEdit: false, canDelete: false, isCommand: false, isOwner: false,
    setMyLoa: async () => ({ error: null }),
  }),
}))

let seq = 0
function member(over: Partial<Tables<'profiles'>> = {}): Tables<'profiles'> {
  seq += 1
  return {
    id: `00000000-0000-4000-b000-0000000000${String(seq).padStart(2, '0')}`,
    display_name: `Member ${seq}`, avatar_url: null, badge_number: `C-${10 + seq}`,
    division: 'major_crimes', role: 'detective', active: true, loa: false, loa_since: null,
    created_at: '2026-07-01T12:00:00.000Z', updated_at: '2026-07-01T12:00:00.000Z',
    discord_id: null, email: null, is_owner: false, is_system: false, is_test: false,
    login_denied: false, login_denied_at: null, login_denied_by: null, login_denied_reason: null,
    removed_at: null, ...over,
  } as unknown as Tables<'profiles'>
}

async function signedIn() {
  const { credentials } = roleSession('detective')
  const { error } = await supabase().auth.signInWithPassword({ email: credentials.email, password: credentials.password })
  expect(error).toBeNull()
}

/** What investigator A does, as the directory sees it: the row changed in the
 *  database, and a change notification arrived. */
async function aChanges(id: string, patch: Partial<Tables<'profiles'>>) {
  setRows('profiles', getRows('profiles').map((r) => (r.id === id ? { ...r, ...patch } : r)))
  await act(async () => { useRealtimeStore.getState().bump('profiles') })
}

/** The member names under one bureau heading, in DOM order. */
function groupMembers(label: string): string[] {
  const headings = Array.from(document.querySelectorAll('h2'))
  const heading = headings.find((h) => h.textContent?.includes(label))
  const section = heading?.closest('section')
  if (!section) return []
  return Array.from(section.querySelectorAll('li')).map((li) =>
    li.textContent?.replace(/\s+/g, ' ').trim() ?? '')
}

/** Where a member sits in a rendered group. */
const at = (rows: string[], name: string) => rows.findIndex((r) => r.includes(name))

beforeEach(() => {
  navigations.length = 0
  useProfilesStore.setState({ profiles: [], loaded: false, loading: false, error: null })
  useRealtimeStore.setState({ versions: {}, channels: {} })
})
afterEach(() => { vi.restoreAllMocks() })

describe('two investigators, one directory', () => {
  it('moves a transferred member to the new bureau without a manual refresh — and leaves no copy behind', async () => {
    await signedIn()
    const [moved, stayed] = seedRows('profiles', [
      member({ display_name: 'Okonkwo' }),
      member({ display_name: 'Prasad' }),
    ])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)
      expect(groupMembers('Major Crimes').join(' ')).toContain('Okonkwo')
      expect(groupMembers('Street Crimes')).toEqual([])

      // A transfers Okonkwo to Street Crimes. B touches nothing.
      await aChanges(moved.id, { division: 'street_crimes' })
      await view.settle(30)

      expect(groupMembers('Street Crimes').join(' ')).toContain('Okonkwo')
      expect(groupMembers('Major Crimes').join(' '), 'no copy in the bureau they left').not.toContain('Okonkwo')
      expect(groupMembers('Major Crimes').join(' ')).toContain('Prasad')
      // …and exactly once across the whole page.
      expect(document.body.textContent!.match(/Okonkwo/g) ?? []).toHaveLength(1)
      expect(stayed.id).toBeTruthy()
    } finally { await view.unmount() }
  })

  it('re-sorts immediately after a rank change', async () => {
    await signedIn()
    const [, promoted] = seedRows('profiles', [
      member({ display_name: 'Abara' }),
      member({ display_name: 'Zeller' }),
    ])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)
      // (The signed-in fixture account is on the roster too — assert the
      // RELATIVE order of the two members under test, not fixed positions.)
      const before = groupMembers('Major Crimes')
      expect(at(before, 'Abara')).toBeLessThan(at(before, 'Zeller'))

      await aChanges(promoted.id, { role: 'bureau_lead' })
      await view.settle(30)

      const rows = groupMembers('Major Crimes')
      expect(rows[0], 'leadership sorts to the top of the bureau').toContain('Zeller')
      expect(rows[0]).toContain('Leadership')
      expect(at(rows, 'Zeller')).toBeLessThan(at(rows, 'Abara'))
    } finally { await view.unmount() }
  })

  it('follows an LOA start and an LOA end', async () => {
    await signedIn()
    const [m] = seedRows('profiles', [member({ display_name: 'Vance' })])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)
      expect(groupMembers('Major Crimes')[0]).not.toContain('On LOA')

      await aChanges(m.id, { loa: true, loa_since: '2026-07-02T00:00:00.000Z' })
      await view.settle(30)
      expect(document.body.textContent).toContain('On LOA')

      await aChanges(m.id, { loa: false, loa_since: null })
      await view.settle(30)
      expect(groupMembers('Major Crimes')[0]).not.toContain('On LOA')
    } finally { await view.unmount() }
  })

  it('follows a deactivation, and a removal takes the member off the directory', async () => {
    await signedIn()
    const [m] = seedRows('profiles', [member({ display_name: 'Cruz' }), member({ display_name: 'Diaz' })])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)

      await aChanges(m.id, { active: false })
      await view.settle(30)
      expect(groupMembers('Major Crimes')[0]).toContain('Inactive')

      await aChanges(m.id, { removed_at: '2026-07-03T00:00:00.000Z' })
      await view.settle(30)
      expect(document.body.textContent).not.toContain('Cruz')
      expect(document.body.textContent).toContain('Diaz')
    } finally { await view.unmount() }
  })

  it('shows a newly approved member as soon as the approval lands', async () => {
    await signedIn()
    seedRows('profiles', [member({ display_name: 'Serving' })])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)
      expect(document.body.textContent).not.toContain('Newcomer')

      seedRows('profiles', [member({ display_name: 'Newcomer', division: 'street_crimes' })])
      await act(async () => { useRealtimeStore.getState().bump('profiles') })
      await view.settle(30)

      expect(groupMembers('Street Crimes').join(' ')).toContain('Newcomer')
    } finally { await view.unmount() }
  })

  it('ignores a change to a table it is not showing', async () => {
    await signedIn()
    seedRows('profiles', [member({ display_name: 'Okonkwo' })])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)
      const before = document.body.innerHTML
      await act(async () => { useRealtimeStore.getState().bump('cases') })
      await view.settle(10)
      expect(document.body.innerHTML).toBe(before)
    } finally { await view.unmount() }
  })
})

describe('the states a directory owes its readers', () => {
  it('never renders a load or a failure as an empty division', async () => {
    await signedIn()
    seedRows('profiles', [member({ display_name: 'Okonkwo' })])
    // The read itself is refused — the roster never arrives, and the cache is
    // empty. This is the case the old screen rendered as "No officers".
    setDenial('profiles', 'grant')
    const view = await render(<DirectoryView />)
    try {
      await view.settle(0)
      const text = document.body.textContent ?? ''
      expect(text).not.toContain('No members on the roster yet')
      // …and nothing is drawn from rows we do not have: no bureau groups, no
      // "0 members", no zeroed summary. A confident zero is worse than a gap.
      expect(text).not.toContain('Major Crimes Bureau')
      expect(text).not.toContain('0 members')
      expect(text).toContain('—')
      expect(text).toMatch(/refused|denied|permission|Connection problem/i)
    } finally { setDenial('profiles', null); await view.unmount() }
  })

  it('says the connection dropped instead of quietly going stale', async () => {
    await signedIn()
    seedRows('profiles', [member({ display_name: 'Okonkwo' })])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)
      expect(document.body.textContent).not.toContain('Reconnecting')
      await act(async () => { useRealtimeStore.setState({ channels: { profiles: 'down' } }) })
      expect(document.body.textContent).toContain('Reconnecting to live updates')
    } finally { await view.unmount() }
  })

  it('distinguishes "nothing matches your search" from "the division is empty"', async () => {
    await signedIn()
    seedRows('profiles', [member({ display_name: 'Okonkwo' })])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)
      const search = document.querySelector('input[type="search"]') as HTMLInputElement
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
        setter.call(search, 'nobody at all')
        search.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await view.settle(10)
      expect(document.body.textContent).toContain('No members match those filters')
      expect(document.body.textContent).not.toContain('No members on the roster yet')
    } finally { await view.unmount() }
  })
})

describe('the wall between the directory and personnel administration', () => {
  it('reads the roster through the non-email projection', async () => {
    await signedIn()
    seedRows('profiles', [member({ display_name: 'Okonkwo', email: 'okonkwo@cid.test' })])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)
      expect(document.body.textContent).not.toContain('okonkwo@cid.test')
      expect(document.body.textContent).not.toContain('@')
    } finally { await view.unmount() }
  })

  it('offers no administration controls — not approve, transfer, promote or remove', async () => {
    await signedIn()
    seedRows('profiles', [member({ display_name: 'Okonkwo' })])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)
      const text = document.body.textContent ?? ''
      for (const control of ['Approve', 'Transfer', 'Promote', 'Remove', 'Deactivate', 'Manage officer']) {
        expect(text, `the directory must not offer "${control}"`).not.toContain(control)
      }
    } finally { await view.unmount() }
  })

  it('does not list the SIB bureau', async () => {
    await signedIn()
    seedRows('profiles', [
      member({ display_name: 'Okonkwo' }),
      member({ display_name: 'Compartmented', division: 'special_investigations' }),
    ])
    const view = await render(<DirectoryView />)
    try {
      await view.settle(30)
      expect(document.body.textContent).not.toContain('Compartmented')
      expect(document.body.textContent).not.toContain('Special Investigations')
      // …and says nothing about having withheld anyone.
      expect(document.body.textContent).not.toMatch(/hidden|withheld/i)
    } finally { await view.unmount() }
  })
})

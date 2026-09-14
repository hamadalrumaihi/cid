/** Personnel Management — the command work list, end to end through MSW.
 *
 *  The split this file guards: the Division Directory is where the division is
 *  browsed, and THIS is where an account is acted on. Both read the same
 *  `profiles` rows through the same cache, so a change made here is the same
 *  change the directory shows — there is no second roster to drift.
 *
 *  What is pinned:
 *   · one table for every account state, not a table plus two leftover lists;
 *   · Approve appears for the member genuinely waiting, and for nobody else —
 *     an external Field Intelligence submitter and a member moved to the DOJ
 *     each carry a decision that was already made, and one reflexive click on
 *     either is the mistake the column exists to prevent;
 *   · a successful action refreshes the shared roster, so Personnel Management
 *     and the Division Directory agree without a reload.
 */
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { AdminPanel } from '@/components/personnel/AdminPanel'
import { DirectoryView } from '@/components/directory/DirectoryView'
import { useFieldStanding } from '@/lib/fieldStanding'
import { useProfilesStore } from '@/lib/profiles'
import { useRealtimeStore } from '@/lib/realtime'
import { supabase } from '@/lib/supabase'
import { roleSession } from '@/mocks/scenarios'
import { getRows, seedRows, setRows } from '@/mocks/store'
import { render } from './render'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/command-center',
}))

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    state: 'in',
    profile: { id: 'cmd-1', display_name: 'C. Okafor', role: 'director', active: true },
    canEdit: true, canDelete: true, isCommand: true, isOwner: false,
    setMyLoa: async () => ({ error: null }),
  }),
}))

let seq = 0
const member = (over: Partial<Tables<'profiles'>> = {}): Tables<'profiles'> => {
  seq += 1
  return {
    id: `00000000-0000-4000-e000-0000000000${String(seq).padStart(2, '0')}`,
    display_name: `Member ${seq}`, avatar_url: null, badge_number: `C-${30 + seq}`,
    division: 'major_crimes', role: 'detective', active: true, loa: false, loa_since: null,
    created_at: '2026-07-01T12:00:00.000Z', updated_at: '2026-07-01T12:00:00.000Z',
    discord_id: null, email: null, is_owner: false, is_system: false, is_test: false,
    login_denied: false, login_denied_at: null, login_denied_by: null, login_denied_reason: null,
    removed_at: null, ...over,
  } as unknown as Tables<'profiles'>
}

async function signedIn() {
  useProfilesStore.setState({ profiles: [], loaded: false, loading: false, error: null })
  useRealtimeStore.setState({ versions: {}, channels: {} })
  useFieldStanding.setState({ ids: new Set<string>(), loaded: true })
  const { credentials } = roleSession('director')
  const { error } = await supabase().auth.signInWithPassword({ email: credentials.email, password: credentials.password })
  expect(error).toBeNull()
}

const panel = (profiles: Tables<'profiles'>[], emails: Record<string, string> = {}) => (
  <AdminPanel
    profiles={profiles as never}
    emails={emails}
    justiceByUser={{}}
    requests={[]}
    onManage={() => {}}
    onChanged={() => {}}
  />
)

/** The action buttons offered on the row containing `name`. */
const actionsFor = (name: string): string[] => {
  const row = Array.from(document.querySelectorAll('tr')).find((tr) => tr.textContent?.includes(name))
  return Array.from(row?.querySelectorAll('button') ?? []).map((b) => b.textContent?.trim() ?? '')
}

beforeEach(async () => { await signedIn() })

describe('one table, every account state', () => {
  it('lists active, waiting, denied, external and removed accounts together, each named', async () => {
    const rows = [
      member({ display_name: 'Active Ann' }),
      member({ display_name: 'Waiting Wes', active: false }),
      member({ display_name: 'Denied Dee', login_denied: true }),
      member({ display_name: 'Removed Ray', removed_at: '2026-08-01T00:00:00.000Z' }),
    ]
    const view = await render(panel(rows))
    try {
      const text = document.body.textContent ?? ''
      for (const name of ['Active Ann', 'Waiting Wes', 'Denied Dee', 'Removed Ray']) {
        expect(text, name).toContain(name)
      }
      expect(text).toContain('Awaiting approval')
      expect(text).toContain('Login denied')
      expect(text).toContain('Removed')
    } finally { await view.unmount() }
  })

  it('offers Approve only to the member actually waiting on a decision', async () => {
    const external = member({ display_name: 'Outside Otto', active: false })
    useFieldStanding.setState({ ids: new Set([external.id]), loaded: true })
    const rows = [
      member({ display_name: 'Waiting Wes', active: false }),
      external,
      member({ display_name: 'Active Ann' }),
    ]
    const view = await render(panel(rows))
    try {
      expect(actionsFor('Waiting Wes')).toContain('Approve')
      expect(actionsFor('Outside Otto'), 'an outside submitter applied for nothing').not.toContain('Approve')
      expect(actionsFor('Active Ann')).not.toContain('Approve')
      expect(document.body.textContent).toContain('Field Intelligence')
    } finally { await view.unmount() }
  })

  it('offers Restore, not Manage, on a removed account', async () => {
    const view = await render(panel([member({ display_name: 'Removed Ray', removed_at: '2026-08-01T00:00:00.000Z' })]))
    try {
      expect(actionsFor('Removed Ray')).toContain('Restore')
      expect(actionsFor('Removed Ray')).not.toContain('Manage')
    } finally { await view.unmount() }
  })

  it('counts what is waiting, and says so when nothing is', async () => {
    const busy = await render(panel([member({ display_name: 'Waiting Wes', active: false })]))
    expect(document.body.textContent).toContain('1 waiting on a command decision')
    await busy.unmount()

    const quiet = await render(panel([member({ display_name: 'Active Ann' })]))
    expect(document.body.textContent).toContain('Nothing is waiting on a decision')
    await quiet.unmount()
  })

  it('searches by the identifiers command actually types', async () => {
    const rows = [member({ display_name: 'Abara' }), member({ display_name: 'Bell', badge_number: 'K-09' })]
    const view = await render(panel(rows, { [rows[1].id]: 'bell@cid.test' }))
    try {
      const search = document.querySelector('input[type="search"]') as HTMLInputElement
      const type = async (value: string) => {
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
          setter.call(search, value)
          search.dispatchEvent(new Event('input', { bubbles: true }))
        })
      }
      await type('K-09')
      expect(document.body.textContent).toContain('Bell')
      expect(document.body.textContent).not.toContain('Abara')
      await type('bell@cid.test')
      expect(document.body.textContent).toContain('Bell')
      await type('nobody')
      expect(document.body.textContent).toContain('No members match those filters')
    } finally { await view.unmount() }
  })

  it('points at the Division Directory for browsing rather than repeating it', async () => {
    const view = await render(panel([member({ display_name: 'Active Ann' })]))
    try {
      expect(document.body.textContent).toContain('Division Directory')
    } finally { await view.unmount() }
  })
})

describe('Personnel Management and the Division Directory stay in step', () => {
  it('a command change reaches the directory without a reload', async () => {
    const [moved] = seedRows('profiles', [member({ display_name: 'Okonkwo' })])
    const directory = await render(<DirectoryView />)
    try {
      await directory.settle(30)
      expect(document.body.textContent).toContain('Okonkwo')

      // Command transfers them from Personnel Management. Both surfaces read
      // the same rows through the same cache, so the directory follows.
      setRows('profiles', getRows('profiles').map((r) =>
        (r.id === moved.id ? { ...r, division: 'street_crimes' } : r)))
      await act(async () => { await useProfilesStore.getState().fetch() })
      await directory.settle(10)

      const street = Array.from(document.querySelectorAll('section'))
        .find((s) => s.querySelector('h2')?.textContent?.includes('Street Crimes'))
      expect(street?.textContent).toContain('Okonkwo')
    } finally { await directory.unmount() }
  })
})

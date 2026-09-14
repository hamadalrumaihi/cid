/** The Command Center's personnel surfaces, after the split.
 *
 *  The Command Center used to carry a second complete roster: the Duty Status
 *  board listed every active member of every bureau, which is the Division
 *  Directory's job and now the Division Directory's alone. What command needs
 *  from a readiness board is the EXCEPTIONS — who is unavailable, and where
 *  the division is thin — plus a door to the two surfaces that own the detail.
 *
 *  What is pinned here: the board reports availability and does not reprint
 *  the roster, and the doors exist. */
import { describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { DutyStatus } from '@/components/command-center/sections/DutyStatus'
import { useProfilesStore } from '@/lib/profiles'
import { useRealtimeStore } from '@/lib/realtime'
import { supabase } from '@/lib/supabase'
import { roleSession } from '@/mocks/scenarios'
import { seedRows } from '@/mocks/store'
import { render } from './render'

const navigations: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { navigations.push(href) }, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/command-center',
}))

let seq = 0
const member = (over: Partial<Tables<'profiles'>> = {}): Tables<'profiles'> => {
  seq += 1
  return {
    id: `00000000-0000-4000-c000-0000000000${String(seq).padStart(2, '0')}`,
    display_name: `Officer ${seq}`, avatar_url: null, badge_number: `C-${20 + seq}`,
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
  const { credentials } = roleSession('bureau_lead')
  const { error } = await supabase().auth.signInWithPassword({ email: credentials.email, password: credentials.password })
  expect(error).toBeNull()
}

describe('Command Center — Duty Status is an exceptions board, not a roster', () => {
  it('names who is unavailable and does not reprint everyone who is', async () => {
    await signedIn()
    seedRows('profiles', [
      member({ display_name: 'Available Ann' }),
      member({ display_name: 'Available Bob', division: 'street_crimes' }),
      member({ display_name: 'Away Cara', loa: true, loa_since: '2026-07-02T00:00:00.000Z' }),
    ])
    const view = await render(<DutyStatus />)
    try {
      await view.settle(30)
      const text = document.body.textContent ?? ''
      expect(text).toContain('Away Cara')
      expect(text, 'the full roster belongs to the Division Directory').not.toContain('Available Ann')
      expect(text).not.toContain('Available Bob')
    } finally { await view.unmount() }
  })

  it('still counts the division — command needs the numbers, not the names', async () => {
    await signedIn()
    seedRows('profiles', [
      member({ display_name: 'One' }),
      member({ display_name: 'Two', loa: true }),
      member({ display_name: 'Three', active: false }),
    ])
    const view = await render(<DutyStatus />)
    try {
      await view.settle(30)
      const text = document.body.textContent ?? ''
      expect(text).toContain('On duty')
      expect(text).toContain('On LOA')
      expect(text).toContain('Major Crimes')
    } finally { await view.unmount() }
  })

  it('says so plainly when everyone is available', async () => {
    await signedIn()
    seedRows('profiles', [member({ display_name: 'One' })])
    const view = await render(<DutyStatus />)
    try {
      await view.settle(30)
      expect(document.body.textContent).toMatch(/everyone is available|no one is on loa/i)
    } finally { await view.unmount() }
  })

  it('points at the two surfaces that own the detail', async () => {
    await signedIn()
    seedRows('profiles', [member({ display_name: 'One' })])
    const view = await render(<DutyStatus />)
    try {
      await view.settle(30)
      const text = document.body.textContent ?? ''
      expect(text).toContain('Division Directory')
      expect(text).toContain('Personnel')
    } finally { await view.unmount() }
  })
})

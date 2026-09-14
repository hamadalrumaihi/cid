/** Accessibility, on the components this project added.
 *
 *  The live axe gate (tests/e2e/a11y.spec.ts) is the real one — it scans the
 *  assembled page in a browser, which is where most violations actually live.
 *  It also SKIPS without the RLS fixture credentials, which are not repo
 *  secrets, so on an ordinary checkout nothing accessibility-related runs at
 *  all and a new component can ship unexamined.
 *
 *  This runs axe-core against the real components in happy-dom, with no
 *  credentials and no server. It cannot see anything that depends on layout,
 *  colour rendering or a real focus ring, so it is a floor and not a ceiling:
 *  it catches the structural mistakes — an unlabelled control, a definition
 *  list built wrong, a heading level out of order, a control with no
 *  accessible name — which are the ones a reviewer also misses.
 *
 *  Serious and critical only, same bar as the live gate. */
import axe from 'axe-core'
import { describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { seedRows } from '@/mocks/store'
import { REGISTRY_PURPOSE } from '@/lib/registryPurpose'
import { useProfilesStore, type RosterProfile } from '@/lib/profiles'
import { RecordProvenance } from '@/components/shared/RecordProvenance'
import { RegistryPurposeNote } from '@/components/shared/RegistryPurposeNote'
import { DirectoryView } from '@/components/directory/DirectoryView'
import { render } from './render'

// The harness has no App Router (the house pattern — see directory.test.tsx):
// the guide link inside the purpose note only needs a router that exists.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/',
}))

// Same house pattern: the harness has no AuthProvider.
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    state: 'in',
    profile: { id: 'viewer-a', display_name: 'A. Reader', role: 'detective' },
    canEdit: false, canDelete: false, isCommand: false, isOwner: false,
    setMyLoa: async () => ({ error: null }),
  }),
}))

let seq = 0
const member = (over: Partial<Tables<'profiles'>> = {}): Tables<'profiles'> => {
  seq += 1
  return {
    id: `00000000-0000-4000-c000-0000000000${String(seq).padStart(2, '0')}`,
    display_name: `Member ${seq}`, avatar_url: null, badge_number: `C-${20 + seq}`,
    division: 'major_crimes', role: 'detective', active: true, loa: false, loa_since: null,
    created_at: '2026-07-01T12:00:00.000Z', updated_at: '2026-07-01T12:00:00.000Z',
    discord_id: null, email: null, is_owner: false, is_system: false, is_test: false,
    login_denied: false, login_denied_at: null, login_denied_by: null, login_denied_reason: null,
    removed_at: null, ...over,
  } as Tables<'profiles'>
}

const GATED = new Set(['serious', 'critical'])

async function violations(node: HTMLElement) {
  const results = await axe.run(node, {
    // Rules that need a real viewport, real painting or the whole document
    // report nothing useful against a detached fragment; leaving them on
    // produces noise that teaches people to ignore the run.
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
      'page-has-heading-one': { enabled: false },
      'landmark-one-main': { enabled: false },
    },
  })
  return results.violations
    .filter((v) => GATED.has(v.impact ?? ''))
    .map((v) => ({ rule: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.html) }))
}

describe('axe: components added by the portal redesign', () => {
  it('the check itself reports a real violation', async () => {
    // A scan harness that always passes is indistinguishable from no scan.
    // This is the control: a button with no accessible name is a serious
    // violation, and if this stops failing the rest of the file means nothing.
    const r = await render(<button type="button" />)
    expect((await violations(r.container)).map((v) => v.rule)).toContain('button-name')
    await r.unmount()
  })

  for (const registry of Object.keys(REGISTRY_PURPOSE) as (keyof typeof REGISTRY_PURPOSE)[]) {
    it(`the ${registry} purpose note is clean, collapsed and expanded`, async () => {
      const r = await render(<RegistryPurposeNote registry={registry} />)
      expect(await violations(r.container), `${registry} note`).toEqual([])

      const toggle = r.container.querySelector('button')
      expect(toggle, 'the note must be toggleable by a real button').toBeTruthy()
      await r.fire(toggle!, new MouseEvent('click', { bubbles: true }))
      expect(await violations(r.container), `${registry} note (toggled)`).toEqual([])
      await r.unmount()
    })
  }

  it('the Division Directory is clean with members on it', async () => {
    // A whole redesigned screen, not just a widget: groups, badges, the
    // summary strip and the filter controls all in one scan.
    seedRows('profiles', [
      member({ display_name: 'Ainsley', role: 'bureau_lead' }),
      member({ display_name: 'Bracken', division: 'street_crimes' }),
      member({ display_name: 'Calder', loa: true, loa_since: '2026-08-01T00:00:00.000Z' }),
    ])
    const r = await render(<DirectoryView />)
    await r.settle(30)
    expect(await violations(r.container), 'Division Directory').toEqual([])
    await r.unmount()
  })

  it('the record origin line is clean whether or not it can name the author', async () => {
    const at = new Date(Date.now() - 72 * 3600_000).toISOString()
    // Unknown author: the line carries a title attribute, which is the shape
    // most likely to be got wrong.
    const r = await render(<RecordProvenance record={{ created_at: at, created_by: 'gone', updated_at: null }} />)
    expect(await violations(r.container), 'origin line (unnamed author)').toEqual([])

    useProfilesStore.setState({
      profiles: [{ id: 'u-1', display_name: 'Det. Rowe' } as RosterProfile],
      loaded: true, loading: false, error: null,
    })
    await r.rerender(
      <RecordProvenance record={{ created_at: at, created_by: 'u-1', updated_at: new Date().toISOString() }}>
        Lead Det. Vega
      </RecordProvenance>,
    )
    expect(await violations(r.container), 'origin line (named author)').toEqual([])
    await r.unmount()
  })
})

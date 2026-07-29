/** Profile / session fixtures — typed against database.types.ts.
 *
 *  roleSession() is the entry point: it seeds a profiles row shaped like the
 *  real onboarding pipeline produces (applicant = inactive + JTF default
 *  division; owner = is_owner flag, mirroring the live owner fixture which
 *  carries ONLY the flag, not a command role) and registers matching GoTrue
 *  password-grant credentials with the auth handlers. */
import type { Database, Tables } from '@/lib/database.types'
import { mockId, mockTimestamp, seedRows, setSession, type MockAuthSession } from '../store'

type Bureau = Database['public']['Enums']['bureau']
type AppRole = Database['public']['Enums']['app_role']

/** The program's role list. applicant/owner are portal concepts, not enum
 *  values: applicant = inactive profile awaiting approval; owner = is_owner
 *  flag on top of an ordinary rank. */
export type MockRole =
  | 'applicant'
  | 'detective'
  | 'senior_detective'
  | 'bureau_lead'
  | 'deputy_director'
  | 'director'
  | 'owner'

/** Full typed profiles Row with sane defaults; override anything. */
export function profileRow(overrides: Partial<Tables<'profiles'>> = {}): Tables<'profiles'> {
  const id = overrides.id ?? mockId()
  return {
    active: true,
    avatar_url: null,
    badge_number: '4021',
    created_at: mockTimestamp(),
    discord_id: null,
    display_name: 'Det. Mara Voss',
    division: 'LSB',
    email: `mock-${id.slice(-4)}@cid.test`,
    id,
    is_owner: false,
    is_system: false,
    is_test: true,
    loa: false,
    loa_since: null,
    login_denied: false,
    login_denied_at: null,
    login_denied_by: null,
    login_denied_reason: null,
    removed_at: null,
    role: 'detective',
    updated_at: mockTimestamp(),
    ...overrides,
  }
}

export interface RoleSessionResult {
  profile: Tables<'profiles'>
  credentials: MockAuthSession
}

/** Seed a profile for `role` and register it as the signed-in session the
 *  auth handlers will mint tokens for. Defaults follow the production shape:
 *  - applicant → active:false, division 'JTF' (the pre-approval default);
 *  - owner     → is_owner:true on a plain detective rank (live owner fixture
 *                carries only the flag — RLS/UI gates key on is_owner);
 *  - all ranks → active:true in the given division (default LSB). */
export function roleSession(
  role: MockRole,
  opts: { division?: Bureau; active?: boolean; overrides?: Partial<Tables<'profiles'>> } = {},
): RoleSessionResult {
  const enumRole: AppRole = role === 'applicant' || role === 'owner' ? 'detective' : role
  const profile = profileRow({
    role: enumRole,
    division: opts.division ?? (role === 'applicant' ? 'JTF' : 'LSB'),
    active: opts.active ?? role !== 'applicant',
    is_owner: role === 'owner',
    display_name: `Mock ${role.replace(/_/g, ' ')}`,
    ...opts.overrides,
  })
  seedRows('profiles', [profile])
  const credentials: MockAuthSession = {
    userId: profile.id,
    email: profile.email ?? `mock-${role}@cid.test`,
    password: 'mock-password',
  }
  setSession(credentials)
  return { profile, credentials }
}

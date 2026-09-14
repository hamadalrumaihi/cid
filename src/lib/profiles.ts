'use client'

/** Shared roster cache — vanilla command.js PROFILES/fetchProfiles/officerName.
 *  Reads use the non-email column projection (profiles.email is column-granted
 *  to command only; selecting it as a member would be DENIED). */
import { create } from 'zustand'
import { list } from './db'
import type { Tables } from './database.types'

export const ROSTER_COLS =
  'id,display_name,avatar_url,badge_number,division,role,active,created_at,updated_at,loa,loa_since,discord_id,removed_at,is_owner,login_denied,is_system' as const

export type RosterProfile = Pick<
  Tables<'profiles'>,
  'id' | 'display_name' | 'avatar_url' | 'badge_number' | 'division' | 'role'
  | 'active' | 'created_at' | 'updated_at' | 'loa' | 'loa_since' | 'discord_id' | 'removed_at' | 'is_owner' | 'login_denied' | 'is_system'
>

interface ProfilesState {
  profiles: RosterProfile[]
  /** True once a read has SUCCEEDED. A screen may only say "no members" when
   *  this is true — before it, an empty array means "not read yet". */
  loaded: boolean
  /** A read is in flight. `loaded && loading` is a refresh over stale rows. */
  loading: boolean
  /** The last read's failure, or null. Kept separately from `profiles` so a
   *  failed refresh can show stale rows AND say they are stale. */
  error: string | null
  fetch: () => Promise<void>
}

/** Monotonic request id. Two refreshes can be in flight at once — a realtime
 *  bump landing on top of a manual refresh — and they can resolve out of
 *  order, which used to let an OLDER answer overwrite a newer one (a member
 *  reappearing in the bureau they had just left). Only the newest request may
 *  write. */
let seq = 0

export const useProfilesStore = create<ProfilesState>((set) => ({
  profiles: [],
  loaded: false,
  loading: false,
  error: null,
  async fetch() {
    const mine = ++seq
    set({ loading: true })
    try {
      const rows = (await list('profiles', { select: ROSTER_COLS })) as unknown as RosterProfile[]
      if (mine !== seq) return // a newer read already answered
      set({ profiles: rows, loaded: true, loading: false, error: null })
    } catch (e) {
      if (mine !== seq) return
      // The rows already in hand stay: stale beats blank. What changes is that
      // the failure is now VISIBLE, so a screen can say so and offer a retry
      // instead of rendering an empty division.
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },
}))

/** Resolve an officer id → display name against the cache (command.js:434). */
export function officerName(id: string | null | undefined): string | null {
  if (!id) return null
  const p = useProfilesStore.getState().profiles.find((x) => x.id === id)
  return p ? p.display_name : 'Officer'
}

/** Active members, name-sorted — the standard assignee/mention option pool.
 *  System accounts (the Phase B deletion tombstone) never appear: RLS already
 *  hides them from ordinary members; the client mirror keeps owner sessions
 *  (which CAN read system rows) from offering them in pickers. */
export function activeProfiles(): RosterProfile[] {
  return useProfilesStore.getState().profiles
    .filter((p) => p.active && !p.is_system)
    .slice()
    .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
}

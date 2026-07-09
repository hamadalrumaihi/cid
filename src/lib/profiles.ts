'use client'

/** Shared roster cache — vanilla command.js PROFILES/fetchProfiles/officerName.
 *  Reads use the non-email column projection (profiles.email is column-granted
 *  to command only; selecting it as a member would be DENIED). */
import { create } from 'zustand'
import { list } from './db'
import type { Tables } from './database.types'

export const ROSTER_COLS =
  'id,display_name,avatar_url,badge_number,division,role,active,created_at,updated_at,loa,loa_since,discord_id,removed_at,is_owner' as const

export type RosterProfile = Pick<
  Tables<'profiles'>,
  'id' | 'display_name' | 'avatar_url' | 'badge_number' | 'division' | 'role'
  | 'active' | 'created_at' | 'updated_at' | 'loa' | 'loa_since' | 'discord_id' | 'removed_at' | 'is_owner'
>

interface ProfilesState {
  profiles: RosterProfile[]
  loaded: boolean
  fetch: () => Promise<void>
}

export const useProfilesStore = create<ProfilesState>((set) => ({
  profiles: [],
  loaded: false,
  async fetch() {
    try {
      const rows = (await list('profiles', { select: ROSTER_COLS })) as unknown as RosterProfile[]
      set({ profiles: rows, loaded: true })
    } catch { /* transient — keep the previous cache; views degrade to 'Officer' */ }
  },
}))

/** Resolve an officer id → display name against the cache (command.js:434). */
export function officerName(id: string | null | undefined): string | null {
  if (!id) return null
  const p = useProfilesStore.getState().profiles.find((x) => x.id === id)
  return p ? p.display_name : 'Officer'
}

/** Active members, name-sorted — the standard assignee/mention option pool. */
export function activeProfiles(): RosterProfile[] {
  return useProfilesStore.getState().profiles
    .filter((p) => p.active)
    .slice()
    .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
}

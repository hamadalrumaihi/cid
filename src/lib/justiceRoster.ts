'use client'

/** Active DOJ/Judiciary identities, keyed by CID user id — for command surfaces
 *  that must tell a member moved out of CID by an organization correction apart
 *  from a genuine pending sign-in. `justice_memberships` is readable only by the
 *  member themselves, justice staff, command and owner (jm_sel), so this fetch
 *  yields rows only on the command-gated screens that use it; elsewhere it
 *  degrades to empty. */
import { create } from 'zustand'
import { list } from './db'
import type { JusticeAgency, JusticeRole } from './justice'

export interface JusticeIdentity { agency: JusticeAgency; justice_role: JusticeRole }

interface JusticeRosterState {
  byUser: Record<string, JusticeIdentity>
  loaded: boolean
  fetch: () => Promise<void>
}

export const useJusticeRoster = create<JusticeRosterState>((set) => ({
  byUser: {},
  loaded: false,
  async fetch() {
    try {
      const rows = (await list('justice_memberships', { select: 'user_id,agency,justice_role,active' })) as unknown as
        { user_id: string; agency: JusticeAgency; justice_role: JusticeRole; active: boolean }[]
      const byUser: Record<string, JusticeIdentity> = {}
      for (const r of rows) if (r.active) byUser[r.user_id] = { agency: r.agency, justice_role: r.justice_role }
      set({ byUser, loaded: true })
    } catch { /* command-only read; degrade to empty for anyone else */ }
  },
}))

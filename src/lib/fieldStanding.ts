'use client'

/** Accounts that currently hold Field Intelligence standing, as a set of ids.
 *
 *  Every surface that asks "who is waiting for a membership decision?" needs
 *  this, and for one specific reason: a Field Intelligence submitter is
 *  INACTIVE BY DESIGN. The standing is deliberately not `profiles.active`,
 *  because 22 intelligence tables are gated on that flag alone — so
 *  "inactive, not removed, no membership request" described a submitter
 *  perfectly, and the approval queue spent its time asking command to approve
 *  people who had never applied for anything.
 *
 *  Mirrors the justiceRoster store, including its failure mode: `field_officers`
 *  is readable by any active investigator (`field_officers_sel`), so this
 *  resolves on the surfaces that need it and degrades to an empty set — and
 *  therefore to the previous behavior — for anybody else. `loaded` is how a
 *  caller tells "no submitters" apart from "could not look".
 */
import { create } from 'zustand'
import { list } from './db'

interface FieldStandingState {
  ids: Set<string>
  loaded: boolean
  fetch: () => Promise<void>
}

export const useFieldStanding = create<FieldStandingState>((set) => ({
  ids: new Set<string>(),
  loaded: false,
  async fetch() {
    try {
      const rows = await list('field_officers', { eq: { active: true }, select: 'user_id' })
      set({ ids: new Set(rows.map((r) => r.user_id)), loaded: true })
    } catch { /* investigator-only read; degrade to empty for anyone else */ }
  },
}))

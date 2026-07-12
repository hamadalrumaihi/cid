'use client'

/** Tiny shared store so the Owner Portal Overview KPI strip can REUSE values the
 *  Health and Feedback sections already fetch — Overview never fetches. Health
 *  writes its DB round-trip after its existing refresh(); the Feedback inbox
 *  writes the open/unresolved count after its existing load. A null value means
 *  "not checked yet this session", and the KPI card degrades to a graceful "—". */
import { create } from 'zustand'

/** DB reachability + round-trip, mirrored from HealthState['db']. */
export interface HealthVital {
  ok: boolean
  ms: number
}

interface OwnerVitalsState {
  health: HealthVital | null
  openFeedback: number | null
  setHealth: (health: HealthVital | null) => void
  setOpenFeedback: (openFeedback: number | null) => void
}

export const useOwnerVitals = create<OwnerVitalsState>((set) => ({
  health: null,
  openFeedback: null,
  setHealth: (health) => set({ health }),
  setOpenFeedback: (openFeedback) => set({ openFeedback }),
}))

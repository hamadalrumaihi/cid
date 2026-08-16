'use client'

/** SIU standing for the signed-in account — the ONE place the app asks "does
 *  SIU exist for this user, and with what authority?".
 *
 *  Components never re-derive this from a role check (`docs/AUTHORIZATION.md`
 *  §7): they call `useSiu()` and read a capability off the returned object.
 *  The answer is still only a UX gate — `private.siu_standing()` re-resolves
 *  it server-side for every read and every RPC, and both reads below are
 *  RLS-filtered, so a non-authorized account gets empty results rather than a
 *  denial (it learns nothing about what exists).
 *
 *  Cost: two tiny selects, once per signed-in session, shared by every
 *  consumer through a module-level promise. Sign-out clears it. */

import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import { supabase } from './supabase'
import {
  siuCanAppoint, siuCanReadCid, siuIsAgent, siuIsCommand, siuOperates, siuStanding,
  type SiuContext, type SiuMembership, type SiuStanding,
} from './siu'

interface SiuFacts {
  release: boolean
  membership: SiuMembership | null
}

let cache: { uid: string; promise: Promise<SiuFacts> } | null = null

async function loadFacts(uid: string): Promise<SiuFacts> {
  const db = supabase()
  const [settings, membership] = await Promise.all([
    db.from('siu_settings').select('enabled_for_non_owner').maybeSingle(),
    db.from('siu_memberships')
      .select('user_id,siu_role,callsign,oversight_only,active')
      .eq('user_id', uid)
      .maybeSingle(),
  ])
  // An RLS-filtered miss and a genuine "no row" are the same answer here, and
  // both mean "no SIU" — never surface an error state that would confirm the
  // tables exist to someone who cannot see them.
  return {
    release: !!settings.data?.enabled_for_non_owner,
    membership: (membership.data as SiuMembership | null) ?? null,
  }
}

export interface SiuAccess {
  /** Resolved authority, or null when SIU does not exist for this account. */
  standing: SiuStanding | null
  /** May open the SIU workspace at all. */
  canAccess: boolean
  /** Field standing — may work investigations (oversight-only excluded). */
  isAgent: boolean
  /** X-Ray 1 (or the Owner during build phase). */
  isCommand: boolean
  /** May appoint / remove SIU personnel. */
  canAppoint: boolean
  /** Broad, read-only visibility of CID investigations. */
  canReadCid: boolean
  /** `siu_settings.enabled_for_non_owner` — false during the build phase. */
  releaseOpen: boolean
  membership: SiuMembership | null
  loading: boolean
}

const NO_ACCESS: SiuAccess = {
  standing: null, canAccess: false, isAgent: false, isCommand: false,
  canAppoint: false, canReadCid: false, releaseOpen: false,
  membership: null, loading: false,
}

export function useSiu(): SiuAccess {
  const { state, profile, justiceRole } = useAuth()
  const uid = profile?.id ?? null
  const [facts, setFacts] = useState<SiuFacts | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    // Every state write happens after an await, so the effect body itself
    // never triggers a synchronous cascading render (the ShiftsView pattern).
    void (async () => {
      await Promise.resolve()
      if (!live) return
      if (state !== 'in' || !uid) {
        cache = null
        setFacts(null)
        setLoading(false)
        return
      }
      setLoading(true)
      if (!cache || cache.uid !== uid) cache = { uid, promise: loadFacts(uid) }
      try {
        const f = await cache.promise
        if (live) setFacts(f)
      } catch {
        if (live) setFacts(null)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [state, uid])

  if (state !== 'in' || !profile) return NO_ACCESS

  const ctx: SiuContext = {
    profile,
    membership: facts?.membership ?? null,
    justiceRole,
    release: !!facts?.release,
  }
  return {
    standing: siuStanding(ctx),
    canAccess: siuOperates(ctx),
    isAgent: siuIsAgent(ctx),
    isCommand: siuIsCommand(ctx),
    canAppoint: siuCanAppoint(ctx),
    canReadCid: siuCanReadCid(ctx),
    releaseOpen: !!facts?.release,
    membership: facts?.membership ?? null,
    loading,
  }
}

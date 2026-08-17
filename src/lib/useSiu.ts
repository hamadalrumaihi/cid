'use client'

/** Departmental context for the signed-in account — the ONE place the app asks
 *  "which investigative department am I, and which workspace do I render?".
 *
 *  The platform is one portal with two departments (CID and SIU). A member has
 *  exactly one ACTIVE department; only the Owner and the Attorney General
 *  legitimately hold both contexts, and only they are offered a deliberate
 *  switch (§23 — there is no "Switch to SIU" button for normal members).
 *
 *  Components never re-derive any of this from a role check
 *  (`docs/AUTHORIZATION.md` §7): they call `useSiu()` and read a capability.
 *  The answer is a UX gate only — `siu_department_context()` re-resolves it
 *  server-side from `private.user_department()` / `private.siu_standing()`, and
 *  every read is RLS-scoped while every write goes through a definer RPC.
 *
 *  Cost: one RPC per signed-in session, shared by every consumer through a
 *  module-level promise. Sign-out clears it. */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import { rpc } from './db'
import { Store } from './store'
import {
  maySwitchDepartment, siuCanAppoint, siuCanReadCid, siuIsAgent, siuIsCommand,
  siuOperates, siuStanding, userDepartment, mayCreateCidCase, siuCaseReadOnly,
  type Department, type SiuContext, type SiuMembership, type SiuStanding,
} from './siu'

/** Server payload from `siu_department_context()`. */
interface DeptContext {
  department: Department
  siu_available: boolean
  siu_standing: SiuStanding | null
  release_open: boolean
  may_switch: boolean
  callsign: string | null
  siu_role: string | null
}

let cache: { uid: string; promise: Promise<DeptContext | null> } | null = null

async function loadContext(): Promise<DeptContext | null> {
  const res = await rpc('siu_department_context', {})
  // An RLS/RPC miss and "no SIU" are the same answer — never surface an error
  // state that would confirm SIU exists to someone who cannot see it.
  if (res.error) return null
  return (res.data as unknown as DeptContext | null) ?? null
}

/** Which workspace the user is currently looking at. Persisted per browser so
 *  an authorized dual-context user (Owner testing SIU, AG doing oversight)
 *  stays where they were across reloads. Storing it grants nothing: the server
 *  re-checks authority on every read and every write. */
const VIEW_KEY = 'departmentView'
const readStoredView = (): Department | null => {
  const v = Store.get<string | null>(VIEW_KEY, null)
  return v === 'siu' || v === 'cid' ? v : null
}

export interface SiuAccess {
  /** The member's ACTIVE department (their home department). */
  department: Department
  /** The department whose workspace is currently rendered. Equals
   *  `department` unless an authorized dual-context user switched. */
  viewing: Department
  /** True while the SIU workspace is the active context. */
  inSiu: boolean
  /** Resolved SIU authority, or null when SIU does not exist for this account. */
  standing: SiuStanding | null
  /** May open the SIU workspace at all. */
  canAccess: boolean
  /** Field standing — may work investigations (oversight-only excluded). */
  isAgent: boolean
  /** X-Ray 1 — SIU's operational head (or the Owner during build phase). */
  isCommand: boolean
  /** May appoint / remove SIU personnel. */
  canAppoint: boolean
  /** Broad, read-only visibility of CID investigations. */
  canReadCid: boolean
  /** Holds both contexts, so a deliberate switch is offered (Owner / AG). */
  maySwitch: boolean
  /** `siu_settings.enabled_for_non_owner` — false during the build phase. */
  releaseOpen: boolean
  callsign: string | null
  membership: SiuMembership | null
  loading: boolean
  /** Switch the rendered workspace. No-op unless `maySwitch`. */
  setViewing: (d: Department) => void
  /** Is this case read-only for me purely because of the departmental split?
   *  Narrows `useAuth().canEdit` — never widens it. See `siuCaseReadOnly`. */
  caseReadOnly: (caseRow: { case_authority?: string | null }) => boolean
  /** May I create a CID case? False for SIU department members, who would
   *  create one and immediately lose access to it. */
  mayCreateCase: boolean
}

const NO_ACCESS: SiuAccess = {
  department: 'cid', viewing: 'cid', inSiu: false,
  standing: null, canAccess: false, isAgent: false, isCommand: false,
  canAppoint: false, canReadCid: false, maySwitch: false, releaseOpen: false,
  callsign: null, membership: null, loading: false,
  setViewing: () => {},
  caseReadOnly: () => false,
  mayCreateCase: true,
}

export function useSiu(): SiuAccess {
  const { state, profile, justiceRole } = useAuth()
  const uid = profile?.id ?? null
  const [ctx, setCtx] = useState<DeptContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<Department | null>(null)

  useEffect(() => {
    let live = true
    // Every state write happens after an await, so the effect body itself
    // never triggers a synchronous cascading render (the ShiftsView pattern).
    void (async () => {
      await Promise.resolve()
      if (!live) return
      if (state !== 'in' || !uid) {
        cache = null
        setCtx(null)
        setLoading(false)
        return
      }
      setLoading(true)
      setView(readStoredView())
      if (!cache || cache.uid !== uid) cache = { uid, promise: loadContext() }
      try {
        const c = await cache.promise
        if (live) setCtx(c)
      } catch {
        if (live) setCtx(null)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [state, uid])

  const setViewing = useCallback((d: Department) => {
    if (!ctx?.may_switch) return
    Store.set(VIEW_KEY, d)
    setView(d)
  }, [ctx?.may_switch])

  if (state !== 'in' || !profile) return NO_ACCESS

  // The membership shape the pure capability helpers expect. Reconstructed
  // from the server context so `siu.ts` stays the single mirror of the rules.
  const membership: SiuMembership | null = ctx?.siu_role
    ? {
        user_id: profile.id,
        siu_role: ctx.siu_role,
        callsign: ctx.callsign,
        oversight_only: false,
        active: true,
      }
    : null

  const capCtx: SiuContext = {
    profile, membership, justiceRole, release: !!ctx?.release_open,
  }

  // The server is authoritative for department and standing; the pure helpers
  // are the fallback while the RPC is still in flight, so a slow network never
  // flashes the wrong workspace.
  const department: Department = ctx?.department ?? userDepartment(capCtx)
  const canAccess = ctx?.siu_available ?? siuOperates(capCtx)
  const maySwitch = ctx?.may_switch ?? maySwitchDepartment(capCtx)
  // A stored SIU view only applies to someone who may actually switch; every
  // other account renders their own department, always.
  const viewing: Department = maySwitch && view && canAccess ? view : department
  const standing = ctx?.siu_standing ?? siuStanding(capCtx)

  return {
    department,
    viewing,
    inSiu: viewing === 'siu',
    standing,
    canAccess,
    isAgent: siuIsAgent(capCtx),
    isCommand: siuIsCommand(capCtx),
    canAppoint: siuCanAppoint(capCtx),
    canReadCid: siuCanReadCid(capCtx),
    maySwitch,
    releaseOpen: !!ctx?.release_open,
    callsign: ctx?.callsign ?? null,
    membership,
    loading,
    setViewing,
    // Bound to the viewer's HOME department, not the workspace they happen to
    // be looking at: an Owner browsing the SIU workspace is still CID by
    // department and keeps their CID write rights.
    caseReadOnly: (caseRow) => siuCaseReadOnly({ department, standing }, caseRow),
    mayCreateCase: mayCreateCidCase(department),
  }
}

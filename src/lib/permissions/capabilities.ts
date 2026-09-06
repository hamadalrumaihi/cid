'use client'

/** The single capability model every dashboard and nav gate reads.
 *
 *  One question — "which dashboards does this account get, and with what
 *  scope?" — answered in one place, composed from the existing authorities:
 *  `useAuth()` (gate state + CID profile), `useSiu()` (SIB standing) and the
 *  expiry-aware DOJ role (own justice_memberships row). Components never
 *  re-derive a dashboard gate from raw role checks; they call
 *  `useCapabilities()` and read a capability.
 *
 *  UX gating ONLY. RLS and definer RPCs remain the authority for every read
 *  and write behind each dashboard — hiding an entry is cosmetic. */

import { type GateState, type Profile, useAuth } from '../auth'
import { isCommandRole } from '../roles'
import type { SiuStanding } from '../siu'
import { type DojRole } from './mirrors'
import { usePermissions } from './usePermissions'
import { useSiu } from './useSiu'

/** Every dashboard surface an account can hold. 'submitter' (the Field
 *  Intelligence portal) never coexists with the others — the auth gate routes
 *  a field officer to a separate shell entirely (auth.tsx: CID wins). */
export type DashboardId = 'my' | 'cases' | 'command' | 'sib' | 'doj' | 'submitter' | 'owner'

export type { DojRole }

/** Command reach of an active CID command-staff member: a Bureau Lead sees
 *  their own bureau; Deputy Director and Director see the whole division. */
export interface CommandScope {
  level: 'bureau' | 'division'
  bureau: string | null
}

export interface SibCaps {
  access: boolean
  agent: boolean
  command: boolean
  standing: SiuStanding | null
}

export interface Caps {
  /** Auth gate settled and the SIB context resolved — render gated chrome
   *  only when true, so nothing flashes in and out during boot. */
  ready: boolean
  /** The dashboards this account may open, in display order. */
  dashboards: DashboardId[]
  /** Active CID profile (any rank) — the ordinary investigator capability. */
  detective: boolean
  /** Non-null for active CID command staff (bureau_lead / DD / director). */
  commandScope: CommandScope | null
  isOwner: boolean
  sib: SibCaps
  doj: { role: DojRole }
  /** Field officer (SAHP/BCSO/LSPD) — the submission portal, nothing else. */
  submitter: boolean
}

/** The signals `capsFrom` derives from — kept minimal and serializable so the
 *  derivation is a pure function with a full test matrix (capabilities.test). */
export interface CapsInput {
  state: GateState
  profile: Pick<Profile, 'active' | 'role' | 'division' | 'is_owner'> | null
  sib: SibCaps
  dojRole: DojRole
  ready: boolean
}

const NO_SIB: SibCaps = { access: false, agent: false, command: false, standing: null }

/** Pure derivation — the whole capability model, no hooks. Rules:
 *   · my + cases       — any ACTIVE CID profile.
 *   · command          — commandScope !== null OR owner (the owner sees the
 *                        operational command picture per spec).
 *   · sib              — SIB workspace access (useSiu().canAccess).
 *   · doj              — an effective DOJ role (dual identity only — a
 *                        justice-only account cannot pass the sign-in gate).
 *   · owner            — profiles.is_owner ONLY.
 *   · submitter        — the 'field' gate state, exclusive of everything. */
export function capsFrom(input: CapsInput): Caps {
  const { state, profile, ready } = input
  if (state === 'field') {
    return {
      ready, dashboards: ['submitter'], detective: false, commandScope: null,
      isOwner: false, sib: NO_SIB, doj: { role: null }, submitter: true,
    }
  }
  const inApp = state === 'in'
  const detective = inApp && !!profile?.active
  const isOwner = detective && !!profile?.is_owner
  const role = detective ? profile?.role ?? null : null
  const commandScope: CommandScope | null = !isCommandRole(role)
    ? null
    : role === 'bureau_lead'
      ? { level: 'bureau', bureau: profile?.division ?? null }
      : { level: 'division', bureau: null }
  const sib = inApp ? input.sib : NO_SIB
  const doj = { role: inApp ? input.dojRole : null }

  const dashboards: DashboardId[] = []
  if (detective) dashboards.push('my', 'cases')
  if (commandScope !== null || isOwner) dashboards.push('command')
  if (sib.access) dashboards.push('sib')
  if (doj.role) dashboards.push('doj')
  if (isOwner) dashboards.push('owner')

  return { ready, dashboards, detective, commandScope, isOwner, sib, doj, submitter: false }
}

/** The live capability model for the signed-in account. The DOJ role is
 *  the server's answer (`my_permissions().doj_role`, expiry-aware through
 *  private.justice_role_effective) — no own justice_memberships read, no
 *  fallback: until the permissions RPC settles the DOJ dashboard is simply
 *  absent, and an RPC error keeps it absent (NO_ACCESS). */
export function useCapabilities(): Caps {
  const auth = useAuth()
  const siu = useSiu()
  const permissions = usePermissions()
  return capsFrom({
    state: auth.state,
    profile: auth.profile,
    sib: { access: siu.canAccess, agent: siu.isAgent, command: siu.isCommand, standing: siu.standing },
    dojRole: permissions.perms.doj_role,
    ready: auth.state !== 'loading' && !siu.loading && permissions.ready,
  })
}

'use client'

/** The server-first permission context — `public.my_permissions()` (P1-01)
 *  read once per signed-in session and shared by every consumer.
 *
 *  Safe defaults, deliberately: the hook answers NO_ACCESS until the RPC
 *  resolves, and an RPC error KEEPS NO_ACCESS and surfaces `error` for a
 *  retry notice — there is no fallback to the pure mirrors, because a
 *  mirror that disagrees with the server would only ever show a control the
 *  server then refuses (plan §P4). `can(action, kind)` answers the global
 *  matrix cell for the viewer's access class; a per-record question goes to
 *  `canRecord()` (public.can_record) and is always async. */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { rpc } from '../db'
import { useTableVersion } from '../realtime'
import { PERMISSIONS_MATRIX, type PermissionMatrixCells } from '../permissionsMatrix'
import type { DojRole } from './mirrors'
import type { SiuStanding } from '../siu'

export type AccessClass = 'owner' | 'command' | 'member' | 'justice' | 'field' | 'inactive' | 'none'

export interface Expiry { case_id: string; expires_at: string }

/** Shape of `public.my_permissions()` (20261005120000, extended by
 *  20261012120000 with expiries.case_access_grants). */
export interface MyPermissions {
  access_class: AccessClass
  active: boolean
  role: string | null
  rank: number
  bureau: string | null
  is_owner: boolean
  sib_standing: SiuStanding | null
  department: 'cid' | 'siu'
  doj_role: DojRole
  doj_membership_role: string | null
  is_field_officer: boolean
  command_scope: { level: 'bureau' | 'division'; bureau: string | null } | null
  expiries: {
    doj_membership: string | null
    joint_assignments: Expiry[]
    sib_temporary_access: Expiry[]
    case_access_grants: Expiry[]
  }
  flags: {
    is_test: boolean
    login_denied: boolean
    loa: boolean
    removed: boolean
    sib_release_open: boolean
    sib_may_switch: boolean
    sib_may_control_visibility: boolean
  }
  generated_at: string | null
}

export const NO_ACCESS: MyPermissions = Object.freeze({
  access_class: 'none', active: false, role: null, rank: 0, bureau: null, is_owner: false,
  sib_standing: null, department: 'cid', doj_role: null, doj_membership_role: null,
  is_field_officer: false, command_scope: null,
  expiries: { doj_membership: null, joint_assignments: [], sib_temporary_access: [], case_access_grants: [] },
  flags: {
    is_test: false, login_denied: false, loa: false, removed: false,
    sib_release_open: false, sib_may_switch: false, sib_may_control_visibility: false,
  },
  generated_at: null,
}) as MyPermissions

export interface PermissionsState {
  /** The RPC settled (with an answer or an error). Gate chrome on this. */
  ready: boolean
  /** Non-null when the last read failed — the UI stays at NO_ACCESS and
   *  offers `retry()`. */
  error: string | null
  perms: MyPermissions
  retry: () => void
  /** The global matrix cell for the viewer's access class: true for ✓ /
   *  ✓*, false for ✗ (and for an unknown action/kind), null when the cell
   *  is record-dependent ("case access", "bureau / global" …) — ask
   *  `canRecord()` then. */
  can: (action: string, kind: string) => boolean | null
}

/** Normalise the wire payload: anything missing reads as NO_ACCESS. */
export function normalizePermissions(raw: unknown): MyPermissions {
  if (!raw || typeof raw !== 'object') return NO_ACCESS
  const r = raw as Partial<MyPermissions> & { expiries?: Partial<MyPermissions['expiries']>; flags?: Partial<MyPermissions['flags']> }
  if (!r.access_class) return NO_ACCESS
  return {
    ...NO_ACCESS,
    ...r,
    access_class: r.access_class,
    expiries: { ...NO_ACCESS.expiries, ...(r.expiries ?? {}) },
    flags: { ...NO_ACCESS.flags, ...(r.flags ?? {}) },
  } as MyPermissions
}

/** Which matrix column answers for an access class. */
export function matrixColumnFor(cls: AccessClass): keyof PermissionMatrixCells {
  if (cls === 'owner') return 'owner'
  if (cls === 'command') return 'command'
  if (cls === 'member') return 'member'
  return 'inactive'
}

/** Read one matrix cell: ✓ / ✓* → true, ✗ → false, anything else → null
 *  (record-dependent). Unknown action/kind → false (deny by default). */
export function matrixCan(perms: MyPermissions, action: string, kind: string): boolean | null {
  const row = PERMISSIONS_MATRIX.find((r) => r.key === `${action}/${kind}`)
    ?? PERMISSIONS_MATRIX.find((r) => r.key === `${action}/*`)
  if (!row) return false
  const cell = row[matrixColumnFor(perms.access_class)]
  if (typeof cell !== 'string') return false
  if (cell.startsWith('✓')) return true
  if (cell.startsWith('✗')) return false
  return null
}

let cache: { uid: string; promise: Promise<{ perms: MyPermissions; error: string | null }> } | null = null

async function load(): Promise<{ perms: MyPermissions; error: string | null }> {
  try {
    const res = await rpc('my_permissions', {})
    if (res.error) return { perms: NO_ACCESS, error: res.error.message || 'permissions unavailable' }
    return { perms: normalizePermissions(res.data), error: null }
  } catch (e) {
    return { perms: NO_ACCESS, error: e instanceof Error ? e.message : 'permissions unavailable' }
  }
}

export function usePermissions(): PermissionsState {
  const { state, profile } = useAuth()
  const uid = state === 'in' || state === 'field' ? profile?.id ?? null : null
  const pv = useTableVersion('profiles')
  const jv = useTableVersion('justice_memberships')
  const [answer, setAnswer] = useState<{ perms: MyPermissions; error: string | null; uid: string | null }>(
    { perms: NO_ACCESS, error: null, uid: null },
  )
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (!live) return
      if (!uid) { cache = null; setAnswer({ perms: NO_ACCESS, error: null, uid: null }); return }
      // A realtime bump or a retry invalidates the session cache.
      if (!cache || cache.uid !== uid || tick > 0 || pv > 0 || jv > 0) cache = { uid, promise: load() }
      const a = await cache.promise
      if (live) setAnswer({ ...a, uid })
    })()
    return () => { live = false }
  }, [uid, tick, pv, jv])

  const retry = useCallback(() => { cache = null; setTick((t) => t + 1) }, [])
  const perms = uid && answer.uid === uid ? answer.perms : NO_ACCESS
  const ready = !uid ? state !== 'loading' : answer.uid === uid
  const can = useCallback((action: string, kind: string) => matrixCan(perms, action, kind), [perms])
  return { ready, error: uid && answer.uid === uid ? answer.error : null, perms, retry, can }
}

/** Per-record answer from `public.can_record` — async by nature. A transport
 *  error is a refusal (deny by default). */
export async function canRecord(action: string, kind: string, id: string): Promise<boolean> {
  const res = await rpc('can_record', { p_action: action, p_kind: kind, p_id: id })
  return !res.error && res.data === true
}

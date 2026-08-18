/** Penal Code administration — the client half of the publish/rollback lane.
 *
 *  The write RPCs have existed since 20260904120000 and nothing has ever
 *  called them. That is not a cosmetic gap: the 2026 code has been imported
 *  and unpublishable, because publishing requires an authenticated
 *  administrator and no screen offered the action.
 *
 *  ── This file decides nothing ──────────────────────────────────────────────
 *  `isAdmin` comes from the server, out of `penal_admin_overview()`, which
 *  asks `private.penal_is_admin()` — the same helper every penal policy uses.
 *  It is not inferred from a role, and it is not inferred from being able to
 *  read `penal_administrators` (the owner is an administrator without having a
 *  row there, so that inference reports the one person entitled to publish as
 *  not entitled). Every write below is a SECURITY DEFINER RPC that re-checks
 *  the same thing; hiding a control is convenience, never the boundary.
 *
 *  ── Publishing is not a save ───────────────────────────────────────────────
 *  It changes the law in force for every unit at once, supersedes whatever was
 *  in force, and is audited. `publishWarnings()` exists so a screen can say
 *  what is about to happen — in particular that a version carrying codeless
 *  charges will ship an incomplete code, since a charge with no code cannot be
 *  selected on a case.
 */

import { rpc } from './db'

export type PenalVersionStatus = 'draft' | 'published' | 'superseded'

export interface PenalVersionSummary {
  id: string
  name: string
  status: PenalVersionStatus
  effective_date: string
  source_file: string | null
  change_summary: string | null
  published_at: string | null
  superseded_at: string | null
  /** Selectable statutes. */
  active_charges: number
  /** Held back — a codeless charge is a draft and reaches no selector. */
  draft_charges: number
  archived_charges: number
  needs_code: number
  rules: number
  schedules: number
}

export interface PenalAdminOverview {
  isAdmin: boolean
  versions: PenalVersionSummary[]
}

interface OverviewPayload {
  is_admin: boolean
  versions: PenalVersionSummary[]
}

export async function loadPenalAdminOverview(): Promise<PenalAdminOverview> {
  const res = await rpc('penal_admin_overview', {})
  const p = (res.data ?? null) as OverviewPayload | null
  return { isAdmin: !!p?.is_admin, versions: p?.versions ?? [] }
}

// ---------------------------------------------------------------------------
// What a screen should say before it lets anyone publish
// ---------------------------------------------------------------------------

/** Warnings for publishing `v`, given the version currently in force. Empty
 *  means nothing surprising — never that the act is small. */
export function publishWarnings(
  v: PenalVersionSummary,
  inForce: PenalVersionSummary | null,
): string[] {
  const out: string[] = []
  if (v.needs_code > 0) {
    const one = v.needs_code === 1
    out.push(
      `${v.needs_code} charge${one ? '' : 's'} in this version ${one ? 'has' : 'have'} no ` +
      `code. ${one ? 'It stays' : 'They stay'} held back and will not appear in any ` +
      'charge picker until a code is assigned, so the published code is incomplete.',
    )
  }
  if (v.active_charges === 0) {
    out.push('This version has no selectable charges. The database will refuse to publish it.')
  }
  if (v.rules === 0) {
    out.push('This version carries no court, plea or sentencing rules.')
  }
  if (inForce && inForce.id !== v.id) {
    out.push(
      `“${inForce.name}” is in force and will be superseded. Cases already ` +
      'charged under it keep their own snapshots and are unaffected.',
    )
  }
  return out
}

/** The version currently in force, if any. */
export function inForceVersion(versions: PenalVersionSummary[]): PenalVersionSummary | null {
  return versions.find((v) => v.status === 'published') ?? null
}

/** A version can only be published from draft or superseded, and never twice. */
export function canPublish(v: PenalVersionSummary): boolean {
  return v.status !== 'published' && v.active_charges > 0
}

/** Rolling back means re-publishing a version that was superseded. It is not
 *  an undo of an edit — it changes the law in force again, so it demands a
 *  reason the same way a publish does. */
export function canRollBack(v: PenalVersionSummary): boolean {
  return v.status === 'superseded' && v.active_charges > 0
}

// ---------------------------------------------------------------------------
// Writes — every one of these is re-checked server-side
// ---------------------------------------------------------------------------

export async function publishPenalVersion(id: string, note: string | null): Promise<string | null> {
  const res = await rpc('penal_publish_version', { p_version: id, p_note: note || undefined })
  return res.error?.message ?? null
}

export async function rollBackPenalVersion(id: string, reason: string): Promise<string | null> {
  const res = await rpc('penal_rollback_to', { p_version: id, p_reason: reason })
  return res.error?.message ?? null
}

// public.penal_archive_charge(p_charge, p_reason) and
// public.penal_restore_charge(p_charge, p_reason, p_code) are the per-CHARGE
// half of administration: retiring a statute, and giving a codeless draft its
// number. Wrappers for them are deliberately not defined here — they need a
// charge-list surface to be called from, and an exported function with no
// caller reads as a supported path that nothing has ever exercised. They
// arrive with that screen.

/** Explicit seniority order — mirrors vanilla CID_ROLE_ORDER (roles.js).
 *  detective < senior_detective < bureau_lead < deputy_director < director */
export const ROLE_ORDER = [
  'detective',
  'senior_detective',
  'bureau_lead',
  'deputy_director',
  'director',
] as const

export const ROLE_LABEL: Record<string, string> = {
  detective: 'Detective',
  senior_detective: 'Senior Detective',
  bureau_lead: 'Bureau Lead',
  deputy_director: 'Deputy Director',
  director: 'Director',
}
export const COMMAND_ROLES = ['bureau_lead', 'deputy_director', 'director'] as const
export const BUREAUS: Record<string, string> = {
  LSB: 'Los Santos Bureau',
  BCB: 'Blaine County Bureau',
  SAB: 'State Bureau',
  JTF: 'Joint Task Force',
}

/** Department abbreviation per bureau — the officer-card vocabulary
 *  (vanilla DEPT_OF_BUREAU, collab.js:7). bureauLabel is the long form. */
export const DEPT_OF_BUREAU: Record<string, string> = {
  LSB: 'LSPD',
  BCB: 'BCSO',
  SAB: 'SAHP',
  JTF: 'JTF (Joint)',
}

export const roleLabel = (r?: string | null) => (r && ROLE_LABEL[r]) || r || '—'
export const bureauLabel = (b?: string | null) => (b && BUREAUS[b]) || b || '—'
export const deptLabel = (b?: string | null) => (b && DEPT_OF_BUREAU[b]) || b || '—'
export const isCommandRole = (r?: string | null) =>
  !!r && (COMMAND_ROLES as readonly string[]).includes(r)

// ---------------------------------------------------------------------------
// Unified role/department policy — the client mirror of the server matrix in
// private.can_assign_cid_role() (20260718010000_unified_role_policy.sql).
// UX filtering only; RLS/RPCs remain the authority. Keep the two in lockstep.
// ---------------------------------------------------------------------------

/** Permanent CID departments. JTF is deliberately absent: it is a temporary
 *  joint-case designation (and the pre-approval profile default), never a
 *  permanent home — the server rejects it in every assignment path. */
export const PERMANENT_BUREAUS = ['LSB', 'BCB', 'SAB'] as const

/** Minimal actor/target shape shared by profiles and roster rows. */
export interface RoleParty {
  id?: string | null
  role?: string | null
  division?: string | null
  active?: boolean | null
  is_owner?: boolean | null
  is_system?: boolean | null
}

/** Every role an applicant may REQUEST at signup. Requesting grants nothing —
 *  an authorized reviewer decides. Owner is a flag, not an app_role, so it can
 *  never appear here. */
export const getRequestableRoles = (domain: 'cid' | 'doj' | 'judiciary' = 'cid') =>
  domain === 'cid' ? ROLE_ORDER : ([] as readonly string[])

/** Valid permanent departments for a CID role (DOJ/Judiciary identities do not
 *  use profiles.division — justice authority lives in justice_memberships). */
export const getValidDepartments = (_role?: string | null, domain: 'cid' | 'doj' | 'judiciary' = 'cid') =>
  domain === 'cid' ? PERMANENT_BUREAUS : ([] as readonly string[])

/** May `actor` assign/approve `finalRole` in `bureau`? Mirrors the server
 *  matrix: Det/Sr Det ← Bureau Lead of that bureau or higher; Bureau Lead ←
 *  DD+; Deputy Director ← Director+; Director ← Owner. */
export const canAssignCidRole = (
  actor: RoleParty | null | undefined, finalRole: string, bureau: string,
): boolean => {
  if (!actor) return false
  // Unknown/retired roles (and "owner", which is a flag, not a role) are
  // never assignable — not even by the Owner.
  if (!(ROLE_ORDER as readonly string[]).includes(finalRole)) return false
  if (actor.is_owner && actor.active) return true
  if (!actor.active) return false
  switch (finalRole) {
    case 'detective':
    case 'senior_detective':
      return (actor.role === 'bureau_lead' && actor.division === bureau)
        || actor.role === 'deputy_director' || actor.role === 'director'
    case 'bureau_lead':
      return actor.role === 'deputy_director' || actor.role === 'director'
    case 'deputy_director':
      return actor.role === 'director'
    default:
      return false // director requires Owner; unknown/retired roles never assignable
  }
}

/** May `actor` approve a membership request into (`requestedRole`, `bureau`)?
 *  Same matrix as canAssignCidRole — a thin delegation (not a re-export) so
 *  call sites read as the approval question they are asking. */
export const canApproveRequestedRole = (
  actor: RoleParty | null | undefined, finalRole: string, bureau: string,
): boolean => canAssignCidRole(actor, finalRole, bureau)

/** May `actor` change `target`'s role to `newRole` (same department)? Needs
 *  matrix authority over BOTH the old and the new role; never yourself. */
export const canChangeRole = (
  actor: RoleParty | null | undefined, target: RoleParty, newRole: string,
): boolean =>
  !!actor && actor.id !== target.id
  && (PERMANENT_BUREAUS as readonly string[]).includes(target.division ?? '')
  && newRole !== target.role
  && canAssignCidRole(actor, target.role ?? '', target.division ?? '')
  && canAssignCidRole(actor, newRole, target.division ?? '')

/** Roles `actor` could move `target` to right now (UI options). */
export const getAssignableRoles = (actor: RoleParty | null | undefined, target: RoleParty) =>
  ROLE_ORDER.filter((r) => canChangeRole(actor, target, r))

/** May `actor` INITIATE a transfer of `target` from `source` to `destination`?
 *  A Bureau Lead may only initiate for rank-and-file members when one side is
 *  their own bureau (the other bureau still approves); DD+ and Owner may
 *  initiate any move between departments, JTF included. Never yourself. */
export const canTransfer = (
  actor: RoleParty | null | undefined, target: RoleParty, source: string, destination: string,
): boolean => {
  if (!actor || !actor.active || actor.id === target.id) return false
  // Any department may be either side of a move, JTF included — the pair just
  // has to be two real, different departments.
  if (!(source in BUREAUS) || !(destination in BUREAUS) || source === destination) return false
  if (actor.is_owner || actor.role === 'deputy_director' || actor.role === 'director') return true
  if (actor.role !== 'bureau_lead') return false
  if (isCommandRole(target.role)) return false
  return actor.division === source || actor.division === destination
}

/** May `actor` decide (approve/reject) the given SIDE of a pending transfer?
 *  Bureau Lead of that bureau, or Deputy Director or higher, or Owner. */
export const canDecideTransferSide = (actor: RoleParty | null | undefined, bureau: string): boolean =>
  !!actor && ((!!actor.is_owner && !!actor.active)
    || (!!actor.active && ((actor.role === 'bureau_lead' && actor.division === bureau)
      || actor.role === 'deputy_director' || actor.role === 'director')))

/** May `actor` permanently remove `target` from CID (admin_remove_member)?
 *  Bureau Lead: own-bureau rank-and-file only; Deputy Director: anyone below
 *  Deputy; Director: anyone except an Owner account; Owner: anyone. Never
 *  yourself, never system accounts. Mirrors the server matrix exactly —
 *  the RPC is the authority, this only decides whether to show the button. */
export const canRemoveMember = (actor: RoleParty | null | undefined, target: RoleParty): boolean => {
  if (!actor || !actor.active || actor.id === target.id || target.is_system) return false
  if (target.is_owner && !actor.is_owner) return false
  if (actor.is_owner) return true
  if (actor.role === 'director') return true
  if (actor.role === 'deputy_director') return !isCommandRole(target.role) || target.role === 'bureau_lead'
  if (actor.role === 'bureau_lead') {
    return actor.division === target.division && (target.role === 'detective' || target.role === 'senior_detective')
  }
  return false
}

/** May `actor` restore a removed member (admin_restore_member)? Director or
 *  Owner only — restored members return inactive pending re-approval. */
export const canRestoreMember = (actor: RoleParty | null | undefined): boolean =>
  !!actor && !!actor.active && (actor.role === 'director' || !!actor.is_owner)

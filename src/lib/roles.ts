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

// ---------------------------------------------------------------------------
// The authoritative CID bureau model. Every screen, filter, dropdown, and
// label derives from these maps — never hardcode bureau ids or names in a
// component. The database mirror lives in private.bureau_label /
// private.bureau_prefix / private.case_number_base
// (20260825120000_bureau_restructure.sql); keep the two in lockstep.
//
//   Criminal Investigations Division
//   ├── Major Crimes Bureau            (major_crimes,           MCB)
//   ├── Street Crimes Bureau           (street_crimes,          SCB)
//   └── Special Investigations Bureau  (special_investigations, SIB)
//
// JTF is not a bureau: it is the temporary joint-case designation (and the
// pre-approval profile default). SIB is a real bureau but is never a normal
// assignment target — its membership, cases, and legal path run through the
// compartmented siu_* systems (internal plumbing identifiers keep the
// historical `siu` spelling; every user-facing surface says SIB).
// ---------------------------------------------------------------------------

export const BUREAUS: Record<string, string> = {
  major_crimes: 'Major Crimes Bureau',
  street_crimes: 'Street Crimes Bureau',
  special_investigations: 'Special Investigations Bureau',
  JTF: 'Joint Task Force',
}

/** Short code per bureau — chips, badges, table columns, compact UI. */
export const BUREAU_SHORT: Record<string, string> = {
  major_crimes: 'MCB',
  street_crimes: 'SCB',
  special_investigations: 'SIB',
  JTF: 'JTF',
}

/** Case-number prefix per bureau (mirror of private.bureau_prefix). Legacy
 *  identifiers minted before the restructure (LSB-/BCB-/SAB-/SIU-) are
 *  preserved data, never a live vocabulary. */
export const CASE_PREFIX: Record<string, string> = {
  major_crimes: 'MCB',
  street_crimes: 'SCB',
  special_investigations: 'SIB',
  JTF: 'JTF',
}

export const roleLabel = (r?: string | null) => (r && ROLE_LABEL[r]) || r || '—'
export const bureauLabel = (b?: string | null) => (b && BUREAUS[b]) || b || '—'
/** Short-code label (MCB/SCB/SIB/JTF); falls back to the raw value for
 *  historical codes in frozen records. */
export const bureauShort = (b?: string | null) => (b && BUREAU_SHORT[b]) || b || '—'
export const isCommandRole = (r?: string | null) =>
  !!r && (COMMAND_ROLES as readonly string[]).includes(r)
/** Is this the compartmented Special Investigations Bureau? */
export const isSibBureau = (b?: string | null) => b === 'special_investigations'

// ---------------------------------------------------------------------------
// Unified role/department policy — the client mirror of the server matrix in
// private.can_assign_cid_role() (20260718010000_unified_role_policy.sql).
// UX filtering only; RLS/RPCs remain the authority. Keep the two in lockstep.
// ---------------------------------------------------------------------------

/** Permanent CID departments — the normal assignment targets. JTF is
 *  deliberately absent (temporary joint-case designation, pre-approval
 *  default) and so is special_investigations: SIB membership is appointed
 *  through the SIB workflow (siu_appoint), never a division dropdown — the
 *  server rejects both in every assignment path. */
export const PERMANENT_BUREAUS = ['major_crimes', 'street_crimes'] as const

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
 *  Single-step since 20260807040000: an authorized initiation applies the move
 *  immediately — no approval stage, and the source bureau has no veto. A
 *  Bureau Lead may only initiate for rank-and-file members when one side is
 *  their own bureau; DD+ and Owner may initiate any move between departments,
 *  JTF included. Never yourself. */
export const canTransfer = (
  actor: RoleParty | null | undefined, target: RoleParty, source: string, destination: string,
): boolean => {
  if (!actor || !actor.active || actor.id === target.id) return false
  // Any department may be either side of a move, JTF included — the pair just
  // has to be two real, different departments. SIB is never a transfer side:
  // its membership moves only through the SIB appointment workflow.
  if (!(source in BUREAUS) || !(destination in BUREAUS) || source === destination) return false
  if (isSibBureau(source) || isSibBureau(destination)) return false
  if (actor.is_owner || actor.role === 'deputy_director' || actor.role === 'director') return true
  if (actor.role !== 'bureau_lead') return false
  if (isCommandRole(target.role)) return false
  return actor.division === source || actor.division === destination
}

/** May `actor` decide (approve/reject) the given SIDE of a pending transfer?
 *  Bureau Lead of that bureau, or Deputy Director or higher, or Owner.
 *  Legacy: transfers are single-step since 20260807040000, so this only
 *  serves pre-existing open rows — nothing creates pending rows anymore. */
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

import type { Database } from './database.types'

export type AppRole = Database['public']['Enums']['app_role']
export type Bureau = Database['public']['Enums']['bureau']

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
export const SUBMIT_ROLES = ['detective', 'senior_detective'] as const
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
/** Seniority rank; -1 for unknown/legacy roles — mirrors vanilla cidRoleRank. */
export const roleRank = (r?: string | null) =>
  (ROLE_ORDER as readonly string[]).indexOf(r ?? '')
export const isCommandRole = (r?: string | null) =>
  !!r && (COMMAND_ROLES as readonly string[]).includes(r)
export const isSubmitRole = (r?: string | null) =>
  !!r && (SUBMIT_ROLES as readonly string[]).includes(r)

/** True when the given profile is ACTIVE and holds a command role — mirrors
 *  vanilla cidMeIsCommand(), which requires BOTH m.active AND a command role.
 *  Client-side UX gate only; RLS is the authority. */
export const meIsCommand = (me?: { active?: boolean | null; role?: string | null } | null) =>
  !!(me && me.active && isCommandRole(me.role))

/** @deprecated role-only check kept for existing imports — prefer meIsCommand
 *  (active-aware) for anything that gates UI. */
export const isCommand = isCommandRole

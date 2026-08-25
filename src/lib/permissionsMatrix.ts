/** The portal access matrix — who can do what, by standing. Static
 *  documentation data (informational only; RLS and the definer RPCs are the
 *  authority). Shared home so the Command Center's Permissions section no
 *  longer reaches into the Owner Console's data module for it. */

export interface PermissionsMatrixRow {
  area: string
  owner: string
  command: string
  member: string
  inactive: string
}

export const PERMISSIONS_MATRIX: PermissionsMatrixRow[] = [
  { area: 'Work cases / registries (own bureau)', owner: '✓', command: '✓', member: '✓', inactive: '✗' },
  { area: 'Delete registry records (with Undo)', owner: '✓*', command: '✓', member: '✗', inactive: '✗' },
  { area: 'Archive / restore a case', owner: '✓*', command: '✓', member: '✗', inactive: '✗' },
  { area: 'Permanently delete an archived case', owner: '✓ (reason + preview required)', command: '✗', member: '✗', inactive: '✗' },
  { area: 'Approve members / assign roles', owner: '✓*', command: '✓', member: '✗', inactive: '✗' },
  { area: 'Post announcements', owner: '✓*', command: '✓', member: '✗', inactive: '✗' },
  { area: 'Submit feedback', owner: '✓', command: '✓', member: '✓', inactive: '✗' },
  { area: 'View ALL feedback + triage/catalog', owner: '✓', command: '✗', member: 'own only', inactive: '✗' },
  { area: 'Audit Log', owner: '✓', command: '✗', member: '✗', inactive: '✗' },
  { area: 'Developer Handbook (in-app)', owner: '✓', command: '✗', member: '✗', inactive: '✗' },
  { area: 'Owner Console', owner: '✓', command: '✗', member: '✗', inactive: '✗' },
  { area: 'Grant ownership (is_owner flag)', owner: 'SQL only', command: '✗', member: '✗', inactive: '✗' },
]

export const MATRIX_NOTE =
  '* Owner rights on division data come from the owner account ALSO holding a command role — ownership itself only grants the owner-only areas. Enforcement: profiles.is_owner → private.is_owner() in RLS (audit_log, feedback, feedback_meta) + useAuth().isOwner in the UI. The guard_profile trigger makes is_owner immutable from every client — granting it is a SQL/dashboard operation.'

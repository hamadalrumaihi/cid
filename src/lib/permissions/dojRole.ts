'use client'

/** The signed-in viewer's EFFECTIVE justice role — server-resolved by
 *  `my_permissions().doj_role` (private.justice_role_effective over an
 *  active, unexpired membership). Formerly its own justice_memberships read
 *  in legalShared and capabilities; there is now one source. */
import type { DojRole } from './mirrors'
import { usePermissions } from './usePermissions'

export function useMyJusticeRole(): DojRole {
  return usePermissions().perms.doj_role
}

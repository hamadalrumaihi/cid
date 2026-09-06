/** The client permission module (plan §P4; P1-08 / P1-09).
 *
 *  Components import EVERY authorization question from here:
 *   · usePermissions()  — server-first: my_permissions() with NO_ACCESS
 *                         until it resolves (and on error), plus the global
 *                         matrix cell reader `can(action, kind)` and the
 *                         async per-record `canRecord()`.
 *   · useCapabilities() — the dashboard/nav capability model.
 *   · useSiu()          — the departmental (SIB) context.
 *   · useMyJusticeRole()— the effective DOJ role, from my_permissions().
 *   · mirrors / sibMirrors — the pure predicates (cosmetic gates only).
 *   · matrix            — the generated permission matrix.
 *
 *  Importing a predicate from roles.ts / siu.ts, or the old capabilities /
 *  useSiu paths, anywhere else is an ESLint error (eslint.config.mjs). RLS
 *  and the definer RPCs remain the authority for every read and write. */
export * from './mirrors'
export * from './sibMirrors'
export * from './matrix'
export { usePermissions, canRecord, matrixCan, matrixColumnFor, normalizePermissions, NO_ACCESS } from './usePermissions'
export type { AccessClass, Expiry, MyPermissions, PermissionsState } from './usePermissions'
export { useCapabilities, capsFrom } from './capabilities'
export type { Caps, CapsInput, CommandScope, DashboardId, SibCaps } from './capabilities'
export { useSiu } from './useSiu'
export type { SiuAccess } from './useSiu'
export { useMyJusticeRole } from './dojRole'

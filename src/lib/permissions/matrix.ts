/** The generated permission matrix (scripts/gen-permissions-matrix.mjs →
 *  src/lib/permissionsMatrix.ts) re-exported through the permission module,
 *  so components never import the generated file directly. */
export { PERMISSIONS_MATRIX, PERMISSION_CATALOG, MATRIX_NOTE } from '../permissionsMatrix'
export type { PermissionCatalogRow, PermissionMatrixCells, PermissionsMatrixRow } from '../permissionsMatrix'

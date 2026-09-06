import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Legacy vanilla app (main's live code, frozen on this branch during the
    // React rebuild — root-level classic scripts, not part of the Next.js app):
    "*.js",
    // Supabase edge functions are Deno code with their own conventions:
    "supabase/functions/**",
  ]),
  // P1-08 / P1-09: client authorization predicates live ONLY in
  // src/lib/permissions. Labels, bureau maps and fetch helpers stay
  // importable from roles.ts / siu.ts; the predicates (and the retired
  // capabilities / useSiu / permissionsMatrix paths) are not.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/permissions/**", "src/lib/siu.test.ts", "src/lib/roles.test.ts", "src/lib/roles.ts", "src/lib/siu.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          ...["@/lib/roles", "./roles", "../roles", "../lib/roles"].map((name) => ({
            name,
            importNames: [
              "COMMAND_ROLES", "isCommandRole", "canAssignCidRole", "canApproveRequestedRole", "canChangeRole",
              "getAssignableRoles", "canTransfer", "canDecideTransferSide", "canRemoveMember", "canRestoreMember",
            ],
            message: "Permission predicates are imported from @/lib/permissions (P1-08).",
          })),
          ...["@/lib/siu", "./siu", "../siu", "../lib/siu"].map((name) => ({
            name,
            importNames: [
              "siuStanding", "siuOperates", "maySwitchDepartment", "siuIsAgent", "siuIsCommand", "siuCanAppoint",
              "siuCanAppointRole", "siuCanRemove", "siuCaseAccess", "siuCaseReadOnly", "siuCanReadCid",
              "siuAssignableClassifications", "siuMayRequestAccess", "siuCanReviewReferrals", "siuCanResolveConflict",
              "isOversightStanding", "userDepartment",
            ],
            message: "SIB standing predicates are imported from @/lib/permissions (P1-08).",
          })),
          { name: "@/lib/capabilities", message: "Moved to @/lib/permissions (P1-08)." },
          { name: "@/lib/useSiu", message: "Moved to @/lib/permissions (P1-08)." },
          { name: "@/lib/permissionsMatrix", message: "Import the matrix from @/lib/permissions (P1-08)." },
        ],
      }],
    },
  },
]);

export default eslintConfig;

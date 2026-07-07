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
]);

export default eslintConfig;

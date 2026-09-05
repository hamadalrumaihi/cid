/** Generates src/lib/permissionsMatrix.ts from the public.permission_catalog
 *  seed statements in supabase/migrations/*.sql, so the in-app permissions
 *  matrix and the database's own list cannot drift.
 *
 *  Run `npm run gen:permissions` after adding catalog rows in a migration —
 *  CI fails if the generated module differs from the committed one
 *  (`npm run gen:permissions -- --check`). Parser + renderer live in
 *  scripts/lib/permission-catalog.mjs (unit-tested). */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseCatalog, renderModule } from './lib/permission-catalog.mjs'

const MIGRATIONS_DIR = 'supabase/migrations'
const OUT = 'src/lib/permissionsMatrix.ts'
const check = process.argv.includes('--check')

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }))
  .filter((f) => /permission_catalog/i.test(f.sql))

const rows = parseCatalog(files)
if (rows.length === 0) { console.error('gen-permissions-matrix: no permission_catalog seed found'); process.exit(1) }
const next = renderModule(rows)

let current = ''
try { current = readFileSync(OUT, 'utf8') } catch { /* first generation */ }

if (check) {
  if (current !== next) {
    console.error(`${OUT} is stale — run: npm run gen:permissions`)
    process.exit(1)
  }
  console.log(`permissions matrix OK: ${rows.length} catalog rows, module up to date`)
} else {
  writeFileSync(OUT, next)
  console.log(`wrote ${OUT}: ${rows.length} catalog rows from ${files.length} migration file(s)`)
}

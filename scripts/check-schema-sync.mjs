/** Offline drift check between the two repo artifacts that mirror the live
 *  schema: supabase/schema-snapshot.sql (generated reference dump) and
 *  src/lib/database.types.ts (the TypeScript mirror). Catches the classic
 *  failure "migrated live + updated one artifact + forgot the other" without
 *  needing database credentials, so it can run in CI on every PR.
 *
 *  Scope: public-schema tables and their column NAMES (types don't encode
 *  enough to compare SQL types reliably). Exit 1 with a report on any gap. */
import { readFileSync } from 'node:fs'

const snapshot = readFileSync('supabase/schema-snapshot.sql', 'utf8')
const types = readFileSync('src/lib/database.types.ts', 'utf8')

/* ---- tables + columns from the snapshot ---- */
const snapTables = new Map()
const tableRe = /^create table public\."?([a-z0-9_]+)"? \(\n([\s\S]*?)\n\);$/gm
for (const m of snapshot.matchAll(tableRe)) {
  const cols = m[2]
    .split('\n')
    .map((l) => /^ {2}"?([a-z0-9_]+)"? /.exec(l)?.[1])
    .filter(Boolean)
  snapTables.set(m[1], new Set(cols))
}

/* ---- tables + Row columns from database.types.ts ---- */
const typeTables = new Map()
{
  const tablesStart = types.indexOf('Tables: {')
  const src = types.slice(tablesStart)
  // Each table: "      name: {\n        Row: { ... }\n        Insert: ..."
  const tblRe = /\n {6}([a-z0-9_]+): \{\n {8}Row: \{([\s\S]*?)\n {8}\}/g
  for (const m of src.matchAll(tblRe)) {
    const cols = m[2]
      .split('\n')
      .map((l) => /^ {10}([a-z0-9_]+)\??:/.exec(l)?.[1])
      .filter(Boolean)
    typeTables.set(m[1], new Set(cols))
  }
}

if (snapTables.size < 40 || typeTables.size < 40) {
  console.error(`parse failure: snapshot=${snapTables.size} tables, types=${typeTables.size} tables — did a format change break the regexes?`)
  process.exit(1)
}

const problems = []
for (const [t, cols] of snapTables) {
  const tCols = typeTables.get(t)
  if (!tCols) { problems.push(`table ${t} is in the snapshot but missing from database.types.ts`); continue }
  for (const c of cols) if (!tCols.has(c)) problems.push(`${t}.${c} is in the snapshot but missing from database.types.ts`)
  for (const c of tCols) if (!cols.has(c)) problems.push(`${t}.${c} is in database.types.ts but missing from the snapshot`)
}
for (const t of typeTables.keys()) {
  if (!snapTables.has(t)) problems.push(`table ${t} is in database.types.ts but missing from the snapshot`)
}

if (problems.length) {
  console.error(`schema-sync check FAILED (${problems.length} gaps):`)
  for (const p of problems) console.error('  - ' + p)
  console.error('\nFix: regenerate supabase/schema-snapshot.sql from the live catalogs and/or update src/lib/database.types.ts (see supabase/README.md).')
  process.exit(1)
}
console.log(`schema-sync OK: ${snapTables.size} tables, columns match in both directions`)

/** Realtime-publication gate — catches "migration added (or dropped) a table
 *  in supabase_realtime but supabase/schema-snapshot.sql was not regenerated".
 *
 *  Offline and deterministic: every `alter publication supabase_realtime add
 *  table public.X` in supabase/migrations/*.sql must name a table listed in
 *  the snapshot's "Realtime publication members" block, unless a LATER
 *  migration drops it from the publication. The platform loop that adds the
 *  original tables dynamically (20260616090000_platform.sql `rt_tables`) is
 *  parsed too. Run: npm run check:realtime */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const MIGRATIONS_DIR = 'supabase/migrations'
const SNAPSHOT = 'supabase/schema-snapshot.sql'

const snapshot = readFileSync(SNAPSHOT, 'utf8')
const titleAt = snapshot.indexOf('-- Realtime publication members (supabase_realtime)')
if (titleAt < 0) { console.error('check-realtime: publication block not found in the snapshot'); process.exit(1) }
// The title is followed by a rule line; the block runs from there to the next rule.
const blockStart = snapshot.indexOf('\n', snapshot.indexOf('-- ====', titleAt)) + 1
const blockEnd = snapshot.indexOf('-- ====', blockStart)
const block = snapshot.slice(blockStart, blockEnd < 0 ? undefined : blockEnd)
const published = new Set([...block.matchAll(/^--\s+public\.([a-z0-9_]+)\s*$/gm)].map((m) => m[1]))

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && statSync(path.join(MIGRATIONS_DIR, f)).isFile())
  .sort()

const expected = new Map() // table -> last migration that touched it
const dropped = new Set()
for (const f of files) {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
    .replace(/--[^\n]*/g, '')
    .toLowerCase()
  for (const m of sql.matchAll(/alter\s+publication\s+supabase_realtime\s+add\s+table\s+(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    if (m[1] === 'public') continue // a format('… add table public.%I') template, handled by the loop parser below
    expected.set(m[1], f); dropped.delete(m[1])
  }
  // A table dropped outright leaves the publication with it.
  for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    dropped.add(m[1]); expected.delete(m[1])
  }
  for (const m of sql.matchAll(/alter\s+publication\s+supabase_realtime\s+drop\s+table\s+(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    dropped.add(m[1]); expected.delete(m[1])
  }
  // The platform migration adds its tables through a loop over an array literal.
  const loop = /rt_tables\s*text\[\]\s*:=\s*array\[([^\]]+)\]/.exec(sql)
  if (loop) for (const m of loop[1].matchAll(/'([a-z0-9_]+)'/g)) { expected.set(m[1], f); dropped.delete(m[1]) }
}

const problems = []
for (const [t, f] of expected) {
  if (!published.has(t)) problems.push(`${t} is added to the publication by ${f} but is not in the snapshot block`)
}
if (published.size < 20) problems.push(`parse failure: only ${published.size} published tables found in the snapshot`)

if (problems.length) {
  console.error(`realtime check FAILED (${problems.length}):`)
  for (const p of problems) console.error('  - ' + p)
  console.error('\nFix: regenerate the snapshot (scripts/schema-dump.sql -> scripts/build-schema-snapshot.mjs).')
  process.exit(1)
}
console.log(`realtime OK: ${published.size} tables in the snapshot publication block; ${expected.size} migration-declared tables all present`)

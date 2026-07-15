/** Snapshot-freshness gate (P3-5) — catches "migration added but
 *  supabase/schema-snapshot.sql untouched".
 *
 *  How snapshot maintenance works in this repo: schema-snapshot.sql is a
 *  generated reference dump ("-- Generated ..." header) that is maintained
 *  inline after each migration — the OBJECTS a migration creates are added to
 *  the snapshot, but the migration filename itself is usually not mentioned.
 *  So a filename/timestamp comparison is impossible in a plain CI checkout
 *  (no reliable mtimes) and a "stem appears in snapshot" check would be
 *  wrong. Instead this is content-based and fully offline:
 *
 *    for every supabase/migrations/*.sql (archive/ excluded), parse the
 *    names of objects it CREATEs (function / table / trigger / policy /
 *    index / type / view) and require at least ONE of them to appear in
 *    schema-snapshot.sql.
 *
 *  Refinements that keep it honest without false alarms:
 *    - drop-awareness: a name dropped by a LATER migration is not expected
 *      in the snapshot (the snapshot mirrors the live end-state);
 *    - migrations that create nothing (pure ALTER / GRANT / data fixes) have
 *      nothing assertable and pass with a note;
 *    - deliberate omissions live in EXCEPTIONS below, each with a reason.
 *
 *  Deterministic, no network, no database. Run: npm run check:freshness */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const MIGRATIONS_DIR = 'supabase/migrations'
const SNAPSHOT = 'supabase/schema-snapshot.sql'

/** Migrations whose created objects are deliberately NOT in the snapshot.
 *  Add entries only with a reason — this list is part of the gate's audit
 *  trail. Filename -> why the snapshot legitimately omits it. */
const EXCEPTIONS = new Map([
  // Pre-existing drift found when this gate was introduced (2026-07-15):
  // these owner-only maintenance RPCs are live and documented in
  // supabase/README.md, but were never mirrored into schema-snapshot.sql.
  // They are BASELINE DEBT, not approved omissions — remove each entry when
  // the snapshot is next regenerated from the live catalogs.
  ['20260716020000_legal_import_provenance.sql', 'import_legal_warrant/import_rollback_by_key not yet in snapshot — remove on next snapshot regen'],
  ['20260716030000_owner_maintenance_gate.sql', 'is_owner_maintenance gate not yet in snapshot — remove on next snapshot regen'],
  ['20260719030000_org_correction.sql', 'correct_membership_organization not yet in snapshot — remove on next snapshot regen'],
  ['20260719040000_owner_justice_grant.sql', 'owner_grant_justice_membership not yet in snapshot — remove on next snapshot regen'],
])

const snapshot = readFileSync(SNAPSHOT, 'utf8').toLowerCase()

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && statSync(path.join(MIGRATIONS_DIR, f)).isFile())
  .sort() // timestamp-prefixed names sort chronologically

/** Extract created / dropped object names from one migration's SQL. */
function parseObjects(sql) {
  const src = sql
    .replace(/--[^\n]*/g, '') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .toLowerCase()
  const created = new Set()
  const dropped = new Set()
  const name = (raw) => raw.replace(/"/g, '').split('.').pop()
  const collect = (set, re, group = 1) => {
    for (const m of src.matchAll(re)) set.add(name(m[group]))
  }
  collect(created, /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)\s*\(/g)
  collect(created, /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/g)
  collect(created, /create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+([a-z0-9_."]+)/g)
  collect(created, /create\s+policy\s+"([^"]+)"/g)
  collect(created, /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/g)
  collect(created, /create\s+type\s+([a-z0-9_."]+)/g)
  collect(created, /create\s+(?:or\s+replace\s+)?view\s+([a-z0-9_."]+)/g)
  collect(dropped, /drop\s+function\s+(?:if\s+exists\s+)?([a-z0-9_."]+)/g)
  collect(dropped, /drop\s+table\s+(?:if\s+exists\s+)?([a-z0-9_."]+)/g)
  collect(dropped, /drop\s+trigger\s+(?:if\s+exists\s+)?([a-z0-9_."]+)/g)
  collect(dropped, /drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"/g)
  collect(dropped, /drop\s+index\s+(?:if\s+exists\s+)?([a-z0-9_."]+)/g)
  collect(dropped, /drop\s+type\s+(?:if\s+exists\s+)?([a-z0-9_."]+)/g)
  collect(dropped, /drop\s+view\s+(?:if\s+exists\s+)?([a-z0-9_."]+)/g)
  return { created, dropped }
}

const parsed = files.map((f) => ({
  file: f,
  ...parseObjects(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')),
}))

// Drop-awareness: names dropped by any migration STRICTLY AFTER index i are
// not expected in the snapshot when checking migration i. (A migration that
// drops-and-recreates its own object still expects it.)
const failures = []
let unassertable = 0
parsed.forEach(({ file, created }, i) => {
  if (EXCEPTIONS.has(file)) return
  const droppedLater = new Set()
  for (let j = i + 1; j < parsed.length; j++) for (const d of parsed[j].dropped) droppedLater.add(d)
  const expected = [...created].filter((n) => !droppedLater.has(n))
  if (expected.length === 0) {
    unassertable++
    return // pure ALTER/GRANT/data migration (or everything it made was later dropped)
  }
  if (!expected.some((n) => snapshot.includes(n))) {
    failures.push({ file, expected })
  }
})

if (failures.length) {
  console.error(`snapshot-freshness FAILED — ${failures.length} migration(s) have no trace in ${SNAPSHOT}:`)
  for (const { file, expected } of failures) {
    console.error(`  - ${file}: none of [${expected.join(', ')}] appear in the snapshot`)
  }
  console.error('\nFix: mirror the migration into supabase/schema-snapshot.sql (regenerate from the')
  console.error('live catalogs or maintain it inline — see supabase/README.md), or add the file to')
  console.error('EXCEPTIONS in scripts/check-snapshot-freshness.mjs with a reason.')
  process.exit(1)
}
console.log(
  `snapshot-freshness OK: ${files.length} migrations — ${files.length - unassertable - EXCEPTIONS.size} verified in the snapshot, ` +
  `${unassertable} with nothing assertable (pure ALTER/GRANT/data), ${EXCEPTIONS.size} documented exceptions`,
)

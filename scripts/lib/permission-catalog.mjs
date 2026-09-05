/** permission_catalog seed parser + renderer — shared by
 *  scripts/gen-permissions-matrix.mjs (CLI) and its vitest suite
 *  (src/lib/permissionsMatrix.test.ts).
 *
 *  The database table public.permission_catalog is the single source of the
 *  permission list (migration 20261005120000_permission_module.sql). CI has
 *  no database, so the generator reads the SAME rows from the migration
 *  files: every
 *      insert into public.permission_catalog (<columns>) values
 *        (<tuple>), (<tuple>) …
 *  block, in filename order, with later files overriding earlier rows by
 *  (action, kind), and `delete from public.permission_catalog where action =
 *  '<a>' and kind = '<k>'` removing a row. Tuples are parsed with a small
 *  SQL-literal tokenizer (quoted strings with '' escapes, numbers, NULL,
 *  optional ::casts), so a row may span lines and contain commas. */

const INSERT_RE = /insert\s+into\s+public\.permission_catalog\s*\(([^)]*)\)\s*values/gi
const DELETE_RE = /delete\s+from\s+public\.permission_catalog\s+where\s+action\s*=\s*'([^']*)'\s+and\s+kind\s*=\s*'([^']*)'/gi

/** Strip `-- …` line comments outside string literals. */
function stripComments(sql) {
  let out = ''
  let inStr = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (inStr) {
      out += ch
      if (ch === "'") { if (sql[i + 1] === "'") { out += "'"; i++ } else inStr = false }
      continue
    }
    if (ch === "'") { inStr = true; out += ch; continue }
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      if (nl < 0) break
      i = nl - 1
      continue
    }
    out += ch
  }
  return out
}

/** Read one literal starting at `pos`; returns { value, end }. */
function readLiteral(sql, pos) {
  let i = pos
  while (/\s/.test(sql[i])) i++
  if (sql[i] === "'") {
    let s = ''
    i++
    for (;;) {
      if (i >= sql.length) throw new Error('unterminated string literal in permission_catalog seed')
      if (sql[i] === "'") { if (sql[i + 1] === "'") { s += "'"; i += 2; continue } i++; break }
      s += sql[i++]
    }
    // optional ::type cast
    const cast = /^\s*::\s*[a-z_]+/i.exec(sql.slice(i))
    if (cast) i += cast[0].length
    return { value: s, end: i }
  }
  const m = /^(null|-?\d+(?:\.\d+)?|true|false)\b/i.exec(sql.slice(i))
  if (!m) throw new Error(`unexpected token in permission_catalog seed near: ${sql.slice(i, i + 40)}`)
  const raw = m[1].toLowerCase()
  const value = raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : Number(raw)
  return { value, end: i + m[0].length }
}

/** Parse the tuples of one VALUES list starting right after `values`. */
function readTuples(sql, pos) {
  const tuples = []
  let i = pos
  for (;;) {
    while (/\s/.test(sql[i])) i++
    if (sql[i] !== '(') break
    i++
    const fields = []
    for (;;) {
      const lit = readLiteral(sql, i)
      fields.push(lit.value)
      i = lit.end
      while (/\s/.test(sql[i])) i++
      if (sql[i] === ',') { i++; continue }
      if (sql[i] === ')') { i++; break }
      throw new Error(`expected , or ) in permission_catalog seed near: ${sql.slice(i, i + 40)}`)
    }
    tuples.push(fields)
    while (/\s/.test(sql[i])) i++
    if (sql[i] === ',') { i++; continue }
    break
  }
  return tuples
}

/** Apply every seed statement in `sql` (one migration file) onto `rows`
 *  (Map keyed `${action}/${kind}`). */
export function applySeed(rows, sql, source = '<sql>') {
  const clean = stripComments(sql)
  INSERT_RE.lastIndex = 0
  let m
  while ((m = INSERT_RE.exec(clean))) {
    const cols = m[1].split(',').map((c) => c.trim().toLowerCase())
    for (const tuple of readTuples(clean, m.index + m[0].length)) {
      if (tuple.length !== cols.length) throw new Error(`${source}: tuple has ${tuple.length} values for ${cols.length} columns`)
      const row = {}
      cols.forEach((c, i) => { row[c] = tuple[i] })
      if (typeof row.matrix === 'string') row.matrix = JSON.parse(row.matrix)
      if (!row.action || !row.kind) throw new Error(`${source}: seed row without action/kind`)
      rows.set(`${row.action}/${row.kind}`, { ...row, source })
    }
  }
  DELETE_RE.lastIndex = 0
  while ((m = DELETE_RE.exec(clean))) rows.delete(`${m[1]}/${m[2]}`)
  return rows
}

/** Parse an ordered list of { name, sql } migration files into sorted rows. */
export function parseCatalog(files) {
  const rows = new Map()
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) applySeed(rows, f.sql, f.name)
  return [...rows.values()].sort((a, b) =>
    (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.action.localeCompare(b.action) || a.kind.localeCompare(b.kind))
}

export const MATRIX_NOTE =
  '* Owner rights on division data come from the owner account ALSO holding a command role — ownership itself only grants the owner-only areas. Enforcement: profiles.is_owner → private.is_owner() in RLS (audit_log, feedback, feedback_meta) + useAuth().isOwner in the UI. The guard_profile trigger makes is_owner immutable from every client — granting it is a SQL/dashboard operation.'

const q = (s) => JSON.stringify(s ?? null)

/** Render src/lib/permissionsMatrix.ts from parsed rows. */
export function renderModule(rows) {
  const lines = []
  lines.push('/** GENERATED by scripts/gen-permissions-matrix.mjs — do not edit.')
  lines.push(' *')
  lines.push(' *  Source: the public.permission_catalog seed in supabase/migrations')
  lines.push(' *  (20261005120000_permission_module.sql and later). The database table is')
  lines.push(' *  the authority for WHAT may be asked of can_record(); RLS and the definer')
  lines.push(' *  RPCs named in `enforcingObject` are the authority for the ANSWER. This')
  lines.push(' *  module is documentation data for the Command Center matrix and the')
  lines.push(' *  handbook — never a gate. Regenerate: npm run gen:permissions. */')
  lines.push('')
  lines.push('export interface PermissionMatrixCells {')
  lines.push('  owner: string')
  lines.push('  command: string')
  lines.push('  member: string')
  lines.push('  inactive: string')
  lines.push('}')
  lines.push('')
  lines.push('export interface PermissionCatalogRow {')
  lines.push('  /** can_record() action, e.g. `edit`; role-level rows use kind `*`. */')
  lines.push('  action: string')
  lines.push('  kind: string')
  lines.push('  area: string')
  lines.push('  rule: string')
  lines.push('  enforcingObject: string')
  lines.push('  testId: string | null')
  lines.push('  matrix: PermissionMatrixCells')
  lines.push('  sortOrder: number')
  lines.push('}')
  lines.push('')
  lines.push('export const PERMISSION_CATALOG: PermissionCatalogRow[] = [')
  for (const r of rows) {
    const mx = r.matrix ?? {}
    lines.push(`  { action: ${q(r.action)}, kind: ${q(r.kind)}, area: ${q(r.area)}, rule: ${q(r.rule)}, enforcingObject: ${q(r.enforcing_object)}, testId: ${q(r.test_id)}, matrix: { owner: ${q(mx.owner ?? '')}, command: ${q(mx.command ?? '')}, member: ${q(mx.member ?? '')}, inactive: ${q(mx.inactive ?? '')} }, sortOrder: ${Number(r.sort_order ?? 100)} },`)
  }
  lines.push(']')
  lines.push('')
  lines.push('/** The Command Center / Owner Console table shape (one row per catalog entry). */')
  lines.push('export interface PermissionsMatrixRow extends PermissionMatrixCells {')
  lines.push('  /** Stable key: `${action}/${kind}`. */')
  lines.push('  key: string')
  lines.push('  area: string')
  lines.push('  kind: string')
  lines.push('}')
  lines.push('')
  lines.push('export const PERMISSIONS_MATRIX: PermissionsMatrixRow[] = PERMISSION_CATALOG.map((r) => ({')
  lines.push('  key: `${r.action}/${r.kind}`, area: r.area, kind: r.kind, ...r.matrix,')
  lines.push('}))')
  lines.push('')
  lines.push(`export const MATRIX_NOTE =\n  ${q(MATRIX_NOTE)}`)
  lines.push('')
  return lines.join('\n')
}

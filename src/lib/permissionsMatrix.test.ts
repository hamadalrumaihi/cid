/** The permissions-matrix generator (scripts/gen-permissions-matrix.mjs) —
 *  parser and renderer pinned offline, plus the committed module's contract.
 *
 *  Why a test for a doc generator: PERMISSION_CATALOG is the one list both
 *  the Command Center matrix and the handbook read, and it is derived from
 *  SQL seed statements. A parser that silently dropped a row (a quote, a
 *  comma in a rule, a JSON cell) would make the documented matrix lie about
 *  what can_record() accepts. */
import { describe, expect, it } from 'vitest'
import { applySeed, parseCatalog, renderModule } from '../../scripts/lib/permission-catalog.mjs'
import { PERMISSION_CATALOG, PERMISSIONS_MATRIX, MATRIX_NOTE } from './permissionsMatrix'

const SEED = `
-- header comment with a 'quote' and insert into public.permission_catalog (nothing) values (ignored)
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('read', 'case', 'Read a case', 'Case access, or the SIB read superset.', 'private.can_read_case', 'v180', '{"owner":"all","command":"bureau / global","member":"case access","inactive":"✗"}', 200),
  ('approve', 'legal', 'Decide the CID gate', 'The bureau''s Lead (JTF: any Lead), with a comma, and (parentheses).', 'private.can_approve_legal', null, '{"owner":"fallback","command":"✓","member":"✗","inactive":"✗"}'::jsonb, 420),
  ('work', '*', 'Work cases', 'Any active member.', 'private.is_active', 'rls', -- trailing comment
   '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 10)
on conflict (action, kind) do update set area = excluded.area;
`

describe('permission_catalog seed parser', () => {
  it('reads every tuple, unescapes quotes, parses JSON cells and casts', () => {
    const rows = parseCatalog([{ name: '20261005120000_permission_module.sql', sql: SEED }])
    expect(rows.map((r) => `${r.action}/${r.kind}`)).toEqual(['work/*', 'read/case', 'approve/legal']) // sorted by sort_order
    const approve = rows.find((r) => r.action === 'approve')!
    expect(approve.rule).toBe("The bureau's Lead (JTF: any Lead), with a comma, and (parentheses).")
    expect(approve.test_id).toBeNull()
    expect(approve.matrix).toEqual({ owner: 'fallback', command: '✓', member: '✗', inactive: '✗' })
    expect(rows.find((r) => r.action === 'work')!.matrix.member).toBe('✓')
  })

  it('later migrations override by (action, kind) and can delete a row', () => {
    const later = `
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('read', 'case', 'Read a case (v2)', 'Rule v2.', 'private.can_read_case', 'v181', '{"owner":"all","command":"all","member":"case access","inactive":"✗"}', 200)
on conflict (action, kind) do update set area = excluded.area;
delete from public.permission_catalog where action = 'work' and kind = '*';
`
    const rows = parseCatalog([
      { name: '20261006000000_later.sql', sql: later },
      { name: '20261005120000_permission_module.sql', sql: SEED }, // order given does not matter
    ])
    expect(rows.map((r) => `${r.action}/${r.kind}`)).toEqual(['read/case', 'approve/legal'])
    expect(rows[0].area).toBe('Read a case (v2)')
    expect(rows[0].source).toBe('20261006000000_later.sql')
  })

  it('rejects a tuple whose arity does not match the column list', () => {
    const bad = `insert into public.permission_catalog (action, kind, area) values ('a', 'b');`
    expect(() => applySeed(new Map(), bad, 'bad.sql')).toThrow(/2 values for 3 columns/)
  })

  it('renders a module that round-trips the rows', () => {
    const rows = parseCatalog([{ name: 'x.sql', sql: SEED }])
    const out = renderModule(rows)
    expect(out).toContain('export const PERMISSION_CATALOG: PermissionCatalogRow[] = [')
    expect(out).toContain('action: "approve", kind: "legal"')
    expect(out).toContain("The bureau's Lead")
    expect(out.split('\n').filter((l) => l.startsWith('  { action:'))).toHaveLength(3)
  })
})

describe('generated src/lib/permissionsMatrix.ts', () => {
  it('is keyed uniquely and carries every role-level row the matrix used to list', () => {
    const keys = PERMISSIONS_MATRIX.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    const roleLevel = PERMISSION_CATALOG.filter((r) => r.kind === '*').map((r) => r.action)
    for (const a of ['work', 'delete', 'archive', 'permanent_delete', 'assign_role', 'announce', 'feedback_submit', 'feedback_triage', 'audit_read', 'handbook', 'owner_console', 'grant_ownership']) {
      expect(roleLevel).toContain(a)
    }
    // Every can_record() kind dispatched by private.perm_dispatch is documented.
    const kinds = new Set(PERMISSION_CATALOG.map((r) => r.kind))
    for (const k of ['case', 'report', 'evidence', 'legal', 'person', 'vehicle', 'gang', 'place', 'account']) expect(kinds.has(k)).toBe(true)
    expect(MATRIX_NOTE).toMatch(/is_owner/)
  })

  it('every row names its enforcing object and a non-empty rule', () => {
    for (const r of PERMISSION_CATALOG) {
      expect(r.enforcingObject.length, r.action).toBeGreaterThan(0)
      expect(r.rule.length, r.action).toBeGreaterThan(0)
      expect(Object.values(r.matrix).every((v) => v.length > 0), `${r.action}/${r.kind}`).toBe(true)
    }
  })
})

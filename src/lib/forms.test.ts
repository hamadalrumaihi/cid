/** Schema invariants for the fillable CID forms. The `person` flag routes a
 *  field through the Persons-registry picker (ReportsTab.PersonField) and
 *  captures a person_id next to the name — so it belongs on name fields
 *  only. P2-08 fixed the surveillance report's mixed "Name / Plate" column,
 *  which was flagged as a person field: a plate typed there would have been
 *  searched against persons and could have carried a person id. */
import { describe, expect, it } from 'vitest'
import { FORM_SCHEMAS } from './forms'

type Flagged = { schema: string; section: string; key: string; label: string }

/** Every person-flagged kv field / grid column across all schemas. */
function personFlagged(): Flagged[] {
  const out: Flagged[] = []
  for (const [id, schema] of Object.entries(FORM_SCHEMAS)) {
    for (const s of schema.sections) {
      if (s.type === 'kv') for (const f of s.fields) if (f.person) out.push({ schema: id, section: s.id, key: f.key, label: f.label })
      if (s.type === 'grid') for (const c of s.cols) if (c.person) out.push({ schema: id, section: s.id, key: c.key, label: c.label })
    }
  }
  return out
}

describe('FORM_SCHEMAS person flag', () => {
  it("surveillance_report 'Relevant Persons / Vehicles' name_or_plate is NOT a person field", () => {
    const section = FORM_SCHEMAS.surveillance_report.sections.find((s) => s.id === 'entities')
    expect(section?.type).toBe('grid')
    if (section?.type !== 'grid') return
    const col = section.cols.find((c) => c.key === 'name_or_plate')
    expect(col).toBeDefined()
    expect(col?.person).toBeUndefined()
    // The neighbouring detectives grid keeps its person column — the fix is
    // surgical, not a blanket removal.
    const detectives = FORM_SCHEMAS.surveillance_report.sections.find((s) => s.id === 'detectives')
    expect(detectives?.type === 'grid' && detectives.cols.find((c) => c.key === 'name')?.person).toBe(true)
  })

  it('no person-flagged field or column is a plate / vehicle field', () => {
    const flagged = personFlagged()
    expect(flagged.length).toBeGreaterThan(0)
    for (const f of flagged) {
      expect(`${f.key} ${f.label}`.toLowerCase(), `${f.schema}.${f.section}.${f.key}`).not.toMatch(/plate|vehicle/)
    }
  })
})

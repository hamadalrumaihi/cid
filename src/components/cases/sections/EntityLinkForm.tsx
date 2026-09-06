'use client'

/** The "link a record to this case" form for one entity section (P3-06).
 *  Picker: EntityPicker (entity_suggest — bounded, RLS-scoped, exact hits
 *  first) with already-linked ids excluded (UNIQUE case+kind+ref). Create
 *  new: persons keep the PersonModal route (CreateHost — duplicate notice
 *  and the SIB visibility choice intact); vehicles, gangs and places open
 *  EntityCreateSheet with the typed text prefilled. Either way the fresh
 *  record auto-links to the case — EXCEPT a person created SIB Only: the link
 *  row itself would be visible to the whole case team (case_intel_links
 *  reads under can_access_case), disclosing that a compartmented record
 *  exists — so the auto-link is skipped and the agent is told to link it
 *  from the SIB workspace when disclosure is intended (security review
 *  WARN-1, carried over from the old Intel & Notes tab). */
import { useEffect, useRef, useState } from 'react'
import { insert } from '@/lib/db'
import type { EntityHit } from '@/lib/entitySearch'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'
import { EntityCreateSheet } from '@/components/entity/EntityCreateSheet'
import { EntityPicker } from '@/components/entity/EntityPicker'
import { LinkedPersonPanel } from '@/components/shared/LinkedPersonPanel'
import { appendNoteLines } from '@/components/shared/personCompletion'
import { useCreate } from '@/components/shell/CreateHost'
import { ENTITY_SECTION, writeRefusal, type EntitySectionKind } from './sectionShared'

export function EntityLinkForm({ caseId, kind, linkedIds, onLinked }: {
  caseId: string
  kind: EntitySectionKind
  linkedIds: ReadonlySet<string>
  onLinked: () => void
}) {
  const create = useCreate()
  const meta = ENTITY_SECTION[kind]
  const [sel, setSel] = useState<EntityHit | null>(null)
  const [role, setRole] = useState('Subject')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [createQuery, setCreateQuery] = useState<string | null>(null)

  /** One insert path for both the picker selection and a just-created
   *  record — the same role/note semantics either way, read at call time. */
  const link = async (refId: string) => {
    if (busy) return
    setBusy(true)
    const res = await insert('case_intel_links', { case_id: caseId, kind, ref_id: refId, role: role.trim() || null, note: note.trim() || null })
    setBusy(false)
    if (res.error?.code === '23505') { toast('Already linked to this case.', 'warn'); return }
    const refusal = writeRefusal(res)
    if (refusal) { toast(refusal, 'danger'); return }
    setSel(null); setNote('')
    toast(`${meta.one[0]!.toUpperCase()}${meta.one.slice(1)} linked.`, 'success')
    onLinked()
  }
  // The create callbacks fire later — read the CURRENT link fn (role/note
  // typed meanwhile) through a ref.
  const linkRef = useRef(link)
  useEffect(() => { linkRef.current = link })

  const createPerson = (q: string) =>
    create.open('person', {
      prefillName: q,
      onCreated: (id, _name, opts) => {
        if (opts.siuOnly) {
          toast('Created SIB Only — not linked: a case link would reveal the record to the whole case team.', 'warn')
          return
        }
        void linkRef.current(id)
      },
    })

  return (
    <Card pad="sm" className="space-y-3">
      <h3 className="text-[13px] font-semibold text-white">Link a {meta.one} to this case</h3>
      <EntityPicker
        kind={kind}
        label={meta.one[0]!.toUpperCase() + meta.one.slice(1)}
        value={sel}
        onChange={setSel}
        exclude={linkedIds}
        onCreateNew={kind === 'person' ? createPerson : (q) => setCreateQuery(q)}
        createLabel={(q) => `New ${meta.one}: “${q}” — create & link`}
      />
      {kind === 'person' && sel && (
        <LinkedPersonPanel
          key={sel.id}
          personId={sel.id}
          personLabel={sel.label}
          onCaseOnly={(lines) => setNote((n) => appendNoteLines(n, lines))}
        />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Role in case">
          {(id) => <Input id={id} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Suspect, witness, stash…" />}
        </Field>
        <Field label="Link note (optional)">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this record matters here" />}
        </Field>
      </div>
      <Button variant="primary" onClick={() => { if (sel) void link(sel.id) }} disabled={busy || !sel}>
        {busy ? 'Linking…' : 'Link to case'}
      </Button>
      {kind !== 'person' && createQuery !== null && (
        <EntityCreateSheet
          kind={kind}
          open
          caseId={caseId}
          initial={{ [meta.createKey]: createQuery }}
          onClose={() => setCreateQuery(null)}
          onCreated={(hit) => { setCreateQuery(null); void linkRef.current(hit.id) }}
          onUseExisting={(hit) => { setCreateQuery(null); setSel(hit) }}
        />
      )}
    </Card>
  )
}

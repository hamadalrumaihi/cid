'use client'

/** Link a source to a record (`external_source_link`, audited). Registry
 *  kinds and cases go through the shared EntityPicker (RLS-scoped
 *  `entity_suggest`); evidence and reports are picked from the bound case's
 *  own media / report list (bounded, RLS-scoped). The server re-checks that
 *  the target is visible to the caller. A link is a pointer — it never
 *  copies anything from the page onto the record. */
import { useEffect, useState } from 'react'
import { list } from '@/lib/db'
import type { EntityHit } from '@/lib/entitySearch'
import { SOURCE_LINK_KIND_LABEL, linkSource, type SourceLinkKind, type SourceLinkRow, type SourceRow } from '@/lib/externalSources'
import { reportTitle } from '@/lib/forms'
import { toast } from '@/lib/toast'
import { EntityPicker } from '@/components/entity'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

type PickKind = 'case' | 'person' | 'vehicle' | 'gang' | 'place' | 'narcotic'
const PICK_KINDS: readonly SourceLinkKind[] = ['case', 'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'report']
const isPickKind = (k: SourceLinkKind): k is PickKind => k !== 'evidence' && k !== 'report' && k !== 'intel'

interface Option { id: string; label: string }

export function LinkSourceDialog({ open, onClose, source, existing, onLinked }: {
  open: boolean
  onClose: () => void
  source: SourceRow
  existing: readonly SourceLinkRow[]
  onLinked: () => void
}) {
  const [kind, setKind] = useState<SourceLinkKind>('case')
  const [hit, setHit] = useState<EntityHit | null>(null)
  const [kase, setKase] = useState<EntityHit | null>(null)
  const [options, setOptions] = useState<Option[] | null>(null)
  const [optionId, setOptionId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const caseId = source.case_id ?? kase?.id ?? null
  const linked = new Set(existing.filter((l) => l.kind === kind).map((l) => l.ref_id))

  // Evidence / reports of the bound case — a bounded list, never a registry.
  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => {
      if (kind !== 'evidence' && kind !== 'report') { setOptions(null); return }
      if (!caseId) { setOptions([]); return }
      setOptions(null)
      const load = kind === 'evidence'
        ? list('media', { select: 'id,title,evidence_number', eq: { case_id: caseId }, is: { archived_at: null }, limit: 200 })
          .then((rows) => (rows as unknown as { id: string; title: string | null; evidence_number: string | null }[])
            .map((r) => ({ id: r.id, label: [r.evidence_number, r.title].filter(Boolean).join(' · ') || 'Untitled media' })))
        : list('reports', { select: 'id,template,kind,seq', eq: { case_id: caseId }, limit: 200 })
          .then((rows) => (rows as unknown as { id: string; template: string | null; kind: string | null; seq: number | null }[])
            .map((r) => ({ id: r.id, label: reportTitle(r) })))
      load.then((opts) => { if (live) setOptions(opts) })
        .catch(() => { if (live) { setOptions([]); toast('Could not load the case list.', 'danger') } })
    }, 0)
    return () => { live = false; window.clearTimeout(t) }
  }, [kind, caseId])

  const refId = isPickKind(kind) ? hit?.id ?? null : optionId || null
  const canSubmit = !!refId && !busy

  const submit = async () => {
    if (!refId) return
    setBusy(true)
    const res = await linkSource(source.id, kind, refId, note)
    setBusy(false)
    if (!res.ok) { toast(res.code === '23505' ? 'Already linked to that record.' : res.message, 'danger'); return }
    toast('Source linked.', 'success')
    setHit(null); setOptionId(''); setNote('')
    onLinked()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => !!note.trim() || !!hit || !!optionId}>
      <form className="p-6" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <ModalHeader title={`Link ${source.source_number} to a record`} onClose={onClose} />
        <div className="space-y-3">
          <Field label="Record type">
            {(id) => (
              <Select id={id} name="kind" value={kind} onChange={(e) => { setKind(e.target.value as SourceLinkKind); setHit(null); setOptionId('') }}>
                {PICK_KINDS.map((k) => <option key={k} value={k}>{SOURCE_LINK_KIND_LABEL[k]}</option>)}
              </Select>
            )}
          </Field>

          {isPickKind(kind) ? (
            <EntityPicker
              key={kind}
              kind={kind}
              label={SOURCE_LINK_KIND_LABEL[kind]}
              value={hit}
              onChange={setHit}
              exclude={linked}
              placeholder={`Search ${SOURCE_LINK_KIND_LABEL[kind].toLowerCase()}s…`}
            />
          ) : (
            <>
              {!source.case_id && (
                <EntityPicker kind="case" label="Case" value={kase} onChange={(h) => { setKase(h); setOptionId('') }}
                  hint={`${SOURCE_LINK_KIND_LABEL[kind]} is picked from a case's own list.`} placeholder="Search cases by number or title…" />
              )}
              <Field label={SOURCE_LINK_KIND_LABEL[kind]}
                hint={!caseId ? 'Pick a case first.' : options && options.length === 0 ? `No ${kind === 'evidence' ? 'media' : 'reports'} you can see on that case.` : undefined}>
                {(id) => (
                  <Select id={id} name="ref" value={optionId} onChange={(e) => setOptionId(e.target.value)} disabled={!caseId || !options || options.length === 0}>
                    <option value="">{options === null && caseId ? 'Loading…' : 'Choose…'}</option>
                    {(options ?? []).filter((o) => !linked.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </Select>
                )}
              </Field>
            </>
          )}

          <Field label="Link note (optional)">
            {(id) => <Input id={id} name="note" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this page matters to the record…" />}
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSubmit}>Link source</Button>
        </div>
      </form>
    </Modal>
  )
}

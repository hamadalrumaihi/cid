'use client'

/** Declaring what a document relates to.
 *
 *  The relations table, its RLS and the reader's "Related" panel all shipped
 *  with document governance. What never shipped was any way to CREATE a
 *  relation, which is why the table holds zero rows and why documents in this
 *  portal have felt like isolated files. This is that missing half.
 *
 *  Two kinds of link, and the second is the interesting one:
 *   • to another DOCUMENT — this policy supersedes that one, this checklist
 *     belongs to that SOP.
 *   • to a ROUTE — a place in the portal where the document actually applies.
 *     That is what makes contextual help work without any screen maintaining a
 *     list of "relevant policies": the document claims its own relevance, and
 *     the evidence page simply asks who claimed it.
 *
 *  Only somebody who may edit the owning document sees this, and the database
 *  re-decides on write (doc_rel_ins). The control is not the authority.
 */

import { useCallback, useEffect, useState } from 'react'
import { list } from '@/lib/db'
import { toast } from '@/lib/toast'
import {
  DOC_ROUTES, RELATIONS, RELATION_LABEL, RELATION_MEANING,
  linkDocument, linkRoute, loadRelations, relationLabel, routeLabel, unlinkRelation,
  type Relation, type RelationRow,
} from '@/lib/docRelations'
import { docTitle } from './docModel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Select } from '@/components/ui/Field'

interface DocPick { id: string; name: string; status: string }

export function RelationEditor({ documentId, onChanged }: {
  documentId: string
  onChanged?: () => void
}) {
  const [rows, setRows] = useState<RelationRow[]>([])
  const [docs, setDocs] = useState<DocPick[]>([])
  const [relation, setRelation] = useState<Relation>('policy_for')
  const [kind, setKind] = useState<'route' | 'document'>('route')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => { setRows(await loadRelations(documentId)) }, [documentId])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load()
      void list('documents', { select: 'id,name,status', order: 'name', limit: 500 })
        .then((r) => setDocs((r as unknown as DocPick[]).filter((d) => d.id !== documentId)))
        .catch(() => setDocs([]))
    }, 0)
    return () => window.clearTimeout(t)
  }, [load, documentId])

  const add = async () => {
    if (!target) return
    setBusy(true)
    const err = kind === 'route'
      ? await linkRoute(documentId, relation, target)
      : await linkDocument(documentId, relation, target)
    setBusy(false)
    if (err) { toast(err, 'danger'); return }
    setTarget('')
    toast('Linked.', 'success')
    await load()
    onChanged?.()
  }

  const drop = async (r: RelationRow) => {
    const err = await unlinkRelation(r.id)
    if (err) { toast(err, 'danger'); return }
    toast('Link removed.', 'success')
    await load()
    onChanged?.()
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          What this document relates to
        </h4>
        <p className="mt-1 text-xs text-slate-500">
          A link to a place in the portal is what puts this document in front of
          somebody doing that work. Nothing else has to be configured.
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <Badge tone="neutral">{relationLabel(r.relation)}</Badge>
              <span>
                {r.target_kind === 'route'
                  ? routeLabel(r.target_route)
                  : docTitle(docs.find((d) => d.id === r.target_document_id)?.name
                      ?? r.label ?? 'another document')}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void drop(r)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Relationship">
          {(id) => (
            <Select id={id} value={relation}
              onChange={(e) => setRelation(e.target.value as Relation)}>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>{RELATION_LABEL[r]}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={kind}
              onChange={(e) => { setKind(e.target.value as 'route' | 'document'); setTarget('') }}>
              <option value="route">A place in the portal</option>
              <option value="document">Another document</option>
            </Select>
          )}
        </Field>
        <Field label={kind === 'route' ? 'Where' : 'Which document'}>
          {(id) => (
            <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose…</option>
              {kind === 'route'
                ? DOC_ROUTES.map((r) => <option key={r.route} value={r.route}>{r.label}</option>)
                : docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {docTitle(d.name)}{d.status !== 'published' ? ` (${d.status})` : ''}
                    </option>
                  ))}
            </Select>
          )}
        </Field>
      </div>

      <p className="text-xs text-slate-500">{RELATION_MEANING[relation]}</p>

      <Button size="sm" variant="primary" disabled={!target || busy} onClick={() => void add()}>
        Add link
      </Button>
    </div>
  )
}

'use client'

/** RelatedCasesPanel — the case's `case_links` in both directions (P3-04),
 *  mounted in the Brief. A link is readable only when BOTH cases are (RLS),
 *  so every row here names a case the viewer can open. Rows written from
 *  this case can be unlinked here (soft delete, kind case_link, undo); a
 *  row written from the other side is shown as such and managed there. Add:
 *  EntityPicker over cases + a kind + an optional note. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import type { Tables } from '@/lib/database.types'
import { insert, list } from '@/lib/db'
import { deleteRecord } from '@/lib/deleteRecord'
import type { EntityHit } from '@/lib/entitySearch'
import { useCaseTableVersion } from '@/lib/realtime'
import { statusTint } from '@/lib/tint'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { ErrorNotice } from '@/components/ui/Notice'
import { EntityPicker } from '@/components/entity/EntityPicker'
import type { CaseRow } from '../tabs/shared'
import { writeRefusal } from './sectionShared'

type LinkRow = Tables<'case_links'>
type CaseStub = Pick<CaseRow, 'id' | 'case_number' | 'title' | 'status'>

const KINDS: ReadonlyArray<{ id: string; label: string; inverse: string }> = [
  { id: 'related', label: 'Related', inverse: 'Related' },
  { id: 'duplicate', label: 'Duplicate of', inverse: 'Duplicated by' },
  { id: 'parent', label: 'Parent', inverse: 'Child' },
  { id: 'child', label: 'Child', inverse: 'Parent' },
  { id: 'spawned_from', label: 'Spawned from', inverse: 'Spawned' },
  { id: 'see_also', label: 'See also', inverse: 'See also' },
]
const kindLabel = (kind: string, reverse: boolean) => {
  const k = KINDS.find((x) => x.id === kind)
  return k ? (reverse ? k.inverse : k.label) : kind.replace(/_/g, ' ')
}

export function RelatedCasesPanel({ c, canEdit }: { c: CaseRow; canEdit: boolean }) {
  const { profile } = useAuth()
  const [links, setLinks] = useState<LinkRow[]>([])
  const [cases, setCases] = useState<Record<string, CaseStub>>({})
  const [error, setError] = useState<unknown>(null)
  const [adding, setAdding] = useState(false)
  const [sel, setSel] = useState<EntityHit | null>(null)
  const [kind, setKind] = useState('related')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const v = useCaseTableVersion('case_links', c.id)

  const refresh = useCallback(async () => {
    try {
      const [out, inbound] = await Promise.all([
        list('case_links', { eq: { case_id: c.id }, order: 'created_at', ascending: false }),
        list('case_links', { eq: { related_case_id: c.id }, order: 'created_at', ascending: false }),
      ])
      const seen = new Set<string>()
      const all = [...out, ...inbound].filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
      setLinks(all)
      setError(null)
      const ids = [...new Set(all.map((l) => (l.case_id === c.id ? l.related_case_id : l.case_id)))]
      const stubs = ids.length
        ? ((await list('cases', { select: 'id,case_number,title,status', in: { id: ids } }).catch(() => [])) as unknown as CaseStub[])
        : []
      setCases(Object.fromEntries(stubs.map((s) => [s.id, s])))
    } catch (e) { setError(e) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  const exclude = useMemo(() => new Set([c.id, ...links.map((l) => (l.case_id === c.id ? l.related_case_id : l.case_id))]), [c.id, links])

  const add = async () => {
    if (!sel || busy) return
    setBusy(true)
    const res = await insert('case_links', { case_id: c.id, related_case_id: sel.id, kind, note: note.trim() || null, created_by: profile?.id ?? null })
    setBusy(false)
    if (res.error?.code === '23505') { toast('These cases are already linked.', 'warn'); return }
    const refusal = writeRefusal(res)
    if (refusal) { toast(refusal, 'danger'); return }
    toast('Cases linked.', 'success')
    setSel(null); setNote(''); setAdding(false)
    void refresh()
  }

  return (
    <section aria-label="Related cases" className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-white">Related cases</h3>
        {canEdit && <Button size="sm" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Link a case'}</Button>}
      </div>
      {adding && (
        <div className="mb-3 space-y-3 rounded-lg border border-white/10 bg-ink-900/60 p-3">
          <EntityPicker kind="case" label="Case" value={sel} onChange={setSel} exclude={exclude} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Relationship">
              {(id) => (
                <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Note (optional)">
              {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why these cases belong together" />}
            </Field>
          </div>
          <Button variant="primary" size="sm" loading={busy} disabled={!sel} onClick={() => void add()}>Link cases</Button>
        </div>
      )}
      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : links.length === 0 ? (
        <p className="text-sm text-slate-400">No related cases recorded.</p>
      ) : (
        <ul className="space-y-2">
          {links.map((l) => {
            const reverse = l.case_id !== c.id
            const otherId = reverse ? l.case_id : l.related_case_id
            const other = cases[otherId]
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="accent">{kindLabel(l.kind, reverse)}</Badge>
                {other ? (
                  <Link href={caseLink(other.id)} className="font-mono text-badge-300 hover:underline">{other.case_number}</Link>
                ) : (
                  <span className="text-slate-400">Restricted case</span>
                )}
                {other?.title && <span className="min-w-0 truncate text-slate-200">{other.title}</span>}
                {other?.status && <Badge tint={statusTint(other.status)}>{other.status}</Badge>}
                {l.note && <span className="text-xs text-slate-400">· {l.note}</span>}
                {reverse && <span className="text-[11px] text-slate-400" title="Recorded on the other case — manage it there">from the other case</span>}
                {canEdit && !reverse && (
                  <Button
                    size="sm" variant="ghost" className="ml-auto text-rose-300 hover:text-rose-200"
                    aria-label={`Unlink ${other?.case_number ?? 'this case'}`}
                    onClick={() => void deleteRecord('case_links', l, {
                      confirmTitle: 'Unlink cases', confirmMessage: `Remove the link to ${other?.case_number ?? 'this case'}? Both cases are kept. You can undo this from the toast or the Trash.`,
                      confirmText: 'Unlink', label: 'case link', after: () => void refresh(),
                    })}
                  >
                    Unlink
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

'use client'

/** EntitySection — the People / Vehicles / Gangs / Locations sections of a
 *  case (P3-06): the case's `case_intel_links` of one kind, each with the
 *  record's label (a bounded `in: { id }` lookup on just the referenced ids —
 *  a row the viewer cannot read keeps the neutral "Restricted record" stub,
 *  never its UUID), a RecordPeek, role/note edit through the shared
 *  LinkEditPopover (the table's UPDATE policy — audit-triggered), soft unlink
 *  with undo, and the "differs from record" markers: an observation recorded
 *  on THIS case (entity_field_observations) whose value is not what the
 *  master record currently says. Observe opens ObservationForm inline.
 *
 *  Link rules match the table's RLS: any active case member may link and
 *  unlink; an archived case refuses every write (writeRefusal). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Tables } from '@/lib/database.types'
import { deleteWithUndo, list } from '@/lib/db'
import { useCaseTableVersion } from '@/lib/realtime'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { RecordPeek } from '@/components/ui/RecordPeek'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { ObservationForm } from '@/components/entity/ObservationForm'
import { cellText, fieldLabel } from '@/components/entity/labels'
import { LinkEditPopover } from '@/components/shared/LinkEditPopover'
import type { CaseRow, IntelRow } from '../tabs/shared'
import { EntityLinkForm } from './EntityLinkForm'
import { ENTITY_SECTION, differingObservations, recordHref, type EntitySectionKind, type MasterRow } from './sectionShared'

type ObservationRow = Tables<'entity_field_observations'>

export function EntitySection({ c, kind, canEdit }: { c: CaseRow; kind: EntitySectionKind; canEdit: boolean }) {
  const meta = ENTITY_SECTION[kind]
  const [links, setLinks] = useState<IntelRow[] | null>(null)
  const [masters, setMasters] = useState<Record<string, MasterRow>>({})
  const [observations, setObservations] = useState<ObservationRow[]>([])
  const [error, setError] = useState<unknown>(null)
  const [peek, setPeek] = useState<string | null>(null)
  const [editing, setEditing] = useState<IntelRow | null>(null)
  const [observing, setObserving] = useState<string | null>(null)
  const vLinks = useCaseTableVersion('case_intel_links', c.id)

  const refresh = useCallback(async () => {
    let rows: IntelRow[]
    try {
      rows = await list('case_intel_links', { eq: { case_id: c.id, kind }, order: 'created_at', ascending: false })
    } catch (e) {
      setError(e)
      return
    }
    setError(null)
    setLinks(rows)
    const ids = [...new Set(rows.map((l) => l.ref_id))]
    // Bounded lookups: the referenced records (full rows — the label AND the
    // fields the observations are compared against) and this case's
    // observations of the kind. A record RLS hides simply stays absent.
    const [found, obs] = await Promise.all([
      ids.length ? list(meta.table, { in: { id: ids } }).catch(() => []) : Promise.resolve([]),
      list('entity_field_observations', { eq: { case_id: c.id, kind }, order: 'created_at', ascending: false, limit: 500 }).catch(() => [] as ObservationRow[]),
    ])
    setMasters(Object.fromEntries((found as unknown as MasterRow[]).map((r) => [r.id, r])))
    setObservations(obs)
  }, [c.id, kind, meta.table])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vLinks])

  const linkedIds = useMemo(() => new Set((links ?? []).map((l) => l.ref_id)), [links])
  const label = (l: IntelRow) => {
    const v = masters[l.ref_id]?.[meta.labelColumn]
    return typeof v === 'string' && v ? v : 'Restricted record'
  }
  const obsFor = useMemo(() => {
    const by = new Map<string, ObservationRow[]>()
    for (const o of observations) { if (!by.has(o.ref_id)) by.set(o.ref_id, []); by.get(o.ref_id)!.push(o) }
    return by
  }, [observations])

  return (
    <div className="space-y-4">
      {canEdit && <EntityLinkForm caseId={c.id} kind={kind} linkedIds={linkedIds} onLinked={() => void refresh()} />}
      <section aria-label={`${meta.many} linked to this case`} className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
        <h3 className="mb-3 font-bold text-white">
          {meta.many}
          {links && links.length > 0 && <span className="ml-2 text-xs font-normal text-slate-400">{links.length}</span>}
        </h3>
        {error ? (
          <ErrorNotice message={error} onRetry={() => void refresh()} />
        ) : links === null ? (
          <ListSkeleton count={3} />
        ) : links.length === 0 ? (
          <EmptyState
            title={`No ${meta.many.toLowerCase()} linked`}
            hint={canEdit ? `Use “Link a ${meta.one} to this case” above to connect one.` : undefined}
          />
        ) : (
          <ul className="space-y-2">
            {links.map((l) => {
              const name = label(l)
              const href = recordHref(l.kind, l.ref_id)
              const differs = differingObservations(masters[l.ref_id], obsFor.get(l.ref_id) ?? [])
              return (
                <li key={l.id} className="rounded-lg border border-white/10 bg-ink-900/60 p-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {href && masters[l.ref_id] ? (
                          <Link href={href} title={`Open ${name}`} className="truncate font-medium text-badge-300 hover:underline">{name}</Link>
                        ) : (
                          <span className="truncate font-medium text-slate-300">{name}</span>
                        )}
                        {l.role && <Badge tone="neutral">{l.role}</Badge>}
                      </div>
                      {l.note && <p className="mt-1 text-xs text-slate-400">{l.note}</p>}
                      {differs.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Observed on this case, differs from the record">
                          {differs.map((o) => (
                            <li key={o.id}>
                              <Badge tone="warn" title={`Recorded on this case${o.note ? `: ${o.note}` : ''} — the record says “${cellText(masters[l.ref_id]?.[o.field]) || '—'}”`}>
                                {fieldLabel(o.field)} differs: {o.value}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setPeek(l.ref_id)} aria-label={`Preview ${name}`}>Peek</Button>
                      {canEdit && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(l)} aria-label={`Edit link to ${name}`}>Edit</Button>
                          {masters[l.ref_id] && (
                            <Button size="sm" variant="ghost" aria-expanded={observing === l.id} onClick={() => setObserving((cur) => (cur === l.id ? null : l.id))}>
                              Observe
                            </Button>
                          )}
                          <Button
                            size="sm" variant="ghost" className="text-rose-300 hover:text-rose-200"
                            aria-label={`Unlink ${name}`}
                            onClick={() => void deleteWithUndo('case_intel_links', l, {
                              confirmTitle: 'Remove link',
                              confirmMessage: `Unlink ${name} from this case? The ${meta.one} record itself is kept — only the link is removed. You can undo this for a few seconds.`,
                              confirmText: 'Unlink', label: 'link', after: () => void refresh(),
                            })}
                          >
                            Unlink
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {observing === l.id && (
                    <div className="mt-3">
                      <ObservationForm kind={kind} refId={l.ref_id} caseId={c.id} onSaved={() => { setObserving(null); void refresh() }} onCancel={() => setObserving(null)} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {peek && <RecordPeek type={kind} id={peek} onClose={() => setPeek(null)} />}
      {editing && (
        <LinkEditPopover
          title={`Edit ${meta.one} link`}
          table="case_intel_links"
          id={editing.id}
          role={editing.role}
          note={editing.note}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh() }}
        />
      )}
    </div>
  )
}

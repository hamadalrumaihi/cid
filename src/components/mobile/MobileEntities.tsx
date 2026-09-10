'use client'

/** People / Vehicles / Gangs / Locations — this case's `case_intel_links`
 *  of one kind as cards (the EntitySection projection: link rows, then a
 *  bounded `in: { id }` label lookup — a record RLS hides keeps the neutral
 *  "Restricted record" stub, never its id). Linking reuses EntityLinkForm
 *  (EntityPicker → the same case_intel_links insert); role / note edits,
 *  observations and unlinking stay on the desktop. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { list } from '@/lib/db'
import { useCaseTableVersion } from '@/lib/realtime'
import type { IntelRow } from '@/components/cases/tabs/shared'
import { EntityLinkForm } from '@/components/cases/sections/EntityLinkForm'
import { ENTITY_SECTION, recordHref, type EntitySectionKind } from '@/components/cases/sections/sectionShared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { DesktopOnlyCard, type MobileCase } from './mobileShared'

/** Link kind → the case section id the workspace opens on. */
const SECTION_OF: Record<EntitySectionKind, string> = { person: 'people', vehicle: 'vehicles', gang: 'gangs', place: 'locations' }

export function MobileEntities({ c, kind, canEdit }: { c: MobileCase; kind: EntitySectionKind; canEdit: boolean }) {
  const meta = ENTITY_SECTION[kind]
  const [links, setLinks] = useState<IntelRow[] | null>(null)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [linking, setLinking] = useState(false)
  const v = useCaseTableVersion('case_intel_links', c.id)

  const refresh = useCallback(async () => {
    let rows: IntelRow[]
    try {
      rows = await list('case_intel_links', { eq: { case_id: c.id, kind }, order: 'created_at', ascending: false })
    } catch (e) { setError(e); return }
    setError(null)
    setLinks(rows)
    const ids = [...new Set(rows.map((l) => l.ref_id))]
    if (!ids.length) { setLabels({}); return }
    // Label-only projection — the phone shows the name, nothing else.
    const found = await list(meta.table, { select: `id,${meta.labelColumn}`, in: { id: ids } }).catch(() => [])
    const next: Record<string, string> = {}
    for (const r of found as unknown as Array<Record<string, unknown> & { id: string }>) {
      const val = r[meta.labelColumn]
      if (typeof val === 'string' && val) next[r.id] = val
    }
    setLabels(next)
  }, [c.id, kind, meta.table, meta.labelColumn])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  const linkedIds = useMemo(() => new Set((links ?? []).map((l) => l.ref_id)), [links])
  const One = meta.one[0]!.toUpperCase() + meta.one.slice(1)

  return (
    <>
      {canEdit && (linking
        ? <EntityLinkForm caseId={c.id} kind={kind} linkedIds={linkedIds} onLinked={() => { setLinking(false); void refresh() }} />
        : <Button variant="secondary" className="w-full" onClick={() => setLinking(true)} aria-expanded={false}>Link a {meta.one}</Button>)}
      {canEdit && linking && (
        <Button variant="ghost" size="sm" onClick={() => setLinking(false)}>Cancel</Button>
      )}
      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : links === null ? (
        <ListSkeleton count={3} />
      ) : links.length === 0 ? (
        <EmptyState title={`No ${meta.many.toLowerCase()} linked`} hint={canEdit ? `Use “Link a ${meta.one}” above to connect one.` : undefined} />
      ) : (
        <ul className="space-y-2" aria-label={`${meta.many} linked to this case`}>
          {links.map((l) => {
            const name = labels[l.ref_id] ?? 'Restricted record'
            const href = labels[l.ref_id] ? recordHref(l.kind, l.ref_id) : null
            return (
              <li key={l.id} className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {href
                    ? <Link href={href} className="inline-flex min-h-[44px] items-center truncate font-medium text-badge-300 hover:underline">{name}</Link>
                    : <span className="inline-flex min-h-[44px] items-center truncate font-medium text-slate-300">{name}</span>}
                  {l.role && <Badge tone="neutral">{l.role}</Badge>}
                </div>
                {l.note && <p className="text-xs text-slate-400">{l.note}</p>}
              </li>
            )
          })}
        </ul>
      )}
      <DesktopOnlyCard caseId={c.id} section={SECTION_OF[kind]} title={`${One} roles, observations and unlinking are edited on the desktop`} />
    </>
  )
}

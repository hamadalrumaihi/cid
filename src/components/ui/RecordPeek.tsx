'use client'

/** RecordPeek — a small lazy-loaded preview card for a linked record: title,
 *  type, status chips, key identifiers, linked-record counts and one "Open
 *  full record" action. Deliberately NOTHING else — the full dossier stays one
 *  click away, the peek just answers "is this the record I think it is?".
 *  Data comes from lib/entityPreview (lite RLS-scoped projections); a row the
 *  viewer cannot read renders the established access-restricted stub. */
import { useEffect, useState } from 'react'
import { fetchEntityPreview, type EntityPreview, type PreviewType } from '@/lib/entityPreview'
import { safeUrl } from '@/lib/safeUrl'
import { useToolNav } from '@/components/tools/useToolNav'
import { Badge } from './Badge'
import { Button } from './Button'
import { Modal, ModalHeader } from './Modal'
import { Skeleton } from './Skeleton'
import { StatusBadge } from './StatusBadge'

const TYPE_LABEL: Record<PreviewType, string> = {
  person: 'Person', vehicle: 'Vehicle', gang: 'Gang', place: 'Place', account: 'Account', narcotic: 'Narcotic',
}

export function RecordPeek({ type, id, onClose }: { type: PreviewType; id: string; onClose: () => void }) {
  const nav = useToolNav()
  const [data, setData] = useState<EntityPreview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    const t = window.setTimeout(async () => {
      const p = await fetchEntityPreview(type, id).catch(() => null)
      if (!live) return
      setData(p)
      setLoading(false)
    }, 0)
    return () => { live = false; window.clearTimeout(t) }
  }, [type, id])

  const openFull = () => {
    if (!data) return
    onClose()
    if ('href' in data.open) nav.openHref(data.open.href)
    else nav.openRecord(data.open.tool, data.open.recordId, data.title)
  }

  const img = data?.imageUrl ? safeUrl(data.imageUrl) : ''

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title={loading ? 'Loading…' : data?.title ?? 'Record'} onClose={onClose} />
        {loading ? (
          <div role="status" aria-busy="true" className="space-y-2">
            <span className="sr-only">Loading preview…</span>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : !data ? (
          /* RLS returned nothing for this id — the established stub, with no
             detail whatsoever about the hidden record. */
          <p className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-400">
            Linked {TYPE_LABEL[type].toLowerCase()} — access restricted.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              {img && (
                /* eslint-disable-next-line @next/next/no-img-element -- external mugshot CDN */
                <img src={img} alt="" className="h-16 w-16 flex-shrink-0 rounded-lg border border-white/10 object-cover" />
              )}
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">{TYPE_LABEL[data.type]}</p>
                {data.subtitle && <p className="mt-0.5 text-sm text-slate-300">{data.subtitle}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {data.chips.map((c) => <StatusBadge key={`${c.domain}:${c.value}`} domain={c.domain} value={c.value} />)}
                  {data.tags.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}
                </div>
              </div>
            </div>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 border-t border-white/5 pt-2">
              {data.counts.map((c) => (
                <div key={c.label} className="flex items-baseline gap-1.5">
                  <dd className="text-sm font-bold tabular-nums text-white">{c.value}</dd>
                  <dt className="text-[11px] text-slate-400">{c.label}</dt>
                </div>
              ))}
            </dl>
            <Button variant="primary" className="w-full" onClick={openFull}>Open full record</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

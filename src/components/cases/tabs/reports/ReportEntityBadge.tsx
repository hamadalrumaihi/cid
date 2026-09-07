'use client'

/** Chips for a report's entity set (P5-04, RB6). `ReportEntityBadge` names
 *  one item (kind · role) and carries the "Differs from record" marker when
 *  the rendered text was edited after insert; `ReportEntityList` lays the
 *  set out as removable chips for the editor / a plain list for readers. */
import { Badge } from '@/components/ui/Badge'
import { KindIcon } from '@/components/shell/icons'
import { entityKey, type EntityItem } from '@/lib/mentions'

const humanize = (s: string | null | undefined): string =>
  s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : ''

export function ReportEntityBadge({ item, className = '' }: { item: Pick<EntityItem, 'kind' | 'role' | 'edited'>; className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      <Badge tone="neutral" title={humanize(item.kind)}>
        <span aria-hidden className="text-slate-400"><KindIcon kind={item.kind} size={11} /></span>
        {humanize(item.kind)}{item.role && item.role !== item.kind ? ` · ${humanize(item.role)}` : ''}
      </Badge>
      {item.edited && (
        <Badge tone="warn" title="The text inserted for this record was edited in the report and no longer matches the record.">Differs from record</Badge>
      )}
    </span>
  )
}

export function ReportEntityList({ items, onRemove, className = '' }: {
  items: readonly EntityItem[]
  /** Editor mode: renders a remove control per chip. */
  onRemove?: (key: string) => void
  className?: string
}) {
  if (!items.length) return null
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`} aria-label="Records referenced by this report">
      {items.map((it) => {
        const key = entityKey(it)
        return (
          <li key={key} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/5 py-1 pl-2.5 pr-1.5 text-xs text-slate-200">
            <span className="min-w-0 truncate">{it.label}</span>
            <ReportEntityBadge item={it} />
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(key)}
                aria-label={`Remove ${it.label} from the report's records`}
                title="Remove"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-200"
              >
                ✕
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

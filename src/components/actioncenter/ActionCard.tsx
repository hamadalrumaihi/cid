'use client'

/** The < 640 px shape of a queue row (Phase 7, P7-08): title, reason and
 *  badges stacked, then the actions on their own line — no table-like
 *  flex-row that would wrap unpredictably at phone widths. Same facts and
 *  the same handlers as ActionItemRow; every control ≥ 44 px. */
import Link from 'next/link'
import { ACCENT, RowActions, RowBadges, RowCheckbox, type RowProps } from './ActionItemRow'

export function ActionCard(props: RowProps) {
  const { item, now, muted, lane, selected, onSelect, onOpen } = props
  const quiet = muted || !!lane
  return (
    <li className="list-none">
      <article
        aria-label={item.title}
        className={`rounded-lg border border-l-2 bg-ink-900/55 p-3 transition focus-within:ring-2 focus-within:ring-amber-400/40 ${
          selected ? 'border-amber-400/30 bg-amber-500/[0.06]' : 'border-white/10'
        } ${ACCENT[item.priority] ?? ACCENT.normal} ${quiet ? 'opacity-80' : ''}`}
      >
        <div className="flex items-start gap-1">
          <RowCheckbox item={item} selected={selected} onSelect={onSelect} />
          <div className="min-w-0 flex-1 pt-2">
            <Link
              href={item.deepLink}
              onClick={() => onOpen(item)}
              className={`block rounded text-sm font-semibold leading-snug transition ${quiet ? 'text-slate-300' : 'text-white'} hover:text-amber-100`}
            >
              {item.title}
            </Link>
            {item.summary && <p className="mt-0.5 text-xs text-slate-300">{item.summary}</p>}
            {item.reason && <p className="mt-0.5 text-[11px] text-slate-400">{item.reason}</p>}
            <RowBadges item={item} now={now} lane={lane} />
          </div>
        </div>
        <div className="mt-2 border-t border-white/5 pt-2">
          <RowActions {...props} stack />
        </div>
      </article>
    </li>
  )
}

'use client'

/** One actionable dashboard row. The `why` line is mandatory per spec — every
 *  row states the reason it is in front of you ("Returned by AG — correction
 *  required"), not just what it is. Rows are dense but keep a ≥40px hit area
 *  and a visible focus ring (browser default on the button). */

export interface DashRowProps {
  title: string
  /** Why this row needs the viewer — always shown, never decorative. */
  why: string
  /** Right-aligned quiet metadata (age, due date, case number). */
  meta?: string
  /** Chip slot — pass a `Badge` (lib/tint colors), rendered beside the title. */
  badge?: React.ReactNode
  onClick: () => void
  /** Past a deadline — the why-line turns rose so overdue reads at a glance. */
  overdue?: boolean
}

export function DashRow({ title, why, meta, badge, onClick, overdue = false }: DashRowProps) {
  return (
    <button
      onClick={onClick}
      className="group flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-white/5"
    >
      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-100 group-hover:text-white">{title}</span>
          {badge}
        </span>
        <span className={`block truncate text-[11px] ${overdue ? 'font-semibold text-rose-300' : 'text-slate-400'}`}>
          {why}
        </span>
      </span>
      {meta && <span className="flex-shrink-0 text-[11px] tabular-nums text-slate-400">{meta}</span>}
    </button>
  )
}

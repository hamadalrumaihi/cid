'use client'

/** Compact KPI strip for a dossier overview. Each metric is optionally
 *  actionable — clicking jumps to the section that owns the number (so the
 *  overview navigates rather than just decorates). A metric with no `onClick`
 *  renders as static text; one with `onClick` renders as a real <button> with
 *  a visible focus ring. Values are shown verbatim — pass `—` for unknown,
 *  never a fabricated 0. */

export interface Metric {
  label: string
  /** Pre-formatted value. Use `'—'` when the datum genuinely doesn't exist. */
  value: React.ReactNode
  hint?: string
  /** Jump to the related section. Omit for a non-navigating stat. */
  onClick?: () => void
  /** Tint the value (e.g. threat/confidence) — a bg/text chip class. */
  tint?: string
}

export function MetricStrip({ metrics, className = '' }: { metrics: Metric[]; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-px overflow-hidden rounded-lg border border-white/10 bg-white/5 ${className}`}>
      {metrics.map((m, i) => {
        const body = (
          <>
            <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">{m.label}</p>
            <p className={`mt-0.5 text-lg font-bold leading-6 tabular-nums ${m.tint ? `inline-flex rounded px-1.5 ${m.tint}` : 'text-white'}`}>{m.value}</p>
            {m.hint && <p className="truncate text-[10px] text-slate-400">{m.hint}</p>}
          </>
        )
        // gap-px over the bg-white/5 wrapper draws the hairline separators in
        // both axes, so the strip stays border-separated even when it wraps.
        const base = 'min-h-[44px] min-w-0 flex-1 basis-28 bg-ink-900 px-3 py-1.5 text-left'
        return m.onClick ? (
          <button
            key={i}
            type="button"
            onClick={m.onClick}
            title={m.hint ? undefined : `Go to ${m.label}`}
            className={`${base} transition hover:bg-ink-850 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-badge-500`}
          >
            {body}
          </button>
        ) : (
          <div key={i} className={base}>{body}</div>
        )
      })}
    </div>
  )
}

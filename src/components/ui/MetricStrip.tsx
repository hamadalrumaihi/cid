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
    <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 ${className}`}>
      {metrics.map((m, i) => {
        const body = (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{m.label}</p>
            <p className={`mt-1 text-xl font-black tabular-nums ${m.tint ? `inline-flex rounded-md px-1.5 ${m.tint}` : 'text-white'}`}>{m.value}</p>
            {m.hint && <p className="mt-0.5 text-[11px] text-slate-500">{m.hint}</p>}
          </>
        )
        const base = 'rounded-xl border border-white/5 bg-ink-900/60 p-3 text-left'
        return m.onClick ? (
          <button
            key={i}
            type="button"
            onClick={m.onClick}
            title={m.hint ? undefined : `Go to ${m.label}`}
            className={`${base} transition hover:border-white/15 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500`}
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

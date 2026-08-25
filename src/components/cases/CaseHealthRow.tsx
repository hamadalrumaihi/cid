'use client'

/** Compact advisory "Health" row under the case command header — the
 *  lib/caseHealth flags as clickable chips (amber = warn, slate = info).
 *  Each chip's tooltip says why it raised and how to clear it; clicking jumps
 *  to the flag's tab. Non-blocking by design: renders nothing at all when the
 *  case is healthy, so a clean case never carries an empty nag strip. */
import type { HealthFlag } from '@/lib/caseHealth'

export function CaseHealthRow({ flags, onGoTab }: {
  flags: HealthFlag[]
  onGoTab: (tab: string) => void
}) {
  if (!flags.length) return null
  return (
    <div
      role="group"
      aria-label="Case health advisories"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-white/10 bg-ink-900/40 px-4 py-1.5"
    >
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Health</span>
      {flags.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => onGoTab(f.tab)}
          title={f.why}
          className={`inline-flex min-h-[40px] items-center rounded-full px-2.5 text-[11px] font-semibold transition sm:min-h-0 sm:py-0.5 ${
            f.severity === 'warn'
              ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
              : 'bg-white/5 text-slate-300 hover:bg-white/10'
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}

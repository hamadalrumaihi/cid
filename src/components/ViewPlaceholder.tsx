'use client'

/** Stub rendered for views whose slice hasn't been ported yet. Honest about
 *  status: the vanilla app on main remains the live tool for these. */
import { PAGE_META, TAB_LABEL } from '@/lib/nav'

export function ViewPlaceholder({ tab }: { tab: string }) {
  const meta = PAGE_META[tab]
  return (
    <section className="view-in mx-auto max-w-xl pt-10 text-center">
      <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-8">
        <p className="t-readout mb-3 inline-flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-amber-300/90">
          <span className="t-dot t-dot-amber" /> React rebuild — slice pending
        </p>
        <h3 className="text-lg font-bold text-white">{meta?.title ?? TAB_LABEL[tab] ?? tab}</h3>
        <p className="mt-1 text-sm text-slate-400">{meta?.sub}</p>
        <p className="mt-4 text-xs text-slate-500">
          This view is being ported one vertical slice at a time. Until its slice lands,
          the vanilla portal remains the tool of record for this section.
        </p>
      </div>
    </section>
  )
}

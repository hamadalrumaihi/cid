'use client'

/** Fallback rendered for an unrecognised tab (the [tab] route's catch-all).
 *  Used views all have real components now, so this is a friendly "not found
 *  here" rather than a build-status note. */
import { PAGE_META, TAB_LABEL } from '@/lib/nav'

export function ViewPlaceholder({ tab }: { tab: string }) {
  const meta = PAGE_META[tab]
  return (
    <section className="view-in mx-auto max-w-xl pt-10 text-center">
      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8">
        <div className="mb-3 text-2xl" aria-hidden>🧭</div>
        <h1 className="text-lg font-bold text-white">{meta?.title ?? TAB_LABEL[tab] ?? 'Section unavailable'}</h1>
        <p className="mt-1 text-sm text-slate-400">{meta?.sub ?? 'This section isn’t available right now.'}</p>
        <p className="mt-4 text-sm text-slate-400">
          If you reached this from a link, the section may have moved. Use the sidebar to pick
          where you’d like to go.
        </p>
      </div>
    </section>
  )
}

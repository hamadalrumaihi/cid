'use client'

/** "What is this registry for?" — the explainer that sits on the two shared
 *  registries whose names do not explain them.
 *
 *  Collapsed to one line by default, because a detective who already knows
 *  what an indicator is should not read a paragraph every visit; open it and
 *  it says the same three things in the same order — what this registry holds,
 *  what belongs somewhere else, and what the division gets out of it — plus a
 *  link into the guide that covers it at length. The copy lives in
 *  lib/registryPurpose so the guide, the screen and the tests read one source.
 *
 *  The open/closed choice is remembered per registry on this device only: it
 *  is a reading preference, not a record. */
import { useState } from 'react'
import { REGISTRY_PURPOSE } from '@/lib/registryPurpose'
import { Store } from '@/lib/store'
import { GuideHelpLink } from '@/components/guides/GuideHelpLink'

export function RegistryPurposeNote({ registry }: { registry: keyof typeof REGISTRY_PURPOSE }) {
  const key = `registryPurpose:${registry}`
  const [open, setOpen] = useState(() => Store.get<boolean>(key, false))
  const p = REGISTRY_PURPOSE[registry]
  const toggle = () => {
    setOpen((o) => {
      Store.set(key, !o)
      return !o
    })
  }

  return (
    <section className="rounded-lg border border-white/10 bg-ink-950/40" aria-label="What this registry is for">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-h-[36px] min-w-0 flex-1 items-center gap-2 text-left text-xs font-semibold text-slate-200"
        >
          <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          What belongs in this registry?
        </button>
        <GuideHelpLink slug={p.guide} anchor={p.anchor} label="Read the guide" title="Open the Investigative Tools guide" />
      </div>
      {open && (
        <dl className="space-y-2 border-t border-white/5 px-3 py-3 text-xs sm:px-4">
          <div>
            <dt className="font-semibold text-slate-300">What it holds</dt>
            <dd className="text-slate-400">{p.holds}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-300">What goes somewhere else</dt>
            <dd className="text-slate-400">{p.notHere}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-300">Why we keep it</dt>
            <dd className="text-slate-400">{p.payoff}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

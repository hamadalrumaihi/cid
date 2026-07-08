'use client'

/** Encouragement widget (#16) — vanilla collab.js:364-386. Rotates a line
 *  every 5 minutes; dismiss is session-only (module flag, clears on reload).
 *  Text is picked client-side in an effect so the static prerender never
 *  embeds a random line (hydration-safe). */
import { useEffect, useState } from 'react'

const ENCOURAGEMENTS = [
  'You got this, Detective.', 'Build the case step by step.', 'Justice requires patience.',
  'Every detail matters — document it.', 'Follow the evidence, not the noise.',
  'Strong cases are built, not rushed.', 'Chain of custody is everything.',
  'Verify, then trust.', 'The quiet lead often breaks the case.',
  'Protect the integrity of the investigation.', 'Good notes today win the case tomorrow.',
  'Stay sharp. Stay thorough. Stay fair.',
]

let sessionDismissed = false

export function Encourage() {
  const [text, setText] = useState('')
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (sessionDismissed) return
    let rotate: number | undefined
    const boot = window.setTimeout(() => {
      const pick = () => setText(ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)])
      setDismissed(false)
      pick()
      rotate = window.setInterval(pick, 5 * 60 * 1000)
    }, 0)
    return () => { window.clearTimeout(boot); if (rotate) window.clearInterval(rotate) }
  }, [])

  if (dismissed || !text) return null
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-gradient-to-r from-blue-500/[0.07] to-transparent px-4 py-2.5">
      <span className="text-cyan-300" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="7" /><path d="M12 3.5V7M12 17v3.5M3.5 12H7M17 12h3.5" /></svg>
      </span>
      <p className="flex-1 text-sm italic text-slate-300">{text}</p>
      <button
        onClick={() => { sessionDismissed = true; setDismissed(true) }}
        className="flex-shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:text-white"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}

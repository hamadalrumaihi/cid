'use client'

/** Owner-only Portal Assistant (pilot) — a natural-language copilot that drives
 *  the Portal UI via page-agent (alibaba/page-agent).
 *
 *  Safety model (this is the whole point):
 *   • OWNER-ONLY — renders nothing for anyone else.
 *   • INERT until configured — page-agent is never imported and no network call
 *     happens unless NEXT_PUBLIC_PAGE_AGENT_MODEL / _BASE_URL / _API_KEY are set.
 *   • READ / NAVIGATE / PREPARE only — a capture-phase DOM guard blocks
 *     destructive controls while the agent runs (defense-in-depth on top of RLS
 *     and the app's confirmation dialogs).
 *   • page-agent is LAZY-LOADED on first run, so it stays out of the shared
 *     first-load bundle.
 *
 *  Data note: the agent reads what is on the owner's screen and sends it to the
 *  configured LLM. Do not run it on restricted / sealed records. See
 *  docs/DEV-TOOLING.md. */
import { useCallback, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { toast } from '@/lib/toast'
import { installDestructiveGuard } from './destructiveGuard'
import { isPageAgentConfigured, pageAgentConfig } from './pageAgentConfig'

export function PortalAssistant() {
  const { isOwner } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [instruction, setInstruction] = useState('')
  const configured = isPageAgentConfigured()

  const run = useCallback(async () => {
    const text = instruction.trim()
    if (!text || !configured) return
    setBusy(true)
    const removeGuard = installDestructiveGuard((label) =>
      toast(`Assistant blocked a destructive control (“${label}”). Do that step yourself.`, 'warn'),
    )
    try {
      const { PageAgent } = await import('page-agent')
      const agent = new PageAgent({ ...pageAgentConfig(), language: 'en-US' })
      await agent.execute(text)
      toast('Assistant finished.', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Assistant failed.', 'danger')
    } finally {
      removeGuard()
      setBusy(false)
    }
  }, [instruction, configured])

  if (!isOwner) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Portal Assistant (owner pilot)"
        aria-label="Open Portal Assistant"
        className="fixed bottom-24 right-4 z-40 grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-badge-500 to-blue-700 text-white shadow-glow transition hover:brightness-110 lg:bottom-6"
      >
        <span aria-hidden className="text-lg">✦</span>
      </button>

      {open && (
        <div className="fixed bottom-40 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-ink-900 p-3 shadow-2xl lg:bottom-20">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-white">Portal Assistant <span className="rounded bg-white/10 px-1.5 text-[10px] font-semibold text-slate-300">owner pilot</span></p>
            <button onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-white">✕</button>
          </div>

          <p className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
            Read &amp; navigate only — destructive actions are blocked. The assistant sees your current screen and sends it to the configured model; don’t use it on restricted/sealed records.
          </p>

          {configured ? (
            <>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder="e.g. Open case SAB-9000026 and go to the Evidence tab"
                className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"
              />
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy || !instruction.trim()}
                className="mt-2 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60"
              >
                {busy ? 'Working…' : 'Run'}
              </button>
            </>
          ) : (
            <p className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-[11px] text-slate-400">
              Not configured. Set <code className="text-slate-300">NEXT_PUBLIC_PAGE_AGENT_MODEL</code>, <code className="text-slate-300">_BASE_URL</code> and <code className="text-slate-300">_API_KEY</code> to enable. Until then the assistant loads nothing and makes no external calls. Use a restricted/proxy key — it is exposed to the browser.
            </p>
          )}
        </div>
      )}
    </>
  )
}

/** Defense-in-depth for the owner-only assistant.
 *
 *  While the agent is driving the UI, a capture-phase click interceptor blocks
 *  controls that would perform a destructive or irreversible action, so the
 *  assistant stays read / navigate / prepare only and can never fire one on the
 *  owner's behalf. This is an EXTRA layer — RLS and the app's own confirmation
 *  dialogs (permanent-delete sudo, report finalize, sign-off, warrant issue)
 *  remain the real authority. Matching is deliberately broad and heuristic
 *  (label / aria-label / text / an explicit `data-destructive` opt-in); a false
 *  positive only means the owner does that one step by hand. */
const DESTRUCTIVE =
  /\b(delete|remove|permanently|finali[sz]e|sign[-\s]?off|issue\s+warrant|revoke|deny|approve|merge|archive|discard|submit|reset|unlink|retire)\b/i

/** Install the guard; returns a disposer. `onBlock` receives the control's
 *  label so the UI can explain what was stopped. */
export function installDestructiveGuard(onBlock: (label: string) => void): () => void {
  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null
    const el = target?.closest('button, [role="button"], a, input[type="submit"], input[type="button"]')
    if (!el) return
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (el.hasAttribute('data-destructive') || DESTRUCTIVE.test(label)) {
      // Capture phase + stopImmediatePropagation runs before React's delegated
      // handlers, so the control's onClick never fires.
      e.preventDefault()
      e.stopImmediatePropagation()
      onBlock(label || 'destructive action')
    }
  }
  document.addEventListener('click', handler, true)
  return () => document.removeEventListener('click', handler, true)
}

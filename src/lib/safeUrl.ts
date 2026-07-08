/** Allow-list URL schemes for href/src so a user-supplied URL can't smuggle a
 *  javascript:/data:/vbscript: payload into a link, image, or iframe.
 *  Ported verbatim from the vanilla core.js. Returns '' if unsafe.
 *  Apply to EVERY href/src whose value originates from the database. */
export function safeUrl(u: unknown): string {
  const s = String(u ?? '').trim()
  if (!s) return ''
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 32) return ''
  const m = s.match(/^([a-z][a-z0-9+.-]*):/i)
  if (m) {
    const sch = m[1].toLowerCase()
    return sch === 'http' || sch === 'https' || sch === 'mailto' ? s : ''
  }
  return s // protocol-relative (//host) or relative path is safe
}

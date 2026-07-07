import { toast } from './toast'

/** Small formatting + browser-download helpers ported from vanilla core.js /
 *  command.js / app.js. Pure functions except the download/clipboard ones. */

/** "just now" / "5m ago" / "3h ago" / "12d ago" — vanilla command.js:212. */
export function timeAgo(ts: string | number | Date): string {
  const s = (Date.now() - new Date(ts).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Local-date ISO (YYYY-MM-DD) — matches vanilla todayISO. */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtUSD(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US')
}

/** Filename-safe slug — vanilla app.js:198. */
export const slug = (s: string | null | undefined): string => String(s || 'case').replace(/[^a-z0-9]/gi, '-')

export const initials = (name: string | null | undefined): string =>
  (name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadTextFile(filename: string, text: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename)
}

/** Clipboard copy with a confirming toast; falls back to showing the text. */
export function copyText(text: string, label = 'Text'): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast(`${label} copied`, 'success'),
      () => toast(text, 'info'),
    )
  } else toast(text, 'info')
}

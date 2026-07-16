'use client'

/** Pure line diff + rendered diff view shared by DocHistory (compare/restore
 *  preview) and DocLifecycle (sync-conflict resolution). A small LCS over
 *  lines — SOP bodies are a few hundred lines at most — rendered as React
 *  elements (added "+" emerald / removed "−" rose prefixes, never
 *  color-alone, never dangerouslySetInnerHTML). */

export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
}

const splitLines = (s: string): string[] => String(s ?? '').replace(/\r\n?/g, '\n').split('\n')

/** Line diff base → other. Common prefix/suffix are trimmed first so the LCS
 *  table only covers the changed middle; a pathological middle (>1M cells)
 *  degrades to whole-block remove+add rather than freezing the tab. */
export function diffLines(base: string, other: string): DiffLine[] {
  const a = splitLines(base)
  const b = splitLines(other)
  let lo = 0
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++
  let aHi = a.length, bHi = b.length
  while (aHi > lo && bHi > lo && a[aHi - 1] === b[bHi - 1]) { aHi--; bHi-- }

  const out: DiffLine[] = a.slice(0, lo).map((text) => ({ type: 'same' as const, text }))
  const mid = diffMiddle(a.slice(lo, aHi), b.slice(lo, bHi))
  out.push(...mid, ...a.slice(aHi).map((text) => ({ type: 'same' as const, text })))
  return out
}

function diffMiddle(a: string[], b: string[]): DiffLine[] {
  if (!a.length) return b.map((text) => ({ type: 'add' as const, text }))
  if (!b.length) return a.map((text) => ({ type: 'del' as const, text }))
  if (a.length * b.length > 1_000_000)
    return [...a.map((text) => ({ type: 'del' as const, text })), ...b.map((text) => ({ type: 'add' as const, text }))]

  // LCS length table (single flat array), then walk back to emit edits.
  const w = b.length + 1
  const dp = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])

  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++ }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) out.push({ type: 'del', text: a[i++] })
    else out.push({ type: 'add', text: b[j++] })
  }
  while (i < a.length) out.push({ type: 'del', text: a[i++] })
  while (j < b.length) out.push({ type: 'add', text: b[j++] })
  return out
}

const ROW: Record<DiffLine['type'], { mark: string; cls: string }> = {
  same: { mark: ' ', cls: 'text-slate-400' },
  add: { mark: '+', cls: 'bg-emerald-500/10 text-emerald-200' },
  del: { mark: '−', cls: 'bg-rose-500/10 text-rose-200' },
}

/** Unified diff pane. Long unchanged runs collapse to a "… N unchanged lines"
 *  marker so a one-line edit in a long SOP stays readable. */
export function DiffView({ base, other, className = '' }: { base: string; other: string; className?: string }) {
  const lines = diffLines(base, other)
  if (lines.every((l) => l.type === 'same'))
    return <p className={`text-sm text-slate-400 ${className}`}>No text differences between these versions.</p>

  // Collapse same-runs longer than 8 lines to head 3 + marker + tail 3.
  const rows: (DiffLine | { type: 'skip'; count: number })[] = []
  for (let i = 0; i < lines.length; ) {
    if (lines[i].type !== 'same') { rows.push(lines[i]); i++; continue }
    let j = i
    while (j < lines.length && lines[j].type === 'same') j++
    const run = j - i
    if (run > 8) {
      rows.push(...lines.slice(i, i + 3), { type: 'skip', count: run - 6 }, ...lines.slice(j - 3, j))
    } else rows.push(...lines.slice(i, j))
    i = j
  }

  return (
    <div className={`max-h-80 overflow-auto rounded-lg border border-white/10 bg-ink-950/60 font-mono text-xs leading-5 ${className}`}>
      {rows.map((l, i) =>
        l.type === 'skip' ? (
          <p key={i} className="border-y border-white/5 px-3 py-1 text-center text-slate-500">… {l.count} unchanged lines …</p>
        ) : (
          <p key={i} className={`whitespace-pre-wrap px-3 ${ROW[l.type].cls}`}>
            <span aria-hidden className="mr-2 inline-block w-3 select-none text-center">{ROW[l.type].mark}</span>
            <span className="sr-only">{l.type === 'add' ? 'added: ' : l.type === 'del' ? 'removed: ' : ''}</span>
            {l.text || ' '}
          </p>
        ),
      )}
    </div>
  )
}

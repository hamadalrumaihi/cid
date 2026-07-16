'use client'

/** Pure line diff + rendered diff view shared by DocHistory (compare/restore
 *  preview) and DocLifecycle (sync-conflict resolution). A small LCS over
 *  lines — SOP bodies are a few hundred lines at most — grouped into
 *  document-style added/removed/context sections that read top to bottom
 *  (never color-alone, never dangerouslySetInnerHTML). */

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

/** A line diff grouped into document-style blocks: runs of unchanged context
 *  (collapsed when long) and change blocks that read removed-then-added, top to
 *  bottom — no columns, no table. */
type DiffBlock =
  | { kind: 'context'; lines: string[] }
  | { kind: 'change'; removed: string[]; added: string[] }

function groupBlocks(lines: DiffLine[]): DiffBlock[] {
  const blocks: DiffBlock[] = []
  for (let i = 0; i < lines.length; ) {
    if (lines[i].type === 'same') {
      let j = i
      while (j < lines.length && lines[j].type === 'same') j++
      blocks.push({ kind: 'context', lines: lines.slice(i, j).map((l) => l.text) })
      i = j
    } else {
      let j = i
      const removed: string[] = []
      const added: string[] = []
      while (j < lines.length && lines[j].type !== 'same') {
        if (lines[j].type === 'del') removed.push(lines[j].text)
        else added.push(lines[j].text)
        j++
      }
      blocks.push({ kind: 'change', removed, added })
      i = j
    }
  }
  return blocks
}

/** Unchanged context — collapses runs longer than 6 lines to head 3 + a
 *  "N unchanged lines" marker + tail 3 so a one-line edit in a long SOP stays
 *  readable. */
function ContextBlock({ lines }: { lines: string[] }) {
  const collapse = lines.length > 6
  const shown: (string | null)[] = collapse ? [...lines.slice(0, 3), null, ...lines.slice(-3)] : lines
  return (
    <div className="px-3 py-1.5">
      {shown.map((t, i) =>
        t === null ? (
          <p key={i} className="py-1 text-center text-xs text-slate-500">{lines.length - 6} unchanged lines</p>
        ) : (
          <p key={i} className="whitespace-pre-wrap text-sm leading-6 text-slate-400">{t || ' '}</p>
        ),
      )}
    </div>
  )
}

/** Grouped diff view — removed and added text sit in their own labelled
 *  (colour + text) sections; unchanged context reads quietly between them. */
export function DiffView({ base, other, className = '' }: { base: string; other: string; className?: string }) {
  const lines = diffLines(base, other)
  if (lines.every((l) => l.type === 'same'))
    return <p className={`text-sm text-slate-400 ${className}`}>No text differences between these versions.</p>

  const blocks = groupBlocks(lines)
  return (
    <div className={`max-h-80 space-y-2 overflow-auto rounded-lg border border-white/10 bg-ink-950/60 p-2 ${className}`}>
      {blocks.map((b, i) =>
        b.kind === 'context' ? (
          <ContextBlock key={i} lines={b.lines} />
        ) : (
          <div key={i} className="overflow-hidden rounded-lg border border-white/10">
            {b.removed.length > 0 && (
              <div className="border-l-2 border-rose-500/60 bg-rose-500/10 px-3 py-2">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-300">Removed</p>
                {b.removed.map((t, k) => (
                  <p key={k} className="whitespace-pre-wrap text-sm leading-6 text-rose-200">
                    <span className="sr-only">removed: </span>{t || ' '}
                  </p>
                ))}
              </div>
            )}
            {b.added.length > 0 && (
              <div className="border-l-2 border-emerald-500/60 bg-emerald-500/10 px-3 py-2">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">Added</p>
                {b.added.map((t, k) => (
                  <p key={k} className="whitespace-pre-wrap text-sm leading-6 text-emerald-200">
                    <span className="sr-only">added: </span>{t || ' '}
                  </p>
                ))}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  )
}

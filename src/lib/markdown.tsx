/** Safe mini-Markdown → React renderer — port of the vanilla sopArticle
 *  engine (drive.js:421-516) used by the case Notes tab (and later SOPs).
 *  Vanilla escaped-then-innerHTML'd; here we build React elements, so user/DB
 *  text is auto-escaped and dangerouslySetInnerHTML is never used (hard rule).
 *
 *  Handles: \r\n, # headings, **bold**, `code`, > note blocks, -/1. lists,
 *  Markdown tables (|:-:| separators), bare pipe-delimited data blocks, and
 *  the short-ALL-CAPS / colon-terminated heading heuristic. */
import type { ReactNode } from 'react'

/** Inline **bold** and `code` within an escaped-by-React text run. */
function inline(t: string): ReactNode[] {
  const out: ReactNode[] = []
  // Tokenize on **bold** and `code` spans, preserving order.
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(t))) {
    if (m.index > last) out.push(t.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>)
    else out.push(<code key={k++} className="rounded bg-white/10 px-1 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>)
    last = m.index + tok.length
  }
  if (last < t.length) out.push(t.slice(last))
  return out
}

const isSep = (l: string) => /^\|?[\s:|-]+\|?$/.test(l) && l.includes('-')
const splitRow = (l: string) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

function cellNode(v: string): ReactNode {
  const t = v.trim()
  const l = t.toLowerCase()
  if (l === 'active') return <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">ACTIVE</span>
  if (l === 'inactive' || l === 'loa' || l === 'suspended' || l === 'tba')
    return <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">{t.toUpperCase()}</span>
  return <>{inline(t)}</>
}

function tableNode(rows: string[][], hasHead: boolean, key: number): ReactNode {
  const width = Math.max(...rows.map((r) => r.length))
  const cells = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
  const body = rows.slice(hasHead ? 1 : 0)
  return (
    <div key={key} className="my-3 overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-left text-sm">
        {hasHead && (
          <thead>
            <tr className="bg-ink-800 text-[10px] uppercase tracking-wider text-slate-400">
              {cells(rows[0]).map((c, i) => (
                <th key={i} className="border-b border-r border-white/5 px-2.5 py-2 font-semibold">{c ? cellNode(c) : <span className="text-slate-600">-</span>}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, ri) => {
            const filled = r.filter(Boolean)
            // A row with one non-empty bold cell is a group header.
            if (filled.length === 1 && /^\*\*[^*]+\*\*$/.test(filled[0])) {
              return (
                <tr key={ri}>
                  <td colSpan={width} className="border-b border-white/5 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-300">{filled[0].replace(/\*\*/g, '')}</td>
                </tr>
              )
            }
            return (
              <tr key={ri}>
                {cells(r).map((c, i) => (
                  <td key={i} className="border-b border-r border-white/5 px-2.5 py-1.5 text-slate-200">{c ? cellNode(c) : <span className="text-slate-600">-</span>}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const H3 = ({ children }: { children: ReactNode }) => (
  <h3 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wider text-blue-300/90 first:mt-0">{children}</h3>
)

export function renderMarkdown(body: string | null | undefined): ReactNode {
  const norm = String(body ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/^_{4,}\s*$/gm, '')
  const blocks = norm.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
  if (!blocks.length) return <p className="text-slate-500">No content.</p>

  const isHeadingText = (t: string) =>
    t.length <= 64 && ((t === t.toUpperCase() && /[A-Z]/.test(t)) || /:$/.test(t)) && !t.includes('|')

  return blocks.map((b, bi) => {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return null
    // Markdown heading / quote blocks.
    if (/^#{1,6}\s/.test(lines[0]) && lines.length === 1)
      return <H3 key={bi}>{inline(lines[0].replace(/^#{1,6}\s+/, ''))}</H3>
    if (lines.every((l) => /^>\s?/.test(l)))
      return (
        <blockquote key={bi} className="my-3 rounded-lg border-l-2 border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm text-amber-100/90">
          {inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '))}
        </blockquote>
      )
    // Lists.
    if (lines.length > 1 && lines.every((l) => /^([-*•]|\d+[.)])\s/.test(l))) {
      const ordered = /^\d/.test(lines[0])
      const items = lines.map((l, i) => <li key={i}>{inline(l.replace(/^([-*•]|\d+[.)])\s+/, ''))}</li>)
      return ordered
        ? <ol key={bi} className="my-2 list-decimal space-y-1 pl-5 text-sm text-slate-200">{items}</ol>
        : <ul key={bi} className="my-2 list-disc space-y-1 pl-5 text-sm text-slate-200">{items}</ul>
    }
    // Tables: Markdown (with separator row) or bare pipe data.
    const piped = lines.filter((l) => l.includes('|'))
    const sepIdx = lines.findIndex(isSep)
    if (sepIdx === 1 && piped.length >= 2) {
      const rows = lines.filter((l, i) => i !== sepIdx && !isSep(l)).map(splitRow)
      return tableNode(rows, true, bi)
    }
    const tabular = piped.length >= 2 || (piped.length === 1 && piped[0].split('|').length >= 4)
    if (tabular) {
      const rest = lines.slice()
      const head = !rest[0].includes('|') && !/^#/.test(rest[0]) ? rest.shift() : null
      const rows = rest.filter((l) => !isSep(l)).map(splitRow)
      return (
        <div key={bi}>
          {head && <H3>{inline(head.replace(/:$/, ''))}</H3>}
          {tableNode(rows, false, bi)}
        </div>
      )
    }
    // Single short ALL-CAPS / colon line → heading.
    if (lines.length === 1 && isHeadingText(lines[0]))
      return <H3 key={bi}>{inline(lines[0].replace(/:$/, ''))}</H3>
    // Mixed blocks: inline # headings split paragraphs.
    const out: ReactNode[] = []
    let para: string[] = []
    let k = 0
    const flush = () => {
      if (!para.length) return
      out.push(
        <p key={k++} className="my-2 text-sm leading-relaxed text-slate-200">
          {para.map((l, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {inline(l)}
            </span>
          ))}
        </p>,
      )
      para = []
    }
    for (const l of lines) {
      if (/^#{1,6}\s/.test(l)) { flush(); out.push(<H3 key={k++}>{inline(l.replace(/^#{1,6}\s+/, ''))}</H3>) }
      else para.push(l)
    }
    flush()
    return <div key={bi}>{out}</div>
  })
}

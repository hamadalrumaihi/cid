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

/** One heading the document renderer emitted — the TOC consumes exactly this
 *  list, produced during the SAME render pass (never a second parser). */
export interface DocHeading { id: string; text: string; level: 2 | 3 }

/** Deterministic, URL-safe anchor id; uniqueness handled by the collector. */
const slugify = (t: string): string =>
  t.toLowerCase().replace(/\*\*|`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'section'

/** Collector threaded through a doc-mode render: assigns unique ids and
 *  records every emitted heading in document order. */
interface HeadingCollector { used: Map<string, number>; out: DocHeading[] }

/** Emit a heading. Legacy mode (no collector) keeps the exact pre-doc-mode
 *  rendering — one styled visual h3, no ids — so case notes are unchanged.
 *  Doc mode maps #/## and heuristic headings to a semantic <h2> and ###+ to
 *  <h3>, each with a stable unique id for TOC/anchor navigation. */
function heading(raw: string, mdLevel: number | null, collect: HeadingCollector | null, key: number): ReactNode {
  if (!collect) return <H3 key={key}>{inline(raw)}</H3>
  const level: 2 | 3 = mdLevel !== null && mdLevel >= 3 ? 3 : 2
  const text = raw.replace(/\*\*|`/g, '').trim()
  const base = slugify(text)
  const n = collect.used.get(base) ?? 0
  collect.used.set(base, n + 1)
  const id = n === 0 ? base : `${base}-${n + 1}`
  collect.out.push({ id, text, level })
  return level === 2 ? (
    <h2 key={key} id={id} className="mb-2 mt-7 scroll-mt-24 text-base font-bold text-white first:mt-0">{inline(raw)}</h2>
  ) : (
    <h3 key={key} id={id} className="mb-2 mt-5 scroll-mt-24 text-sm font-bold uppercase tracking-wider text-blue-300/90 first:mt-0">{inline(raw)}</h3>
  )
}

function renderBlocks(body: string | null | undefined, collect: HeadingCollector | null): ReactNode {
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
      return heading(lines[0].replace(/^#{1,6}\s+/, ''), (lines[0].match(/^#+/) as RegExpMatchArray)[0].length, collect, bi)
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
          {head && heading(head.replace(/:$/, ''), null, collect, 0)}
          {tableNode(rows, false, bi)}
        </div>
      )
    }
    // Single short ALL-CAPS / colon line → heading.
    if (lines.length === 1 && isHeadingText(lines[0]))
      return heading(lines[0].replace(/:$/, ''), null, collect, bi)
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
      if (/^#{1,6}\s/.test(l)) { flush(); out.push(heading(l.replace(/^#{1,6}\s+/, ''), (l.match(/^#+/) as RegExpMatchArray)[0].length, collect, k++)) }
      else para.push(l)
    }
    flush()
    return <div key={bi}>{out}</div>
  })
}

/** Legacy renderer — exact pre-doc-mode output (case notes, previews). */
export function renderMarkdown(body: string | null | undefined): ReactNode {
  return renderBlocks(body, null)
}

/** Document-mode renderer: the same block classifier as renderMarkdown, but
 *  headings become semantic <h2>/<h3> with stable unique ids, and the emitted
 *  heading list is returned alongside — the reader's table of contents is
 *  BY CONSTRUCTION in lockstep with what rendered. */
export function renderDocumentMarkdown(body: string | null | undefined): { nodes: ReactNode; headings: DocHeading[] } {
  const collect: HeadingCollector = { used: new Map(), out: [] }
  const nodes = renderBlocks(body, collect)
  return { nodes, headings: collect.out }
}

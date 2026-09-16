/** Safe mini-Markdown → React renderer — port of the vanilla sopArticle
 *  engine (drive.js:421-516) used by the case Notes tab (and later SOPs).
 *  Vanilla escaped-then-innerHTML'd; here we build React elements, so user/DB
 *  text is auto-escaped and dangerouslySetInnerHTML is never used (hard rule).
 *
 *  Handles: \r\n, # headings, **bold**, `code`, > note blocks, -/1. lists,
 *  Markdown tables (|:-:| separators), bare pipe-delimited data blocks, and
 *  the short-ALL-CAPS / colon-terminated heading heuristic. */
import type { ReactNode } from 'react'
import { EntityLink } from '@/components/ui/EntityLink'
import { MENTION_RE, RESTRICTED_LABEL, isMentionKind, isMentionLinkKind, mentionKey, type MentionLabels } from './mentions'

/** Mention resolution for the read-only render (P5-05): the label map the
 *  caller resolved under RLS (lib/mentionResolve). A key present with `null`
 *  renders "Restricted record"; an absent key renders a muted "resolving"
 *  placeholder — the raw id is never printed. WITHOUT a resolver the token
 *  text is left untouched, so every legacy surface (case notes, SOPs)
 *  renders byte-for-byte as before. */
export interface RenderMarkdownOptions { mentions?: MentionLabels }

function mentionNode(kind: string, id: string, labels: MentionLabels, key: number): ReactNode {
  if (!isMentionKind(kind)) return null
  const k = mentionKey(kind, id)
  const label = labels[k]
  // Registry kinds deep-link; the platform-upgrade artefact kinds (evidence,
  // charge, report, legal, source) render their resolved label as a chip.
  if (typeof label === 'string' && label) {
    return isMentionLinkKind(kind)
      ? <EntityLink key={key} kind={kind} id={id} label={label} />
      : <span key={key} className="inline-flex max-w-full items-center rounded border border-white/10 bg-white/5 px-1.5 py-0.5 align-baseline text-xs font-medium text-slate-200">{label}</span>
  }
  if (label === null) return <span key={key} className="text-slate-400">{RESTRICTED_LABEL}</span>
  return <span key={key} className="text-slate-400" aria-busy="true">Resolving record…</span>
}

/** Inline **bold**, `code`, and [label](https://…) links within an
 *  escaped-by-React text run. Links are http(s)-only by the tokenizer's own
 *  pattern — any other scheme stays plain text, so javascript:/data: URLs
 *  can never become an href. */
function inline(t: string, labels: MentionLabels | null = null): ReactNode[] {
  const out: ReactNode[] = []
  // Tokenize on **bold**, `code`, [text](http…) links and — only when a
  // resolver is present — [kind:id] mention tokens, preserving order.
  const re = labels
    ? new RegExp(`(\\*\\*[^*]+\\*\\*|\`[^\`]+\`|\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^\\s)]+\\)|${MENTION_RE.source})`, 'gi')
    : /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(t))) {
    if (m.index > last) out.push(t.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>)
    else if (labels && m[2] && m[3]) out.push(mentionNode(m[2].toLowerCase(), m[3].toLowerCase(), labels, k++))
    else if (tok.startsWith('[')) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(tok) as RegExpExecArray
      out.push(
        <a key={k++} href={link[2]} target="_blank" rel="noreferrer" className="text-blue-300 underline decoration-blue-300/40 underline-offset-2 transition hover:text-blue-200">
          {link[1]}
        </a>,
      )
    }
    else out.push(<code key={k++} className="rounded bg-white/10 px-1 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>)
    last = m.index + tok.length
  }
  if (last < t.length) out.push(t.slice(last))
  return out
}

const isSep = (l: string) => /^\|?[\s:|-]+\|?$/.test(l) && l.includes('-')
const splitRow = (l: string) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

function cellNode(v: string, labels: MentionLabels | null): ReactNode {
  const t = v.trim()
  const l = t.toLowerCase()
  if (l === 'active') return <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">ACTIVE</span>
  if (l === 'inactive' || l === 'loa' || l === 'suspended' || l === 'tba')
    return <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">{t.toUpperCase()}</span>
  return <>{inline(t, labels)}</>
}

function tableNode(rows: string[][], hasHead: boolean, key: number, labels: MentionLabels | null): ReactNode {
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
                <th key={i} className="border-b border-r border-white/5 px-2.5 py-2 font-semibold">{c ? cellNode(c, labels) : <span className="text-slate-600">-</span>}</th>
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
                  <td key={i} className="border-b border-r border-white/5 px-2.5 py-1.5 text-slate-200">{c ? cellNode(c, labels) : <span className="text-slate-600">-</span>}</td>
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
function heading(raw: string, mdLevel: number | null, collect: HeadingCollector | null, key: number, labels: MentionLabels | null): ReactNode {
  if (!collect) return <H3 key={key}>{inline(raw, labels)}</H3>
  const level: 2 | 3 = mdLevel !== null && mdLevel >= 3 ? 3 : 2
  const text = raw.replace(/\*\*|`/g, '').trim()
  const base = slugify(text)
  const n = collect.used.get(base) ?? 0
  collect.used.set(base, n + 1)
  const id = n === 0 ? base : `${base}-${n + 1}`
  collect.out.push({ id, text, level })
  return level === 2 ? (
    <h2 key={key} id={id} className="mb-2 mt-7 scroll-mt-24 text-base font-bold text-white first:mt-0">{inline(raw, labels)}</h2>
  ) : (
    <h3 key={key} id={id} className="mb-2 mt-5 scroll-mt-24 text-sm font-bold uppercase tracking-wider text-blue-300/90 first:mt-0">{inline(raw, labels)}</h3>
  )
}

/** Reduce a line to the letters and digits in it, lowercased — so
 *  "CRIMINAL INVESTIGATION DIVISION (CID) STANDARD OPERATING PROCEDURE",
 *  "# Criminal Investigation Division (CID) Standard Operating Procedure" and
 *  "**Criminal Investigation Division (CID) Standard Operating Procedure**"
 *  all compare equal. */
const titleKey = (s: string): string =>
  s.replace(/^#{1,6}\s+/, '').replace(/[*_`]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** A word-processor tab label — "Tab 1", "Tab 2" — left behind by the export
 *  every migrated document came through. It names a tab in a document that no
 *  longer exists, so on its own line at the very top it is noise, not policy. */
const TAB_MARKER = /^Tab\s+\d+$/i

/** Drop the opening lines that only restate the document's own title.
 *
 *  Every document migrated out of the old library came from a word processor,
 *  where the title had to be typed into the page because nothing else carried
 *  it. In the portal the title is already the `<h1>`, so the first thing a
 *  reader sees is the same sentence two or three times — and the derived table
 *  of contents opens with an entry that goes nowhere useful.
 *
 *  Two things are removed and nothing else: an exact restatement of the title,
 *  and a bare export tab marker above it. Both only within the first few lines,
 *  before any prose. Policy wording is untouched — a line that says anything
 *  the heading does not is left exactly where the author put it — and the
 *  stored body is not modified, so the authoritative text and its revision
 *  history stay whole. This is a reading view, not an edit. */
export function stripDocumentPreamble(body: string | null | undefined, title: string | null | undefined): string {
  const text = String(body ?? '')
  const want = titleKey(String(title ?? ''))
  if (!want || !text) return text
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let seen = 0
  let i = 0
  let dropped = false
  // Only the opening of the document: once four non-empty lines have gone by,
  // a matching line is far more likely to be a real section about the subject
  // than a restated cover heading.
  while (i < lines.length && seen < 4) {
    const line = lines[i].trim()
    if (!line) { i += 1; continue }
    seen += 1
    // The tab marker goes only when it is the very first thing on the page and
    // the title follows it — that pairing is the export's signature, and it is
    // the only shape in which the marker is certainly not content.
    const isPreamble = titleKey(line) === want
      || (seen === 1 && TAB_MARKER.test(line)
        && lines.slice(i + 1).map((l) => l.trim()).filter(Boolean).slice(0, 3)
          .some((t) => titleKey(t) === want))
    if (isPreamble) {
      lines.splice(i, 1)
      dropped = true
      continue
    }
    // Nothing dropped from the first line means this document does not open
    // with a restatement at all; leave the rest of it alone.
    if (!dropped && seen >= 2) break
    i += 1
  }
  return lines.join('\n').replace(/^\n+/, '')
}

function renderBlocks(body: string | null | undefined, collect: HeadingCollector | null, labels: MentionLabels | null): ReactNode {
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
      return heading(lines[0].replace(/^#{1,6}\s+/, ''), (lines[0].match(/^#+/) as RegExpMatchArray)[0].length, collect, bi, labels)
    if (lines.every((l) => /^>\s?/.test(l)))
      return (
        <blockquote key={bi} className="my-3 rounded-lg border-l-2 border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm text-amber-100/90">
          {inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '), labels)}
        </blockquote>
      )
    // Lists.
    if (lines.length > 1 && lines.every((l) => /^([-*•]|\d+[.)])\s/.test(l))) {
      const ordered = /^\d/.test(lines[0])
      const items = lines.map((l, i) => <li key={i}>{inline(l.replace(/^([-*•]|\d+[.)])\s+/, ''), labels)}</li>)
      return ordered
        ? <ol key={bi} className="my-2 list-decimal space-y-1 pl-5 text-sm text-slate-200">{items}</ol>
        : <ul key={bi} className="my-2 list-disc space-y-1 pl-5 text-sm text-slate-200">{items}</ul>
    }
    // Tables: Markdown (with separator row) or bare pipe data.
    const piped = lines.filter((l) => l.includes('|'))
    const sepIdx = lines.findIndex(isSep)
    if (sepIdx === 1 && piped.length >= 2) {
      const rows = lines.filter((l, i) => i !== sepIdx && !isSep(l)).map(splitRow)
      return tableNode(rows, true, bi, labels)
    }
    const tabular = piped.length >= 2 || (piped.length === 1 && piped[0].split('|').length >= 4)
    if (tabular) {
      const rest = lines.slice()
      const head = !rest[0].includes('|') && !/^#/.test(rest[0]) ? rest.shift() : null
      const rows = rest.filter((l) => !isSep(l)).map(splitRow)
      return (
        <div key={bi}>
          {head && heading(head.replace(/:$/, ''), null, collect, 0, labels)}
          {tableNode(rows, false, bi, labels)}
        </div>
      )
    }
    // Single short ALL-CAPS / colon line → heading.
    if (lines.length === 1 && isHeadingText(lines[0]))
      return heading(lines[0].replace(/:$/, ''), null, collect, bi, labels)
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
              {inline(l, labels)}
            </span>
          ))}
        </p>,
      )
      para = []
    }
    for (const l of lines) {
      if (/^#{1,6}\s/.test(l)) { flush(); out.push(heading(l.replace(/^#{1,6}\s+/, ''), (l.match(/^#+/) as RegExpMatchArray)[0].length, collect, k++, labels)) }
      else para.push(l)
    }
    flush()
    return <div key={bi}>{out}</div>
  })
}

/** Legacy renderer — exact pre-doc-mode output (case notes, previews).
 *  Pass `{ mentions }` (a lib/mentionResolve label map) to resolve
 *  `[kind:id]` narrative tokens; without it they stay literal text. */
export function renderMarkdown(body: string | null | undefined, opts?: RenderMarkdownOptions): ReactNode {
  return renderBlocks(body, null, opts?.mentions ?? null)
}

/** Document-mode renderer: the same block classifier as renderMarkdown, but
 *  headings become semantic <h2>/<h3> with stable unique ids, and the emitted
 *  heading list is returned alongside — the reader's table of contents is
 *  BY CONSTRUCTION in lockstep with what rendered. */
export function renderDocumentMarkdown(body: string | null | undefined, opts?: RenderMarkdownOptions): { nodes: ReactNode; headings: DocHeading[] } {
  const collect: HeadingCollector = { used: new Map(), out: [] }
  const nodes = renderBlocks(body, collect, opts?.mentions ?? null)
  return { nodes, headings: collect.out }
}

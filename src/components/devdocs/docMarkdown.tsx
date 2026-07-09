'use client'

/** Markdown → React renderer for the Developer Handbook pages. Separate from
 *  src/lib/markdown.tsx because the handbook needs constructs the shared
 *  mini-renderer deliberately omits (fenced code blocks, links, anchor ids,
 *  checklists) — and lib/markdown is a security surface shared by user-typed
 *  content that must stay minimal. Same hard rule though: React elements
 *  only, never innerHTML; external hrefs pass safeUrl. */
import React, { type ReactNode } from 'react'
import { safeUrl } from '@/lib/safeUrl'

export interface DocHeading { id: string; text: string; level: 2 | 3 }

export const anchorId = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)

/** `[text](target)` → handbook navigation (…md links), external <a>, or
 *  same-page anchor. onLink receives (slug|null, anchor|null) for internal. */
type LinkFn = (slug: string | null, anchor: string | null) => void

function inline(text: string, onLink: LinkFn, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // Tokenize links first, then bold/code inside the remaining plain runs.
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  const pushPlain = (s: string) => {
    // **bold** and `code`
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
    let l = 0
    let mm: RegExpExecArray | null
    while ((mm = re.exec(s))) {
      if (mm.index > l) out.push(s.slice(l, mm.index))
      const tok = mm[0]
      if (tok.startsWith('**')) out.push(<strong key={`${keyBase}-b${k++}`} className="font-bold text-white">{tok.slice(2, -2)}</strong>)
      else out.push(<code key={`${keyBase}-c${k++}`} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-amber-200">{tok.slice(1, -1)}</code>)
      l = mm.index + tok.length
    }
    if (l < s.length) out.push(s.slice(l))
  }
  while ((m = linkRe.exec(text))) {
    if (m.index > last) pushPlain(text.slice(last, m.index))
    const [, label, target] = m
    if (/^https?:\/\//.test(target)) {
      const href = safeUrl(target)
      out.push(href
        ? <a key={`${keyBase}-a${k++}`} href={href} target="_blank" rel="noreferrer" className="text-blue-300 underline decoration-blue-300/40 hover:text-blue-200">{label}</a>
        : label)
    } else {
      // internal: "file.md", "file.md#anchor", or "#anchor"
      const [path, anchor] = target.split('#')
      const slug = path
        ? path.replace(/\.md$/, '').replace(/^\d+-/, '').replace(/^appendix-/, '').replace(/^README$/, 'home')
        : null
      out.push(
        <button
          key={`${keyBase}-l${k++}`}
          onClick={() => onLink(slug, anchor || null)}
          className="text-blue-300 underline decoration-blue-300/40 hover:text-blue-200"
        >
          {label}
        </button>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) pushPlain(text.slice(last))
  return out
}

const isSep = (l: string) => /^\s*\|?\s*:?-{2,}/.test(l) && l.includes('-')
const splitRow = (l: string) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())

export function docHeadings(body: string): DocHeading[] {
  const out: DocHeading[] = []
  let inCode = false
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) { inCode = !inCode; continue }
    if (inCode) continue
    const m = line.match(/^(##+)\s+(.+)$/)
    if (m && m[1].length <= 3) out.push({ id: anchorId(m[2]), text: m[2].replace(/\*\*/g, ''), level: m[1].length as 2 | 3 })
  }
  return out
}

export function renderDocMarkdown(body: string, onLink: LinkFn): ReactNode {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i++; continue }

    // fenced code block
    if (line.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++ }
      i++
      blocks.push(
        <pre key={key++} className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-ink-950 p-4 font-mono text-[12px] leading-relaxed text-slate-300">
          {buf.join('\n')}
        </pre>,
      )
      continue
    }

    // horizontal rule
    if (/^---+\s*$/.test(line)) { blocks.push(<hr key={key++} className="my-6 border-white/10" />); i++; continue }

    // headings
    const h = line.match(/^(#+)\s+(.+)$/)
    if (h) {
      const level = h[1].length
      const text = h[2]
      const id = anchorId(text)
      const content = inline(text, onLink, `h${key}`)
      if (level <= 2) blocks.push(<h2 key={key++} id={id} className="mt-8 mb-3 scroll-mt-24 border-b border-white/10 pb-2 text-lg font-black text-white">{content}</h2>)
      else blocks.push(<h3 key={key++} id={id} className="mt-6 mb-2 scroll-mt-24 text-sm font-black uppercase tracking-wider text-blue-300">{content}</h3>)
      i++
      continue
    }

    // blockquote
    if (line.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      blocks.push(
        <blockquote key={key++} className="my-4 rounded-r-xl border-l-2 border-amber-400/60 bg-amber-500/5 px-4 py-3 text-sm text-slate-300">
          {buf.map((b, j) => <p key={j} className={j ? 'mt-2' : ''}>{inline(b, onLink, `q${key}-${j}`)}</p>)}
        </blockquote>,
      )
      continue
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      const headers = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(splitRow(lines[i])); i++ }
      blocks.push(
        <div key={key++} className="my-4 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                {headers.map((hd, j) => <th key={j} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">{inline(hd, onLink, `th${key}-${j}`)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => <td key={ci} className="px-3 py-2 align-top text-slate-300">{inline(c, onLink, `td${key}-${ri}-${ci}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // lists (unordered, ordered, checklist)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: { text: string; ordered: boolean; check: boolean | null }[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let t = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')
        // continuation lines (indented, not new items)
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i + 1])) {
          t += ' ' + lines[i + 1].trim()
          i++
        }
        const cm = t.match(/^\[([ x])\]\s+(.*)$/)
        items.push({
          text: cm ? cm[2] : t,
          ordered: /^\s*\d+\./.test(lines[i]),
          check: cm ? cm[1] === 'x' : null,
        })
        i++
      }
      const ordered = items[0]?.ordered
      const Tag = ordered ? 'ol' : 'ul'
      blocks.push(
        <Tag key={key++} className={`my-3 space-y-1.5 pl-5 text-sm text-slate-300 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-slate-600`}>
          {items.map((it, j) => (
            <li key={j}>
              {it.check !== null && <span aria-hidden className="mr-1.5">{it.check ? '☑' : '☐'}</span>}
              {inline(it.text, onLink, `li${key}-${j}`)}
            </li>
          ))}
        </Tag>,
      )
      continue
    }

    // paragraph (merge soft-wrapped lines)
    const buf: string[] = [line]
    i++
    while (
      i < lines.length && lines[i].trim() &&
      !lines[i].startsWith('```') && !lines[i].startsWith('#') && !lines[i].startsWith('>') &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^---+\s*$/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isSep(lines[i + 1]))
    ) { buf.push(lines[i]); i++ }
    blocks.push(<p key={key++} className="my-3 text-sm leading-relaxed text-slate-300">{inline(buf.join(' '), onLink, `p${key}`)}</p>)
  }

  return <>{blocks}</>
}

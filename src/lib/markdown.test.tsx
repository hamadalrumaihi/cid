/** Pins for the safe mini-Markdown engine — the legacy renderer's output
 *  shape (case notes must not change) and the new document mode's heading
 *  ids/levels, which the reader TOC consumes. The TOC list and the rendered
 *  headings come from ONE pass, so these tests pin both at once. */
import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderDocumentMarkdown, renderMarkdown } from './markdown'

/** Depth-first flatten of a ReactNode tree into elements. */
function elements(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (isValidElement(n)) {
      out.push(n)
      walk((n.props as { children?: ReactNode }).children)
    }
  }
  walk(node)
  return out
}
const tags = (node: ReactNode) => elements(node).map((e) => e.type).filter((t) => typeof t === 'string')

describe('renderMarkdown (legacy mode — case notes unchanged)', () => {
  it('renders headings via the anonymous H3 component with no id', () => {
    const els = elements(renderMarkdown('# Title\n\nBody text.'))
    // Legacy headings are the local <H3> function component — never a raw
    // tag with an id, and never an <h2>.
    const heading = els.find((e) => typeof e.type === 'function')
    expect(heading).toBeDefined()
    expect((heading!.props as { id?: string }).id).toBeUndefined()
    expect(tags(renderMarkdown('# Title\n\nBody text.'))).toContain('p')
  })

  it('never emits h2 and keeps lists/tables/quotes working', () => {
    const md = '## Two\n\n- a\n- b\n\n> note\n\n| h | j |\n|---|---|\n| 1 | 2 |'
    const t = tags(renderMarkdown(md))
    expect(t).not.toContain('h2')
    expect(t).toContain('ul')
    expect(t).toContain('blockquote')
    expect(t).toContain('table')
  })

  it('empty body renders the placeholder paragraph', () => {
    const els = elements(renderMarkdown(''))
    expect(els[0].type).toBe('p')
  })
})

describe('renderDocumentMarkdown (doc mode — TOC in lockstep with render)', () => {
  it('maps #/## to h2 and ###+ to h3, with matching heading list', () => {
    const { nodes, headings } = renderDocumentMarkdown('# One\n\ntext\n\n## Two\n\ntext\n\n### Three\n\ntext')
    expect(headings).toEqual([
      { id: 'one', text: 'One', level: 2 },
      { id: 'two', text: 'Two', level: 2 },
      { id: 'three', text: 'Three', level: 3 },
    ])
    const els = elements(nodes)
    const rendered = els.filter((e) => e.type === 'h2' || e.type === 'h3')
      .map((e) => ({ tag: e.type, id: (e.props as { id: string }).id }))
    expect(rendered).toEqual([
      { tag: 'h2', id: 'one' }, { tag: 'h2', id: 'two' }, { tag: 'h3', id: 'three' },
    ])
  })

  it('ids are URL-safe, deterministic, and unique (duplicates suffixed)', () => {
    const { headings } = renderDocumentMarkdown('# Scene Response!\n\nx\n\n# Scene Response!\n\ny')
    expect(headings.map((h) => h.id)).toEqual(['scene-response', 'scene-response-2'])
    const again = renderDocumentMarkdown('# Scene Response!\n\nx\n\n# Scene Response!\n\ny')
    expect(again.headings.map((h) => h.id)).toEqual(['scene-response', 'scene-response-2'])
  })

  it('heuristic headings (ALL-CAPS / colon lines) join the TOC as h2', () => {
    const { headings } = renderDocumentMarkdown('EVIDENCE HANDLING\n\nAlways bag it.\n\nCustody chain:\n\nSign every hand-off.')
    expect(headings).toEqual([
      { id: 'evidence-handling', text: 'EVIDENCE HANDLING', level: 2 },
      { id: 'custody-chain', text: 'Custody chain', level: 2 },
    ])
  })

  it('strips inline markers from TOC text and slugs', () => {
    const { headings } = renderDocumentMarkdown('# Use of **Force** `Policy`\n\nx')
    expect(headings[0]).toEqual({ id: 'use-of-force-policy', text: 'Use of Force Policy', level: 2 })
  })

  it('inline # headings inside mixed blocks are collected too', () => {
    const { headings } = renderDocumentMarkdown('intro line\n# Mid Heading\nmore text')
    expect(headings.map((h) => h.id)).toContain('mid-heading')
  })

  it('a document with no headings yields an empty TOC and still renders', () => {
    const { nodes, headings } = renderDocumentMarkdown('just a paragraph')
    expect(headings).toEqual([])
    expect(tags(nodes)).toContain('p')
  })
})

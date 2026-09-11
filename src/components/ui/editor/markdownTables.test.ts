// @vitest-environment happy-dom
/** Markdown round-trip pins for the report editor's platform-upgrade
 *  extensions: GFM pipe tables (tiptap-markdown serialises a header-row
 *  table as `| a | b |` + `| --- | --- |`, markdown-it parses it back),
 *  underline (`<u>` in html mode), http(s)-only links, the `[kind:id]`
 *  grammar for inline mentions AND the lone-token entity block, and the
 *  slash-command filter. Builds the SAME extension set the surface mounts. */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { EDITOR_EXTENSIONS, MENTION_NODE } from '../RichEditorInner'
import { ENTITY_NODE } from './EntityBlock'
import { SLASH_COMMANDS, filterSlashCommands } from './SlashMenu'

const P = '11111111-2222-4333-8444-555555555555'
const E = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

let editor: Editor | null = null
const mount = (content: string): Editor => {
  editor = new Editor({ extensions: EDITOR_EXTENSIONS, content })
  return editor
}
const md = (e: Editor): string => (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
const names = (e: Editor): string[] => {
  const out: string[] = []
  e.state.doc.descendants((n) => { out.push(n.type.name) })
  return out
}
// Destroy, then let ProseMirror's 20 ms DOMObserver flush timer fire while
// the happy-dom `document` still exists — otherwise it can land after the
// environment is torn down and surface as an unhandled ReferenceError.
afterEach(async () => {
  editor?.destroy()
  editor = null
  await new Promise((r) => setTimeout(r, 40))
})

describe('tables', () => {
  it('round-trips a GFM pipe table with a header row', () => {
    const src = '| Item | Qty |\n| --- | --- |\n| Bag | 2 |\n| Scale | 1 |'
    const e = mount(src)
    expect(names(e)).toContain('table')
    expect(names(e).filter((n) => n === 'tableHeader')).toHaveLength(2)
    expect(names(e).filter((n) => n === 'tableCell')).toHaveLength(4)
    // Cells are padded to a fixed width by the serializer; collapse runs of
    // spaces (never newlines) before comparing.
    expect(md(e).replace(/[ \t]+\|/g, ' |').trim()).toBe(src)
  })

  it('serialises an inserted 3 × 3 table (header row) as a pipe table', () => {
    const e = mount('')
    e.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    const out = md(e)
    const lines = out.trim().split('\n')
    expect(lines).toHaveLength(4) // header + delimiter + two body rows
    expect(lines[1]).toBe('| --- | --- | --- |')
    // And parses back to the same shape.
    const again = mount(out)
    expect(names(again).filter((n) => n === 'tableRow')).toHaveLength(3)
  })
})

describe('marks', () => {
  it('underline goes out as <u> (html mode) and comes back as the mark', () => {
    const e = mount('')
    e.chain().insertContent('plain ').toggleUnderline().insertContent('under').run()
    expect(md(e)).toBe('plain <u>under</u>')
    const again = mount('plain <u>under</u>')
    let underlined = ''
    again.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'underline')) underlined += n.text })
    expect(underlined).toBe('under')
  })

  it('links round-trip; javascript: links never become an href', () => {
    const e = mount('see [the notice](https://example.org/n/1) now')
    let href = ''
    e.state.doc.descendants((n) => { for (const m of n.marks) if (m.type.name === 'link') href = String(m.attrs.href) })
    expect(href).toBe('https://example.org/n/1')
    expect(md(e)).toBe('see [the notice](https://example.org/n/1) now')
    const bad = mount('[x](javascript:alert(1))')
    let anyLink = false
    bad.state.doc.descendants((n) => { if (n.marks.some((m) => m.type.name === 'link')) anyLink = true })
    // The text stays literal (escaped brackets), with no link mark → no href.
    expect(anyLink).toBe(false)
    expect(bad.getHTML()).not.toContain('<a')
  })
})

describe('mention grammar', () => {
  it('a token inside a sentence is an inline chip; a lone-token paragraph is an entity block', () => {
    const e = mount(`Met [person:${P}] at the dock.\n\n[evidence:${E}]\n\nEnd.`)
    const kinds = names(e)
    expect(kinds).toContain(MENTION_NODE)
    expect(kinds).toContain(ENTITY_NODE)
    expect(md(e)).toBe(`Met [person:${P}] at the dock.\n\n[evidence:${E}]\n\nEnd.`)
  })

  it('an inserted entity block serialises to its token on its own line', () => {
    const e = mount('Before')
    e.chain().focus('end').insertContent([{ type: ENTITY_NODE, attrs: { kind: 'charge', id: P, label: 'Murder', code: '187' } }]).run()
    const out = md(e)
    expect(out).toContain(`[charge:${P}]`)
    expect(out).not.toContain('Murder')
    expect(out).not.toContain('187')
    const again = mount(out)
    expect(names(again)).toContain(ENTITY_NODE)
  })
})

describe('slash commands', () => {
  it('lists the eleven entity commands and the four format commands', () => {
    expect(SLASH_COMMANDS.map((c) => c.id)).toEqual([
      'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'case', 'charge', 'report', 'legal', 'source',
      'table', 'heading', 'list', 'quote',
    ])
    expect(SLASH_COMMANDS.filter((c) => c.kind)).toHaveLength(11)
  })

  it('filters by prefix first, then substring over label and keywords', () => {
    expect(filterSlashCommands('').map((c) => c.id)).toHaveLength(SLASH_COMMANDS.length)
    const le = filterSlashCommands('le').map((c) => c.id)
    expect(le[0]).toBe('legal') // the one prefix match leads
    expect(le).toEqual(expect.arrayContaining(['vehicle', 'table']))
    expect(le).not.toContain('person')
    expect(filterSlashCommands('warrant').map((c) => c.id)).toEqual(['legal'])
    expect(filterSlashCommands('zzz')).toEqual([])
  })
})

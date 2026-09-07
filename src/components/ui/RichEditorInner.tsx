'use client'

/** Rich-text editor (Tiptap v3) that READS AND WRITES MARKDOWN — storage
 *  stays plain markdown text, so everything downstream (renderMarkdown views,
 *  .md exports, the PDF/docx packet, gdrive-synced SOPs) is untouched. The
 *  editor is WYSIWYG: bold shows bold, lists indent, markdown shortcuts work
 *  (## + space → heading, - + space → list, **b** → bold). Value is
 *  initial-only — mount the editor fresh per edit session (both call sites
 *  already do).
 *
 *  Mentions (P5-05, RB5): an inline atom node `cidMention` that serialises
 *  to the `[kind:id]` token of lib/mentions and parses it back, so the
 *  markdown round-trips with tiptap-markdown untouched. Typing `@` (at a word
 *  start) or the toolbar "@" opens the shared EntityPicker; the picked record
 *  is inserted as a chip carrying its display label. Labels are NOT part of
 *  the token — tokens already in the text are resolved on mount through
 *  lib/mentionResolve (bounded `list()` lookups; RLS decides), and a record
 *  the author cannot read renders "Restricted record". The raw id is never
 *  shown. Pass `mentions` to enable the trigger; the node itself is always
 *  registered so an existing token never degrades to literal text.
 *
 *  Import via ui/RichEditor (the lazy wrapper) — never directly. This module
 *  carries the whole @tiptap bundle, and the wrapper keeps it out of the
 *  shared chunk until an edit surface actually mounts. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, Node as TiptapNode, mergeAttributes, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { EntityPicker, type EntitySuggestFn } from '@/components/entity/EntityPicker'
import { KIND_LABEL } from '@/lib/entity/kinds'
import type { EntityHit } from '@/lib/entitySearch'
import {
  MENTION_KINDS, MENTION_RE, RESTRICTED_LABEL, isMentionKind, mentionKey, mentionToken, splitMentions,
  type MentionKind, type MentionLabels, type MentionRef,
} from '@/lib/mentions'
import { resolveMentionLabels } from '@/lib/mentionResolve'
import { Button } from './Button'
import { Field, Select } from './Field'
import { Modal, ModalHeader } from './Modal'

const md = (editor: Editor): string =>
  (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

/* ── Mention node ─────────────────────────────────────────────────────────── */

export const MENTION_NODE = 'cidMention'
const MENTION_ONE = new RegExp(MENTION_RE.source, 'i')
const CHIP_CLASS = 'cid-mention inline-flex max-w-full items-center rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 align-baseline text-xs font-medium text-blue-200'

/** Replace `[kind:id]` text runs (outside code) with mention spans so the
 *  node's parseHTML picks them up. Runs inside tiptap-markdown's parse step
 *  (`storage.markdown.parse.updateDOM`), i.e. only in a browser DOM. */
function upgradeMentionText(root: HTMLElement): void {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const targets: Text[] = []
  let n: globalThis.Node | null
  while ((n = walker.nextNode())) {
    const t = n as Text
    if (!t.parentElement?.closest('code,pre') && MENTION_ONE.test(t.data)) targets.push(t)
  }
  for (const t of targets) {
    const frag = doc.createDocumentFragment()
    for (const seg of splitMentions(t.data)) {
      if (typeof seg === 'string') { frag.appendChild(doc.createTextNode(seg)); continue }
      const span = doc.createElement('span')
      span.setAttribute('data-mention-kind', seg.kind)
      span.setAttribute('data-mention-id', seg.id)
      span.textContent = '@…'
      frag.appendChild(span)
    }
    t.replaceWith(frag)
  }
}

interface MentionAttrs { kind: MentionKind; id: string; label: string | null }

/** Exported for the round-trip test seam only; the editor registers it. */
export const MentionNode = TiptapNode.create({
  name: MENTION_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      kind: { default: 'person', parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-kind'), renderHTML: (a: MentionAttrs) => ({ 'data-mention-kind': a.kind }) },
      id: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-id'), renderHTML: (a: MentionAttrs) => ({ 'data-mention-id': a.id }) },
      label: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-label'), renderHTML: (a: MentionAttrs) => (a.label ? { 'data-mention-label': a.label } : {}) },
    }
  },
  parseHTML() { return [{ tag: 'span[data-mention-kind][data-mention-id]' }] },
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as MentionAttrs
    return ['span', mergeAttributes(HTMLAttributes, { class: CHIP_CLASS, contenteditable: 'false' }), `@${a.label ?? '…'}`]
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: { write(s: string): void }, node: { attrs: MentionAttrs }) {
          const a = node.attrs
          state.write(isMentionKind(a.kind) && a.id ? mentionToken(a.kind, a.id) : '')
        },
        parse: { updateDOM: upgradeMentionText },
      },
    }
  },
})

/** Refs in the document whose chip still has no label. */
function unlabelledRefs(editor: Editor): MentionRef[] {
  const out: MentionRef[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name !== MENTION_NODE) return
    const a = node.attrs as MentionAttrs
    if (!a.label && isMentionKind(a.kind) && a.id) out.push({ kind: a.kind, id: a.id })
  })
  return out
}

/** Stamp resolved labels onto the chips. A label-only change never touches
 *  the markdown (labels are not serialised), so the transaction is flagged
 *  and skipped by onUpdate — the surface does not read as dirty. */
const LABEL_META = 'cidMentionLabels'
function applyLabels(editor: Editor, labels: MentionLabels): void {
  const tr = editor.state.tr
  let changed = false
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== MENTION_NODE) return
    const a = node.attrs as MentionAttrs
    const l = labels[mentionKey(a.kind, a.id)]
    if (l === undefined) return
    const next = l ?? RESTRICTED_LABEL
    if (next !== a.label) { tr.setNodeMarkup(pos, undefined, { ...a, label: next }); changed = true }
  })
  if (changed) { tr.setMeta('addToHistory', false); tr.setMeta(LABEL_META, true); editor.view.dispatch(tr) }
}

/* ── Toolbar ──────────────────────────────────────────────────────────────── */

function Btn({ editor, active, onRun, title, children }: {
  editor: Editor
  active?: string
  onRun: (e: Editor) => void
  title: string
  children: React.ReactNode
}) {
  const isOn = active ? editor.isActive(active) : false
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ? isOn : undefined}
      onMouseDown={(e) => e.preventDefault() /* keep editor focus */}
      onClick={() => onRun(editor)}
      className={`rounded-md px-2 py-1 text-xs font-bold transition ${isOn ? 'bg-badge-500 text-white' : 'text-slate-300 hover:bg-white/10'}`}
    >
      {children}
    </button>
  )
}

export interface RichEditorMentionOptions {
  /** Labels the caller already holds (key `kind:id`, e.g. from the report's
   *  entity snapshots via lib/mentions withMentionLabels). */
  labels?: MentionLabels
  /** Every label learned — a picker insert or a resolved lookup — so the
   *  caller can derive the report_entities mention rows on save. */
  onLabels?: (labels: MentionLabels) => void
  /** Kinds the picker offers (default: every mention kind). */
  kinds?: readonly MentionKind[]
  /** Injection seam for stories and tests; never set it in app code. */
  suggest?: EntitySuggestFn
}

export function RichEditorInner({ value, onChange, minHeight = '18rem', mentions, id }: {
  value: string
  onChange: (markdown: string) => void
  minHeight?: string
  /** Applied to the editable ProseMirror element (labels, tests). */
  id?: string
  /** Enables the `@` trigger and the toolbar mention button. */
  mentions?: RichEditorMentionOptions
}) {
  const mentionsRef = useRef(mentions)
  useEffect(() => { mentionsRef.current = mentions })
  // Insert position captured when `@` was typed (null = at the selection).
  const [picker, setPicker] = useState<{ at: number | null } | null>(null)
  const [kind, setKind] = useState<MentionKind>(mentions?.kinds?.[0] ?? 'person')
  const asked = useRef<Set<string>>(new Set())

  const learn = useCallback((labels: MentionLabels) => { mentionsRef.current?.onLabels?.(labels) }, [])

  const resolvePending = useCallback((editor: Editor) => {
    const known = mentionsRef.current?.labels
    const pending = unlabelledRefs(editor)
    if (!pending.length) return
    if (known) applyLabels(editor, known)
    const ask = pending.filter((r) => {
      const k = mentionKey(r.kind, r.id)
      return !asked.current.has(k) && typeof known?.[k] !== 'string'
    })
    if (!ask.length) return
    for (const r of ask) asked.current.add(mentionKey(r.kind, r.id))
    void resolveMentionLabels(ask).then((res) => {
      if (editor.isDestroyed) return
      applyLabels(editor, res)
      const learned = Object.fromEntries(Object.entries(res).filter(([, v]) => typeof v === 'string'))
      if (Object.keys(learned).length) learn(learned)
    })
  }, [learn])

  const editor = useEditor({
    extensions: [StarterKit, MentionNode, Markdown.configure({ transformPastedText: true })],
    content: value,
    immediatelyRender: false,
    onCreate: ({ editor }) => resolvePending(editor),
    onUpdate: ({ editor, transaction }) => {
      if (transaction.getMeta(LABEL_META)) return
      onChange(md(editor))
      if (transaction.docChanged) resolvePending(editor)
    },
    editorProps: {
      attributes: { class: 'rich-editor-content focus:outline-none', style: `min-height:${minHeight}`, ...(id ? { id } : {}) },
      handleTextInput: (view, from, _to, text) => {
        if (!mentionsRef.current || text !== '@') return false
        // Word-start only, so e-mail addresses keep typing normally.
        const before = from > 0 ? view.state.doc.textBetween(from - 1, from) : ''
        if (before && !/\s/.test(before)) return false
        window.setTimeout(() => setPicker({ at: from }), 0)
        return false
      },
    },
  })

  // Labels handed in after mount (the caller's snapshot lookup landing late)
  // — keyed on the CONTENT of mentions.labels, read through the ref.
  const knownKeys = mentions?.labels ? JSON.stringify(mentions.labels) : ''
  useEffect(() => {
    const known = mentionsRef.current?.labels
    if (editor && known && knownKeys) applyLabels(editor, known)
  }, [editor, knownKeys])

  if (!editor) return <div className="rounded-lg border border-white/10 bg-ink-950 p-3 text-sm text-slate-500" style={{ minHeight }}>Loading editor…</div>

  const closePicker = () => { setPicker(null); editor.commands.focus() }
  const insertMention = (hit: EntityHit | null) => {
    if (!hit || !picker) return
    const { at } = picker
    const doc = editor.state.doc
    const hasAt = at !== null && at < doc.content.size && doc.textBetween(at, at + 1) === '@'
    const range = hasAt ? { from: at, to: at + 1 } : { from: editor.state.selection.from, to: editor.state.selection.to }
    editor.chain().focus()
      .insertContentAt(range, [{ type: MENTION_NODE, attrs: { kind, id: hit.id, label: hit.label } }, { type: 'text', text: ' ' }])
      .run()
    learn({ [mentionKey(kind, hit.id)]: hit.label })
    setPicker(null)
  }
  const kinds = mentions?.kinds ?? MENTION_KINDS

  const hd = (level: 2 | 3) => (e: Editor) => e.chain().focus().toggleHeading({ level }).run()
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-ink-950 transition focus-within:border-badge-500 focus-within:ring-2 focus-within:ring-badge-500/30">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-white/10 bg-white/[0.03] px-2 py-1.5">
        <Btn editor={editor} active="bold" title="Bold (⌘B)" onRun={(e) => e.chain().focus().toggleBold().run()}><span className="font-black">B</span></Btn>
        <Btn editor={editor} active="italic" title="Italic (⌘I)" onRun={(e) => e.chain().focus().toggleItalic().run()}><span className="italic">I</span></Btn>
        <Btn editor={editor} active="strike" title="Strikethrough" onRun={(e) => e.chain().focus().toggleStrike().run()}><span className="line-through">S</span></Btn>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <Btn editor={editor} active="heading" title="Heading" onRun={hd(2)}>H2</Btn>
        <Btn editor={editor} title="Sub-heading" onRun={hd(3)}>H3</Btn>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <Btn editor={editor} active="bulletList" title="Bullet list" onRun={(e) => e.chain().focus().toggleBulletList().run()}>••</Btn>
        <Btn editor={editor} active="orderedList" title="Numbered list" onRun={(e) => e.chain().focus().toggleOrderedList().run()}>1.</Btn>
        <Btn editor={editor} active="blockquote" title="Note block" onRun={(e) => e.chain().focus().toggleBlockquote().run()}>❝</Btn>
        <Btn editor={editor} active="code" title="Inline code" onRun={(e) => e.chain().focus().toggleCode().run()}>{'</>'}</Btn>
        {mentions && (<>
          <span className="mx-1 h-4 w-px bg-white/10" />
          <Btn editor={editor} title="Mention a record (@)" onRun={() => setPicker({ at: null })}>@</Btn>
        </>)}
        <span className="mx-1 h-4 w-px bg-white/10" />
        <Btn editor={editor} title="Undo (⌘Z)" onRun={(e) => e.chain().focus().undo().run()}>↺</Btn>
        <Btn editor={editor} title="Redo" onRun={(e) => e.chain().focus().redo().run()}>↻</Btn>
      </div>
      <EditorContent editor={editor} className="px-3 py-2 text-sm text-slate-100" />
      {mentions && (
        <Modal open={!!picker} onClose={closePicker}>
          <div className="p-5">
            <ModalHeader title="Mention a record" onClose={closePicker} />
            <div className="space-y-3">
              <Field label="Record type">
                {(id) => (
                  <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as MentionKind)}>
                    {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k].one.replace(/^\w/, (c) => c.toUpperCase())}</option>)}
                  </Select>
                )}
              </Field>
              <EntityPicker
                key={kind}
                kind={kind}
                label={`Search ${KIND_LABEL[kind].many}`}
                value={null}
                onChange={insertMention}
                suggest={mentions.suggest}
                hint="The record is inserted as a chip; readers who cannot open it see “Restricted record”."
              />
              <div className="flex justify-end">
                <Button onClick={closePicker}>Cancel</Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

'use client'

/** Rich-text editor (Tiptap v3) that READS AND WRITES MARKDOWN — storage
 *  stays plain markdown text, so everything downstream (renderMarkdown views,
 *  .md exports, the PDF/docx packet, gdrive-synced SOPs) is untouched. The
 *  editor is WYSIWYG: bold shows bold, lists indent, markdown shortcuts work
 *  (## + space → heading, - + space → list, **b** → bold). Value is
 *  initial-only — mount the editor fresh per edit session (both call sites
 *  already do).
 *
 *  Import via ui/RichEditor (the lazy wrapper) — never directly. This module
 *  carries the whole @tiptap bundle, and the wrapper keeps it out of the
 *  shared chunk until an edit surface actually mounts. */
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'

const md = (editor: Editor): string =>
  (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

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

export function RichEditorInner({ value, onChange, minHeight = '18rem' }: {
  value: string
  onChange: (markdown: string) => void
  minHeight?: string
}) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ transformPastedText: true })],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(md(editor)),
    editorProps: {
      attributes: { class: 'rich-editor-content focus:outline-none', style: `min-height:${minHeight}` },
    },
  })

  if (!editor) return <div className="rounded-xl border border-white/10 bg-ink-950 p-3 text-sm text-slate-500" style={{ minHeight }}>Loading editor…</div>

  const hd = (level: 2 | 3) => (e: Editor) => e.chain().focus().toggleHeading({ level }).run()
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-950 transition focus-within:border-badge-500 focus-within:ring-2 focus-within:ring-badge-500/30">
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
        <span className="mx-1 h-4 w-px bg-white/10" />
        <Btn editor={editor} title="Undo (⌘Z)" onRun={(e) => e.chain().focus().undo().run()}>↺</Btn>
        <Btn editor={editor} title="Redo" onRun={(e) => e.chain().focus().redo().run()}>↻</Btn>
      </div>
      <EditorContent editor={editor} className="px-3 py-2 text-sm text-slate-100" />
    </div>
  )
}

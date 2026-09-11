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
 *  Platform upgrade (report editor): tables (GFM pipe tables through
 *  tiptap-markdown — verified by editor/markdownTables.test.ts), underline
 *  (`<u>` in html mode), http(s)-only links (safeUrl), and a slash menu
 *  (`/person … /source`, `/table /heading /list /quote`) whose entity
 *  commands open the picker for that kind and insert a `cidEntity` BLOCK
 *  (editor/EntityBlock.tsx) — same `[kind:id]` grammar, on its own line.
 *  Evidence / report / legal pickers are scoped to `caseId` (the case the
 *  report belongs to); charge reads the penal catalog; source uses
 *  `external_source_search`. The slash trigger and the table / underline /
 *  link buttons follow flag `advanced_editor`; the nodes and marks are
 *  always registered so saved content never degrades.
 *
 *  Import via ui/RichEditor (the lazy wrapper) — never directly. This module
 *  carries the whole @tiptap bundle, and the wrapper keeps it out of the
 *  shared chunk until an edit surface actually mounts. */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { EditorContent, Node as TiptapNode, mergeAttributes, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { Markdown } from 'tiptap-markdown'
import { EntityPicker, type EntitySuggestFn } from '@/components/entity/EntityPicker'
import { RecordSearchPicker } from '@/components/shared/RecordSearchPicker'
import { LinkIcon } from '@/components/shell/icons'
import { list, rpc } from '@/lib/db'
import { KIND_LABEL } from '@/lib/entity/kinds'
import type { EntityHit } from '@/lib/entitySearch'
import { useFlag } from '@/lib/flags'
import { reportTitle } from '@/lib/forms'
import {
  MENTION_LINK_KINDS, MENTION_RE, RESTRICTED_LABEL, isMentionKind, isMentionLinkKind, mentionKey, mentionToken, splitMentions,
  type MentionKind, type MentionLabels, type MentionLinkKind, type MentionRef,
} from '@/lib/mentions'
import { resolveMentionLabels } from '@/lib/mentionResolve'
import { ensurePenalCode, penalCatalog, penalSearch } from '@/lib/penal'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { Button } from './Button'
import { uiPrompt } from './dialog'
import { ENTITY_NODE, EntityBlockNode, type EntityAttrs } from './editor/EntityBlock'
import { SlashMenu, filterSlashCommands, type SlashCommand } from './editor/SlashMenu'
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
 *  (`storage.markdown.parse.updateDOM`), i.e. only in a browser DOM. A
 *  paragraph that holds nothing but one token is an entity BLOCK (see
 *  editor/EntityBlock upgradeEntityBlocks) — it is skipped here. */
function upgradeMentionText(root: HTMLElement): void {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const targets: Text[] = []
  let n: globalThis.Node | null
  while ((n = walker.nextNode())) {
    const t = n as Text
    if (t.parentElement?.closest('code,pre,[data-entity-kind]')) continue
    if (!MENTION_ONE.test(t.data)) continue
    const p = t.parentElement
    if (p?.tagName === 'P' && p.childNodes.length === 1 && isLoneToken(t.data)) continue
    targets.push(t)
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

const isLoneToken = (text: string): boolean => {
  const segs = splitMentions(text)
  return segs.filter((s) => typeof s !== 'string').length === 1 && !segs.filter((s): s is string => typeof s === 'string').join('').trim()
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

/** The extension set — exported so the markdown round-trip test builds the
 *  SAME editor the surface mounts. Order matters for the markdown parse
 *  hooks: the entity block claims lone-token paragraphs before the inline
 *  mention pass walks the remaining text. */
export const EDITOR_EXTENSIONS = [
  // StarterKit v3 bundles link + underline; they are registered explicitly
  // below (configured) so the names never collide.
  StarterKit.configure({ link: false, underline: false }),
  Underline,
  Link.configure({
    openOnClick: false,
    autolink: true,
    linkOnPaste: true,
    protocols: ['http', 'https'],
    // http(s) only — safeUrl refuses javascript:/data:/vbscript: and any
    // control character; the default validator handles the URL grammar.
    isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && /^https?:\/\//i.test(safeUrl(url)),
    HTMLAttributes: { rel: 'noopener noreferrer nofollow', class: 'text-blue-300 underline underline-offset-2' },
  }),
  Table.configure({ resizable: false, HTMLAttributes: { class: 'my-2 w-full border-collapse text-sm' } }),
  TableRow,
  TableHeader.configure({ HTMLAttributes: { class: 'border border-white/10 bg-white/5 px-2 py-1 text-left font-semibold text-slate-100' } }),
  TableCell.configure({ HTMLAttributes: { class: 'border border-white/10 px-2 py-1 align-top' } }),
  EntityBlockNode,
  MentionNode,
  Markdown.configure({ transformPastedText: true }),
]

const isRefNode = (name: string): boolean => name === MENTION_NODE || name === ENTITY_NODE

/** Refs in the document (chips and blocks) that still have no label. */
function unlabelledRefs(editor: Editor): MentionRef[] {
  const out: MentionRef[] = []
  editor.state.doc.descendants((node) => {
    if (!isRefNode(node.type.name)) return
    const a = node.attrs as MentionAttrs
    if (!a.label && isMentionKind(a.kind) && a.id) out.push({ kind: a.kind, id: a.id })
  })
  return out
}

/** Stamp resolved labels onto the chips and blocks. A label-only change
 *  never touches the markdown (labels are not serialised), so the transaction
 *  is flagged and skipped by onUpdate — the surface does not read as dirty. */
const LABEL_META = 'cidMentionLabels'
function applyLabels(editor: Editor, labels: MentionLabels): void {
  const tr = editor.state.tr
  let changed = false
  editor.state.doc.descendants((node, pos) => {
    if (!isRefNode(node.type.name)) return
    const a = node.attrs as MentionAttrs
    const l = labels[mentionKey(a.kind, a.id)]
    if (l === undefined) return
    const next = l ?? RESTRICTED_LABEL
    if (next !== a.label) { tr.setNodeMarkup(pos, undefined, { ...a, label: next }); changed = true }
  })
  if (changed) { tr.setMeta('addToHistory', false); tr.setMeta(LABEL_META, true); editor.view.dispatch(tr) }
}

/* ── Artefact pickers (evidence / charge / report / legal / source) ───────── */

/** A picked artefact: `label` is what the block shows, `code` its number,
 *  `full` the label the mention map / report_entities row carries (matches
 *  what lib/mentionResolve produces for the same record). */
interface ArtefactHit extends EntityHit { code: string | null; full: string }

const str = (v: unknown): string => (v == null ? '' : String(v))
const matches = (q: string, ...hay: unknown[]): boolean => {
  const needle = q.trim().toLowerCase()
  return !needle || hay.some((h) => str(h).toLowerCase().includes(needle))
}
const withFull = (id: string, label: string, code: string | null, sublabel?: string): ArtefactHit =>
  ({ id, label, sublabel, code, full: code ? `${label} · ${code}` : label })

async function searchEvidence(caseId: string, q: string): Promise<ArtefactHit[]> {
  const rows = await list('media', { select: 'id,title,evidence_number,type', eq: { case_id: caseId }, is: { archived_at: null }, order: 'created_at', ascending: false, limit: 100 })
  return rows
    .filter((m) => matches(q, m.title, m.evidence_number))
    .slice(0, 30)
    .map((m) => withFull(m.id, m.title || 'Evidence', m.evidence_number ?? null, m.evidence_number ? undefined : str(m.type)))
}

async function searchCharges(q: string): Promise<ArtefactHit[]> {
  await ensurePenalCode()
  const rows = q.trim() ? penalSearch(q) : penalCatalog()
  return rows.slice(0, 30).map((c) => withFull(c.id, c.title, c.code, c.level))
}

async function searchReports(caseId: string, q: string): Promise<ArtefactHit[]> {
  const rows = await list('reports', { select: 'id,template,kind,seq,created_at', eq: { case_id: caseId }, order: 'created_at', ascending: false, limit: 100 })
  return rows
    .map((r) => ({ id: r.id, title: reportTitle(r) }))
    .filter((r) => matches(q, r.title))
    .slice(0, 30)
    .map((r) => withFull(r.id, r.title, null))
}

async function searchLegal(caseId: string, q: string): Promise<ArtefactHit[]> {
  const rows = await list('legal_requests', { select: 'id,request_number,request_type,subtype', eq: { case_id: caseId }, order: 'created_at', ascending: false, limit: 100 })
  return rows
    .filter((r) => matches(q, r.request_number, r.request_type, r.subtype))
    .slice(0, 30)
    .map((r) => withFull(r.id, r.request_type, r.request_number, r.subtype ?? undefined))
}

async function searchSources(q: string): Promise<ArtefactHit[]> {
  if (q.trim().length >= 2) {
    const res = await rpc('external_source_search', { p_q: q.trim(), p_limit: 20 })
    if (res.error) throw new Error(res.error.message)
    return (res.data ?? []).map((r) => withFull(r.source_id, r.title || r.domain, r.source_number, r.domain))
  }
  const rows = await list('external_sources', { select: 'id,source_number,title,domain', order: 'created_at', ascending: false, limit: 20 })
  return rows.map((r) => withFull(r.id, r.title || r.domain, r.source_number, r.domain))
}

const CASE_SCOPED: ReadonlySet<MentionKind> = new Set(['evidence', 'report', 'legal'])
const ARTEFACT_LABEL: Record<MentionKind, string> = {
  person: 'person', vehicle: 'vehicle', gang: 'organisation', place: 'place', case: 'case', narcotic: 'narcotic',
  evidence: 'evidence item', charge: 'charge', report: 'report', legal: 'legal request', source: 'external source',
}

/* ── Toolbar ──────────────────────────────────────────────────────────────── */

function Btn({ editor, active, onRun, title, children }: {
  editor: Editor
  active?: string
  onRun: (e: Editor) => unknown
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
      onClick={() => void onRun(editor)}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 py-1 text-xs font-bold transition lg:min-h-0 lg:min-w-0 ${isOn ? 'bg-badge-500 text-white' : 'text-slate-300 hover:bg-white/10'}`}
    >
      {children}
    </button>
  )
}

const Sep = () => <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />

export interface RichEditorMentionOptions {
  /** Labels the caller already holds (key `kind:id`, e.g. from the report's
   *  entity snapshots via lib/mentions withMentionLabels). */
  labels?: MentionLabels
  /** Every label learned — a picker insert or a resolved lookup — so the
   *  caller can derive the report_entities mention rows on save. */
  onLabels?: (labels: MentionLabels) => void
  /** Kinds the `@` picker offers (default: every registry kind). */
  kinds?: readonly MentionLinkKind[]
  /** Injection seam for stories and tests; never set it in app code. */
  suggest?: EntitySuggestFn
}

interface PickerState {
  /** Insert position captured when `@` was typed (null = at the selection). */
  at: number | null
  kind: MentionKind
  /** true → the slash menu asked for a block; false → an inline `@` chip. */
  block: boolean
}

interface SlashState { at: number; query: string; index: number; pos: { left: number; top: number } }

export function RichEditorInner({ value, onChange, minHeight = '18rem', mentions, id, caseId }: {
  value: string
  onChange: (markdown: string) => void
  minHeight?: string
  /** Applied to the editable ProseMirror element (labels, tests). */
  id?: string
  /** Enables the `@` trigger and the toolbar mention button. */
  mentions?: RichEditorMentionOptions
  /** The case the narrative belongs to — scopes the evidence / report /
   *  legal slash commands. Without it those three commands explain why
   *  they are unavailable instead of listing nothing. */
  caseId?: string
}) {
  const mentionsRef = useRef(mentions)
  useEffect(() => { mentionsRef.current = mentions })
  const advanced = useFlag('advanced_editor')
  const advancedRef = useRef(advanced)
  useEffect(() => { advancedRef.current = advanced })
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const slashRef = useRef(slash)
  useEffect(() => { slashRef.current = slash })
  const asked = useRef<Set<string>>(new Set())
  const slashListId = useId()

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

  /** Re-derive the slash query from the document after every change: the
   *  run from the `/` to the caret is the query; a space, a newline or a
   *  caret before the slash closes the menu. */
  const syncSlash = useCallback((editor: Editor) => {
    const s = slashRef.current
    if (!s) return
    const from = editor.state.selection.from
    if (from <= s.at) { setSlash(null); return }
    const text = editor.state.doc.textBetween(s.at, from, '\n')
    if (!text.startsWith('/') || /\s/.test(text)) { setSlash(null); return }
    const query = text.slice(1)
    if (query !== s.query) setSlash({ ...s, query, index: 0 })
  }, [])

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: value,
    immediatelyRender: false,
    onCreate: ({ editor }) => resolvePending(editor),
    onUpdate: ({ editor, transaction }) => {
      if (transaction.getMeta(LABEL_META)) return
      onChange(md(editor))
      if (transaction.docChanged) { resolvePending(editor); syncSlash(editor) }
    },
    onSelectionUpdate: ({ editor }) => {
      const s = slashRef.current
      if (s && editor.state.selection.from <= s.at) setSlash(null)
    },
    editorProps: {
      attributes: { class: 'rich-editor-content focus:outline-none', style: `min-height:${minHeight}`, ...(id ? { id } : {}) },
      handleTextInput: (view, from, _to, text) => {
        if (text !== '@' && text !== '/') return false
        // Word-start only, so e-mail addresses and paths keep typing normally.
        const before = from > 0 ? view.state.doc.textBetween(from - 1, from) : ''
        if (before && !/\s/.test(before)) return false
        if (text === '@') {
          if (!mentionsRef.current) return false
          window.setTimeout(() => setPicker({ at: from, kind: mentionsRef.current?.kinds?.[0] ?? 'person', block: false }), 0)
          return false
        }
        if (!advancedRef.current) return false
        const c = view.coordsAtPos(from)
        window.setTimeout(() => setSlash({ at: from, query: '', index: 0, pos: { left: c.left, top: c.bottom + 4 } }), 0)
        return false
      },
      handleKeyDown: (_view, event) => {
        const s = slashRef.current
        if (!s) return false
        const items = filterSlashCommands(s.query)
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (!items.length) return true
          const d = event.key === 'ArrowDown' ? 1 : -1
          setSlash({ ...s, index: (s.index + d + items.length) % items.length })
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const cmd = items[s.index]
          if (cmd) window.setTimeout(() => runSlashRef.current(cmd), 0)
          return true
        }
        if (event.key === 'Escape') { setSlash(null); return true }
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

  /** Run a slash command: remove the `/query` run, then act. */
  const runSlash = useCallback((cmd: SlashCommand) => {
    const s = slashRef.current
    if (!editor || !s) return
    setSlash(null)
    const to = editor.state.selection.from
    const chain = editor.chain().focus().deleteRange({ from: s.at, to: Math.max(to, s.at + 1) })
    if (cmd.id === 'table') { chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); return }
    if (cmd.id === 'heading') { chain.setHeading({ level: 2 }).run(); return }
    if (cmd.id === 'list') { chain.toggleBulletList().run(); return }
    if (cmd.id === 'quote') { chain.toggleBlockquote().run(); return }
    chain.run()
    if (cmd.kind) setPicker({ at: null, kind: cmd.kind, block: true })
  }, [editor])
  const runSlashRef = useRef(runSlash)
  useEffect(() => { runSlashRef.current = runSlash })

  if (!editor) return <div className="rounded-lg border border-white/10 bg-ink-950 p-3 text-sm text-slate-500" style={{ minHeight }}>Loading editor…</div>

  const closePicker = () => { setPicker(null); editor.commands.focus() }

  /** Inline chip (the `@` path). */
  const insertMention = (hit: EntityHit | null) => {
    if (!hit || !picker) return
    const { at, kind } = picker
    const doc = editor.state.doc
    const hasAt = at !== null && at < doc.content.size && doc.textBetween(at, at + 1) === '@'
    const range = hasAt ? { from: at, to: at + 1 } : { from: editor.state.selection.from, to: editor.state.selection.to }
    editor.chain().focus()
      .insertContentAt(range, [{ type: MENTION_NODE, attrs: { kind, id: hit.id, label: hit.label } }, { type: 'text', text: ' ' }])
      .run()
    learn({ [mentionKey(kind, hit.id)]: hit.label })
    setPicker(null)
  }

  /** Block (the slash path). */
  const insertBlock = (kind: MentionKind, hit: { id: string; label: string; code: string | null; full: string }) => {
    const attrs: EntityAttrs = { kind, id: hit.id, label: hit.label, code: hit.code }
    editor.chain().focus().insertContent([{ type: ENTITY_NODE, attrs }]).run()
    learn({ [mentionKey(kind, hit.id)]: hit.full })
    setPicker(null)
  }

  const linkKinds = mentions?.kinds ?? MENTION_LINK_KINDS
  const inTable = editor.isActive('table')

  const setLink = async (e: Editor) => {
    const prev = (e.getAttributes('link').href as string | undefined) ?? ''
    const raw = await uiPrompt('Link address (http or https)', { title: 'Insert link', placeholder: 'https://…', value: prev, confirmText: 'Apply' })
    if (raw === null) { e.commands.focus(); return }
    const url = raw.trim()
    if (!url) { e.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    const safe = safeUrl(url)
    if (!/^https?:\/\//i.test(safe)) { toast('Only http(s) links can be inserted.', 'warn'); e.commands.focus(); return }
    e.chain().focus().extendMarkRange('link').setLink({ href: safe }).run()
  }

  const hd = (level: 2 | 3) => (e: Editor) => e.chain().focus().toggleHeading({ level }).run()
  const pickerKind = picker?.kind ?? 'person'
  const pickerScoped = picker ? CASE_SCOPED.has(picker.kind) : false
  const artefactSearch = (kind: MentionKind) => async (q: string): Promise<ArtefactHit[]> => {
    if (kind === 'charge') return searchCharges(q)
    if (kind === 'source') return searchSources(q)
    if (!caseId) return []
    if (kind === 'evidence') return searchEvidence(caseId, q)
    if (kind === 'report') return searchReports(caseId, q)
    if (kind === 'legal') return searchLegal(caseId, q)
    return []
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-ink-950 transition focus-within:border-badge-500 focus-within:ring-2 focus-within:ring-badge-500/30">
      <div role="group" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-white/10 bg-white/[0.03] px-2 py-1.5">
        <Btn editor={editor} active="bold" title="Bold (⌘B)" onRun={(e) => e.chain().focus().toggleBold().run()}><span className="font-bold">B</span></Btn>
        <Btn editor={editor} active="italic" title="Italic (⌘I)" onRun={(e) => e.chain().focus().toggleItalic().run()}><span className="italic">I</span></Btn>
        {advanced && <Btn editor={editor} active="underline" title="Underline (⌘U)" onRun={(e) => e.chain().focus().toggleUnderline().run()}><span className="underline">U</span></Btn>}
        <Btn editor={editor} active="strike" title="Strikethrough" onRun={(e) => e.chain().focus().toggleStrike().run()}><span className="line-through">S</span></Btn>
        <Sep />
        <Btn editor={editor} active="heading" title="Heading" onRun={hd(2)}>H2</Btn>
        <Btn editor={editor} title="Sub-heading" onRun={hd(3)}>H3</Btn>
        <Sep />
        <Btn editor={editor} active="bulletList" title="Bullet list" onRun={(e) => e.chain().focus().toggleBulletList().run()}>••</Btn>
        <Btn editor={editor} active="orderedList" title="Numbered list" onRun={(e) => e.chain().focus().toggleOrderedList().run()}>1.</Btn>
        <Btn editor={editor} active="blockquote" title="Note block" onRun={(e) => e.chain().focus().toggleBlockquote().run()}>❝</Btn>
        <Btn editor={editor} active="code" title="Inline code" onRun={(e) => e.chain().focus().toggleCode().run()}>{'</>'}</Btn>
        {advanced && (<>
          <Sep />
          <Btn editor={editor} active="link" title={editor.isActive('link') ? 'Edit link' : 'Insert link'} onRun={setLink}><LinkIcon size={14} /></Btn>
          {inTable ? (<>
            <Btn editor={editor} title="Add row below" onRun={(e) => e.chain().focus().addRowAfter().run()}>+Row</Btn>
            <Btn editor={editor} title="Add column after" onRun={(e) => e.chain().focus().addColumnAfter().run()}>+Col</Btn>
            <Btn editor={editor} title="Delete row" onRun={(e) => e.chain().focus().deleteRow().run()}>−Row</Btn>
            <Btn editor={editor} title="Delete column" onRun={(e) => e.chain().focus().deleteColumn().run()}>−Col</Btn>
            <Btn editor={editor} title="Delete table" onRun={(e) => e.chain().focus().deleteTable().run()}>✕ Table</Btn>
          </>) : (
            <Btn editor={editor} title="Insert table (3 × 3)" onRun={(e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Table</Btn>
          )}
        </>)}
        {mentions && (<>
          <Sep />
          <Btn editor={editor} title="Mention a record (@)" onRun={() => setPicker({ at: null, kind: linkKinds[0] ?? 'person', block: false })}>@</Btn>
          {advanced && <Btn editor={editor} title="Insert a record block (/)" onRun={() => setPicker({ at: null, kind: 'person', block: true })}>/</Btn>}
        </>)}
        <Sep />
        <Btn editor={editor} title="Undo (⌘Z)" onRun={(e) => e.chain().focus().undo().run()}>↺</Btn>
        <Btn editor={editor} title="Redo" onRun={(e) => e.chain().focus().redo().run()}>↻</Btn>
      </div>
      <EditorContent editor={editor} className="px-3 py-2 text-sm text-slate-100" />
      {slash && (
        <SlashMenu
          listId={slashListId}
          items={filterSlashCommands(slash.query)}
          index={slash.index}
          position={slash.pos}
          onHover={(i) => setSlash((s) => (s ? { ...s, index: i } : s))}
          onPick={runSlash}
        />
      )}
      <Modal open={!!picker} onClose={closePicker}>
        {picker && (
          <div className="p-5">
            <ModalHeader title={picker.block ? `Insert ${ARTEFACT_LABEL[pickerKind]}` : 'Mention a record'} onClose={closePicker} />
            <div className="space-y-3">
              {/* The `@` path picks a registry kind; a slash block may also
                  switch among the registry kinds, artefact kinds are fixed. */}
              {(!picker.block || isMentionLinkKind(picker.kind)) && (
                <Field label="Record type">
                  {(fid) => (
                    <Select id={fid} value={pickerKind} onChange={(e) => setPicker({ ...picker, kind: e.target.value as MentionKind })}>
                      {(picker.block ? MENTION_LINK_KINDS : linkKinds).map((k) => <option key={k} value={k}>{KIND_LABEL[k].one.replace(/^\w/, (c) => c.toUpperCase())}</option>)}
                    </Select>
                  )}
                </Field>
              )}
              {isMentionLinkKind(pickerKind) ? (
                <EntityPicker
                  key={pickerKind}
                  kind={pickerKind}
                  label={`Search ${KIND_LABEL[pickerKind].many}`}
                  value={null}
                  onChange={(hit) => {
                    if (!hit) return
                    if (picker.block) insertBlock(pickerKind, { id: hit.id, label: hit.label, code: null, full: hit.label })
                    else insertMention(hit)
                  }}
                  suggest={mentions?.suggest}
                  hint={picker.block ? 'Inserted as a record block on its own line; readers who cannot open it see “Restricted record”.' : 'The record is inserted as a chip; readers who cannot open it see “Restricted record”.'}
                />
              ) : pickerScoped && !caseId ? (
                <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                  {ARTEFACT_LABEL[pickerKind].replace(/^\w/, (c) => c.toUpperCase())}s can only be inserted from a report opened inside its case.
                </p>
              ) : (
                <RecordSearchPicker<ArtefactHit>
                  key={pickerKind}
                  label={`Search ${ARTEFACT_LABEL[pickerKind]}s`}
                  search={artefactSearch(pickerKind)}
                  value={null}
                  onChange={(hit) => { if (hit) insertBlock(pickerKind, hit) }}
                  hint="Inserted as a record block on its own line; readers who cannot open it see “Restricted record”."
                  placeholder={pickerKind === 'source' ? 'Source number, title or domain…' : 'Type to filter…'}
                />
              )}
              <div className="flex justify-end">
                <Button onClick={closePicker}>Cancel</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

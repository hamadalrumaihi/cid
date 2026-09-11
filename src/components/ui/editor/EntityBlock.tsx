'use client'

/** `cidEntity` — the block node the slash menu inserts (platform upgrade,
 *  report editor). A bordered, selectable, deletable card:
 *
 *      [PERSON] John Doe · PID-001882
 *
 *  Attrs `{kind, id, label, code}`; ONLY `[kind:id]` is serialised (the
 *  lib/mentions grammar, on its own line), so the markdown stays plain and
 *  every downstream reader (renderMarkdown, exports, the packet) already
 *  understands it. `label` / `code` are display state: learned from the
 *  picker on insert, otherwise resolved on mount through lib/mentionResolve
 *  (RLS decides — an unreadable record renders "Restricted record"; the raw
 *  id is never shown).
 *
 *  Parsing: a paragraph whose ENTIRE text is one token becomes a block; a
 *  token inside running text stays the inline `cidMention` chip. That keeps
 *  every existing narrative byte-identical and lets the two node kinds share
 *  one grammar.
 *
 *  Click → RecordPeek for the kinds it can preview (person, vehicle, gang,
 *  place, narcotic, case); the artefact kinds (evidence, charge, report,
 *  legal, source) identify themselves by label + code and have no peek yet. */
import { useState } from 'react'
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import type { PreviewType } from '@/lib/entityPreview'
import { MENTION_KIND_TAG, RESTRICTED_LABEL, isMentionKind, mentionToken, splitMentions, type MentionKind } from '@/lib/mentions'
import { InfoIcon, XMarkIcon } from '@/components/shell/icons'
import { RecordPeek } from '../RecordPeek'

export const ENTITY_NODE = 'cidEntity'

export interface EntityAttrs { kind: MentionKind; id: string; label: string | null; code: string | null }

const PEEK: Partial<Record<MentionKind, PreviewType>> = {
  person: 'person', vehicle: 'vehicle', gang: 'gang', place: 'place', narcotic: 'narcotic', case: 'case',
}

/** Promote paragraphs that hold exactly one `[kind:id]` token (and nothing
 *  else) into entity blocks. Runs inside tiptap-markdown's parse step
 *  (`storage.markdown.parse.updateDOM`) BEFORE the inline mention pass, so
 *  the inline pass never sees these tokens. Browser DOM only. */
export function upgradeEntityBlocks(root: HTMLElement): void {
  const doc = root.ownerDocument
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (p.closest('code,pre,table')) continue
    const segs = splitMentions(p.textContent ?? '')
    const refs = segs.filter((s) => typeof s !== 'string')
    const text = segs.filter((s): s is string => typeof s === 'string').join('').trim()
    if (refs.length !== 1 || text) continue
    // The paragraph must be text-only (no inline HTML like <b>) — a token
    // inside a formatted run is a mention, not a block.
    if (p.children.length) continue
    const ref = refs[0] as { kind: MentionKind; id: string }
    const div = doc.createElement('div')
    div.setAttribute('data-entity-kind', ref.kind)
    div.setAttribute('data-entity-id', ref.id)
    p.replaceWith(div)
  }
}

function EntityBlockView({ node, selected, deleteNode }: NodeViewProps) {
  const a = node.attrs as EntityAttrs
  const [peek, setPeek] = useState(false)
  const kind = isMentionKind(a.kind) ? a.kind : 'person'
  const tag = MENTION_KIND_TAG[kind]
  const label = a.label ?? '…'
  const restricted = a.label === RESTRICTED_LABEL
  const peekType = restricted ? undefined : PEEK[kind]
  return (
    <NodeViewWrapper
      as="div"
      data-drag-handle
      className={`cid-entity my-1.5 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${selected ? 'border-badge-500 bg-badge-500/10' : 'border-white/10 bg-white/[0.03]'}`}
    >
      <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-blue-200" aria-hidden>[{tag}]</span>
      <span className={`min-w-0 flex-1 truncate ${restricted ? 'text-slate-400' : 'text-slate-100'}`}>
        <span className="sr-only">{tag.toLowerCase()} </span>
        {label}
        {a.code && !restricted && <span className="text-slate-400"> · {a.code}</span>}
      </span>
      {peekType && (
        <button
          type="button"
          aria-label={`Quick preview: ${label}`}
          title="Quick preview"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPeek(true)}
          className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-white/5 hover:text-blue-200 lg:h-7 lg:w-7"
        >
          <InfoIcon size={14} />
        </button>
      )}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        title="Remove"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => deleteNode()}
        className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300 lg:h-7 lg:w-7"
      >
        <XMarkIcon size={14} />
      </button>
      {peek && peekType && <RecordPeek type={peekType} id={a.id} onClose={() => setPeek(false)} />}
    </NodeViewWrapper>
  )
}

/** Exported for the round-trip test seam; the editor registers it. */
export const EntityBlockNode = TiptapNode.create({
  name: ENTITY_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      kind: { default: 'person', parseHTML: (el: HTMLElement) => el.getAttribute('data-entity-kind'), renderHTML: (a: EntityAttrs) => ({ 'data-entity-kind': a.kind }) },
      id: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-entity-id'), renderHTML: (a: EntityAttrs) => ({ 'data-entity-id': a.id }) },
      label: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-entity-label'), renderHTML: (a: EntityAttrs) => (a.label ? { 'data-entity-label': a.label } : {}) },
      code: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-entity-code'), renderHTML: (a: EntityAttrs) => (a.code ? { 'data-entity-code': a.code } : {}) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-entity-kind][data-entity-id]' }] },
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as EntityAttrs
    const tag = isMentionKind(a.kind) ? MENTION_KIND_TAG[a.kind] : 'RECORD'
    return ['div', mergeAttributes(HTMLAttributes, { class: 'cid-entity' }), `[${tag}] ${a.label ?? '…'}${a.code ? ` · ${a.code}` : ''}`]
  },
  addNodeView() { return ReactNodeViewRenderer(EntityBlockView) },
  addStorage() {
    return {
      markdown: {
        serialize(state: { write(s: string): void; closeBlock(n: unknown): void }, node: { attrs: EntityAttrs }) {
          const a = node.attrs
          state.write(isMentionKind(a.kind) && a.id ? mentionToken(a.kind, a.id) : '')
          state.closeBlock(node)
        },
        parse: { updateDOM: upgradeEntityBlocks },
      },
    }
  },
})

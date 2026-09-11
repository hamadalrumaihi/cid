'use client'

/** Slash-command menu for the report editor (platform upgrade). Typing `/`
 *  at the start of a line (or after a space) opens this list under the
 *  caret; the characters typed after the slash filter it. Entity commands
 *  open the record picker for that kind and insert a `cidEntity` block;
 *  format commands run the matching Tiptap chain.
 *
 *  The trigger, the filter query and the keyboard (↑ ↓ ↵ Tab Esc) live in
 *  RichEditorInner's editorProps — this file is the command registry (pure,
 *  tested) and the popover (presentational, portal-mounted so it escapes
 *  the editor's overflow clipping). @tiptap/suggestion is not installed
 *  (starter-kit does not ship it), so the trigger is hand-rolled on
 *  `handleTextInput`, exactly like the existing `@` mention trigger. */
import { createPortal } from 'react-dom'
import type { MentionKind } from '@/lib/mentions'

export type SlashCommandId =
  | 'person' | 'vehicle' | 'gang' | 'place' | 'narcotic' | 'evidence' | 'case' | 'charge' | 'report' | 'legal' | 'source'
  | 'table' | 'heading' | 'list' | 'quote'

export interface SlashCommand {
  id: SlashCommandId
  label: string
  hint: string
  /** Entity commands carry their mention kind; format commands do not. */
  kind?: MentionKind
  /** Extra match words (the filter matches id, label and these). */
  keywords?: string
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: 'person', label: 'Person', hint: 'Insert a person record', kind: 'person', keywords: 'suspect poi witness' },
  { id: 'vehicle', label: 'Vehicle', hint: 'Insert a vehicle record', kind: 'vehicle', keywords: 'plate car' },
  { id: 'gang', label: 'Gang', hint: 'Insert an organisation record', kind: 'gang', keywords: 'organisation org club' },
  { id: 'place', label: 'Place', hint: 'Insert a place record', kind: 'place', keywords: 'location address' },
  { id: 'narcotic', label: 'Narcotic', hint: 'Insert a narcotic record', kind: 'narcotic', keywords: 'drug substance' },
  { id: 'evidence', label: 'Evidence', hint: 'Insert an evidence item from this case', kind: 'evidence', keywords: 'media exhibit item' },
  { id: 'case', label: 'Case', hint: 'Insert a case reference', kind: 'case', keywords: 'file' },
  { id: 'charge', label: 'Charge', hint: 'Insert a penal-code charge', kind: 'charge', keywords: 'penal code offense' },
  { id: 'report', label: 'Report', hint: 'Insert a report from this case', kind: 'report', keywords: 'supplemental followup' },
  { id: 'legal', label: 'Legal request', hint: 'Insert a legal request from this case', kind: 'legal', keywords: 'warrant subpoena' },
  { id: 'source', label: 'External source', hint: 'Insert an external source', kind: 'source', keywords: 'url web link' },
  { id: 'table', label: 'Table', hint: '3 × 3 table with a header row', keywords: 'grid' },
  { id: 'heading', label: 'Heading', hint: 'Section heading', keywords: 'h2 title' },
  { id: 'list', label: 'Bullet list', hint: 'Bulleted list', keywords: 'bullets ul' },
  { id: 'quote', label: 'Note block', hint: 'Quoted note', keywords: 'blockquote' },
]

/** Case-insensitive prefix / substring filter over id, label and keywords.
 *  A blank query lists everything. Pure. */
export function filterSlashCommands(query: string, commands: readonly SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...commands]
  const starts = commands.filter((c) => c.id.startsWith(q) || c.label.toLowerCase().startsWith(q))
  const contains = commands.filter((c) => !starts.includes(c) && `${c.id} ${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q))
  return [...starts, ...contains]
}

export function SlashMenu({ items, index, position, onPick, onHover, listId }: {
  items: readonly SlashCommand[]
  index: number
  /** Viewport coordinates of the caret (fixed positioning). */
  position: { left: number; top: number }
  onPick: (cmd: SlashCommand) => void
  onHover: (i: number) => void
  listId: string
}) {
  if (typeof document === 'undefined') return null
  // Keep the popover on screen: below the caret, clamped to the viewport.
  const width = 288
  const left = Math.max(8, Math.min(position.left, (typeof window !== 'undefined' ? window.innerWidth : 1024) - width - 8))
  return createPortal(
    <div
      id={listId}
      role="listbox"
      aria-label="Slash commands"
      style={{ left, top: position.top, width }}
      className="fixed z-dialog max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-ink-850 p-1 shadow-pop"
    >
      {items.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No matching command.</p>}
      {items.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="option"
          id={`${listId}-${c.id}`}
          aria-selected={i === index}
          onMouseDown={(e) => e.preventDefault() /* keep the editor focused */}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(c)}
          className={`flex w-full min-h-10 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${i === index ? 'bg-badge-500/15 text-white' : 'text-slate-200 hover:bg-white/5'}`}
        >
          <span className="w-24 flex-shrink-0 font-mono text-xs text-blue-200">/{c.id}</span>
          <span className="min-w-0 flex-1 truncate">{c.label}</span>
          <span className="hidden flex-shrink-0 text-[11px] text-slate-400 sm:inline">{c.hint}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}

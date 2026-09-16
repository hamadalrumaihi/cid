'use client'

/** Contextual callouts for documentation.
 *
 *  Six kinds, because six is what the material actually distinguishes: a
 *  definition is not a deadline, and a prohibition is not a restriction on who
 *  may read. Anything beyond these would be decoration.
 *
 *  ── Three rules they all obey ────────────────────────────────────────────
 *  1. Colour reinforces a LABEL; it never carries the meaning alone. Every
 *     callout prints its kind as a word, so a reader who cannot distinguish
 *     amber from red loses nothing. This is also why the label is not
 *     optional.
 *  2. The portal's own colour language, not a documentation-only one — the
 *     same blue / amber / rose / emerald the Badge primitive uses.
 *  3. They emphasise; they do not restate. A callout wraps wording that is
 *     already in the document. Putting a sentence in a box does not make it
 *     policy, and rewriting it to fit the box is how a presentation change
 *     quietly becomes a policy change. */
import type { ReactNode } from 'react'

export type CalloutKind =
  /** Explanations, definitions, context, cross-references. */
  | 'info'
  /** A requirement worth reading twice. */
  | 'important'
  /** Prohibited conduct, serious restriction, consequence. */
  | 'warning'
  /** Sensitive material and who may see it. */
  | 'restricted'
  /** A deadline or a retention period — something with a clock on it. */
  | 'time'
  /** Command's own responsibility or authority. */
  | 'command'

interface Spec {
  /** The word. Never omitted — see rule 1. */
  label: string
  /** Border + fill + text, from the portal's tone language. */
  cls: string
  /** Heading colour, one step brighter than the body so the label leads. */
  head: string
  /** A glyph is a second, redundant signal — never the only one. */
  icon: string
}

const SPEC: Record<CalloutKind, Spec> = {
  info: {
    label: 'Information',
    cls: 'border-blue-400/25 bg-blue-500/10 text-blue-100/90',
    head: 'text-blue-300', icon: 'i',
  },
  important: {
    label: 'Important',
    cls: 'border-amber-400/25 bg-amber-500/10 text-amber-100/90',
    head: 'text-amber-300', icon: '!',
  },
  warning: {
    label: 'Warning',
    cls: 'border-rose-400/25 bg-rose-500/10 text-rose-100/90',
    head: 'text-rose-300', icon: '!',
  },
  restricted: {
    label: 'Restricted',
    cls: 'border-rose-400/30 bg-rose-500/10 text-rose-100/90',
    head: 'text-rose-300', icon: '🔒',
  },
  time: {
    label: 'Time-sensitive',
    cls: 'border-amber-400/25 bg-amber-500/10 text-amber-100/90',
    head: 'text-amber-300', icon: '⏱',
  },
  command: {
    label: 'Command',
    cls: 'border-blue-400/30 bg-blue-500/10 text-blue-100/90',
    head: 'text-blue-300', icon: '★',
  },
}

export interface DocCalloutProps {
  kind: CalloutKind
  /** Overrides the default word — for a callout whose subject is narrower
   *  than its kind ("Recording Required" rather than "Important"). The kind
   *  still decides the colour, so the two never disagree. */
  title?: string
  children: ReactNode
  className?: string
}

export function DocCallout({ kind, title, children, className = '' }: DocCalloutProps) {
  const s = SPEC[kind]
  return (
    <aside
      // `note` rather than `alert`: a document is read, not interrupted. An
      // alert role would make a screen reader announce every callout on the
      // page the moment it loads, which for a long SOP is unusable.
      role="note"
      aria-label={`${s.label}: ${title ?? ''}`.trim()}
      className={`rounded-lg border px-3.5 py-3 ${s.cls} ${className}`}
    >
      <p className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${s.head}`}>
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-white/10 text-[9px] leading-none">
          {s.icon}
        </span>
        {title ?? s.label}
        {/* When the caller renames it, the KIND still has to be legible —
            otherwise "Recording Required" in amber says nothing to a reader
            who cannot see amber. */}
        {title && <span className="font-semibold text-current/70">· {s.label}</span>}
      </p>
      <div className="prose-guide mt-1.5 text-sm leading-relaxed [&_a]:underline [&_a]:underline-offset-2">
        {children}
      </div>
    </aside>
  )
}

/** The classification strip a restricted document carries above its header.
 *
 *  Prominent, and deliberately NOT the whole page: a document rendered red
 *  throughout stops meaning anything by its second screen, and the words stop
 *  being readable long before that. One strip, at the top, where a reader
 *  starts. */
export function ClassificationStrip({ text, detail }: { text: string; detail?: string }) {
  return (
    <div
      role="note"
      className="rounded-lg border border-rose-400/30 bg-rose-500/15 px-4 py-2.5"
    >
      <p className="text-sm font-bold uppercase tracking-wide text-rose-200">🔒 {text}</p>
      {detail && <p className="mt-0.5 text-xs font-normal text-rose-100/80">{detail}</p>}
    </div>
  )
}

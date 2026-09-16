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
 *     same neutral / amber / rose the Badge primitive uses.
 *
 *     Note what that language actually resolves to: globals.css remaps every
 *     `blue-*` tier to the reader's chosen accent, and the default accent is
 *     AMBER. So a callout built on blue is amber on most screens, and an
 *     earlier draft of this table put info, important, time-sensitive and
 *     command on blue-or-amber — six kinds rendering as two. They are toned
 *     against what the browser produces, not against what the class name
 *     says.
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

/** Five visual weights for six kinds, which is the honest number.
 *
 *  QUIET (info) — context a reader does not have to act on, so it is the
 *  calmest thing on the page rather than the brightest.
 *  QUIET + ACCENT LABEL (command) — the same calm box; the accent is on the
 *  word, because what makes it different is WHOSE it is, not how urgent.
 *  AMBER (important, time-sensitive) — one tier, deliberately shared: both
 *  mean "act on this". The word and the glyph say which, and inventing a
 *  sixth hue to split them would spend colour the portal does not have.
 *  ROSE (warning) — prohibited conduct or a consequence.
 *  STRONG ROSE (restricted) — heavier border and fill than warning, plus the
 *  lock, because "you may not read this on" is a different claim from "do not
 *  do this" and must not be mistaken for it at a glance. */
const SPEC: Record<CalloutKind, Spec> = {
  info: {
    label: 'Information',
    cls: 'border-white/10 bg-white/[0.04] text-slate-200',
    head: 'text-slate-300', icon: 'i',
  },
  important: {
    label: 'Important',
    cls: 'border-amber-400/30 bg-amber-500/10 text-amber-100/90',
    head: 'text-amber-300', icon: '!',
  },
  warning: {
    label: 'Warning',
    cls: 'border-rose-400/25 bg-rose-500/10 text-rose-100/90',
    head: 'text-rose-300', icon: '!',
  },
  restricted: {
    label: 'Restricted',
    cls: 'border-rose-400/60 bg-rose-500/20 text-rose-100',
    head: 'text-rose-200', icon: '🔒',
  },
  time: {
    label: 'Time-sensitive',
    cls: 'border-amber-400/30 bg-amber-500/10 text-amber-100/90',
    head: 'text-amber-300', icon: '⏱',
  },
  command: {
    label: 'Command',
    cls: 'border-white/10 bg-white/[0.04] text-slate-200',
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
      <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-bold uppercase tracking-wide ${s.head}`}>
        <span aria-hidden className="grid h-4 w-4 flex-shrink-0 place-items-center rounded-full bg-white/10 text-[9px] leading-none">
          {s.icon}
        </span>
        <span className="min-w-0">{title ?? s.label}</span>
        {/* When the caller renames it, the KIND still has to be legible —
            otherwise "Recording Required" in amber says nothing to a reader
            who cannot see amber. It never breaks mid-word: on a phone a long
            title wraps, and the kind drops whole to the next line. */}
        {title && <span className="whitespace-nowrap font-semibold text-current/70">· {s.label}</span>}
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

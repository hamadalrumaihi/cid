/** The documentation surface palette, in one place.
 *
 *  Documentation used to have a look of its own — a near-black ground,
 *  charcoal panels with gold hairlines, muted gold for emphasis. It read as a
 *  separate manual website embedded in the portal, which is the opposite of
 *  what a division's own SOPs should feel like: the Guide Library is where
 *  the rules live, not a guest.
 *
 *  So these tokens now resolve to the PORTAL's own surfaces — the same
 *  `ink-900/60` fill, the same `white/5` edge and the same accent every other
 *  screen uses. The names are unchanged on purpose: nine files consume them,
 *  and re-theming by changing what a token means rather than by editing every
 *  call site is the whole reason they exist.
 *
 *  ── Colour carries meaning, not identity ─────────────────────────────────
 *  Nothing here tints a document by what KIND of document it is. Strong colour
 *  is reserved for things a reader must act on or be careful about — blue
 *  informs, amber warns, red restricts, green confirms — and every coloured
 *  element also carries a word, because colour that is the only carrier of
 *  meaning is invisible to a reader who cannot see it. */

/** The page ground. The portal's own canvas: documentation is not a room with
 *  different lighting. */
export const GUIDE_CANVAS = 'bg-canvas'

/** The primary surface — the portal's canonical card, byte-for-byte what
 *  `<Card>` renders, so a document panel and a case panel are the same object. */
export const PANEL = 'rounded-lg border border-white/5 bg-ink-900/60'

/** A quieter slab inside a panel: table rows, metadata strips, nested blocks. */
export const SLAB = 'rounded-lg border border-white/5 bg-ink-900/40'

/** Emphasis inside a block — informational, the portal's `tone="accent"`.
 *  Deliberately the SAME pair the Badge primitive uses rather than a
 *  documentation-only accent: a reader should not have to learn a second
 *  colour language to read a policy. */
export const GOLD_TINT = 'bg-blue-500/15 text-blue-300'
export const GOLD_TEXT = 'text-blue-300'

/** Caution — a cost, a limit, a deadline, a thing worth reading twice. Never
 *  an error, and never a whole page: a document rendered amber stops meaning
 *  anything by its third paragraph. */
export const WARN = 'rounded-lg border border-amber-400/25 bg-amber-500/15 text-amber-300'

/** State chips. Red is out of reach — restricted, prohibited, not yet met.
 *  Green is done. Both stay chip-sized for the same reason WARN does. */
export const CHIP_LOCKED = 'border-rose-400/25 bg-rose-500/15 text-rose-300'
export const CHIP_DONE = 'border-emerald-400/25 bg-emerald-500/15 text-emerald-300'
export const CHIP_NEUTRAL = 'border-white/10 bg-white/5 text-slate-300'

/** The document-type badge. One accent for every type rather than eight
 *  colours: the badge's job is to say WHICH type in a word, and a library
 *  listing where each card is a different colour is a paint chart. */
export const CHIP_TYPE = 'border-blue-400/25 bg-blue-500/15 text-blue-300'

/** One chip shape, so every chip on every document is the same size. */
export const CHIP =
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide'

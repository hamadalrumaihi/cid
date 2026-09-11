/** The guide surface palette, in one place.
 *
 *  Guides use a darker, quieter treatment than the rest of the portal: a
 *  near-black ground, charcoal panels, hairline borders and muted gold for
 *  emphasis. State colours are literal and mean one thing each — orange warns,
 *  red is locked or out of reach, green is done.
 *
 *  Gold is literal `amber-*`, deliberately NOT the remapped `blue-*` /
 *  `badge-*` accent classes, so a guide reads the same under every user accent
 *  theme. Nothing here changes a global token: the treatment is scoped to the
 *  elements that opt into it, and the portal's own chrome is untouched. */

/** The page ground — near-black. */
export const GUIDE_CANVAS = 'bg-neutral-950'

/** A charcoal panel with a hairline gold border: the guide's primary surface. */
export const PANEL = 'rounded-2xl border border-amber-400/15 bg-neutral-950/80'

/** A charcoal slab inside a panel — table rows, cards, nested blocks. */
export const SLAB = 'rounded-lg border border-white/10 bg-neutral-900/70'

/** Muted gold fill, for the one thing in a block that should catch the eye. */
export const GOLD_TINT = 'bg-amber-500/15 text-amber-200'

/** Gold text on its own. */
export const GOLD_TEXT = 'text-amber-200'

/** Caution — a cost, a limit, a thing worth reading twice. Never an error. */
export const WARN = 'rounded-lg border border-orange-400/30 bg-orange-500/10 text-orange-200'

/** Small state chips. Red is out of reach — a level not yet met, a requirement
 *  not yet satisfied. Green is done. Both are chip-level only: a whole block
 *  rendered red or green reads as an error or a success message, which is not
 *  what a reference document is saying. */
export const CHIP_LOCKED = 'border-red-400/30 bg-red-500/10 text-red-200'
export const CHIP_DONE = 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
export const CHIP_NEUTRAL = 'border-white/10 bg-white/5 text-slate-300'

/** One chip shape, so every state chip on every guide is the same size. */
export const CHIP =
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide'

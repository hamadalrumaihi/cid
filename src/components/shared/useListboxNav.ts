'use client'

/** Combobox/listbox keyboard kernel — the a11y wiring SearchPalette pioneered
 *  (role="combobox" + aria-activedescendant + wrap-around arrows), extracted
 *  so every suggestion list behaves identically. DOM focus stays in the input;
 *  the "focused" option is virtual (aria-activedescendant → optId(sel)).
 *
 *  The consumer renders:
 *    <input {...inputProps} />   — spread first, then override onKeyDown if a
 *                                  wrapper is needed (e.g. reopen-on-ArrowDown).
 *    <ul {...listProps}>         — children carry id={optId(i)}, data-i={i},
 *                                  role="option", aria-selected={i === sel}.
 *
 *  Keys (only while `open`): ArrowUp/Down wrap and skip disabled rows,
 *  Home/End jump to the first/last enabled row (only intercepted while rows
 *  exist, so an empty list never steals the caret), Enter activates the
 *  current row, Escape calls onEscape — with stopPropagation so an enclosing
 *  Modal's Escape handler doesn't also fire. Every keyboard move scrolls the
 *  new row into view (block:'nearest', the SearchPalette idiom). */
import { useCallback, useEffect, useId, useRef, useState } from 'react'

/** Next enabled index moving `delta` from `from`, wrapping; -1 if none. */
export function nextEnabled(from: number, delta: 1 | -1, count: number, isDisabled?: (i: number) => boolean): number {
  if (count <= 0) return -1
  for (let step = 1; step <= count; step++) {
    const i = (((from + delta * step) % count) + count) % count
    if (!isDisabled?.(i)) return i
  }
  return -1
}

/** First keyboard-reachable row; -1 when every row is disabled. */
export const firstEnabled = (count: number, isDisabled?: (i: number) => boolean): number =>
  nextEnabled(-1, 1, count, isDisabled)

/** Last keyboard-reachable row; -1 when every row is disabled. */
export const lastEnabled = (count: number, isDisabled?: (i: number) => boolean): number =>
  nextEnabled(count, -1, count, isDisabled)

export interface ListboxNavOptions {
  /** Number of option rows currently rendered. */
  count: number
  /** Enter on an enabled row (mouse clicks stay the consumer's job). */
  onActivate: (index: number) => void
  /** Escape while open — close the popup WITHOUT clearing the input. */
  onEscape?: () => void
  /** Rows still rendered but not selectable — skipped by the keyboard. */
  isDisabled?: (index: number) => boolean
  /** Popup visibility: gates all key handling, aria-expanded and
   *  aria-activedescendant. Defaults to true (always-open palettes). */
  open?: boolean
}

export interface ListboxNav {
  /** The virtually-focused row index. */
  sel: number
  /** Move the virtual focus (e.g. reset to 0 when fresh results land). */
  setSel: (i: number) => void
  /** Stable key handler — also included in inputProps. */
  onKeyDown: React.KeyboardEventHandler
  /** DOM id for row i — render it on the option AND use it for styling. */
  optId: (i: number) => string
  listProps: { id: string; role: 'listbox' }
  inputProps: {
    role: 'combobox'
    'aria-expanded': boolean
    'aria-autocomplete': 'list'
    'aria-controls': string | undefined
    'aria-activedescendant': string | undefined
    onKeyDown: React.KeyboardEventHandler
  }
}

export function useListboxNav({ count, onActivate, onEscape, isDisabled, open = true }: ListboxNavOptions): ListboxNav {
  const base = useId()
  const [selState, setSelState] = useState(0)

  // The handler reads everything through refs (the useRegistry loadRef idiom)
  // so its identity is stable and inline consumer closures stay safe. `sel`
  // additionally keeps a synchronous mirror so back-to-back key events between
  // renders never navigate from a stale index.
  const selRef = useRef(0)
  const opts = useRef({ count, onActivate, onEscape, isDisabled, open })
  useEffect(() => { opts.current = { count, onActivate, onEscape, isDisabled, open } })

  const setSel = useCallback((i: number) => { selRef.current = i; setSelState(i) }, [])
  const optId = useCallback((i: number) => `${base}-opt-${i}`, [base])
  const listboxId = `${base}-listbox`

  const move = useCallback((next: number) => {
    if (next < 0) return
    setSel(next)
    document.getElementById(optId(next))?.scrollIntoView?.({ block: 'nearest' })
  }, [setSel, optId])

  const onKeyDown: React.KeyboardEventHandler = useCallback((e) => {
    const { count, onActivate, onEscape, isDisabled, open } = opts.current
    if (!open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(nextEnabled(selRef.current, e.key === 'ArrowDown' ? 1 : -1, count, isDisabled))
    } else if (e.key === 'Home' || e.key === 'End') {
      if (!count) return // empty list: leave the text caret alone
      e.preventDefault()
      move(e.key === 'Home' ? firstEnabled(count, isDisabled) : lastEnabled(count, isDisabled))
    } else if (e.key === 'Enter') {
      if (!count) return // no rows: let a surrounding form keep its submit
      e.preventDefault()
      const i = selRef.current
      if (i >= 0 && i < count && !isDisabled?.(i)) onActivate(i)
    } else if (e.key === 'Escape') {
      if (!onEscape) return
      e.preventDefault()
      e.stopPropagation() // the popup consumes it — an enclosing Modal stays open
      onEscape()
    }
  }, [move])

  const active = open && count > 0 && selState >= 0 && selState < count ? optId(selState) : undefined

  return {
    sel: selState,
    setSel,
    onKeyDown,
    optId,
    listProps: { id: listboxId, role: 'listbox' },
    inputProps: {
      role: 'combobox',
      'aria-expanded': open,
      'aria-autocomplete': 'list',
      'aria-controls': open ? listboxId : undefined,
      'aria-activedescendant': active,
      onKeyDown,
    },
  }
}

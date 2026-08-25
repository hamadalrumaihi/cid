// @vitest-environment happy-dom
/** Pins for the combobox keyboard kernel: wrap-around arrows, disabled-row
 *  skipping, Home/End (only when rows exist — an empty list must not steal
 *  the text caret), Enter activation, Escape (consumed, so an enclosing
 *  Modal stays open), and the aria-activedescendant wiring. */
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { firstEnabled, lastEnabled, nextEnabled, useListboxNav, type ListboxNav, type ListboxNavOptions } from './useListboxNav'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const odd = (i: number) => i % 2 === 1

describe('nextEnabled / firstEnabled / lastEnabled (pure kernel)', () => {
  it('wraps in both directions', () => {
    expect(nextEnabled(0, 1, 3)).toBe(1)
    expect(nextEnabled(2, 1, 3)).toBe(0)
    expect(nextEnabled(0, -1, 3)).toBe(2)
  })

  it('skips disabled rows and reports -1 when every row is disabled', () => {
    expect(nextEnabled(0, 1, 4, odd)).toBe(2) // 1 disabled → land on 2
    expect(nextEnabled(2, 1, 4, odd)).toBe(0) // 3 disabled → wrap to 0
    expect(nextEnabled(0, 1, 3, () => true)).toBe(-1)
    expect(nextEnabled(0, 1, 0)).toBe(-1)
  })

  it('firstEnabled/lastEnabled respect disabled rows', () => {
    expect(firstEnabled(4)).toBe(0)
    expect(lastEnabled(4)).toBe(3)
    expect(firstEnabled(4, (i) => i === 0)).toBe(1)
    expect(lastEnabled(4, (i) => i === 3)).toBe(2)
    expect(firstEnabled(0)).toBe(-1)
  })
})

/** Minimal harness: renders the input + options the way a consumer would and
 *  exposes the live nav handle (no testing-library dependency, msw-render
 *  style). */
function Harness({ opts, expose }: { opts: ListboxNavOptions; expose: (nav: ListboxNav) => void }) {
  const nav = useListboxNav(opts)
  expose(nav)
  return (
    <div>
      <input {...nav.inputProps} readOnly />
      <ul {...nav.listProps}>
        {Array.from({ length: opts.count }, (_, i) => (
          <li key={i} id={nav.optId(i)} data-i={i} role="option" aria-selected={i === nav.sel} />
        ))}
      </ul>
    </div>
  )
}

interface FakeKey { key: string; defaulted: boolean; stopped: boolean; preventDefault: () => void; stopPropagation: () => void }

function mount(opts: ListboxNavOptions) {
  const holder: { nav?: ListboxNav } = {}
  const host = document.createElement('div')
  document.body.appendChild(host)
  let root: Root | undefined
  act(() => {
    root = createRoot(host)
    root.render(<Harness opts={opts} expose={(n) => { holder.nav = n }} />)
  })
  const key = (k: string): FakeKey => {
    const e: FakeKey = {
      key: k, defaulted: false, stopped: false,
      preventDefault: () => { e.defaulted = true },
      stopPropagation: () => { e.stopped = true },
    }
    act(() => holder.nav!.onKeyDown(e as unknown as React.KeyboardEvent))
    return e
  }
  return {
    nav: () => holder.nav!,
    key,
    input: () => host.querySelector('input')!,
    unmount: () => { act(() => root!.unmount()); host.remove() },
  }
}

describe('useListboxNav', () => {
  it('arrows wrap, update sel and aria-activedescendant', () => {
    const h = mount({ count: 3, onActivate: () => {} })
    try {
      expect(h.input().getAttribute('role')).toBe('combobox')
      expect(h.input().getAttribute('aria-activedescendant')).toBe(h.nav().optId(0))
      expect(h.key('ArrowDown').defaulted).toBe(true)
      expect(h.nav().sel).toBe(1)
      expect(h.input().getAttribute('aria-activedescendant')).toBe(h.nav().optId(1))
      h.key('ArrowDown')
      h.key('ArrowDown') // wraps 2 → 0
      expect(h.nav().sel).toBe(0)
      h.key('ArrowUp') // wraps 0 → 2
      expect(h.nav().sel).toBe(2)
    } finally { h.unmount() }
  })

  it('skips disabled rows and never activates them', () => {
    const hits: number[] = []
    const h = mount({ count: 4, onActivate: (i) => hits.push(i), isDisabled: odd })
    try {
      h.key('ArrowDown')
      expect(h.nav().sel).toBe(2) // 1 is disabled
      h.key('End')
      expect(h.nav().sel).toBe(2) // 3 is disabled → last enabled is 2
      h.key('Home')
      expect(h.nav().sel).toBe(0)
      h.key('Enter')
      expect(hits).toEqual([0])
    } finally { h.unmount() }
  })

  it('Enter activates the current row; empty lists keep form submit and caret keys', () => {
    const hits: number[] = []
    const full = mount({ count: 2, onActivate: (i) => hits.push(i) })
    try {
      expect(full.key('Enter').defaulted).toBe(true)
      expect(hits).toEqual([0])
    } finally { full.unmount() }

    const empty = mount({ count: 0, onActivate: (i) => hits.push(i) })
    try {
      expect(empty.key('Enter').defaulted).toBe(false) // form submit untouched
      expect(empty.key('Home').defaulted).toBe(false) // caret untouched
      expect(hits).toEqual([0])
    } finally { empty.unmount() }
  })

  it('Escape is consumed (stopPropagation) and calls onEscape; ignored without one', () => {
    let closed = 0
    const h = mount({ count: 2, onActivate: () => {}, onEscape: () => { closed++ } })
    try {
      const e = h.key('Escape')
      expect(closed).toBe(1)
      expect(e.defaulted).toBe(true)
      expect(e.stopped).toBe(true) // an enclosing Modal must not also close
    } finally { h.unmount() }

    const bare = mount({ count: 2, onActivate: () => {} })
    try {
      expect(bare.key('Escape').defaulted).toBe(false)
    } finally { bare.unmount() }
  })

  it('open:false disables key handling and the activedescendant wiring', () => {
    let hits = 0
    const h = mount({ count: 3, open: false, onActivate: () => { hits++ } })
    try {
      expect(h.input().getAttribute('aria-expanded')).toBe('false')
      expect(h.input().getAttribute('aria-activedescendant')).toBeNull()
      expect(h.key('ArrowDown').defaulted).toBe(false)
      expect(h.nav().sel).toBe(0)
      h.key('Enter')
      expect(hits).toBe(0)
    } finally { h.unmount() }
  })
})

/** RecordSearchPicker behavior contracts — the upgraded combobox features
 *  (entity-select phase 1) exercised through the same react-dom/act harness as
 *  record-search-picker.test.tsx, which keeps the MSW round-trip smoke test.
 *
 *  Here the loader is an injected, test-controlled promise per call, because
 *  the contracts under test are about ASYNC ORDERING and STATE PRESERVATION —
 *  a slow first response must never clobber a newer one, a failure must keep
 *  the typed query and the stale rows, Escape/outside-click must never clear
 *  the input. Deterministic promise control beats latency injection for that.
 *  No request ever leaves these tests (MSW's onUnhandledRequest:'error' would
 *  fail the suite if one did). */
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { render, type Rendered } from './render'

const R = (id: string, label: string, sublabel?: string): PickedRecord => ({ id, label, sublabel })

/** One deferred per CALL (not per query) so a retry of the same query can get
 *  a different outcome than the attempt that failed. */
interface Deferred {
  resolve: (rows: PickedRecord[]) => void
  reject: (e: unknown) => void
}
function controlledSearch() {
  const calls: string[] = []
  const pending = new Map<string, Deferred[]>()
  const search = (q: string): Promise<PickedRecord[]> => {
    calls.push(q)
    return new Promise<PickedRecord[]>((resolve, reject) => {
      const queue = pending.get(q) ?? []
      queue.push({ resolve, reject })
      pending.set(q, queue)
    })
  }
  const take = (q: string): Deferred => {
    const d = pending.get(q)?.shift()
    if (!d) throw new Error(`no pending search for "${q}"`)
    return d
  }
  return {
    search,
    calls,
    resolve: (q: string, rows: PickedRecord[]) => take(q).resolve(rows),
    reject: (q: string, e: unknown) => take(q).reject(e),
  }
}

/* ── DOM helpers (native-event idiom — the repo has no testing-library) ──── */

const setNativeValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!

const input = (view: Rendered): HTMLInputElement => {
  const el = view.container.querySelector('input')
  expect(el).not.toBeNull()
  return el as HTMLInputElement
}

const focus = (view: Rendered) =>
  view.fire(input(view), new FocusEvent('focusin', { bubbles: true }))

async function type(view: Rendered, text: string) {
  const el = input(view)
  setNativeValue.call(el, text)
  await view.fire(el, new Event('input', { bubbles: true }))
}

const key = (view: Rendered, k: string) =>
  view.fire(input(view), new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

const click = (view: Rendered, el: Element) =>
  view.fire(el, new MouseEvent('click', { bubbles: true }))

const options = (view: Rendered): HTMLElement[] =>
  [...view.container.querySelectorAll<HTMLElement>('[role="option"]')]

const option = (view: Rendered, text: string): HTMLElement => {
  const el = options(view).find((o) => o.textContent?.includes(text))
  expect(el, `option containing "${text}"`).toBeDefined()
  return el!
}

const listbox = (view: Rendered) => view.container.querySelector('[role="listbox"]')

/** Debounce (250ms) + a promise hop, with margin. Real timers — the harness
 *  settles inside act(). */
const TICK = 320

describe('RecordSearchPicker — async ordering', () => {
  it('debounces keystrokes and discards a stale slow response', async () => {
    const ctl = controlledSearch()
    const view = await render(
      <RecordSearchPicker label="Rec" value={null} onChange={() => {}} search={ctl.search} />,
    )
    try {
      await focus(view)
      await view.settle(TICK)
      ctl.resolve('', [R('r0', 'Recent Row')])
      await view.settle(20)
      expect(view.container.textContent).toContain('Recent Row')

      // Keystrokes inside the 250ms window coalesce — the intermediate query
      // never reaches the loader (the bounded-search contract stays bounded).
      await type(view, 'sl')
      await view.settle(80)
      await type(view, 'slow')
      await view.settle(TICK)
      expect(ctl.calls).toEqual(['', 'slow'])

      // A newer query fires while the first is still in flight…
      await type(view, 'slower')
      await view.settle(TICK)
      expect(ctl.calls).toEqual(['', 'slow', 'slower'])

      // …the newer response lands first and wins…
      ctl.resolve('slower', [R('b', 'Fresh Hit')])
      await view.settle(20)
      expect(view.container.textContent).toContain('Fresh Hit')

      // …and the slow FIRST response must never clobber it (sequence guard).
      ctl.resolve('slow', [R('a', 'Stale Hit')])
      await view.settle(50)
      expect(view.container.textContent).toContain('Fresh Hit')
      expect(view.container.textContent).not.toContain('Stale Hit')
      expect(view.container.textContent).toContain('1 matches') // aria-live count
    } finally {
      await view.unmount()
    }
  })

  it('a failed search keeps the typed query AND the stale rows; Retry re-runs it', async () => {
    const ctl = controlledSearch()
    const view = await render(
      <RecordSearchPicker label="Rec" value={null} onChange={() => {}} search={ctl.search} />,
    )
    try {
      await focus(view)
      await view.settle(TICK)
      ctl.resolve('', [R('r0', 'Recent Row')])
      await view.settle(20)

      await type(view, 'boom')
      await view.settle(TICK)
      ctl.reject('boom', new Error('transient blip'))
      await view.settle(20)

      // The user's work survives the failure: query intact, last-known rows
      // still visible, an explicit retry offered, and the live region honest.
      expect(input(view).value).toBe('boom')
      expect(view.container.textContent).toContain('Recent Row')
      expect(view.container.textContent).toContain('Search failed.')
      const retry = [...view.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Try again'))
      expect(retry).toBeDefined()

      await click(view, retry!)
      await view.settle(TICK)
      expect(ctl.calls).toEqual(['', 'boom', 'boom'])
      ctl.resolve('boom', [R('f', 'Found After Retry')])
      await view.settle(20)
      expect(view.container.textContent).toContain('Found After Retry')
      expect(view.container.textContent).not.toContain('Search failed.')
    } finally {
      await view.unmount()
    }
  })

  it('Escape and outside-click close the list WITHOUT clearing the typed query', async () => {
    const ctl = controlledSearch()
    const view = await render(
      <RecordSearchPicker label="Rec" value={null} onChange={() => {}} search={ctl.search} />,
    )
    try {
      await focus(view)
      await type(view, 'kept')
      await view.settle(TICK)
      ctl.resolve('kept', [R('k1', 'Kept Hit')])
      await view.settle(20)
      expect(listbox(view)).not.toBeNull()

      // Escape closes the popup only — the query is the user's work.
      await key(view, 'Escape')
      expect(listbox(view)).toBeNull()
      expect(input(view).value).toBe('kept')

      // ArrowDown reopens from the keyboard and the search re-fires.
      await key(view, 'ArrowDown')
      expect(listbox(view)).not.toBeNull()
      await view.settle(TICK)
      ctl.resolve('kept', [R('k1', 'Kept Hit')])
      await view.settle(20)
      expect(view.container.textContent).toContain('Kept Hit')

      // Outside pointerdown closes without touching the input either.
      await view.fire(document.body, new Event('pointerdown', { bubbles: true }))
      expect(listbox(view)).toBeNull()
      expect(input(view).value).toBe('kept')
    } finally {
      await view.unmount()
    }
  })
})

/** Multi-select drives real state the way call sites do (chips render from
 *  `values`, so a stateless render would never show a pick). */
function MultiHarness({ search }: { search: (q: string) => Promise<PickedRecord[]> }) {
  const [values, setValues] = useState<PickedRecord[]>([])
  return <RecordSearchPicker multiple label="People" values={values} onChangeMany={setValues} search={search} />
}

describe('RecordSearchPicker — multi-select', () => {
  it('adds/removes chips, disables already-picked rows, and guards double-select', async () => {
    const ctl = controlledSearch()
    const view = await render(<MultiHarness search={ctl.search} />)
    try {
      await focus(view)
      await view.settle(TICK)
      ctl.resolve('', [R('p1', 'Alpha'), R('p2', 'Bravo'), R('p3', 'Charlie')])
      await view.settle(20)

      await click(view, option(view, 'Alpha'))
      const chips = () => [...view.container.querySelectorAll('ul[aria-label="Selected: People"] li')]
      expect(chips().map((c) => c.textContent)).toEqual(['Alpha×'])
      expect(listbox(view)).not.toBeNull() // multi keeps the list open

      // The picked row stays visible but inert: aria-disabled, check-marked,
      // and clicking it again can never duplicate the chip.
      const alpha = option(view, 'Alpha')
      expect(alpha.getAttribute('aria-disabled')).toBe('true')
      expect(alpha.textContent).toContain('Already selected')
      await click(view, alpha)
      expect(chips()).toHaveLength(1)

      // The keyboard skips the picked row too: Home lands on the first
      // ENABLED row (Bravo), and Enter commits it.
      await key(view, 'Home')
      await key(view, 'Enter')
      expect(chips().map((c) => c.textContent)).toEqual(['Alpha×', 'Bravo×'])

      // Chips meet the 44px touch floor (min-h-11 row, 11×11 remove target).
      expect(chips()[0].className).toContain('min-h-11')
      const remove = view.container.querySelector('button[aria-label="Remove Alpha"]')
      expect(remove).not.toBeNull()
      expect((remove as HTMLElement).className).toMatch(/h-11 w-11/)

      // Removing the chip re-enables the row for a future pick.
      await click(view, remove!)
      expect(chips().map((c) => c.textContent)).toEqual(['Bravo×'])
      expect(option(view, 'Alpha').getAttribute('aria-disabled')).toBeNull()
    } finally {
      await view.unmount()
    }
  })
})

describe('RecordSearchPicker — per-row disable (getDisabled)', () => {
  it('renders the reason badge, skips the row on keyboard, and ignores clicks', async () => {
    const ctl = controlledSearch()
    const picked: PickedRecord[] = []
    const view = await render(
      <RecordSearchPicker
        label="Rec"
        value={null}
        onChange={(v) => { if (v) picked.push(v) }}
        search={ctl.search}
        getDisabled={(r) => (r.id === 'd2' ? 'On hold' : null)}
      />,
    )
    try {
      await focus(view)
      await view.settle(TICK)
      ctl.resolve('', [R('d1', 'First'), R('d2', 'Held Row'), R('d3', 'Third')])
      await view.settle(20)

      const held = option(view, 'Held Row')
      expect(held.getAttribute('aria-disabled')).toBe('true')
      expect(held.textContent).toContain('On hold')

      // Arrow navigation from row 0 lands on row 2 — the disabled row is not
      // keyboard-reachable (aria-activedescendant proves the virtual focus).
      await key(view, 'ArrowDown')
      expect(input(view).getAttribute('aria-activedescendant'))
        .toBe(option(view, 'Third').id)

      // Clicking the disabled row selects nothing…
      await click(view, held)
      expect(picked).toEqual([])
      expect(listbox(view)).not.toBeNull()
      // …while an enabled row still commits normally.
      await click(view, option(view, 'Third'))
      expect(picked.map((p) => p.id)).toEqual(['d3'])
    } finally {
      await view.unmount()
    }
  })
})

describe('RecordSearchPicker — create-new / free-text / minChars', () => {
  it('offers Create new only at ≥2 chars and fires with the trimmed query', async () => {
    const ctl = controlledSearch()
    const created: string[] = []
    const view = await render(
      <RecordSearchPicker
        label="Rec" value={null} onChange={() => {}} search={ctl.search}
        onCreateNew={(q) => created.push(q)}
      />,
    )
    try {
      await focus(view)
      await view.settle(TICK)
      ctl.resolve('', [])
      await view.settle(20)

      await type(view, 'x')
      await view.settle(TICK)
      ctl.resolve('x', [])
      await view.settle(20)
      expect(view.container.textContent).not.toContain('Create new')

      await type(view, ' xy ') // trimmed length 2 crosses the threshold
      await view.settle(TICK)
      ctl.resolve(' xy ', [])
      await view.settle(20)
      const createRow = option(view, 'Create new')
      expect(createRow.textContent).toContain('“xy”')

      await click(view, createRow)
      expect(created).toEqual(['xy'])
      expect(listbox(view)).toBeNull() // the caller's modal takes over
    } finally {
      await view.unmount()
    }
  })

  it('free text is an explicit escape hatch — Enter still prefers the real record', async () => {
    const ctl = controlledSearch()
    const picked: string[] = []
    const freeText: string[] = []
    const view = await render(
      <RecordSearchPicker
        label="Rec" value={null} onChange={(v) => { if (v) picked.push(v.id) }} search={ctl.search}
        allowFreeText={{ label: 'Log as text', onPick: (t) => freeText.push(t) }}
      />,
    )
    try {
      await focus(view)
      await type(view, 'Ghost Dock')
      await view.settle(TICK)
      ctl.resolve('Ghost Dock', [R('g1', 'Ghost Dock Warehouse')])
      await view.settle(20)

      // Enter commits the registry row, never the free text (the SIB rule:
      // structured records win whenever one matches).
      await key(view, 'Enter')
      expect(picked).toEqual(['g1'])
      expect(freeText).toEqual([])

      // Reopen and take the explicit fallback link instead.
      await focus(view)
      await view.settle(TICK)
      ctl.resolve('Ghost Dock', [R('g1', 'Ghost Dock Warehouse')])
      await view.settle(20)
      const link = [...view.container.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('Log as text'))
      expect(link?.textContent).toContain('“Ghost Dock”')
      await click(view, link!)
      expect(freeText).toEqual(['Ghost Dock'])
      expect(listbox(view)).toBeNull()
    } finally {
      await view.unmount()
    }
  })

  it('below minChars shows the hint and never fires the loader', async () => {
    const ctl = controlledSearch()
    const view = await render(
      <RecordSearchPicker label="Rec" value={null} onChange={() => {}} search={ctl.search} minChars={3} />,
    )
    try {
      await focus(view)
      await view.settle(TICK)
      expect(view.container.textContent).toContain('Type at least 3 characters to search.')
      expect(ctl.calls).toEqual([]) // not even the blank recent-rows query

      await type(view, 'ab')
      await view.settle(TICK)
      expect(view.container.textContent).toContain('Type at least 3 characters to search.')
      expect(ctl.calls).toEqual([])

      await type(view, 'abc')
      await view.settle(TICK)
      expect(ctl.calls).toEqual(['abc'])
      ctl.resolve('abc', [R('m1', 'Match')])
      await view.settle(20)
      expect(view.container.textContent).toContain('Match')
      expect(view.container.textContent).not.toContain('Type at least')
    } finally {
      await view.unmount()
    }
  })
})

describe('RecordSearchPicker — combobox a11y and touch floor', () => {
  it('wires combobox/listbox/option roles, activedescendant, live count, 44px rows', async () => {
    const ctl = controlledSearch()
    const view = await render(
      <RecordSearchPicker label="Rec" value={null} onChange={() => {}} search={ctl.search} />,
    )
    try {
      await focus(view)
      await view.settle(TICK)
      ctl.resolve('', [R('a1', 'One'), R('a2', 'Two'), R('a3', 'Three')])
      await view.settle(20)

      const el = input(view)
      expect(el.getAttribute('role')).toBe('combobox')
      expect(el.getAttribute('aria-expanded')).toBe('true')
      expect(el.getAttribute('aria-autocomplete')).toBe('list')
      const list = listbox(view)!
      expect(el.getAttribute('aria-controls')).toBe(list.id)

      // aria-activedescendant follows the arrows (virtual focus — DOM focus
      // never leaves the input; options are not tab stops).
      const opts = options(view)
      expect(el.getAttribute('aria-activedescendant')).toBe(opts[0].id)
      await key(view, 'ArrowDown')
      expect(el.getAttribute('aria-activedescendant')).toBe(opts[1].id)
      expect(opts[1].getAttribute('aria-selected')).toBe('true')
      await key(view, 'ArrowDown')
      expect(el.getAttribute('aria-activedescendant')).toBe(opts[2].id)

      // The match count is announced politely, and every row meets the 44px
      // touch floor (min-h-11).
      const live = view.container.querySelector('[aria-live="polite"]')
      expect(live?.textContent).toBe('3 matches')
      for (const o of opts) expect(o.className).toContain('min-h-11')
    } finally {
      await view.unmount()
    }
  })
})

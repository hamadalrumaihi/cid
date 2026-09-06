// @vitest-environment happy-dom
/** Pins for the debounced suggest hook: nothing is sent before the 300 ms
 *  debounce, a stale answer never overwrites a newer query, `exclude`
 *  filters the hits, and a short / disabled query sends nothing. The RPC
 *  wrapper is mocked (suggestEntities) — no server, no MSW. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { suggestEntities, type SuggestRow } from './api'
import { SUGGEST_DEBOUNCE_MS, useEntitySuggest, type EntitySuggestState } from './useEntitySuggest'
import type { SuggestKind } from './kinds'

vi.mock('./api', () => ({ suggestEntities: vi.fn() }))
const suggestMock = vi.mocked(suggestEntities)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (id: string): SuggestRow => ({ id, kind: 'person', label: `Person ${id}`, sublabel: null, score: 1, exact: false })
const EXCLUDE = new Set(['1'])

interface Props { kind: SuggestKind; q: string; exclude?: ReadonlySet<string>; enabled?: boolean }
function Harness({ kind, q, exclude, enabled, expose }: Props & { expose: (s: EntitySuggestState) => void }) {
  expose(useEntitySuggest(kind, q, { exclude, enabled }))
  return null
}

function mount(props: Props) {
  const holder: { state?: EntitySuggestState } = {}
  const host = document.createElement('div')
  document.body.appendChild(host)
  let root: Root | undefined
  const render = (p: Props) => act(() => {
    root ??= createRoot(host)
    root.render(<Harness {...p} expose={(s) => { holder.state = s }} />)
  })
  render(props)
  return {
    state: () => holder.state!,
    rerender: render,
    /** Advance the fake clock and flush the promises the timer callback awaits. */
    tick: (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) }),
    unmount: () => { act(() => root!.unmount()); host.remove() },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  suggestMock.mockReset()
  suggestMock.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers() })

describe('useEntitySuggest', () => {
  it('sends nothing before the debounce, then exactly one request', async () => {
    suggestMock.mockResolvedValue([row('1'), row('2')])
    const h = mount({ kind: 'person', q: 'ma' })
    try {
      expect(h.state()).toEqual({ hits: [], loading: true, empty: false })
      await h.tick(SUGGEST_DEBOUNCE_MS - 1)
      expect(suggestMock).not.toHaveBeenCalled()
      await h.tick(1)
      expect(suggestMock).toHaveBeenCalledTimes(1)
      expect(suggestMock).toHaveBeenCalledWith('person', 'ma', 20)
      expect(h.state()).toEqual({ hits: [row('1'), row('2')], loading: false, empty: false })
    } finally { h.unmount() }
  })

  it('a stale answer never overwrites a newer query', async () => {
    let resolveOld!: (rows: SuggestRow[]) => void
    suggestMock.mockImplementationOnce(() => new Promise<SuggestRow[]>((r) => { resolveOld = r }))
    const h = mount({ kind: 'person', q: 'ma' })
    try {
      await h.tick(SUGGEST_DEBOUNCE_MS) // the 'ma' request is in flight, unanswered
      expect(suggestMock).toHaveBeenCalledTimes(1)
      suggestMock.mockResolvedValueOnce([row('new')])
      h.rerender({ kind: 'person', q: 'mar' })
      expect(h.state().loading).toBe(true)
      await h.tick(SUGGEST_DEBOUNCE_MS)
      expect(suggestMock).toHaveBeenCalledTimes(2)
      expect(h.state()).toEqual({ hits: [row('new')], loading: false, empty: false })
      // The old request answers late: ignored.
      await act(async () => { resolveOld([row('old')]) })
      expect(h.state().hits).toEqual([row('new')])
    } finally { h.unmount() }
  })

  it('a keystroke inside the debounce cancels the pending request (one call, the latest term)', async () => {
    const h = mount({ kind: 'person', q: 'ma' })
    try {
      await h.tick(100)
      h.rerender({ kind: 'person', q: 'mar' })
      await h.tick(SUGGEST_DEBOUNCE_MS - 1)
      expect(suggestMock).not.toHaveBeenCalled()
      await h.tick(1)
      expect(suggestMock).toHaveBeenCalledTimes(1)
      expect(suggestMock).toHaveBeenCalledWith('person', 'mar', 20)
    } finally { h.unmount() }
  })

  it('exclude filters the hits and an all-excluded answer reads as empty', async () => {
    suggestMock.mockResolvedValue([row('1'), row('2')])
    const h = mount({ kind: 'person', q: 'ma', exclude: EXCLUDE })
    try {
      await h.tick(SUGGEST_DEBOUNCE_MS)
      expect(h.state()).toEqual({ hits: [row('2')], loading: false, empty: false })
      suggestMock.mockResolvedValue([row('1')])
      h.rerender({ kind: 'person', q: 'mar', exclude: EXCLUDE })
      await h.tick(SUGGEST_DEBOUNCE_MS)
      expect(h.state()).toEqual({ hits: [], loading: false, empty: true })
    } finally { h.unmount() }
  })

  it('a short term or enabled:false sends nothing and clears the state', async () => {
    suggestMock.mockResolvedValue([row('1')])
    const h = mount({ kind: 'person', q: 'ma' })
    try {
      await h.tick(SUGGEST_DEBOUNCE_MS)
      expect(h.state().hits).toHaveLength(1)
      h.rerender({ kind: 'person', q: ' m ' })
      expect(h.state()).toEqual({ hits: [], loading: false, empty: false })
      await h.tick(SUGGEST_DEBOUNCE_MS)
      expect(suggestMock).toHaveBeenCalledTimes(1)
      h.rerender({ kind: 'person', q: 'marcus', enabled: false })
      await h.tick(SUGGEST_DEBOUNCE_MS)
      expect(suggestMock).toHaveBeenCalledTimes(1)
      expect(h.state()).toEqual({ hits: [], loading: false, empty: false })
    } finally { h.unmount() }
  })
})

/** Minimal component harness — react-dom/client + React.act under happy-dom.
 *  The repo deliberately has no @testing-library dependency (msw + happy-dom
 *  are Phase 1's only additions), and this is all the smoke tests need:
 *  render, fire a native event, flush timers/microtasks, unmount. */
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

export interface Rendered {
  container: HTMLElement
  /** Dispatch a bubbling native event inside act() and flush effects. */
  fire: (target: EventTarget, event: Event) => Promise<void>
  /** Let real timers/network settle for `ms`, inside act(). */
  settle: (ms: number) => Promise<void>
  unmount: () => Promise<void>
}

export async function render(node: ReactElement): Promise<Rendered> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root
  await act(async () => {
    root = createRoot(container)
    root.render(node)
  })
  return {
    container,
    fire: async (target, event) => {
      await act(async () => {
        target.dispatchEvent(event)
      })
    },
    settle: async (ms) => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms))
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

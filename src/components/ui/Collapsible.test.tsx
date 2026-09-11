// @vitest-environment happy-dom
/** Pins for the Collapsible primitive — it must be a REAL disclosure, not a
 *  styled div: a button inside a heading of the caller's rank, aria-expanded
 *  tracking the state, aria-controls pointing at a named region, the panel
 *  absent from the DOM while closed, and a controlled mode something outside
 *  (an in-page search) can drive. */
import { describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Collapsible } from './Collapsible'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function mount(node: React.ReactElement): Promise<{ el: HTMLElement; cleanup: () => Promise<void> }> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  let root: Root
  await act(async () => {
    root = createRoot(host)
    root.render(node)
  })
  return {
    el: host,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const click = async (el: Element) => {
  await act(async () => { (el as HTMLElement).click() })
}

describe('Collapsible (disclosure semantics)', () => {
  it('renders a button inside the requested heading rank', async () => {
    const { el, cleanup } = await mount(
      <Collapsible title="Recommended equipment" headingLevel={2}>body</Collapsible>,
    )
    const heading = el.querySelector('h2')
    expect(heading).not.toBeNull()
    expect(heading!.querySelector('button')).not.toBeNull()
    expect(el.querySelector('h3')).toBeNull()
    await cleanup()
  })

  it('starts closed with the panel out of the DOM, and toggles on click', async () => {
    const { el, cleanup } = await mount(<Collapsible title="FAQ">the answer</Collapsible>)
    const btn = el.querySelector('button')!
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(el.textContent).not.toContain('the answer')

    await click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(el.textContent).toContain('the answer')

    await click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(el.textContent).not.toContain('the answer')
    await cleanup()
  })

  it('opens by default when asked, and names its region from the trigger', async () => {
    const { el, cleanup } = await mount(
      <Collapsible title="Mk.II requirements" defaultOpen>body</Collapsible>,
    )
    const btn = el.querySelector('button')!
    const panel = el.querySelector('[role="region"]') as HTMLElement
    expect(panel).not.toBeNull()
    expect(btn.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(btn.id)
    expect(btn.id).toBeTruthy()
    await cleanup()
  })

  it('honours the controlled `open` prop and reports intent through onOpenChange', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" data-outside onClick={() => setOpen(true)}>open it</button>
          <Collapsible title="Section" open={open} onOpenChange={setOpen}>panel body</Collapsible>
        </>
      )
    }
    const { el, cleanup } = await mount(<Harness />)
    const outside = el.querySelector('[data-outside]')!
    const trigger = el.querySelectorAll('button')[1]!
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    // Something outside the disclosure opens it (the in-guide search case).
    await click(outside)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(el.textContent).toContain('panel body')

    // And the trigger still closes it, through the same callback.
    await click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await cleanup()
  })
})

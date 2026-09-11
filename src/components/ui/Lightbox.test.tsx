// @vitest-environment happy-dom
/** Pins for the Lightbox primitive. A full-screen viewer is a dialog, so the
 *  contract is Modal's: portalled, role="dialog" + aria-modal, focus moved
 *  in, Escape closes, focus returns to whatever opened it, and the body
 *  scroll lock is released on close. Plus the one rule that made it a
 *  separate primitive — the image is object-contain, never cropped. */
import { describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Lightbox } from './Lightbox'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SRC = '/undergrnd/example.png'

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

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null

const press = async (key: string) => {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

/** A trigger + the viewer it opens — the real call shape, so focus restore is
 *  actually exercised. */
function Harness({ caption }: { caption?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" data-trigger onClick={() => setOpen(true)}>Open screenshot</button>
      <Lightbox
        open={open}
        onClose={() => setOpen(false)}
        src={SRC}
        alt="The Quartermaster list with six items and their BJCOIN prices."
        caption={caption}
      />
    </>
  )
}

describe('Lightbox', () => {
  it('renders nothing until it is opened', async () => {
    const { cleanup } = await mount(<Harness />)
    expect(dialog()).toBeNull()
    await cleanup()
  })

  it('portals a modal dialog, locks the body and shows the image uncropped', async () => {
    const { el, cleanup } = await mount(<Harness caption="Quartermaster gear" />)
    await act(async () => { (el.querySelector('[data-trigger]') as HTMLElement).click() })

    const d = dialog()!
    expect(d).not.toBeNull()
    // Portalled to document.body, not nested in the caller's tree.
    expect(el.contains(d)).toBe(false)
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(d.getAttribute('aria-label')).toContain('Quartermaster gear')
    expect(document.body.classList.contains('overflow-hidden')).toBe(true)

    const img = d.querySelector('img')!
    expect(img.getAttribute('src')).toBe(SRC)
    expect(img.getAttribute('alt')).toContain('Quartermaster')
    expect(img.className).toContain('object-contain')
    expect(img.className).not.toContain('object-cover')

    await cleanup()
  })

  it('moves focus in, closes on Escape and restores focus to the trigger', async () => {
    const { el, cleanup } = await mount(<Harness />)
    const trigger = el.querySelector('[data-trigger]') as HTMLElement
    trigger.focus()
    await act(async () => { trigger.click() })

    // Focus is inside the dialog (its first focusable — the close button).
    expect(dialog()!.contains(document.activeElement)).toBe(true)

    await press('Escape')
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.classList.contains('overflow-hidden')).toBe(false)
    await cleanup()
  })

  it('closes from the close button', async () => {
    const { el, cleanup } = await mount(<Harness />)
    await act(async () => { (el.querySelector('[data-trigger]') as HTMLElement).click() })
    const close = dialog()!.querySelector('button[aria-label="Close screenshot"]') as HTMLElement
    expect(close).not.toBeNull()
    await act(async () => { close.click() })
    expect(dialog()).toBeNull()
    await cleanup()
  })

  it('keeps Tab inside the dialog', async () => {
    const { el, cleanup } = await mount(<Harness />)
    await act(async () => { (el.querySelector('[data-trigger]') as HTMLElement).click() })
    const d = dialog()!
    // The close button is the only focusable node, so Tab wraps onto itself
    // rather than escaping to the page behind.
    await press('Tab')
    expect(d.contains(document.activeElement)).toBe(true)
    await press('Tab')
    expect(d.contains(document.activeElement)).toBe(true)
    await cleanup()
  })
})

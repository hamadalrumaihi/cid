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
      <button type="button" data-trigger onClick={() => setOpen(true)}>Open image</button>
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
    const close = dialog()!.querySelector('button[aria-label="Close image"]') as HTMLElement
    expect(close).not.toBeNull()
    await act(async () => { close.click() })
    expect(dialog()).toBeNull()
    await cleanup()
  })

  it('moves focus into the dialog and keeps Tab inside it', async () => {
    const { el, cleanup } = await mount(<Harness />)
    await act(async () => { (el.querySelector('[data-trigger]') as HTMLElement).click() })
    const d = dialog()!
    // Opening moves focus to the first enabled control, so Tab can never start
    // outside the trap.
    expect(d.contains(document.activeElement)).toBe(true)
    // Tab off the last control wraps to the first rather than escaping to the
    // page behind. (happy-dom does not move focus for Tab itself; the wrap is
    // the handler's own work, which is the part worth pinning.)
    const focusable = Array.from(d.querySelectorAll<HTMLElement>('button:not([disabled])'))
    expect(focusable.length).toBeGreaterThan(1)
    focusable[focusable.length - 1].focus()
    await press('Tab')
    expect(document.activeElement).toBe(focusable[0])
    focusable[0].focus()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(focusable[focusable.length - 1])
    await cleanup()
  })

  it('opens fitted, zooms in and out within bounds, and refits on reopen', async () => {
    const { el, cleanup } = await mount(<Harness />)
    const open = async () => act(async () => { (el.querySelector('[data-trigger]') as HTMLElement).click() })
    await open()
    const pct = () => dialog()!.querySelector('[aria-live="polite"]')!.textContent
    const zoomIn = () => dialog()!.querySelector('button[aria-label="Zoom in"]') as HTMLButtonElement
    const zoomOut = () => dialog()!.querySelector('button[aria-label="Zoom out"]') as HTMLButtonElement

    // 1x fits the viewport, so zooming out is refused at the floor.
    expect(pct()).toBe('100%')
    expect(zoomOut().disabled).toBe(true)

    await act(async () => { zoomIn().click() })
    expect(pct()).toBe('150%')
    expect(zoomOut().disabled).toBe(false)
    await act(async () => { zoomOut().click() })
    expect(pct()).toBe('100%')

    // The ceiling holds however many times it is pressed.
    for (let i = 0; i < 12; i++) await act(async () => { zoomIn().click() })
    expect(pct()).toBe('400%')
    expect(zoomIn().disabled).toBe(true)

    // Reopening the same image starts fitted again, not where it was left.
    await press('Escape')
    await open()
    expect(pct()).toBe('100%')
    await cleanup()
  })

  it('zooms from the keyboard and resets with 0', async () => {
    const { el, cleanup } = await mount(<Harness />)
    await act(async () => { (el.querySelector('[data-trigger]') as HTMLElement).click() })
    const pct = () => dialog()!.querySelector('[aria-live="polite"]')!.textContent
    await press('+')
    expect(pct()).toBe('150%')
    await press('+')
    expect(pct()).toBe('200%')
    await press('-')
    expect(pct()).toBe('150%')
    await press('0')
    expect(pct()).toBe('100%')
    await cleanup()
  })
})

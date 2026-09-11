// @vitest-environment happy-dom
/** Pins for the Progress primitive: the clamp kernel (a meter must never
 *  divide by zero or overflow its track) and the a11y contract — a
 *  progressbar with a real name, honest aria-value* numbers, and
 *  aria-valuetext whenever the raw number needs units. */
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Progress, progressPct } from './Progress'

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

describe('progressPct (pure kernel)', () => {
  it('reports the completed percentage', () => {
    expect(progressPct(3, 14)).toBeCloseTo(21.4285, 3)
    expect(progressPct(1522, 1522)).toBe(100)
    expect(progressPct(0, 4)).toBe(0)
  })

  it('clamps instead of overflowing or going negative', () => {
    expect(progressPct(20, 10)).toBe(100)
    expect(progressPct(-5, 10)).toBe(0)
  })

  it('treats a non-positive or non-finite target as "no target yet"', () => {
    expect(progressPct(5, 0)).toBe(0)
    expect(progressPct(5, -1)).toBe(0)
    expect(progressPct(Number.NaN, 10)).toBe(0)
    expect(progressPct(5, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('Progress (a11y contract)', () => {
  it('is a named progressbar carrying valuemin/now/max and valuetext', async () => {
    const { el, cleanup } = await mount(<Progress value={3} max={14} label="Converters cut" />)
    const bar = el.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-label')).toBe('Converters cut')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuenow')).toBe('3')
    expect(bar.getAttribute('aria-valuemax')).toBe('14')
    expect(bar.getAttribute('aria-valuetext')).toBe('3 / 14')
    await cleanup()
  })

  it('names the bar from the visible caption when showValue prints one', async () => {
    const { el, cleanup } = await mount(
      <Progress value={2787} max={5000} label="Dirty money moved" valueText="$2,787 of $5,000" showValue />,
    )
    const bar = el.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-label')).toBeNull()
    const labelledBy = bar.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Dirty money moved')
    expect(el.textContent).toContain('$2,787 of $5,000')
    await cleanup()
  })

  it('clamps the reported value and the drawn width together', async () => {
    const { el, cleanup } = await mount(<Progress value={40} max={10} label="Over target" />)
    const bar = el.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('10')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('100%')
    await cleanup()
  })
})

import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'
import { Lightbox } from './Lightbox'

/** Full-screen image viewer: Modal's accessibility contract (focus trap,
 *  Escape, focus restored to the trigger) with none of its card chrome, so a
 *  screenshot is shown at its own aspect ratio — object-contain, never
 *  stretched, never cropped. Close it and focus returns to the launcher. */
const meta = {
  title: 'UI/Lightbox',
  component: Lightbox,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Lightbox>

export default meta
type Story = StoryObj

// Inline SVG so the story needs no binary asset in public/ — a wide panel and
// a tall one, to show that neither orientation is cropped.
const svg = (w: number, h: number, text: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="#0b1220"/>` +
      `<rect x="8" y="8" width="${w - 16}" height="${h - 16}" fill="none" stroke="#f59e0b" stroke-width="4"/>` +
      `<text x="50%" y="50%" fill="#e2e8f0" font-family="monospace" font-size="28" text-anchor="middle">${text}</text>` +
      '</svg>',
  )}`

function Launcher({ label, children }: {
  label: string
  children: (open: boolean, close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="p-6">
      <Button variant="primary" onClick={() => setOpen(true)}>{label}</Button>
      {children(open, () => setOpen(false))}
    </div>
  )
}

export const Landscape: Story = {
  render: () => (
    <Launcher label="Open screenshot">
      {(open, close) => (
        <Lightbox
          open={open}
          onClose={close}
          src={svg(1600, 900, '1600 x 900')}
          alt="A wide interface panel with a gold border and its dimensions printed in the middle."
          caption="Wide panel — fits to the viewport width."
        />
      )}
    </Launcher>
  ),
}

export const PortraitWithMeta: Story = {
  render: () => (
    <Launcher label="Open tall screenshot">
      {(open, close) => (
        <Lightbox
          open={open}
          onClose={close}
          src={svg(700, 1200, '700 x 1200')}
          alt="A tall interface panel with a gold border and its dimensions printed in the middle."
          caption="Tall panel — capped at 80dvh, still uncropped."
          meta="/example/tall-panel.png"
        />
      )}
    </Launcher>
  ),
}

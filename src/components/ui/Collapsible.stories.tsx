import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './Badge'
import { Button } from './Button'
import { Collapsible } from './Collapsible'

/** The ARIA disclosure pattern: a real button (Enter/Space come free) inside
 *  a heading of the caller's rank, and a labelled region that only exists
 *  while open. Uncontrolled by default; `open` + `onOpenChange` let something
 *  outside — an in-page search, an "expand all" control — drive it. */
const meta = {
  title: 'UI/Collapsible',
  component: Collapsible,
  args: {
    title: 'Recommended equipment',
    children: (
      <p className="text-sm text-slate-300">
        Buy equipment only when its corresponding activity is available, and keep
        enough set aside for the permanent line unlocks.
      </p>
    ),
  },
} satisfies Meta<typeof Collapsible>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const OpenByDefault: Story = {
  args: { defaultOpen: true, hint: 'Nine short rules.' },
}

export const WithMeta: Story = {
  args: { defaultOpen: true, meta: <Badge tone="warn">Examples</Badge> },
}

/** Controlled: an outside control opens and closes every section at once. */
export const Controlled: Story = {
  render: function ControlledStory(args) {
    const [open, setOpen] = useState<Record<string, boolean>>({ a: true, b: false })
    const all = (next: boolean) => setOpen({ a: next, b: next })
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => all(true)}>Expand all</Button>
          <Button size="sm" onClick={() => all(false)}>Collapse all</Button>
        </div>
        <Collapsible
          {...args}
          title="Section A"
          open={open.a}
          onOpenChange={(v) => setOpen((s) => ({ ...s, a: v }))}
        />
        <Collapsible
          {...args}
          title="Section B"
          open={open.b}
          onOpenChange={(v) => setOpen((s) => ({ ...s, b: v }))}
        />
      </div>
    )
  },
}

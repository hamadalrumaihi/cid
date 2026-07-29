import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './Badge'
import { Card } from './Card'
import { SectionHeader } from './PageHeader'

/** The canonical surface: rounded-2xl, border-white/5, bg-ink-900/60.
 *  Padding is a named scale (none/sm/md/lg), never ad-hoc p-* values. */
const meta = {
  title: 'UI/Card',
  component: Card,
  argTypes: {
    pad: { control: 'inline-radio', options: ['none', 'sm', 'md', 'lg'] },
  },
  args: {
    children: (
      <p className="text-sm text-slate-300">
        Surveillance detail confirmed the drop location. Follow-up canvass
        scheduled for Thursday.
      </p>
    ),
  },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const PaddingScale: Story = {
  render: () => (
    <div className="grid max-w-xl gap-3">
      {(['none', 'sm', 'md', 'lg'] as const).map((pad) => (
        <Card key={pad} pad={pad}>
          <p className="text-sm text-slate-300">pad=&quot;{pad}&quot;</p>
        </Card>
      ))}
    </div>
  ),
}

export const Interactive: Story = {
  args: {
    interactive: true,
    children: (
      <p className="text-sm text-slate-300">
        Hover me — interactive cards brighten their border to signal a click
        target.
      </p>
    ),
  },
}

export const WithHeaderAndBadges: Story = {
  render: () => (
    <Card className="max-w-xl">
      <SectionHeader
        title="Vespucci Fencing Ring"
        subtitle="CID-26-0140 · Mirror Park"
        actions={<Badge tone="good">active</Badge>}
      />
      <p className="mt-3 text-sm text-slate-300">
        Pawn shop CCTV pulled; complainant interview complete. Awaiting serial
        trace on the recovered watches.
      </p>
    </Card>
  ),
}

export const LongContent: Story = {
  render: () => (
    <Card className="max-w-xl">
      <p className="text-sm leading-relaxed text-slate-300">
        {Array.from({ length: 6 }, () =>
          'Field interview notes and canvass results accumulate here without breaking the surface geometry. ',
        ).join('')}
      </p>
    </Card>
  ),
}

import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from '@/components/ui/Badge'
import { DashRow } from './DashRow'

/** One actionable dashboard row. The why-line is mandatory — every row states
 *  the reason it needs the viewer, not just what it is. */
const meta = {
  title: 'Dash/DashRow',
  component: DashRow,
  args: {
    title: 'CID-26-0140 · Vespucci Fencing Ring',
    why: 'Returned by AG — correction required',
    onClick: () => {},
  },
} satisfies Meta<typeof DashRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithMetaAndBadge: Story = {
  args: {
    meta: 'due Fri',
    badge: <Badge tone="warn">warrant</Badge>,
  },
}

export const Overdue: Story = {
  args: {
    why: 'Follow-up was due 3 days ago',
    meta: '3d over',
    overdue: true,
  },
}

export const LongTitleTruncates: Story = {
  render: (args) => (
    <div className="max-w-sm">
      <DashRow
        {...args}
        title="CID-26-0162 · Multi-agency container seizure at the Port of Los Santos with parallel financial workup"
        why="Assigned to you — first activity pending"
      />
    </div>
  ),
}

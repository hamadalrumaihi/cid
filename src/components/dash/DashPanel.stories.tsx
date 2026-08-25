import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from '@/components/ui/Badge'
import { DashPanel } from './DashPanel'
import { DashRow } from './DashRow'

/** The dashboard section surface: dense header (title + count chip + optional
 *  action), rows below. An `empty` panel renders NOTHING — dashboards remove
 *  hollow sections instead of showing them. */
const meta = {
  title: 'Dash/DashPanel',
  component: DashPanel,
  args: {
    title: 'Awaiting your sign-off',
    count: 3,
    children: (
      <>
        <DashRow
          title="CID-26-0140 · Vespucci Fencing Ring"
          why="Returned by AG — correction required"
          meta="2d"
          overdue
          onClick={() => {}}
        />
        <DashRow
          title="CID-26-0155 · Dockside Burglaries"
          why="Bureau lead review — your stage"
          meta="6h"
          onClick={() => {}}
        />
        <DashRow
          title="CID-26-0161 · Chop Shop Surveillance"
          why="Deputy Director review — your stage"
          meta="1h"
          badge={<Badge tone="accent">priority</Badge>}
          onClick={() => {}}
        />
      </>
    ),
  },
} satisfies Meta<typeof DashPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithHintAndAction: Story = {
  args: {
    hint: 'Sign-off requests routed to you. Deciding here is the same act as deciding on the case file.',
    action: { label: 'All sign-offs →', onClick: () => {} },
  },
}

export const Collapsible: Story = {
  args: {
    collapsible: true,
    action: { label: 'All →', onClick: () => {} },
  },
}

export const EmptyRendersNothing: Story = {
  render: (args) => (
    <div className="grid max-w-xl gap-3">
      <DashPanel {...args} empty>
        <p>never rendered</p>
      </DashPanel>
      <p className="text-xs text-slate-400">
        The panel above was rendered with <code>empty</code> — nothing appears, by design.
      </p>
    </div>
  ),
}

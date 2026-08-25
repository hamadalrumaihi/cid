import type { Meta, StoryObj } from '@storybook/react-vite'
import { DashSwitcherView } from './DashSwitcherView'

/** The dashboard switcher's presentational core. The wired `DashSwitcher`
 *  needs the auth/SIB providers, so stories exercise the view with explicit
 *  capability sets — exactly what useCapabilities emits per persona. */
const meta = {
  title: 'Dash/DashSwitcher',
  component: DashSwitcherView,
  args: {
    dashboards: ['my', 'cases'],
    activeTab: 'inbox',
    onNavigate: () => {},
  },
} satisfies Meta<typeof DashSwitcherView>

export default meta
type Story = StoryObj<typeof meta>

export const Detective: Story = {}

export const BureauLead: Story = {
  args: { dashboards: ['my', 'cases', 'command'], activeTab: 'command-center' },
}

export const AttorneyGeneral: Story = {
  args: { dashboards: ['my', 'cases', 'sib', 'doj'], activeTab: 'legal' },
}

export const Owner: Story = {
  args: { dashboards: ['my', 'cases', 'command', 'owner'], activeTab: 'owner' },
}

export const NarrowSelect: Story = {
  args: {
    dashboards: ['my', 'cases', 'command', 'sib', 'doj', 'owner'],
    activeTab: 'siu',
    narrow: true,
  },
  render: (args) => (
    <div className="max-w-xs">
      <DashSwitcherView {...args} />
    </div>
  ),
}

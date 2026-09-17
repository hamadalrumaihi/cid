import type { Meta, StoryObj } from '@storybook/react-vite'
import { PortalModeScreen } from './PortalModeScreen'

/** The two screens that replace the whole portal: retirement and
 *  maintenance. No login and no Supabase — this is what every address shows
 *  while PORTAL_MODE is retired or maintenance, at 390, 768 and 1440. */
const meta = {
  title: 'Portal/Mode screens',
  component: PortalModeScreen,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PortalModeScreen>
export default meta
type Story = StoryObj<typeof meta>

export const Retired: Story = { args: { mode: 'retired' } }
export const Maintenance: Story = { args: { mode: 'maintenance' } }

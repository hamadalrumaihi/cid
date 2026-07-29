import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { ActionMenu } from './ActionMenu'

/** Overflow “⋯” menu: aria-haspopup/role=menu, click-outside + Esc close,
 *  arrow/Home/End navigation, and a separated danger group so destructive
 *  actions are never a mis-click away from routine ones. */
const meta = {
  title: 'UI/ActionMenu',
  component: ActionMenu,
  args: {
    items: [
      { label: 'Duplicate case', onClick: fn() },
      { label: 'Export packet', onClick: fn() },
      { label: 'Archive', onClick: fn(), separatorBefore: true },
    ],
  },
} satisfies Meta<typeof ActionMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithDangerGroup: Story = {
  args: {
    items: [
      { label: 'Edit details', icon: '✏️', onClick: fn() },
      { label: 'Reassign lead', icon: '👤', onClick: fn() },
      { label: 'Delete case', icon: '🗑', onClick: fn(), danger: true, separatorBefore: true },
    ],
  },
}

export const WithDisabledItems: Story = {
  args: {
    items: [
      { label: 'Edit details', onClick: fn() },
      { label: 'Finalize (needs sign-off)', onClick: fn(), disabled: true },
      { label: 'Delete case', onClick: fn(), danger: true, disabled: true, separatorBefore: true },
    ],
  },
}

/** Left-aligned popover for triggers near the right edge of a row. */
export const AlignLeft: Story = {
  args: { align: 'left', label: 'Row actions' },
  render: (args) => (
    <div className="flex justify-start">
      <ActionMenu {...args} />
    </div>
  ),
}

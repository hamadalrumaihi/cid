import type { Meta, StoryObj } from '@storybook/react-vite'
import { HelpTip } from './HelpTip'

/** Tiny ⓘ contextual-help popover — click to open, Escape/outside-click/blur
 *  to close. One or two sentences only; anything longer belongs in the User
 *  Guide, which the optional `guide` prop links to (`/guide#g-<section>`).
 *  The 20px chip carries an invisible ~40px hit area (after:-inset-2.5). */
const meta = {
  title: 'UI/HelpTip',
  component: HelpTip,
} satisfies Meta<typeof HelpTip>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    label: 'About stale cases',
    children: 'An open case with no updates for 14 days is flagged stale. Record progress, or mark it cold if it is deliberately parked.',
  },
}

export const WithGuideLink: Story = {
  args: {
    label: 'About sign-off',
    guide: 'case',
    children: 'Sign-off routes the finished investigation up the command chain. The chip names who decides next.',
  },
}

/** Right-aligned popover for triggers near the viewport's right edge. */
export const RightAligned: Story = {
  args: {
    label: 'About visibility',
    align: 'right',
    children: 'SIB Only records are absent from CID search, counts and exports — not marked as withheld.',
  },
  decorators: [(Story) => <div className="flex justify-end pr-2"><Story /></div>],
}

/** Beside an 11px chip — the intended in-situ scale. */
export const BesideAChip: Story = {
  args: {
    label: 'What draft means',
    children: 'A draft is not sent yet. Only you can see it, and you can keep editing it. Once sent, it becomes the record of what you reported.',
  },
  decorators: [
    (Story) => (
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-slate-300">Draft saved</span>
        <Story />
      </span>
    ),
  ],
}

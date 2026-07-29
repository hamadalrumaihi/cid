import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Breadcrumbs } from './Breadcrumbs'

/** Drill-down trail — ancestors are clickable buttons, the last crumb is the
 *  current location (aria-current="page", not clickable). */
const meta = {
  title: 'UI/Breadcrumbs',
  component: Breadcrumbs,
} satisfies Meta<typeof Breadcrumbs>

export default meta
type Story = StoryObj<typeof meta>

export const TwoLevels: Story = {
  args: {
    items: [
      { label: 'Cases', onClick: fn() },
      { label: 'Vespucci Fencing Ring' },
    ],
  },
}

export const ThreeLevels: Story = {
  args: {
    items: [
      { label: 'Operations', onClick: fn() },
      { label: 'Operation Nightjar', onClick: fn() },
      { label: 'Linked case CID-26-0140' },
    ],
  },
}

/** An ancestor without onClick renders as plain text — no dead button. */
export const NonClickableAncestor: Story = {
  args: {
    items: [
      { label: 'Archive (read-only)' },
      { label: 'Cold Storage Burglary' },
    ],
  },
}

export const LongLabels: Story = {
  args: {
    items: [
      { label: 'Cases', onClick: fn() },
      { label: 'Joint Operation — Interbureau Narcotics Distribution Network', onClick: fn() },
      { label: 'Supplemental report #12 — surveillance annex' },
    ],
  },
}

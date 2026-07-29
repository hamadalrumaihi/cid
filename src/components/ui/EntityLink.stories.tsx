import type { Meta, StoryObj } from '@storybook/react-vite'
import { EntityLink } from './EntityLink'

/** Deep-link chip to another record via the app's canonical query-param
 *  navigation. In Storybook, next/navigation is stubbed — clicking a chip
 *  logs router.push(href) to the Actions panel instead of navigating, so the
 *  href shapes are inspectable without an app shell. */
const meta = {
  title: 'UI/EntityLink',
  component: EntityLink,
  args: {
    kind: 'person',
    id: 'a1b2c3d4',
    label: 'Tommy Vercelli',
  },
  argTypes: {
    kind: {
      control: 'select',
      options: ['person', 'vehicle', 'case', 'gang', 'place', 'narcotic'],
    },
  },
} satisfies Meta<typeof EntityLink>

export default meta
type Story = StoryObj<typeof meta>
// For render-only gallery stories (no per-story args).
type Gallery = StoryObj

export const Person: Story = {}

export const AllKinds: Gallery = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <EntityLink kind="person" id="p-1" label="Tommy Vercelli" />
      <EntityLink kind="vehicle" id="v-1" label="SANDY 8821 · Karin Sultan" />
      <EntityLink kind="case" id="c-1" label="CID-26-0140" />
      <EntityLink kind="gang" label="Vagos" />
      <EntityLink kind="place" label="Yellow Jack Inn" />
      <EntityLink kind="narcotic" id="n-1" label="Methamphetamine" />
    </div>
  ),
}

export const LongLabelTruncates: Gallery = {
  render: () => (
    <div className="max-w-48">
      <EntityLink
        kind="case"
        id="c-2"
        label="Joint Operation — Interbureau Narcotics Distribution Network, Sandy Shores Corridor"
      />
    </div>
  ),
}

export const CustomTitle: Story = {
  args: {
    kind: 'vehicle',
    id: 'v-9',
    label: 'LS 55TQK',
    title: 'Open the vehicle record for LS 55TQK',
  },
}

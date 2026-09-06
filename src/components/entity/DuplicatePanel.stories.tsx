import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import type { DuplicateRow } from '@/lib/entity'
import { DuplicatePanel } from './DuplicatePanel'

/** What `entity_duplicates` found for a draft. Strong matches are the amber
 *  block with **Use existing** as the primary action; soft matches are the
 *  quiet list. Signals render as words ("same plate", "similar name"). */
const meta = {
  title: 'Entity/DuplicatePanel',
  component: DuplicatePanel,
  args: { onUseExisting: fn(), onCompare: fn() },
} satisfies Meta<typeof DuplicatePanel>

export default meta
type Story = StoryObj<typeof meta>

const STRONG: DuplicateRow[] = [
  { id: 'a', label: 'Marcus Reyes', sublabel: '“Rey” · 555-0142', signal: 'phone', strength: 'strong', score: 1 },
  { id: 'b', label: 'Marcus Reyes', sublabel: 'DOB 1990-07-14', signal: 'name+dob', strength: 'strong', score: 1 },
]
const SOFT: DuplicateRow[] = [
  { id: 'c', label: 'Marco Reyes-Ortiz', sublabel: null, signal: 'name~', strength: 'soft', score: 0.62 },
  { id: 'd', label: 'Mark Reyes', sublabel: 'Vespucci', signal: 'name~', strength: 'soft', score: 0.55 },
]

export const StrongAndSoft: Story = {
  args: { rows: [...STRONG, ...SOFT], kind: 'person' },
}

export const SoftOnly: Story = {
  args: { rows: SOFT, kind: 'person' },
}

export const WithMerge: Story = {
  args: { rows: STRONG, kind: 'person', onMerge: fn() },
}

export const VehiclePlate: Story = {
  args: {
    kind: 'vehicle',
    rows: [
      { id: 'v1', label: '48KLM921', sublabel: 'black Sultan', signal: 'plate', strength: 'strong', score: 1 },
      { id: 'v2', label: '48KLM92', sublabel: 'grey Sultan RS', signal: 'plate~', strength: 'soft', score: 0.8 },
    ],
  },
}

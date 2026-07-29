import type { Meta, StoryObj } from '@storybook/react-vite'
import { DeadlineChip } from './DeadlineChip'

/** Deadline/expiry chip driven by src/lib/deadlines.ts. `now` is injected in
 *  every story so the rendered state is deterministic — never Date.now(). */
const NOW = Date.parse('2026-07-29T12:00:00Z')
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString()

const meta = {
  title: 'UI/DeadlineChip',
  component: DeadlineChip,
  args: { now: NOW },
} satisfies Meta<typeof DeadlineChip>

export default meta
type Story = StoryObj<typeof meta>
// For render-only gallery stories (no per-story args).
type Gallery = StoryObj

export const Future: Story = {
  args: { at: hours(24 * 14) },
}

export const DueSoon: Story = {
  args: { at: hours(36) },
}

export const Urgent: Story = {
  args: { at: hours(6) },
}

export const Overdue: Story = {
  args: { at: hours(-30) },
}

/** All three kinds share one vocabulary: due / expires / response due. */
export const Kinds: Gallery = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <DeadlineChip at={hours(6)} kind="due" now={NOW} />
      <DeadlineChip at={hours(6)} kind="expires" now={NOW} />
      <DeadlineChip at={hours(6)} kind="deadline" now={NOW} />
      <DeadlineChip at={hours(-72)} kind="expires" now={NOW} />
      <DeadlineChip at={hours(-2)} kind="deadline" now={NOW} />
    </div>
  ),
}

/** Date-only values (task due dates) count as due at end of that day. */
export const DateOnly: Story = {
  args: { at: '2026-07-30' },
}

/** No timestamp → renders nothing at all (the empty state is intentional). */
export const NoDeadline: Gallery = {
  render: () => (
    <p className="text-sm text-slate-400">
      A null/undefined timestamp renders nothing:{' '}
      <DeadlineChip at={null} now={NOW} />
      <span className="text-slate-200">← (empty)</span>
    </p>
  ),
}

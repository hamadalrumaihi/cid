import type { Meta, StoryObj } from '@storybook/react-vite'
import { WorkflowTimeline, type TimelineEntry } from './WorkflowTimeline'

/** Workflow-history timeline — presentation only; each domain maps its rows
 *  into TimelineEntry with its own labels. Timestamps here are fixed ISO
 *  strings (rendered via toLocaleString). */
const ENTRIES: TimelineEntry[] = [
  {
    id: 'e1',
    title: 'Request created',
    actor: 'Det. Ray Calder',
    at: '2026-07-20T09:14:00Z',
  },
  {
    id: 'e2',
    title: 'Submitted to DOJ',
    actor: 'Det. Ray Calder',
    at: '2026-07-21T15:02:00Z',
    from: 'Draft',
    to: 'Submitted',
  },
  {
    id: 'e3',
    title: 'Returned for changes',
    actor: 'ADA M. Reyes',
    at: '2026-07-24T11:47:00Z',
    from: 'Submitted',
    to: 'Changes requested',
    note: 'Probable-cause narrative needs the CCTV timestamps.',
  },
  {
    id: 'e4',
    title: 'Approved',
    actor: 'ADA M. Reyes',
    at: '2026-07-27T16:30:00Z',
    to: 'Approved',
  },
]

const meta = {
  title: 'UI/WorkflowTimeline',
  component: WorkflowTimeline,
  args: { entries: ENTRIES },
} satisfies Meta<typeof WorkflowTimeline>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Dense: Story = {
  args: { dense: true },
}

export const Empty: Story = {
  args: { entries: [], empty: 'No legal actions recorded for this case yet.' },
}

export const SingleEntry: Story = {
  args: { entries: ENTRIES.slice(0, 1) },
}

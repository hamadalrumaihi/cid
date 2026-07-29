import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { threatTint } from '@/lib/tint'
import { MetricStrip } from './MetricStrip'

/** Dossier KPI strip. Metrics with onClick render as real buttons (visible
 *  focus ring) that jump to the owning section; values are verbatim — `—`
 *  for unknown, never a fabricated 0. */
const meta = {
  title: 'UI/MetricStrip',
  component: MetricStrip,
} satisfies Meta<typeof MetricStrip>

export default meta
type Story = StoryObj<typeof meta>

export const Static: Story = {
  args: {
    metrics: [
      { label: 'Open cases', value: 12 },
      { label: 'Reports', value: 48 },
      { label: 'Members', value: 9, hint: '3 confirmed' },
      { label: 'Last activity', value: '—', hint: 'No recorded activity' },
    ],
  },
}

export const Clickable: Story = {
  args: {
    metrics: [
      { label: 'Open cases', value: 12, onClick: fn() },
      { label: 'Reports', value: 48, onClick: fn() },
      { label: 'Tasks due', value: 5, hint: '2 overdue', onClick: fn() },
      { label: 'Media items', value: 31, onClick: fn() },
    ],
  },
}

export const WithTints: Story = {
  args: {
    metrics: [
      { label: 'Threat level', value: 'HIGH', tint: threatTint('high') },
      { label: 'Confidence', value: 'Probable', tint: 'bg-blue-500/15 text-blue-300' },
      { label: 'Open cases', value: 3, onClick: fn() },
      { label: 'Last sighting', value: '—' },
    ],
  },
}

export const UnknownValues: Story = {
  args: {
    metrics: [
      { label: 'Members', value: '—', hint: 'Not yet mapped' },
      { label: 'Territory', value: '—' },
      { label: 'Associates', value: '—' },
      { label: 'Vehicles', value: '—' },
    ],
  },
}

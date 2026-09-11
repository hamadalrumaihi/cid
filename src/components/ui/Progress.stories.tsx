import type { Meta, StoryObj } from '@storybook/react-vite'
import { Progress } from './Progress'

/** Determinate meter with a required accessible name. `showValue` prints the
 *  label and value above the track and names the bar from them
 *  (aria-labelledby); without it the name comes from aria-label. The width
 *  transition is the only motion, and globals.css disables it under
 *  prefers-reduced-motion. */
const meta = {
  title: 'UI/Progress',
  component: Progress,
  args: { value: 3, max: 14, label: 'Converters cut' },
} satisfies Meta<typeof Progress>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithVisibleValue: Story = {
  args: { showValue: true },
}

export const Complete: Story = {
  args: { value: 14, max: 14, tone: 'good', showValue: true },
}

export const CustomValueText: Story = {
  args: { value: 2787, max: 5000, valueText: '$2,787 of $5,000', showValue: true, tone: 'warn' },
}

export const NotStarted: Story = {
  args: { value: 0, max: 4, showValue: true, tone: 'neutral', size: 'sm' },
}

export const Tones: Story = {
  render: (args) => (
    <div className="space-y-3">
      {(['neutral', 'accent', 'good', 'warn', 'danger'] as const).map((tone) => (
        <Progress key={tone} {...args} tone={tone} label={`${tone} meter`} showValue />
      ))}
    </div>
  ),
}

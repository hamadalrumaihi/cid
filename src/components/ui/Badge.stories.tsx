import type { Meta, StoryObj } from '@storybook/react-vite'
import { confidenceTint, priorityTint, statusTint, threatTint } from '@/lib/tint'
import { Badge } from './Badge'

/** The one badge chip. Colour comes either from a `tone` shorthand or a
 *  `tint` class produced by the central helpers in src/lib/tint.ts — never a
 *  hand-rolled class string. */
const meta = {
  title: 'UI/Badge',
  component: Badge,
  args: { children: 'Active' },
  argTypes: {
    tone: {
      control: 'select',
      options: ['neutral', 'accent', 'good', 'warn', 'danger'],
    },
    tint: { control: 'text' },
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Neutral: Story = {}

export const AllTones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge tone="neutral">Neutral</Badge>
      <Badge tone="accent">Accent</Badge>
      <Badge tone="good">Good</Badge>
      <Badge tone="warn">Warn</Badge>
      <Badge tone="danger">Danger</Badge>
    </div>
  ),
}

/** Status/priority/threat/confidence chips read from src/lib/tint.ts, so a
 *  badge always matches the vocabulary used across the app. */
export const WithTintHelpers: Story = {
  render: () => (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {['open', 'active', 'cold', 'closed', 'archived'].map((s) => (
          <Badge key={s} tint={statusTint(s)}>{s}</Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {['critical', 'high', 'medium', 'low'].map((p) => (
          <Badge key={p} tint={priorityTint(p)}>{p} priority</Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {['high', 'medium', 'low'].map((t) => (
          <Badge key={t} tint={threatTint(t)}>threat {t}</Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {['confirmed', 'probable', 'possible', 'unverified', 'disproven'].map((c) => (
          <Badge key={c} tint={confidenceTint(c)}>{c}</Badge>
        ))}
      </div>
    </div>
  ),
}

export const LongContent: Story = {
  args: {
    tone: 'accent',
    children: 'Awaiting sign-off from the Bureau Commander (submitted 3 days ago)',
  },
}

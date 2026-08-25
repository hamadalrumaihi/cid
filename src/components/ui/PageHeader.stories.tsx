import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './Badge'
import { Button } from './Button'
import { PageHeader, SectionHeader } from './PageHeader'

/** One real <h1> per view (PageHeader) and <h2> ranks inside it
 *  (SectionHeader) — a fixed type scale instead of per-view heading drift. */
const meta = {
  title: 'UI/PageHeader',
  component: PageHeader,
  args: {
    title: 'Case Registry',
  },
} satisfies Meta<typeof PageHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithSubtitle: Story = {
  args: {
    title: 'Case Registry',
    subtitle: 'Every case visible to your bureau, newest first.',
  },
}

export const WithEyebrowAndActions: Story = {
  args: {
    eyebrow: 'Major Crimes Bureau',
    title: 'Vespucci Fencing Ring',
    subtitle: 'CID-26-0140 · Lead: Det. Lena Ortiz',
    actions: (
      <>
        <Badge tone="good">active</Badge>
        <Button size="sm">Edit</Button>
        <Button variant="primary" size="sm">Submit for review</Button>
      </>
    ),
  },
}

export const LongTitleWrap: Story = {
  args: {
    eyebrow: 'Street Crimes Bureau',
    title:
      'Joint Operation — Interbureau Narcotics Distribution Network, Sandy Shores Corridor',
    subtitle: 'Wraps without pushing the actions off-screen.',
    actions: <Button variant="primary" size="sm">New report</Button>,
  },
}

export const Section: Story = {
  render: () => (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Case detail" subtitle="PageHeader is the page's single h1." />
      <SectionHeader
        title="Reports"
        subtitle="SectionHeader is the h2 rank inside a page."
        actions={<Button size="sm">Add report</Button>}
      />
      <SectionHeader title="Tasks" />
    </div>
  ),
}

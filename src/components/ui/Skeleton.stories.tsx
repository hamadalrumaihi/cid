import type { Meta, StoryObj } from '@storybook/react-vite'
import { CardGridSkeleton, DetailSkeleton, ListSkeleton, Skeleton } from './Skeleton'

/** First-load placeholders that render the *shape* of the incoming content.
 *  The pulse is the .skel keyframe from globals.css — already disabled under
 *  prefers-reduced-motion. */
const meta = {
  title: 'UI/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Block: Story = {
  args: { className: 'h-4 w-48' },
}

export const CardGrid: Story = {
  render: () => <CardGridSkeleton />,
}

export const CardGridCompactCount: Story = {
  render: () => <CardGridSkeleton count={3} cols="sm:grid-cols-3" />,
}

export const List: Story = {
  render: () => <ListSkeleton />,
}

export const Detail: Story = {
  render: () => <DetailSkeleton blocks={3} />,
}

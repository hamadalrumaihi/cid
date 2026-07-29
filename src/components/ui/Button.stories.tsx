import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Button } from './Button'
import { Toaster } from './Toaster'

/** The one button. Six variants; `secondary` is the default for a reason —
 *  most actions are secondary. `onAction` demos show the built-in useAction
 *  busy-guarding (spinner, no double-fire, errors humanized into a toast). */
const meta = {
  title: 'UI/Button',
  component: Button,
  args: {
    children: 'Assign detective',
    onClick: fn(),
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'danger', 'success', 'warn', 'ghost'],
    },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    onAction: { control: false },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Secondary: Story = {}

export const Primary: Story = {
  args: { variant: 'primary', children: 'Open case' },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Open case</Button>
      <Button variant="secondary">Assign</Button>
      <Button variant="success">Approve</Button>
      <Button variant="warn">Reopen</Button>
      <Button variant="danger">Delete</Button>
      <Button variant="ghost">Dismiss</Button>
    </div>
  ),
}

export const Small: Story = {
  args: { size: 'sm', children: 'Add note' },
}

export const Disabled: Story = {
  args: { disabled: true, children: 'Finalize report' },
}

export const Loading: Story = {
  args: { variant: 'primary', loading: true, children: 'Saving…' },
}

/** `onAction` runs through useAction: busy while pending (spinner, disabled),
 *  guaranteed single-fire. Click and watch the 1.2s round trip. */
export const AsyncAction: Story = {
  args: { onClick: undefined },
  render: () => (
    <Button
      variant="primary"
      onAction={() => new Promise((resolve) => setTimeout(resolve, 1200))}
    >
      Save changes
    </Button>
  ),
}

/** A failing onAction never throws to the console — useAction humanizes the
 *  error into a danger toast (Toaster mounted here to show it). */
export const AsyncActionError: Story = {
  args: { onClick: undefined },
  render: () => (
    <>
      <Button
        variant="danger"
        onAction={() =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('permission denied for table cases')), 600),
          )
        }
      >
        Purge records
      </Button>
      <Toaster />
    </>
  ),
}

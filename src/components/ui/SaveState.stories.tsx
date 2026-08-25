import type { Meta, StoryObj } from '@storybook/react-vite'
import { SaveState } from './SaveState'

/** Autosave-state chip for draft-backed editors (report forms, working notes,
 *  the chat composer, person/gang modals). Amber states mean the draft is
 *  safe on this device but not yet on the server; rose means a server write
 *  failed. Idle renders nothing (the aria-live span stays mounted). */
const meta = {
  title: 'UI/SaveState',
  component: SaveState,
} satisfies Meta<typeof SaveState>

export default meta
type Story = StoryObj<typeof meta>

export const Saving: Story = {
  args: { status: 'saving' },
}

export const Saved: Story = {
  args: { status: 'saved', lastSavedAt: Date.now() - 30_000 },
}

export const SaveFailed: Story = {
  args: { status: 'error' },
}

export const Offline: Story = {
  args: { status: 'offline' },
}

/** Payload over the server ceiling — the draft stays in localStorage only. */
export const TooLargeToSync: Story = {
  args: { status: 'local' },
}

export const Idle: Story = {
  args: { status: 'idle' },
}

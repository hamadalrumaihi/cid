import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { EmptyState, ErrorNotice, Notice } from './Notice'

/** Status panels: Notice (neutral), EmptyState (nothing here yet — explains
 *  what to do next), ErrorNotice (load failure, humanised + Retry). All render
 *  the canonical card surface so they line up with real content. */
const meta = {
  title: 'UI/Notice',
  component: Notice,
} satisfies Meta<typeof Notice>

export default meta
type Story = StoryObj<typeof meta>
// For render-only stories showing EmptyState/ErrorNotice.
type Gallery = StoryObj

export const Default: Story = {
  args: { text: 'Select a case on the left to see its reports.' },
}

export const Empty: Gallery = {
  render: () => (
    <EmptyState
      icon="📁"
      title="No cases yet"
      hint="Open your first case to start tracking reports, tasks and evidence."
      action={{ label: 'New case', onClick: fn() }}
    />
  ),
}

export const EmptyWithoutAction: Gallery = {
  render: () => (
    <EmptyState
      title="No archived cases"
      hint="Closed cases appear here once command archives them."
    />
  ),
}

/** Raw PostgREST/Postgres error text is routed through humanizeError, so DB
 *  internals never reach the user — this one renders as a permission message. */
export const ErrorWithRetry: Gallery = {
  render: () => (
    <ErrorNotice
      message={'new row violates row-level security policy for table "cases"'}
      onRetry={fn()}
    />
  ),
}

export const ErrorPlain: Gallery = {
  render: () => <ErrorNotice message="Connection problem — check your network and retry." />,
}

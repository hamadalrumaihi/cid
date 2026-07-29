import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast, undoToast, useToastStore } from '@/lib/toast'
import { Button } from './Button'
import { Toaster } from './Toaster'

/** Toast stack — imperative `toast()` API backed by a zustand store, rendered
 *  bottom-right above the mobile bar. The preview decorator resets the store
 *  between stories, so leaked toasts never bleed across. */
const meta = {
  title: 'UI/Toaster',
  component: Toaster,
} satisfies Meta<typeof Toaster>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast('Case saved', 'success')}>Success</Button>
      <Button onClick={() => toast('Report pending sign-off', 'info')}>Info</Button>
      <Button onClick={() => toast('Legal hold expires in 24h', 'warn')}>Warn</Button>
      <Button onClick={() => toast('duplicate key value violates unique constraint', 'danger')}>
        Danger (humanized)
      </Button>
      <Button onClick={() => undoToast('Task deleted', () => toast('Task restored', 'success'))}>
        Undo toast
      </Button>
      <Toaster />
    </div>
  ),
}

/** All four types pinned open (seeded directly into the store with no TTL)
 *  so the stack can be inspected without racing the auto-dismiss. */
export const StaticStack: Story = {
  render: function StaticStackStory() {
    useEffect(() => {
      useToastStore.setState({
        toasts: [
          { id: 9001, message: 'Report pending sign-off', type: 'info' },
          { id: 9002, message: 'Case saved', type: 'success' },
          { id: 9003, message: 'Legal hold expires in 24h', type: 'warn' },
          { id: 9004, message: 'You don’t have permission to do that.', type: 'danger' },
          { id: 9005, message: 'Task deleted', type: 'warn', onUndo: () => {} },
        ],
      })
      return () => useToastStore.setState({ toasts: [] })
    }, [])
    return (
      <>
        <p className="text-sm text-slate-400">
          Five pinned toasts render bottom-right (info / success / warn /
          danger / undo).
        </p>
        <Toaster />
      </>
    )
  },
}

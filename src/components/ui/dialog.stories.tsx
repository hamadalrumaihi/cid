import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'
import { DialogHost, uiConfirm, uiPrompt } from './dialog'

/** Themed replacements for native confirm()/prompt(). Promise-based: callers
 *  await uiConfirm/uiPrompt while <DialogHost/> (mounted once in the app
 *  shell) renders the pending dialog at z-dialog — above any open modal. */
const meta = {
  title: 'UI/Dialog',
  component: DialogHost,
} satisfies Meta<typeof DialogHost>

export default meta
type Story = StoryObj<typeof meta>

function Result({ value }: { value: string | null }) {
  if (value === null) return null
  return (
    <p className="mt-4 text-sm text-slate-400">
      Last result: <span className="font-mono text-slate-200">{value}</span>
    </p>
  )
}

export const Confirm: Story = {
  render: function ConfirmStory() {
    const [result, setResult] = useState<string | null>(null)
    return (
      <div>
        <Button
          variant="danger"
          onAction={async () => {
            const ok = await uiConfirm('Delete this report? This cannot be undone.', {
              title: 'Delete report',
              confirmText: 'Delete',
            })
            setResult(String(ok))
          }}
        >
          Delete report…
        </Button>
        <Result value={result} />
        <DialogHost />
      </div>
    )
  },
}

/** danger:false renders the accent confirm button — for non-destructive
 *  confirmations (e.g. submitting for review). */
export const ConfirmNonDanger: Story = {
  render: function ConfirmNonDangerStory() {
    const [result, setResult] = useState<string | null>(null)
    return (
      <div>
        <Button
          variant="primary"
          onAction={async () => {
            const ok = await uiConfirm('Submit this case for command review?', {
              title: 'Submit for review',
              confirmText: 'Submit',
              cancelText: 'Not yet',
              danger: false,
            })
            setResult(String(ok))
          }}
        >
          Submit for review…
        </Button>
        <Result value={result} />
        <DialogHost />
      </div>
    )
  },
}

export const Prompt: Story = {
  render: function PromptStory() {
    const [result, setResult] = useState<string | null>(null)
    return (
      <div>
        <Button
          onAction={async () => {
            const name = await uiPrompt('Name the new evidence folder:', {
              title: 'New folder',
              placeholder: 'e.g. CCTV pulls',
              value: '',
            })
            setResult(name === null ? 'null (cancelled)' : JSON.stringify(name))
          }}
        >
          New folder…
        </Button>
        <Result value={result} />
        <DialogHost />
      </div>
    )
  },
}

/** Keyboard contract: focus starts on the confirm button (or the input for
 *  prompts), Tab is trapped inside the card, Enter on a focused Cancel
 *  cancels — it never confirms a destructive action. */
export const KeyboardFocus: Story = {
  render: function KeyboardFocusStory() {
    const [result, setResult] = useState<string | null>(null)
    return (
      <div>
        <p className="mb-3 max-w-md text-sm text-slate-400">
          Open the dialog, then try Tab / Shift+Tab (trapped), Enter on Cancel
          (cancels), and Escape (cancels).
        </p>
        <Button
          variant="danger"
          onAction={async () => {
            const ok = await uiConfirm('Remove this detective from the case?', {
              title: 'Remove assignment',
              confirmText: 'Remove',
            })
            setResult(String(ok))
          }}
        >
          Remove assignment…
        </Button>
        <Result value={result} />
        <DialogHost />
      </div>
    )
  },
}

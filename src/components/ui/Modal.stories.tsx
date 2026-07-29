import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'
import { Field, Input, Textarea } from './Field'
import { Modal, ModalHeader } from './Modal'
import { DialogHost } from './dialog'

/** Focus-trapped modal (centered card or right slide-over). Every close path
 *  — Esc, backdrop, the header × — routes through the same dirty guard.
 *  Stories are stateful wrappers: close the modal and a launcher button
 *  remains to reopen it. */
const meta = {
  title: 'UI/Modal',
  component: Modal,
  parameters: {
    // The modal portals to document.body and covers the canvas.
    layout: 'fullscreen',
  },
} satisfies Meta<typeof Modal>

export default meta
// Every story owns its open/close state, so all stories are render-only.
type Story = StoryObj

function Launcher({ label, children }: {
  label: string
  children: (open: boolean, close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="p-6">
      <Button variant="primary" onClick={() => setOpen(true)}>{label}</Button>
      {children(open, () => setOpen(false))}
    </div>
  )
}

export const Default: Story = {
  render: () => (
    <Launcher label="Open modal">
      {(open, close) => (
        <Modal open={open} onClose={close}>
          <div className="p-6">
            <ModalHeader title="Reassign case" onClose={close} />
            <p className="text-sm text-slate-300">
              The new lead detective inherits open tasks and sign-off duties.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={close}>Reassign</Button>
            </div>
          </div>
        </Modal>
      )}
    </Launcher>
  ),
}

export const Wide: Story = {
  render: () => (
    <Launcher label="Open wide modal">
      {(open, close) => (
        <Modal open={open} onClose={close} wide>
          <div className="p-6">
            <ModalHeader title="New case" onClose={close} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" required>
                {(id) => <Input id={id} placeholder="Case title" />}
              </Field>
              <Field label="Area">
                {(id) => <Input id={id} placeholder="e.g. Mirror Park" />}
              </Field>
              <Field label="Summary" className="sm:col-span-2">
                {(id) => <Textarea id={id} rows={4} placeholder="What happened?" />}
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={close}>Create case</Button>
            </div>
          </div>
        </Modal>
      )}
    </Launcher>
  ),
}

export const SlideOver: Story = {
  render: () => (
    <Launcher label="Open slide-over">
      {(open, close) => (
        <Modal open={open} onClose={close} slide>
          <div className="p-6">
            <ModalHeader title="Person profile" onClose={close} />
            <p className="text-sm text-slate-300">
              Right-anchored full-height panel — used for intel profiles so the
              underlying registry stays visible.
            </p>
          </div>
        </Modal>
      )}
    </Launcher>
  ),
}

/** Type into the field, then try Esc / backdrop / × — every close path runs
 *  the same unsaved-changes prompt (DialogHost mounted to render it). */
export const DirtyGuard: Story = {
  render: function DirtyGuardStory() {
    const [open, setOpen] = useState(true)
    const [note, setNote] = useState('')
    const close = () => { setOpen(false); setNote('') }
    return (
      <div className="p-6">
        <Button variant="primary" onClick={() => setOpen(true)}>Open guarded modal</Button>
        <Modal open={open} onClose={close} dirty={() => note.trim().length > 0}>
          <div className="p-6">
            <ModalHeader title="Add note" onClose={close} />
            <Field label="Note" hint="Typing makes the modal dirty — closing then asks first.">
              {(id) => (
                <Textarea id={id} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
              )}
            </Field>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={close}>Save note</Button>
            </div>
          </div>
        </Modal>
        <DialogHost />
      </div>
    )
  },
}

export const NonDismissible: Story = {
  render: () => (
    <Launcher label="Open non-dismissible modal">
      {(open, close) => (
        <Modal open={open} onClose={close} dismissible={false}>
          <div className="p-6">
            <ModalHeader title="Finalize report" onClose={close} />
            <p className="text-sm text-slate-300">
              Backdrop clicks are ignored (dismissible=false) — use the × or a
              button. Finalizing is deliberate, not a mis-click.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button variant="success" onClick={close}>Finalize</Button>
            </div>
          </div>
        </Modal>
      )}
    </Launcher>
  ),
}

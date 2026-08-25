import type { Meta, StoryObj } from '@storybook/react-vite'
import { Field, Input, Select, Textarea, fieldErrorId } from './Field'

/** Form primitives. <Field> generates the id and wires htmlFor, so every
 *  control is programmatically labelled — pass the render-prop id to the
 *  control. Input/Select/Textarea are thin styled elements. */
const meta = {
  title: 'UI/Field',
  component: Field,
} satisfies Meta<typeof Field>

export default meta
// Field's `children` is a render prop, so every story is render-only.
type Story = StoryObj

export const TextInput: Story = {
  render: () => (
    <Field label="Case title" className="max-w-sm">
      {(id) => <Input id={id} placeholder="e.g. Vespucci Fencing Ring" />}
    </Field>
  ),
}

export const Required: Story = {
  render: () => (
    <Field label="Case number" required className="max-w-sm">
      {(id) => <Input id={id} placeholder="CID-26-0000" />}
    </Field>
  ),
}

export const WithHint: Story = {
  render: () => (
    <Field
      label="Follow-up date"
      hint="Leave empty for no scheduled follow-up."
      className="max-w-sm"
    >
      {(id) => <Input id={id} type="date" />}
    </Field>
  ),
}

export const SelectField: Story = {
  render: () => (
    <Field label="Priority" className="max-w-sm">
      {(id) => (
        <Select id={id} defaultValue="medium">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </Select>
      )}
    </Field>
  ),
}

export const TextareaField: Story = {
  render: () => (
    <Field label="Summary" className="max-w-md">
      {(id) => <Textarea id={id} rows={4} placeholder="What happened?" />}
    </Field>
  ),
}

/** Validation error: Field renders the rose line (id = fieldErrorId(id));
 *  the caller passes `invalid` + aria-describedby to the control via the
 *  render prop — Field cannot reach the child itself. */
export const WithError: Story = {
  render: () => (
    <Field label="Case number" required error="A case number is required." className="max-w-sm">
      {(id) => (
        <Input
          id={id}
          invalid
          aria-describedby={fieldErrorId(id)}
          placeholder="CID-26-0000"
        />
      )}
    </Field>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Field label="Case number" hint="Assigned automatically on creation." className="max-w-sm">
      {(id) => <Input id={id} value="CID-26-0140" disabled readOnly />}
    </Field>
  ),
}

/** Tab through the form: focus ring is the global focus-visible outline, and
 *  the focused control's border switches to the accent (focus:border-badge-500). */
export const FormLayout: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <Field label="Title" required>
        {(id) => <Input id={id} placeholder="Case title" />}
      </Field>
      <Field label="Area">
        {(id) => <Input id={id} placeholder="e.g. Mirror Park" />}
      </Field>
      <Field label="Priority">
        {(id) => (
          <Select id={id} defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        )}
      </Field>
      <Field label="Follow-up" hint="Optional.">
        {(id) => <Input id={id} type="date" />}
      </Field>
      <Field label="Summary" className="sm:col-span-2">
        {(id) => <Textarea id={id} rows={4} placeholder="What happened?" />}
      </Field>
    </div>
  ),
}

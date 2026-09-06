import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import type { EntityHit } from '@/lib/entitySearch'
import type { SuggestKind, SuggestRow } from '@/lib/entity'
import { EntityPicker } from './EntityPicker'

/** The one registry picker: RecordSearchPicker driven by `entity_suggest`.
 *  Stories inject a mock loader through the `suggest` seam — nothing here
 *  talks to Supabase. Exact hits come first and carry the "exact" pill; the
 *  'phone' kind tags each hit with the table it lives in. */
const meta = {
  title: 'Entity/EntityPicker',
  component: EntityPicker,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof EntityPicker>

export default meta
type Story = StoryObj

const PEOPLE: SuggestRow[] = [
  { id: 'p1', kind: 'person', label: 'Marcus Reyes', sublabel: '“Rey” · 555-0142', score: 1, exact: true },
  { id: 'p2', kind: 'person', label: 'Marco Reyes-Ortiz', sublabel: 'DOB 1991-03-02', score: 0.7, exact: false },
  { id: 'p3', kind: 'person', label: 'M. Reyes', sublabel: null, score: 0.5, exact: false },
]
const PHONES: SuggestRow[] = [
  { id: 'p1', kind: 'person', label: '555-0142', sublabel: 'Marcus Reyes', score: 1, exact: true },
  { id: 'i9', kind: 'indicator', label: '555-0142', sublabel: 'Burner — CID-26-0140', score: 1, exact: true },
]

const mockSuggest = (rows: SuggestRow[]) => async (_kind: SuggestKind, q: string): Promise<SuggestRow[]> => {
  const t = q.trim().toLowerCase()
  await new Promise((r) => setTimeout(r, 200))
  return rows.filter((r) => r.label.toLowerCase().includes(t) || (r.sublabel ?? '').toLowerCase().includes(t))
}

export const Person: Story = {
  render: function PersonStory() {
    const [value, setValue] = useState<EntityHit | null>(null)
    return (
      <div className="max-w-md">
        <EntityPicker kind="person" label="Subject" value={value} onChange={setValue} suggest={mockSuggest(PEOPLE)}
          onCreateNew={fn()} hint="Type “reyes” — the exact match is pinned first." />
      </div>
    )
  },
}

export const PhoneAcrossTables: Story = {
  render: function PhoneStory() {
    const [value, setValue] = useState<EntityHit | null>(null)
    return (
      <div className="max-w-md">
        <EntityPicker kind="phone" label="Phone number" value={value} onChange={setValue} suggest={mockSuggest(PHONES)}
          hint="Type “555” — hits are tagged person or indicator; there is no phone entity." />
      </div>
    )
  },
}

export const MultiSelect: Story = {
  render: function MultiStory() {
    const [values, setValues] = useState<EntityHit[]>([])
    return (
      <div className="max-w-md">
        <EntityPicker kind="person" label="Persons involved" multiple values={values} onChangeMany={setValues} suggest={mockSuggest(PEOPLE)} />
      </div>
    )
  },
}

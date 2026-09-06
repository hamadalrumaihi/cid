import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import type { MergeManifest } from '@/lib/entity'
import { Button } from '@/components/ui/Button'
import { Toaster } from '@/components/ui/Toaster'
import { MergeDialogPanel, type MergeApi } from './MergeDialog'

/** Preview-then-merge over the generic entity ledger. Stories drive the
 *  panel through the `api` seam with a canned manifest / refusal — no
 *  network. `canMerge` is the cosmetic gate the real dialog derives from
 *  usePermissions. */
const meta = {
  title: 'Entity/MergeDialog',
  component: MergeDialogPanel,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MergeDialogPanel>

export default meta
type Story = StoryObj

const MANIFEST: MergeManifest = {
  survivor: { id: 's', label: 'Marcus Reyes' },
  victims: [{
    id: 'v1', label: 'Marcus Reyes (MDT import)',
    repointed: { 'case_intel_links.ref_id': 4, 'person_vehicles.person_id': 1, 'media.person_id': 2, 'watchlist.target_id': 0 },
    repointed_ids: {},
    dropped: [{ table: 'person_vehicles', why: 'duplicate_link', row: {} }],
    scalar_fill: { dob: { from: null, to: '1990-07-14' }, phone: { from: null, to: '555-0142' } },
    notes_from: 'Seen at the Vespucci lot 3×.',
    tombstone: 'lifecycle',
  }],
  added_aliases: ['Rey'],
}

const SURVIVOR = { id: 's', label: 'Marcus Reyes' }
const VICTIMS = [{ id: 'v1', label: 'Marcus Reyes (MDT import)' }]

const okApi: MergeApi = {
  preview: async () => ({ data: { ok: true, kind: 'person', manifest: MANIFEST }, error: null }),
  merge: async (kind, survivor_id, victim_ids) => ({
    data: { ok: true, merge_id: 'm1', kind, survivor_id, victim_ids, manifest: MANIFEST }, error: null,
  }),
}
const heldApi: MergeApi = {
  ...okApi,
  merge: async () => ({ data: { ok: false, code: 'held', hold_cases: ['CID-26-0140'] }, error: null }),
}
const refusedPreviewApi: MergeApi = {
  ...okApi,
  preview: async () => ({ data: { ok: false, code: 'already_merged' }, error: null }),
}

function Launcher({ api, canMerge }: { api: MergeApi; canMerge: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="p-6">
      <Button variant="primary" onClick={() => setOpen(true)}>Open merge dialog</Button>
      <MergeDialogPanel kind="person" survivor={SURVIVOR} victims={VICTIMS} open={open} canMerge={canMerge}
        api={api} onClose={() => setOpen(false)} onMerged={fn()} />
      <Toaster />
    </div>
  )
}

export const Preview: Story = { render: () => <Launcher api={okApi} canMerge /> }

/** Merge is refused by a legal hold — the server's words, inline and toasted. */
export const HeldOnMerge: Story = { render: () => <Launcher api={heldApi} canMerge /> }

export const PreviewRefused: Story = { render: () => <Launcher api={refusedPreviewApi} canMerge /> }

/** A detective sees the manifest but no Merge button (cosmetic gate). */
export const ReadOnly: Story = { render: () => <Launcher api={okApi} canMerge={false} /> }

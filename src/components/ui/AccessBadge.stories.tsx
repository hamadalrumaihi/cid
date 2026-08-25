import type { Meta, StoryObj } from '@storybook/react-vite'
import { AccessBadge } from './AccessBadge'

/** One chip for the three access/classification vocabularies — SIB
 *  compartmentation (violet family), legal classification (bordered,
 *  🔒 sealed), and SOP/library classification. Hover a chip: the title
 *  explains who can access. */
const meta = {
  title: 'UI/AccessBadge',
  component: AccessBadge,
  args: { kind: 'sib', value: 'siu_only' },
} satisfies Meta<typeof AccessBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = {}

export const SibVisibility: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {['siu_only', 'partial', 'revealed', 'unclassified', 'cid'].map((v) => (
        <AccessBadge key={v} kind="sib" value={v} />
      ))}
      <AccessBadge
        kind="sib"
        row={{ state: 'siu_only', revealed_to_case_id: null, revealed_to_user_id: null, scope: 'sections', hidden_sections: ['relationships', 'media'] }}
      />
    </div>
  ),
}

export const LegalClassification: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {['standard', 'restricted', 'classified', 'sealed'].map((v) => (
        <AccessBadge key={v} kind="legal" value={v} />
      ))}
    </div>
  ),
}

export const SopClassification: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {['internal', 'restricted', 'command', 'justice', 'owner'].map((v) => (
        <AccessBadge key={v} kind="sop" value={v} />
      ))}
    </div>
  ),
}

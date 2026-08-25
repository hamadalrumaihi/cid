import type { Meta, StoryObj } from '@storybook/react-vite'
import { StatusBadge } from './StatusBadge'

/** Status chips driven by the central registry (src/lib/status.ts). Every
 *  domain keeps its own canonical value set; the registry only normalizes
 *  presentation (label casing, chip temperature, tooltip copy). Hover a chip
 *  to see the "what this means / who acts next" tooltip. */
const meta = {
  title: 'UI/StatusBadge',
  component: StatusBadge,
  args: { domain: 'case', value: 'active' },
} satisfies Meta<typeof StatusBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = {}

const Row = ({ domain, values }: { domain: Parameters<typeof StatusBadge>[0]['domain']; values: string[] }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="w-36 text-xs text-slate-400">{domain}</span>
    {values.map((v) => <StatusBadge key={v} domain={domain} value={v} />)}
  </div>
)

export const AllDomains: Story = {
  render: () => (
    <div className="space-y-3">
      <Row domain="case" values={['open', 'active', 'cold', 'closed', 'archived']} />
      <Row domain="caseStage" values={['intake', 'active_investigation', 'legal_process', 'enforcement_ready', 'pending_closure', 'closed']} />
      <Row domain="signoff" values={['none', 'awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director', 'approved_deputy', 'approved_complete', 'ready_doj', 'changes_requested', 'denied']} />
      <Row domain="legalReview" values={['not_submitted', 'cid_supervisor_review', 'submitted_to_doj', 'returned_by_ada', 'approved', 'denied', 'withdrawn']} />
      <Row domain="warrant" values={['draft', 'signed', 'executed', 'returned']} />
      <Row domain="fieldSubmission" values={['draft', 'new', 'reviewing', 'needs_info', 'reviewed', 'actionable', 'archived']} />
      <Row domain="priority" values={['low', 'medium', 'high', 'critical']} />
      <Row domain="threat" values={['low', 'medium', 'high']} />
      <Row domain="confidence" values={['unverified', 'possible', 'probable', 'confirmed', 'disproven']} />
      <Row domain="boloRisk" values={['low', 'medium', 'high', 'critical']} />
      <Row domain="seizedItem" values={['held', 'returned', 'destroyed', 'forfeited']} />
      <Row domain="personReview" values={['fresh', 'due', 'stale', 'unreviewed']} />
      <Row domain="accountOwnership" values={['suspected', 'probable', 'confirmed']} />
      <Row domain="caseCharge" values={['approved', 'filed', 'convicted', 'dismissed', 'withdrawn']} />
    </div>
  ),
}

/** 'returned' means different things in different domains — the registry
 *  disambiguates by LABEL: a warrant return is "Return filed" (complete,
 *  emerald), a legal return is "Returned by …" (sent back, rose), a seized
 *  item is "Returned to owner" (accent). */
export const ReturnedDisambiguation: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge domain="warrant" value="returned" />
      <StatusBadge domain="legalReview" value="returned_by_judge" />
      <StatusBadge domain="seizedItem" value="returned" />
    </div>
  ),
}

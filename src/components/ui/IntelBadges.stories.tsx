import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConfidenceBadge, ProvenanceBadge, StaleIntelBadge } from './IntelBadges'

/** Intel-provenance chips: claim confidence, association provenance, and
 *  review staleness. Colour is never the only signal — every chip carries
 *  text and a title. `now` is injected for deterministic staleness. */
const NOW = Date.parse('2026-07-29T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

const meta = {
  title: 'UI/IntelBadges',
  component: ConfidenceBadge,
} satisfies Meta<typeof ConfidenceBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Confidence: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {['confirmed', 'probable', 'possible', 'unverified', 'disproven'].map((c) => (
        <ConfidenceBadge key={c} confidence={c} />
      ))}
      <ConfidenceBadge confidence={null} />
    </div>
  ),
}

export const Provenance: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {['imported', 'reported', 'manually_confirmed', 'inferred', 'historical', 'disputed'].map((p) => (
        <ProvenanceBadge key={p} provenance={p} />
      ))}
    </div>
  ),
}

/** Fresh intel (< 90 days) renders nothing; stale intel gets the N D STALE
 *  readout; never-reviewed gets UNREVIEWED. */
export const Staleness: Story = {
  render: () => (
    <div className="space-y-2 text-sm text-slate-400">
      <p>
        Reviewed 10 days ago (fresh — renders nothing):{' '}
        <StaleIntelBadge reviewedAt={daysAgo(10)} now={NOW} />
        <span className="text-slate-200">← (empty)</span>
      </p>
      <p>
        Reviewed 120 days ago: <StaleIntelBadge reviewedAt={daysAgo(120)} now={NOW} />
      </p>
      <p>
        Custom 30-day threshold, reviewed 45 days ago:{' '}
        <StaleIntelBadge reviewedAt={daysAgo(45)} thresholdDays={30} now={NOW} />
      </p>
      <p>
        Never reviewed: <StaleIntelBadge reviewedAt={null} now={NOW} />
      </p>
    </div>
  ),
}

/** Composed the way dossier rows use them: confidence + provenance + stale. */
export const ComposedRow: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-slate-200">Vercelli ↔ Vagos courier</span>
      <ConfidenceBadge confidence="probable" />
      <ProvenanceBadge provenance="inferred" />
      <StaleIntelBadge reviewedAt={daysAgo(140)} now={NOW} />
    </div>
  ),
}

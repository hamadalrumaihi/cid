/** The dossier origin line, rendered.
 *
 *  The model is unit-tested (src/lib/recordProvenance.test.ts). What this adds
 *  is the part the model cannot see: the line resolves the author against the
 *  LIVE roster, so a dossier opened before the roster finished loading must
 *  fill the name in rather than keeping the anonymous wording until the reader
 *  navigates away. That was the reason the shared component subscribes to the
 *  store instead of calling `officerName` once during render. */
import { beforeEach, describe, expect, it } from 'vitest'
import { useProfilesStore, type RosterProfile } from '@/lib/profiles'
import { RecordProvenance } from '@/components/shared/RecordProvenance'
import { render } from './render'

const HOUR = 3600_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

const roster = (rows: Partial<RosterProfile>[]) =>
  useProfilesStore.setState({ profiles: rows as RosterProfile[], loaded: true, loading: false, error: null })

beforeEach(() => roster([]))

describe('RecordProvenance', () => {
  it('names the author once the roster arrives', async () => {
    const record = { created_at: iso(72 * HOUR), created_by: 'u-1', updated_at: iso(2 * HOUR) }
    const r = await render(<RecordProvenance record={record} />)

    // Roster not loaded yet: the date stands alone, and the line admits it.
    expect(r.container.textContent).not.toContain('Det. Rowe')
    expect(r.container.querySelector('[title]')?.getAttribute('title')).toMatch(/cannot name/i)

    roster([{ id: 'u-1', display_name: 'Det. Rowe' }])
    await r.rerender(<RecordProvenance record={record} />)
    expect(r.container.textContent).toContain('Added by Det. Rowe')
    expect(r.container.textContent).toContain('Updated 2h ago')
    await r.unmount()
  })

  it('renders nothing at all for a record with no provenance', async () => {
    const r = await render(<RecordProvenance record={{}} />)
    expect(r.container.textContent).toBe('')
    await r.unmount()
  })

  it('keeps an extra fact beside the origin, not blended into it', async () => {
    // A lead detective is an assignment; authorship is a fact about the row.
    roster([{ id: 'u-1', display_name: 'Det. Rowe' }])
    const r = await render(
      <RecordProvenance record={{ created_at: iso(48 * HOUR), created_by: 'u-1' }}>Lead Det. Vega</RecordProvenance>,
    )
    const text = r.container.textContent ?? ''
    expect(text).toContain('Added by Det. Rowe')
    expect(text).toContain('Lead Det. Vega')
    expect(text.indexOf('Added by')).toBeLessThan(text.indexOf('Lead'))
    await r.unmount()
  })

  it('does not call an untouched record updated', async () => {
    const at = iso(48 * HOUR)
    const r = await render(<RecordProvenance record={{ created_at: at, updated_at: at }} />)
    expect(r.container.textContent).not.toContain('Updated')
    await r.unmount()
  })
})

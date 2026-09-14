/** The dossier origin line.
 *
 *  Two things are pinned because they are the two ways this line lies:
 *  a record whose author cannot be named must not read as a record with no
 *  author, and a record that has never been edited must not read as one that
 *  was recently maintained. */
import { describe, expect, it } from 'vitest'
import { provenanceText, recordProvenance } from './recordProvenance'

const ROSTER: Record<string, string> = { 'u-1': 'Det. Rowe' }
const resolve = (id: string | null | undefined) => (id ? ROSTER[id] ?? null : null)

const HOUR = 3600_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

describe('recordProvenance', () => {
  it('names the member who recorded the row, and dates it', () => {
    const p = recordProvenance({ created_at: iso(48 * HOUR), created_by: 'u-1' }, resolve)
    expect(p.added).toMatch(/^Added by Det\. Rowe · /)
    expect(p.authorUnknown).toBe(false)
  })

  it('admits it cannot name an author rather than reading as "nobody"', () => {
    // The id is there — a member who left, or one RLS will not show. The
    // record HAS an author; the roster just cannot say who.
    const p = recordProvenance({ created_at: iso(48 * HOUR), created_by: 'gone' }, resolve)
    expect(p.added).toMatch(/^Added /)
    expect(p.added).not.toMatch(/by/)
    expect(p.authorUnknown, 'the caller explains the gap; the line never guesses').toBe(true)
  })

  it('says nothing at all when the record records neither fact', () => {
    const p = recordProvenance({}, resolve)
    expect(p.added).toBeNull()
    expect(p.updated).toBeNull()
    expect(provenanceText(p)).toBe('')
  })

  it('does not call an untouched record updated', () => {
    // Several registry tables stamp updated_at on insert. Reporting that as
    // an edit makes every new record look maintained.
    const at = iso(48 * HOUR)
    expect(recordProvenance({ created_at: at, updated_at: at }, resolve).updated).toBeNull()
    expect(recordProvenance({ created_at: iso(24 * HOUR), updated_at: iso(48 * HOUR) }, resolve).updated).toBeNull()
  })

  it('reports a real edit, relative to now', () => {
    const p = recordProvenance({ created_at: iso(72 * HOUR), updated_at: iso(2 * HOUR) }, resolve)
    expect(p.updated).toBe('Updated 2h ago')
  })

  it('survives a record with no creation date but a known author', () => {
    const p = recordProvenance({ created_by: 'u-1' }, resolve)
    expect(p.added).toBe('Added by Det. Rowe')
  })

  it('ignores an unparseable update stamp instead of rendering NaN', () => {
    expect(recordProvenance({ created_at: iso(HOUR), updated_at: 'not a date' }, resolve).updated).toBeNull()
  })

  it('joins the two halves for the single-string callers', () => {
    const p = recordProvenance({ created_at: iso(72 * HOUR), created_by: 'u-1', updated_at: iso(HOUR) }, resolve)
    expect(provenanceText(p)).toMatch(/^Added by Det\. Rowe · .+ · Updated 1h ago$/)
  })
})

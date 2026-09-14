/** The shared roster cache — the one source of truth for who is in the
 *  division. Every personnel surface reads it (the Division Directory, the
 *  Command Center's availability board, Personnel Management, the Overview
 *  counts), so its failure modes are theirs.
 *
 *  Three of those failure modes were real and are pinned here:
 *
 *   · A load that has not landed yet, and a load that FAILED, were both
 *     indistinguishable from "the division has no members" — the cache held
 *     an empty array and said nothing about why. A roster that shows "no
 *     officers" because the network dropped is worse than one that shows an
 *     error: it is wrong, and it looks authoritative.
 *   · A failed refresh silently kept the previous rows with no way for a
 *     screen to say so or offer a retry.
 *   · Two refreshes racing (a burst of realtime bumps, or a manual refresh on
 *     top of one) could land out of order, so an OLDER answer overwrote a
 *     newer one — a member who had just transferred reappeared in the bureau
 *     they left.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
vi.mock('./db', () => ({ list: (...a: unknown[]) => list(...a) }))

const { useProfilesStore, ROSTER_COLS } = await import('./profiles')

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1', display_name: 'A. Vance', avatar_url: null, badge_number: 'C-01',
  division: 'major_crimes', role: 'detective', active: true, created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', loa: false, loa_since: null, discord_id: null,
  removed_at: null, is_owner: false, login_denied: false, is_system: false, ...over,
})

/** A promise the test resolves by hand — for the ordering cases. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const state = () => useProfilesStore.getState()

beforeEach(() => {
  list.mockReset()
  useProfilesStore.setState({ profiles: [], loaded: false, loading: false, error: null })
})

describe('the roster cache', () => {
  it('reads the non-email projection — email is column-granted to command', async () => {
    list.mockResolvedValue([row()])
    await state().fetch()
    expect(list).toHaveBeenCalledWith('profiles', { select: ROSTER_COLS })
    expect(ROSTER_COLS).not.toContain('email')
  })

  it('says it is LOADING while the first read is in flight — not "no members"', async () => {
    const d = deferred<unknown[]>()
    list.mockReturnValue(d.promise)
    const inFlight = state().fetch()

    expect(state().loading, 'a screen must be able to tell load from empty').toBe(true)
    expect(state().loaded).toBe(false)
    expect(state().profiles).toEqual([])

    d.resolve([row()])
    await inFlight
    expect(state().loading).toBe(false)
    expect(state().loaded).toBe(true)
    expect(state().profiles).toHaveLength(1)
  })

  it('records a FAILED load instead of presenting an empty division', async () => {
    list.mockRejectedValue(new Error('network unreachable'))
    await state().fetch()

    expect(state().error).toMatch(/network unreachable/)
    expect(state().loading).toBe(false)
    // `loaded` stays false: nothing was ever successfully read, so no screen
    // may claim the roster is empty.
    expect(state().loaded).toBe(false)
  })

  it('keeps the rows it already had when a REFRESH fails, and says so', async () => {
    list.mockResolvedValueOnce([row(), row({ id: 'p2', display_name: 'B. Cruz' })])
    await state().fetch()
    list.mockRejectedValueOnce(new Error('connection reset'))
    await state().fetch()

    expect(state().profiles, 'stale rows beat a blank screen').toHaveLength(2)
    expect(state().loaded).toBe(true)
    expect(state().error).toMatch(/connection reset/)
  })

  it('clears the error once a later read succeeds', async () => {
    list.mockRejectedValueOnce(new Error('offline'))
    await state().fetch()
    expect(state().error).toBeTruthy()
    list.mockResolvedValueOnce([row()])
    await state().fetch()
    expect(state().error).toBeNull()
  })

  it('ignores a stale answer that lands after a newer one', async () => {
    // Two refreshes race — a realtime bump on top of a manual refresh. The
    // FIRST resolves last, carrying the member in the bureau they just left.
    const first = deferred<unknown[]>()
    const second = deferred<unknown[]>()
    list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const a = state().fetch()
    const b = state().fetch()

    second.resolve([row({ division: 'street_crimes' })])
    await b
    expect(state().profiles[0].division).toBe('street_crimes')

    first.resolve([row({ division: 'major_crimes' })])
    await a
    expect(state().profiles[0].division, 'the older answer must not win').toBe('street_crimes')
  })

  it('does not let a stale FAILURE overwrite a newer success', async () => {
    const first = deferred<unknown[]>()
    const second = deferred<unknown[]>()
    list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const a = state().fetch()
    const b = state().fetch()
    second.resolve([row()])
    await b
    first.reject(new Error('timed out'))
    await a

    expect(state().error).toBeNull()
    expect(state().profiles).toHaveLength(1)
  })
})

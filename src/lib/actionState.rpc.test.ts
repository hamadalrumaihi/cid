/** `setActionState` dispatch: one key → `action_item_set_state`, many →
 *  `action_item_set_state_many` (chunked at the server's 100-key cap), the
 *  aggregate `{applied, skipped}` and the first DbError passed through. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rpc } from './db'
import { isDbError, setActionState } from './actionState'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return { ...actual, rpc: vi.fn() }
})

const rpcMock = vi.mocked(rpc)

beforeEach(() => { rpcMock.mockReset() })

describe('setActionState', () => {
  it('no keys → nothing is called', async () => {
    expect(await setActionState([], 'seen')).toEqual({ applied: 0, skipped: [] })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('one key → action_item_set_state with p_until', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null } as never)
    const res = await setActionState(['notif:1'], 'snooze', '2026-09-10T09:00:00.000Z')
    expect(res).toEqual({ applied: 1, skipped: [] })
    expect(rpcMock).toHaveBeenCalledWith('action_item_set_state', { p_key: 'notif:1', p_op: 'snooze', p_until: '2026-09-10T09:00:00.000Z' })
  })

  it('duplicates collapse to one key (single path)', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null } as never)
    await setActionState(['task:1', 'task:1'], 'seen')
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock.mock.calls[0][0]).toBe('action_item_set_state')
  })

  it('many keys → _many, reporting applied + skipped', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, applied: 2, skipped: ['task:1'] }, error: null } as never)
    const res = await setActionState(['notif:1', 'notif:2', 'task:1'], 'dismiss')
    expect(res).toEqual({ applied: 2, skipped: ['task:1'] })
    expect(rpcMock).toHaveBeenCalledWith('action_item_set_state_many', { p_keys: ['notif:1', 'notif:2', 'task:1'], p_op: 'dismiss', p_until: null })
  })

  it('chunks above the 100-key cap and sums the answers', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, applied: 100, skipped: [] }, error: null } as never)
    const keys = Array.from({ length: 150 }, (_, i) => `notif:${i}`)
    const res = await setActionState(keys, 'snooze', '2026-09-10T09:00:00.000Z')
    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect((rpcMock.mock.calls[0][1] as { p_keys: string[] }).p_keys).toHaveLength(100)
    expect((rpcMock.mock.calls[1][1] as { p_keys: string[] }).p_keys).toHaveLength(50)
    expect(res).toEqual({ applied: 200, skipped: [] })
  })

  it('passes the DbError through (single and many)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'snooze for up to 48 hours', code: 'P0001' } } as never)
    const one = await setActionState(['notif:1'], 'snooze', 'x')
    expect(isDbError(one)).toBe(true)
    if (isDbError(one)) expect(one.message).toBe('snooze for up to 48 hours')
    const many = await setActionState(['notif:1', 'notif:2'], 'snooze', 'x')
    expect(isDbError(many)).toBe(true)
  })
})

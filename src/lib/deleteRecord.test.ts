/** `deleteRecord` — the one soft-delete helper (P8-02): confirm → reason
 *  (only for REASON_REQUIRED kinds) → soft_delete per row → one undo toast
 *  linking the Trash, whose Undo restores every deleted id. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreRecord, softDeleteRecord } from './db'
import { toast, undoToast } from './toast'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { bumpTrash } from './trash'
import { TRASH_LINK, deleteRecord } from './deleteRecord'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return { ...actual, softDeleteRecord: vi.fn(), restoreRecord: vi.fn() }
})
vi.mock('./toast', () => ({ toast: vi.fn(), undoToast: vi.fn() }))
vi.mock('./trash', () => ({ bumpTrash: vi.fn() }))
vi.mock('@/components/ui/dialog', () => ({ uiConfirm: vi.fn(), uiPrompt: vi.fn() }))

const softMock = vi.mocked(softDeleteRecord)
const restoreMock = vi.mocked(restoreRecord)
const confirmMock = vi.mocked(uiConfirm)
const promptMock = vi.mocked(uiPrompt)
const toastMock = vi.mocked(toast)
const undoMock = vi.mocked(undoToast)
const bumpMock = vi.mocked(bumpTrash)

const ok = { data: { ok: true }, error: null } as never
const refused = (code: string, message: string) => ({ data: { ok: false, code, message }, error: { code, message } }) as never

beforeEach(() => {
  softMock.mockReset(); restoreMock.mockReset(); confirmMock.mockReset(); promptMock.mockReset()
  toastMock.mockReset(); undoMock.mockReset(); bumpMock.mockReset()
  confirmMock.mockResolvedValue(true)
  softMock.mockResolvedValue(ok)
  restoreMock.mockResolvedValue(ok)
})

describe('deleteRecord — confirm and reason', () => {
  it('cancelling the confirm deletes nothing', async () => {
    confirmMock.mockResolvedValue(false)
    expect(await deleteRecord('case_tasks', { id: 't1' }, { label: 'task' })).toBe(false)
    expect(softMock).not.toHaveBeenCalled()
  })
  it('noConfirm skips the dialog (the caller already asked)', async () => {
    await deleteRecord('case_tasks', { id: 't1' }, { noConfirm: true })
    expect(confirmMock).not.toHaveBeenCalled()
    expect(softMock).toHaveBeenCalledWith('case_tasks', 't1', null)
  })
  it('a task needs no reason; a person does — and the prompt value is passed through', async () => {
    await deleteRecord('case_tasks', { id: 't1' })
    expect(promptMock).not.toHaveBeenCalled()
    promptMock.mockResolvedValue('duplicate record')
    await deleteRecord('persons', { id: 'p1' }, { label: 'Person "Ana"' })
    expect(promptMock).toHaveBeenCalledTimes(1)
    expect(softMock).toHaveBeenLastCalledWith('persons', 'p1', 'duplicate record')
  })
  it('a blank or cancelled reason aborts a reason-required delete', async () => {
    promptMock.mockResolvedValue(null)
    expect(await deleteRecord('persons', { id: 'p1' })).toBe(false)
    promptMock.mockResolvedValue('   ')
    expect(await deleteRecord('persons', { id: 'p1' })).toBe(false)
    expect(softMock).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith('A reason is required to delete this record.', 'warn')
  })
  it('an empty row list is a no-op', async () => {
    expect(await deleteRecord('case_tasks', [])).toBe(false)
    expect(confirmMock).not.toHaveBeenCalled()
  })
})

describe('deleteRecord — the delete, the toast and Undo', () => {
  it('soft-deletes every row, runs after(), bumps the Trash badge and shows one undo toast linking /trash', async () => {
    const after = vi.fn()
    expect(await deleteRecord('case_tasks', [{ id: 'a' }, { id: 'b' }], { after })).toBe(true)
    expect(softMock.mock.calls.map((c) => c[1])).toEqual(['a', 'b'])
    expect(after).toHaveBeenCalledTimes(1)
    expect(bumpMock).toHaveBeenCalledTimes(1)
    expect(undoMock).toHaveBeenCalledTimes(1)
    const [message, , , opts] = undoMock.mock.calls[0]
    expect(message).toBe('2 deleted · In Trash')
    expect(opts).toEqual({ link: TRASH_LINK })
    expect(TRASH_LINK.href).toBe('/trash')
  })
  it('Undo restores exactly the ids that were deleted, then runs after() again', async () => {
    const after = vi.fn()
    softMock.mockResolvedValueOnce(ok).mockResolvedValueOnce(refused('denied', 'not permitted'))
    await deleteRecord('case_tasks', [{ id: 'a' }, { id: 'b' }], { after })
    expect(undoMock.mock.calls[0][0]).toBe('1 deleted · 1 failed · In Trash')
    const undo = undoMock.mock.calls[0][1]
    undo()
    await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(2))
    expect(restoreMock).toHaveBeenCalledTimes(1)
    expect(restoreMock).toHaveBeenCalledWith('case_tasks', 'a', 'undo')
    expect(toastMock).toHaveBeenLastCalledWith('1 restored', 'success')
    expect(bumpMock).toHaveBeenCalledTimes(2)
  })
  it('a refusal other than denied is shown as the server phrased it; nothing deleted → danger toast, no undo', async () => {
    promptMock.mockResolvedValue('filed in error')
    softMock.mockResolvedValue(refused('held', 'a legal hold preserves this record'))
    expect(await deleteRecord('reports', { id: 'r1' }, { label: 'report', noConfirm: true })).toBe(false)
    expect(softMock).toHaveBeenCalledWith('reports', 'r1', 'filed in error')
    expect(toastMock).toHaveBeenCalledWith('a legal hold preserves this record', 'danger')
    expect(toastMock).toHaveBeenLastCalledWith('Report could not be deleted.', 'danger')
    expect(undoMock).not.toHaveBeenCalled()
    expect(bumpMock).not.toHaveBeenCalled()
  })
  it('a single labelled row reads "<Label> deleted · In Trash"', async () => {
    await deleteRecord('case_notes', { id: 'n1' }, { label: 'note' })
    expect(undoMock.mock.calls[0][0]).toBe('Note deleted · In Trash')
  })
})

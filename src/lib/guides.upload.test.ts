/** Guide image upload — the reservation and the bytes are ONE operation.
 *
 *  `addGuideImage` reserves a `guide_media` row first and uploads to the path
 *  that row returns. The order is deliberate: the storage policy admits an
 *  object only when a row already names that exact path. The cost is a window
 *  where the row exists and the object does not, and a failed upload leaves
 *  metadata promising an image that was never stored — it shows in the guide's
 *  media manager as a real attachment.
 *
 *  These tests pin the compensating cleanup: a failed upload takes the
 *  reservation with it, the caller still gets the ORIGINAL upload error, and a
 *  cleanup that itself fails never replaces that error or throws.
 *
 *  The two seams are mocked rather than driven through MSW because what is
 *  under test is the orchestration — which call happens after which failure —
 *  not the wire format of either call. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const upload = vi.fn()
const removeObject = vi.fn()
const reportToSentry = vi.fn()

vi.mock('./db', () => ({ rpc: (...a: unknown[]) => rpc(...a), list: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: () => ({ storage: { from: () => ({ upload, remove: removeObject }) } }),
  isConfigured: true,
}))
vi.mock('./services/telemetry/sentry', () => ({
  reportToSentry: (...a: unknown[]) => reportToSentry(...a),
  sentryConfigured: () => false,
}))

const { addGuideImage } = await import('./guides')

const MEDIA_ID = 'media-1'
const PATH = 'guide-1/media-1/photo.png'

/** A reservation that succeeded. */
const reserved = {
  data: { ok: true, media_id: MEDIA_ID, storage_path: PATH, bucket: 'guides', sort_order: 0 },
  error: null,
}

const file = (): File =>
  new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })

const upload_ = () => ({
  guideId: 'guide-1', section: 'overview', alt: 'A screenshot', file: file(),
})

/** Every `guide_media_remove` the code under test made. */
const cleanupCalls = () =>
  rpc.mock.calls.filter(([fn]) => fn === 'guide_media_remove')

beforeEach(() => {
  rpc.mockReset()
  upload.mockReset()
  removeObject.mockReset()
  reportToSentry.mockReset()
})

describe('a successful upload', () => {
  it('reserves, uploads, and cleans up nothing', async () => {
    rpc.mockResolvedValueOnce(reserved)
    upload.mockResolvedValueOnce({ data: { path: PATH }, error: null })

    expect(await addGuideImage(upload_())).toBeNull()

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('guide_media_attach')
    expect(upload).toHaveBeenCalledWith(PATH, expect.anything(), expect.objectContaining({ upsert: false }))
    expect(cleanupCalls(), 'nothing to undo').toHaveLength(0)
    expect(reportToSentry).not.toHaveBeenCalled()
  })
})

describe('an upload that fails after the row was reserved', () => {
  it('removes the reservation and returns the ORIGINAL upload error', async () => {
    rpc.mockResolvedValueOnce(reserved)
    upload.mockResolvedValueOnce({ data: null, error: { message: 'network unreachable' } })
    rpc.mockResolvedValueOnce({ data: { ok: true, id: MEDIA_ID }, error: null })

    const err = await addGuideImage(upload_())

    // The caller is told what actually went wrong, not what the cleanup did.
    expect(err).toBe('network unreachable')
    // …and the orphan is gone. `guide_media_remove` drops the row AND its
    // storage object server-side, so one authorized call undoes both halves.
    expect(cleanupCalls()).toHaveLength(1)
    expect(cleanupCalls()[0][1]).toEqual({ p_id: MEDIA_ID })
  })

  it('reports a cleanup failure without replacing the upload error', async () => {
    rpc.mockResolvedValueOnce(reserved)
    upload.mockResolvedValueOnce({ data: null, error: { message: 'storage quota exceeded' } })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'cleanup denied' } })

    expect(await addGuideImage(upload_())).toBe('storage quota exceeded')
    expect(reportToSentry, 'the orphan is recorded somewhere').toHaveBeenCalledTimes(1)
  })

  it('survives a cleanup that throws, and still returns the upload error', async () => {
    rpc.mockResolvedValueOnce(reserved)
    upload.mockResolvedValueOnce({ data: null, error: { message: 'connection reset' } })
    rpc.mockRejectedValueOnce(new Error('offline'))

    await expect(addGuideImage(upload_())).resolves.toBe('connection reset')
    expect(reportToSentry).toHaveBeenCalledTimes(1)
  })
})

describe('retrying after a failure', () => {
  it('is safe: the retry reserves its own row and cleans up nothing of the first', async () => {
    rpc.mockResolvedValueOnce(reserved)
    upload.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
    rpc.mockResolvedValueOnce({ data: { ok: true, id: MEDIA_ID }, error: null })
    expect(await addGuideImage(upload_())).toBe('timeout')

    rpc.mockReset(); upload.mockReset()
    const second = { ...reserved.data, media_id: 'media-2', storage_path: 'guide-1/media-2/photo.png' }
    rpc.mockResolvedValueOnce({ data: second, error: null })
    upload.mockResolvedValueOnce({ data: { path: second.storage_path }, error: null })

    expect(await addGuideImage(upload_())).toBeNull()
    expect(upload.mock.calls[0][0], 'a fresh path, not the abandoned one').toBe(second.storage_path)
    expect(cleanupCalls()).toHaveLength(0)
  })

  it('cleaning up twice is harmless — a second remove answers not_found', async () => {
    rpc.mockResolvedValueOnce(reserved)
    upload.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
    // The row is already gone; the RPC's validation refusal is not an error.
    rpc.mockResolvedValueOnce({ data: { ok: false, code: 'not_found' }, error: null })

    expect(await addGuideImage(upload_())).toBe('timeout')
    expect(reportToSentry, 'already-gone is not a cleanup failure').not.toHaveBeenCalled()
  })
})

describe('a reservation that never succeeded', () => {
  it('cleans up nothing when the RPC refuses', async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, message: 'you may not add images to guides' }, error: null })
    expect(await addGuideImage(upload_())).toBe('you may not add images to guides')
    expect(upload).not.toHaveBeenCalled()
    expect(cleanupCalls()).toHaveLength(0)
  })

  it('refuses an invalid file before any round trip', async () => {
    const bad = { ...upload_(), file: new File([new Uint8Array([1])], 'x.svg', { type: 'image/svg+xml' }) }
    expect(await addGuideImage(bad)).toMatch(/PNG, JPEG, WebP or GIF/)
    expect(rpc).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })
})

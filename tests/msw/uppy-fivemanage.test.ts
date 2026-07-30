/** Uppy → FiveManage adapter lifecycle against the MSW fivemanage handler
 *  (pilot: Case Detail → Photos & Media). Locks the transport contract on the
 *  wire — per-kind endpoint + field name, raw Authorization, metadata part —
 *  and the queue semantics the modal leans on: upload failure → retry
 *  re-uploads; insert failure → `save-failed` (hosted, NOT done) → retry
 *  re-runs the insert WITHOUT a second host upload; cancel drops only
 *  pending items. */
import { describe, expect, it, vi } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { failedUpload } from '@/mocks/scenarios'
import { setFivemanageFailure } from '@/mocks/store'
import { fivemanageBaseUrl, MOCK_FIVEMANAGE_API_KEY } from '@/mocks/env'
import { createFmUploader, type FmUploader, type UploadedFile } from '@/lib/uppyFivemanage'

const mkFile = (name: string, type: string, bytes = 64) =>
  new File([new Uint8Array(bytes)], name, { type })

/** Queue drained: nothing queued/uploading/saving (done OR failed both count). */
const settled = (u: FmUploader) =>
  vi.waitFor(() => { expect(u.getSnapshot().active).toBe(0) }, { timeout: 10_000 })

describe('transport contract on the wire', () => {
  it('routes image/video/audio to /api/{kind} with a kind-named field, raw key auth and a metadata part', async () => {
    const seen: Array<{ kind: string; auth: string | null; hasKindField: boolean; metadata: unknown }> = []
    server.use(
      http.post(`${fivemanageBaseUrl()}/api/:kind`, async ({ request, params }) => {
        const kind = params.kind as string
        const fd = await request.formData()
        seen.push({
          kind,
          auth: request.headers.get('authorization'),
          hasKindField: fd.get(kind) != null, // multipart field named BY KIND, never `file`
          metadata: fd.get('metadata'),
        })
        return HttpResponse.json({ url: `https://r2.fivemanage.com/mock/${kind}.bin` })
      }),
    )

    const uploaded: UploadedFile[] = []
    const u = createFmUploader({ onUploaded: async (f) => { uploaded.push(f) } })
    u.addFiles([mkFile('scene.png', 'image/png'), mkFile('chase.mp4', 'video/mp4'), mkFile('wire.mp3', 'audio/mpeg')])
    await settled(u)

    expect(u.getSnapshot().items.map((i) => i.status)).toEqual(['done', 'done', 'done'])
    expect(seen.map((s) => s.kind).sort()).toEqual(['audio', 'image', 'video'])
    for (const s of seen) {
      expect(s.auth).toBe(MOCK_FIVEMANAGE_API_KEY) // raw key — NO Bearer prefix
      expect(s.hasKindField).toBe(true)
      expect(typeof s.metadata).toBe('string')
    }
    const names = seen.map((s) => (JSON.parse(s.metadata as string) as { name: string }).name).sort()
    expect(names).toEqual(['chase.mp4', 'scene.png', 'wire.mp3'])
    expect(uploaded.map((f) => f.url).sort()).toEqual([
      'https://r2.fivemanage.com/mock/audio.bin',
      'https://r2.fivemanage.com/mock/image.bin',
      'https://r2.fivemanage.com/mock/video.bin',
    ])
    expect(uploaded.map((f) => f.kind).sort()).toEqual(['audio', 'image', 'video'])
  })

  it('accepts the alternate response shapes (link / data.url) and fails on a URL-less 2xx', async () => {
    const bodies = [
      { link: 'https://r2.fivemanage.com/via-link.png' },
      { data: { url: 'https://r2.fivemanage.com/via-data.png' } },
      { ok: true }, // 2xx without a URL is still a failure
    ]
    let call = 0
    server.use(
      http.post(`${fivemanageBaseUrl()}/api/:kind`, () => HttpResponse.json(bodies[call++] ?? {})),
    )
    const uploaded: UploadedFile[] = []
    const u = createFmUploader({ onUploaded: async (f) => { uploaded.push(f) } })
    u.addFiles([mkFile('a.png', 'image/png')])
    await settled(u)
    u.addFiles([mkFile('b.png', 'image/png')])
    await settled(u)
    u.addFiles([mkFile('c.png', 'image/png')])
    await settled(u)

    expect(uploaded.map((f) => f.url)).toEqual([
      'https://r2.fivemanage.com/via-link.png',
      'https://r2.fivemanage.com/via-data.png',
    ])
    const items = u.getSnapshot().items
    expect(items.map((i) => i.status)).toEqual(['done', 'done', 'upload-failed'])
    expect(items[2].error).toBe('FiveManage returned no URL')
  })
})

describe('failure semantics + retry state', () => {
  it('surfaces the host error verbatim; retry re-uploads once the host recovers', async () => {
    failedUpload('quota exceeded')
    const uploaded: UploadedFile[] = []
    const failures: Array<[string, string]> = []
    const u = createFmUploader({
      onUploaded: async (f) => { uploaded.push(f) },
      onUploadFailed: (name, message) => failures.push([name, message]),
    })
    u.addFiles([mkFile('still.png', 'image/png')])
    await settled(u)

    let item = u.getSnapshot().items[0]
    expect(item.status).toBe('upload-failed')
    expect(item.error).toBe('quota exceeded') // server message, not statusText
    expect(failures).toEqual([['still.png', 'quota exceeded']])
    expect(u.getSnapshot().failed).toBe(1)
    expect(uploaded).toHaveLength(0)

    setFivemanageFailure(null) // host recovers
    u.retry(item.id)
    await settled(u)
    item = u.getSnapshot().items[0]
    expect(item.status).toBe('done')
    expect(uploaded).toHaveLength(1)
    expect(u.getSnapshot().failed).toBe(0)
  })

  it('a failed insert leaves the item hosted-but-NOT-done; retry re-runs the insert without a second upload', async () => {
    let posts = 0
    server.use(
      http.post(`${fivemanageBaseUrl()}/api/:kind`, () => {
        posts += 1
        return HttpResponse.json({ url: 'https://r2.fivemanage.com/hosted-once.png' })
      }),
    )
    let insertFails = true
    const inserted: UploadedFile[] = []
    const u = createFmUploader({
      onUploaded: async (f) => {
        if (insertFails) throw new Error('insert denied by RLS')
        inserted.push(f)
      },
    })
    u.addFiles([mkFile('scene.png', 'image/png')])
    await settled(u)

    let item = u.getSnapshot().items[0]
    expect(item.status).toBe('save-failed') // hosted, not saved — never "done"
    expect(item.error).toBe('insert denied by RLS')
    expect(item.url).toBe('https://r2.fivemanage.com/hosted-once.png')
    expect(u.getSnapshot().failed).toBe(1)
    expect(posts).toBe(1)

    insertFails = false
    u.retry(item.id)
    await settled(u)
    item = u.getSnapshot().items[0]
    expect(item.status).toBe('done')
    expect(inserted).toEqual([{ name: 'scene.png', kind: 'image', size: 64, url: 'https://r2.fivemanage.com/hosted-once.png' }])
    expect(posts).toBe(1) // the retry re-ran the insert only — no re-upload
  })

  it('rejects disallowed types and duplicates before a byte leaves the browser', async () => {
    const rejected: Array<[string, string]> = []
    const u = createFmUploader({
      onUploaded: async () => {},
      onRejected: (name, message) => rejected.push([name, message]),
    })
    u.addFiles([mkFile('notes.pdf', 'application/pdf')])
    expect(u.getSnapshot().items).toHaveLength(0)
    expect(rejected).toHaveLength(1)
    expect(rejected[0][0]).toBe('notes.pdf')
    expect(rejected[0][1]).toMatch(/only upload/i)

    const dupe = mkFile('twice.png', 'image/png')
    u.addFiles([dupe])
    u.addFiles([dupe])
    expect(u.getSnapshot().items).toHaveLength(1)
    expect(rejected[1]).toEqual(['twice.png', 'Already in the upload queue.'])
    await settled(u)
  })

  it('cancelPending drops queued/uploading items and nothing lands afterwards', async () => {
    server.use(
      http.post(`${fivemanageBaseUrl()}/api/:kind`, async () => {
        await delay(300)
        return HttpResponse.json({ url: 'https://r2.fivemanage.com/late.png' })
      }),
    )
    const uploaded: UploadedFile[] = []
    const u = createFmUploader({ onUploaded: async (f) => { uploaded.push(f) } })
    u.addFiles([mkFile('one.png', 'image/png'), mkFile('two.png', 'image/png')])
    expect(u.getSnapshot().active).toBe(2)

    u.cancelPending()
    expect(u.getSnapshot().items).toHaveLength(0)
    expect(u.getSnapshot().active).toBe(0)

    await new Promise((r) => setTimeout(r, 400))
    expect(uploaded).toHaveLength(0) // aborted uploads never reach the insert seam
  })
})

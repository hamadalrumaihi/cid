/** FiveManage + Supabase edge-function handlers.
 *
 *  fivemanage.ts uploads with a bare fetch to {base}/api/{image|video|audio};
 *  the success shape is { url } (fmUpload also accepts link / data.url). The
 *  failedUpload() scenario flips these to HTTP 500 with a message fmUpload
 *  surfaces verbatim.
 *
 *  Edge functions (db.ts invokeFunction → /functions/v1/:name) answer 200 {}
 *  — the app treats them as fire-and-forget, so no richer emulation is
 *  needed; no external side effect ever occurs. */
import { http, HttpResponse } from 'msw'
import { fivemanageBaseUrl, supabaseBaseUrl } from '../env'
import { getFivemanageFailure } from '../store'
import { shapeNetwork } from './postgrest'

export const fivemanageHandlers = [
  http.post(`${fivemanageBaseUrl()}/api/:kind`, async ({ request, params }) => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    if (!request.headers.get('authorization')) {
      return HttpResponse.json({ message: 'Missing API token' }, { status: 401 })
    }
    const failure = getFivemanageFailure()
    if (failure) return HttpResponse.json({ message: failure }, { status: 500 })
    const kind = params.kind as string
    return HttpResponse.json({ url: `https://r2.fivemanage.com/mock/${kind}-upload.bin` })
  }),

  http.post(`${supabaseBaseUrl()}/functions/v1/:name`, async () => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    return HttpResponse.json({})
  }),
]

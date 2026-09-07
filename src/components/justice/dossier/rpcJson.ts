/** The Phase 4 legal RPCs return jsonb `{ok:true, …}` or
 *  `{ok:false, code, message}` — authority refusals come back as a payload,
 *  NOT a thrown error (the server writes perm_deny and lets the client show
 *  the message). This folds both shapes into one result so every caller
 *  toasts the same way. */
import type { MutationResult } from '@/lib/db'
import type { Json } from '@/lib/database.types'
import { humanizeError } from '@/lib/toast'

export interface JsonRpcResult<T extends Record<string, unknown> = Record<string, unknown>> {
  ok: boolean
  message: string | null
  code: string | null
  data: T | null
}

export function readJsonRpc<T extends Record<string, unknown> = Record<string, unknown>>(res: MutationResult<Json>): JsonRpcResult<T> {
  if (res.error) return { ok: false, message: humanizeError(res.error.message), code: res.error.code ?? null, data: null }
  const d = res.data
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, message: 'Unexpected server response.', code: null, data: null }
  const obj = d as Record<string, unknown>
  if (obj.ok === false) {
    return {
      ok: false,
      message: typeof obj.message === 'string' ? obj.message : 'The server refused this action.',
      code: typeof obj.code === 'string' ? obj.code : null,
      data: obj as T,
    }
  }
  return { ok: true, message: null, code: null, data: obj as T }
}


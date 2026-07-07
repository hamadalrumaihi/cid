import { rpc, invokeFunction } from './db'
import type { Json } from './database.types'

/** In-app notification + best-effort Discord DM — vanilla command.js:464-478.
 *  Writes go through the forgery-guarded create_notification RPC (the server
 *  stamps the actor); the discord-notify Edge Function is fire-and-forget and
 *  never blocks or fails the in-app notification. */
export interface NotifyPayload {
  case_id?: string
  case_number?: string
  detective?: string
  reason?: string
  stage?: string
  title?: string
  announce_id?: string | null
  [key: string]: unknown
}

export async function notify(userId: string | null | undefined, type: string, payload: NotifyPayload = {}): Promise<void> {
  if (!userId) return
  const res = await rpc('create_notification', { p_user_id: userId, p_type: type, p_payload: payload as Json })
  if (res.error) return // notification is best-effort; the primary action already succeeded
  void invokeFunction('discord-notify', { user_id: userId, type, payload })
}

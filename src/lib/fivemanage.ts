'use client'

/** FiveManage media hosting — port of vanilla fivemanage.js. Uploads a
 *  photo/video/audio file from the browser and returns the hosted URL, which
 *  the vault/case-files store in Supabase alongside their tags. The API token
 *  is public by design (referrer-bound on FiveManage's side) — same key the
 *  vanilla app ships in index.html — provided via NEXT_PUBLIC_ env. If
 *  absent, uploads are disabled and views fall back to paste-a-URL. */

const API_KEY = process.env.NEXT_PUBLIC_FIVEMANAGE_API_KEY ?? ''
const BASE_URL = (process.env.NEXT_PUBLIC_FIVEMANAGE_BASE_URL ?? 'https://api.fivemanage.com').replace(/\/+$/, '')

export const fmConfigured = (): boolean => !!API_KEY && !/PASTE_/.test(API_KEY)

export type FmKind = 'image' | 'video' | 'audio'

export async function fmUpload(file: File): Promise<{ url: string; kind: FmKind }> {
  if (!fmConfigured()) throw new Error('FiveManage not configured')
  const mime = file.type || ''
  const kind: FmKind = mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'image'
  const fd = new FormData()
  fd.append(kind, file) // FiveManage keys the multipart field by media kind
  fd.append('metadata', JSON.stringify({ name: file.name }))
  const res = await fetch(`${BASE_URL}/api/${kind}`, { method: 'POST', headers: { Authorization: API_KEY }, body: fd })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const j = (await res.json()) as { message?: string; error?: string }; msg = j.message || j.error || msg } catch { /* keep status */ }
    throw new Error(msg)
  }
  const data = (await res.json().catch(() => ({}))) as { url?: string; link?: string; data?: { url?: string } }
  const url = data.url || data.link || data.data?.url
  if (!url) throw new Error('FiveManage returned no URL')
  return { url, kind }
}

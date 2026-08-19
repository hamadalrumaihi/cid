/** Evidence on a Field Intelligence submission — the client half of
 *  20260912120000_field_evidence_storage.sql.
 *
 *  ── Two shapes, on purpose ─────────────────────────────────────────────────
 *  `upload` is a file in the private `field-evidence` bucket. `link` is
 *  something hosted elsewhere, kept exactly as the officer pasted it. A Medal
 *  clip is a page on medal.tv, not a file — there is nothing to download and
 *  re-host, and an officer should never have to export a clip and re-upload it.
 *
 *  ── The bucket is private, so nothing here yields a permanent URL ──────────
 *  Reads go through a short-lived signed URL created on demand. A storage path
 *  pasted into a browser without a token gets nothing. That is deliberate:
 *  evidence attached to an investigation should not be one guessed URL away
 *  from the open internet, which is exactly what a public bucket would make it.
 *
 *  ── Access is decided once, not twice ─────────────────────────────────────
 *  The object path carries the submission id (`field/<submission_id>/<file>`)
 *  and the storage policies resolve it through the same helpers the submission
 *  tables use. A file is visible precisely when its report is. Nothing in this
 *  file is a check — the storage policies refuse the bytes regardless.
 */

import { insert, list, remove } from './db'
import { supabase } from './supabase'
import type { Tables } from './database.types'

export type FieldEvidenceRow = Tables<'field_submission_evidence'>

export const EVIDENCE_BUCKET = 'field-evidence'

/** Mirrors the bucket's own limits. The bucket rejects anything outside them
 *  regardless; catching it here means the officer is told before a 50 MB
 *  upload runs to completion and fails. */
export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024
export const EVIDENCE_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf',
] as const

/** Why this file cannot be attached, or null. */
export function fileProblem(file: { size: number; type: string }): string | null {
  if (!(EVIDENCE_MIME as readonly string[]).includes(file.type)) {
    return 'That file type is not accepted. Use an image, an MP4/WebM/MOV clip, or a PDF.'
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return `That file is ${(file.size / 1048576).toFixed(0)} MB. The limit is 50 MB — link to it instead.`
  }
  if (file.size === 0) return 'That file is empty.'
  return null
}

/** True for a medal.tv URL. This MIRRORS the trigger, which is what actually
 *  sets `is_medal` — the client never gets to claim what a URL is, it only
 *  predicts so the form can show the right preview before the round trip. */
export function looksLikeMedal(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'medal.tv' || host.endsWith('.medal.tv')
  } catch { return false }
}

/** Why this URL cannot be attached, or null. Mirrors the trigger's rule: a
 *  `javascript:` or `data:` URL in a field a reviewer will click is a scripting
 *  vector, and no genuine evidence needs one. */
export function urlProblem(raw: string): string | null {
  const url = raw.trim()
  if (!url) return 'Paste a link first.'
  let parsed: URL
  try { parsed = new URL(url) } catch { return 'That does not look like a link.' }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only http and https links can be attached.'
  }
  return null
}

/** A stable, collision-free object path under this submission's own folder.
 *  The `field/<submission_id>/` prefix is not decoration: the storage policy
 *  and a check constraint both read the submission id out of it. */
export function evidencePath(submissionId: string, fileName: string): string {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  return `field/${submissionId}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

export async function loadEvidence(submissionId: string): Promise<FieldEvidenceRow[]> {
  return list('field_submission_evidence', {
    eq: { submission_id: submissionId }, order: 'created_at',
  }).catch(() => [])
}

/** Upload a file, then record it. The object goes up FIRST: an evidence row
 *  pointing at a file that failed to upload is worse than an orphaned object,
 *  because a reviewer would see an attachment they cannot open and have no way
 *  to tell whether it was withheld or simply never arrived. */
export async function attachUpload(
  submissionId: string, file: File, title?: string,
): Promise<string | null> {
  const problem = fileProblem(file)
  if (problem) return problem

  const path = evidencePath(submissionId, file.name)
  const up = await supabase().storage.from(EVIDENCE_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false, // never silently replace an object another row already names
  })
  if (up.error) return up.error.message

  const res = await insert('field_submission_evidence', {
    submission_id: submissionId, kind: 'upload', storage_path: path,
    title: title?.trim() || file.name,
  })
  if (res.error) {
    // The row failed, so the object is unreferenced. Clean it up rather than
    // leaving a file in the bucket that nothing points at.
    await supabase().storage.from(EVIDENCE_BUCKET).remove([path]).catch(() => undefined)
    return res.error.message
  }
  return null
}

/** Record a hosted link. `is_medal` is deliberately not sent — the trigger
 *  decides it from the URL. */
export async function attachLink(
  submissionId: string, url: string, title?: string,
): Promise<string | null> {
  const problem = urlProblem(url)
  if (problem) return problem
  const res = await insert('field_submission_evidence', {
    submission_id: submissionId, kind: 'link', external_url: url.trim(),
    title: title?.trim() || null,
  })
  return res.error?.message ?? null
}

/** Remove an attachment. The row goes first: if the object delete fails the
 *  worst case is a file nothing references, whereas the reverse would leave a
 *  row promising evidence that is gone. */
export async function detachEvidence(e: FieldEvidenceRow): Promise<string | null> {
  const res = await remove('field_submission_evidence', e.id)
  if (res.error) return res.error.message
  if (e.storage_path) {
    await supabase().storage.from(EVIDENCE_BUCKET).remove([e.storage_path]).catch(() => undefined)
  }
  return null
}

/** A short-lived URL for viewing one upload. Null when the caller is not
 *  entitled to it — the storage policy decides, not this function. */
export async function evidenceUrl(
  e: FieldEvidenceRow, expiresIn = 300,
): Promise<string | null> {
  if (e.kind === 'link') return e.external_url
  if (!e.storage_path) return null
  const { data, error } = await supabase().storage
    .from(EVIDENCE_BUCKET).createSignedUrl(e.storage_path, expiresIn)
  return error ? null : (data?.signedUrl ?? null)
}

/** How to describe an attachment in a list. */
export function evidenceLabel(e: FieldEvidenceRow): string {
  if (e.title?.trim()) return e.title
  if (e.kind === 'link') return e.is_medal ? 'Medal clip' : 'Linked evidence'
  return 'Uploaded file'
}

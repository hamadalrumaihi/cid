'use client'

/** Registry intelligence attachments — the client half of
 *  `public.registry_media_attach` and the `registry/<kind>/<entity_id>/
 *  <media_id>/<file>` prefix on the private `case-evidence` bucket
 *  (migration 20261106120000_org_associations_registry_intel §2).
 *
 *  ── What this is NOT ────────────────────────────────────────────────────
 *  A photograph of a gang tag, a mural or a shopfront is INTELLIGENCE, not
 *  case evidence. It gets no EV- number, no custody chain and no integrity
 *  sweep, and it never goes through `evidence_register`. What it does get is
 *  the same private bucket the platform upgrade gave case evidence, instead
 *  of a browser-visible external URL on a third-party host.
 *
 *  ── Order of operations ─────────────────────────────────────────────────
 *  The RPC reserves the `media` row AND the object path first — the bucket's
 *  insert policy checks that a live, case-less, caller-owned row already
 *  names this exact path and points at the entity in the path — then the
 *  browser uploads the ORIGINAL bytes to that path. A failed upload rolls the
 *  row back: a row without bytes is worse than no row (the stageEvidence
 *  rule). Reads are signed URLs, through lib/evidence's cache.
 *
 *  Data access goes through lib/db; the only direct client use is
 *  `supabase().storage` for the upload, exactly as lib/evidence does. */
import type { Json } from './database.types'
import { rpc, softDeleteRecord } from './db'
import { EVIDENCE_BUCKET, MAX_EVIDENCE_BYTES } from './evidence'
import { supabase } from './supabase'
import { humanizeError } from './toast'

/** `media.kind` for a registry attachment — what separates these rows from
 *  case media in every existing query that reads the column. */
export const REGISTRY_MEDIA_KIND = 'registry_intel'

/** The record kinds `registry_media_attach` accepts (its own CHECK). */
export const REGISTRY_MEDIA_KINDS = ['gang', 'person', 'place', 'vehicle', 'narcotic'] as const
export type RegistryMediaKind = (typeof REGISTRY_MEDIA_KINDS)[number]

/** `<input accept>` for the attach control. Photographs only: the action is
 *  "attach a photograph", and an intelligence attachment that is neither an
 *  image nor case evidence has no surface to be read on. */
export const REGISTRY_MEDIA_ACCEPT = 'image/*'

/** Why this file cannot be attached, or null. Mirrors the bucket's own
 *  limits so the officer hears it before the bytes move. */
export function registryPhotoProblem(file: { size: number; type: string }): string | null {
  if (file.size === 0) return 'That file is empty.'
  if (!(file.type || '').toLowerCase().startsWith('image/')) return 'Attach an image — photographs only.'
  if (file.size > MAX_EVIDENCE_BYTES) {
    return `That file is ${(file.size / 1048576).toFixed(0)} MB. The limit is 100 MB.`
  }
  return null
}

export interface AttachRegistryMediaArgs {
  kind: RegistryMediaKind
  entityId: string
  file: File
  /** Falls back to the filename without its extension. */
  title?: string
  category?: string | null
  caption?: string | null
}

export interface AttachedRegistryMedia {
  mediaId: string
  storagePath: string
}

/** Reserve the row + path, then upload the original bytes. Throws an Error
 *  with an officer-readable message on any refusal or failure; a failed
 *  OBJECT upload withdraws the reserved row. */
export async function attachRegistryMedia(args: AttachRegistryMediaArgs): Promise<AttachedRegistryMedia> {
  const { file } = args
  const problem = registryPhotoProblem(file)
  if (problem) throw new Error(problem)

  const title = (args.title ?? '').trim() || file.name.replace(/\.[a-z0-9]+$/i, '') || file.name
  const res = await rpc('registry_media_attach', {
    p_kind: args.kind,
    p_entity_id: args.entityId,
    p_title: title,
    p_filename: file.name,
    p_mime: file.type || null,
    p_byte_size: file.size,
    p_category: args.category ?? null,
    p_caption: args.caption?.trim() || null,
  })
  if (res.error) throw new Error(humanizeError(res.error.message))
  const out = (res.data ?? {}) as { ok?: boolean; code?: string; message?: string; media_id?: string; storage_path?: string }
  if (out.ok === false) throw new Error(out.message || out.code || 'The attachment was refused.')
  const mediaId = out.media_id
  const storagePath = out.storage_path
  if (!mediaId || !storagePath) throw new Error('The server did not return a storage path for this attachment.')

  const up = await supabase().storage.from(EVIDENCE_BUCKET).upload(storagePath, file, {
    contentType: file.type,
    upsert: false, // originals are immutable — never overwrite an object another row names
  })
  if (up.error) {
    await softDeleteRecord('media', mediaId, 'Upload failed — the object never arrived').catch(() => undefined)
    throw new Error(humanizeError(up.error.message))
  }
  return { mediaId, storagePath }
}

/** The caption the RPC stores under `media.tags.caption`, or null. */
export function registryMediaCaption(tags: Json | null | undefined): string | null {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return null
  const v = (tags as Record<string, unknown>).caption
  return typeof v === 'string' && v.trim() ? v : null
}

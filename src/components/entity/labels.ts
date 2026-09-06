/** Human wording shared by the entity components — signal codes from
 *  `entity_duplicates` / `siu_reconcile_queue`, column names, merge-manifest
 *  table keys, and the label a freshly created record should carry as an
 *  EntityHit. Pure; nothing here touches the network. */
import type { MergeKind, MergeVictimManifest } from '@/lib/entity'
import type { EntityHit } from '@/lib/entitySearch'

/** 'phone' → "same phone", 'name+dob' → "same name and date of birth",
 *  'name~' → "similar name" … Unknown codes degrade to a readable phrase. */
export function signalLabel(signal: string): string {
  switch (signal) {
    case 'phone': return 'same phone'
    case 'name': return 'same name'
    case 'name+dob': return 'same name and date of birth'
    case 'name+area': return 'same name and area'
    case 'alias': return 'same alias'
    case 'plate': return 'same plate'
    case 'handle': return 'same handle'
    case 'value': return 'same value'
    case 'case_number': return 'same case number'
    case 'name~': return 'similar name'
    case 'plate~': return 'similar plate'
    case 'handle~': return 'similar handle'
    case 'title~': return 'similar title'
  }
  const similar = signal.endsWith('~')
  const base = (similar ? signal.slice(0, -1) : signal).replace(/_/g, ' ').replace(/\+/g, ' and ')
  return `${similar ? 'similar' : 'same'} ${base}`
}

/** Column → words: 'display_name' → "Display name", 'dob' → "Date of birth". */
export function fieldLabel(field: string): string {
  switch (field) {
    case 'dob': return 'Date of birth'
    case 'mugshot_url': return 'Mugshot'
    case 'profile_url': return 'Profile URL'
    case 'officer_safety': return 'Officer safety'
    case 'scene_indicators': return 'Scene indicators'
  }
  const s = field.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** A manifest repoint key ('case_intel_links.ref_id') → "Case intel links". */
export function tableLabel(key: string): string {
  const table = key.split('.')[0] ?? key
  return fieldLabel(table)
}

export const TOMBSTONE_LABEL: Record<MergeVictimManifest['tombstone'], string> = {
  lifecycle: 'marked merged (lifecycle)',
  status: 'marked merged (status)',
  soft_delete: 'soft-deleted',
}

/** Anything the create sheet / compare table shows as a cell. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** The EntityHit a just-created record should be handed back as — the same
 *  label/sublabel shape `entity_suggest` would produce for it. */
export function hitFor(kind: MergeKind, id: string, v: Record<string, string>): EntityHit {
  const join = (...parts: (string | undefined)[]) => parts.filter((p) => p && p.trim()).join(' · ') || undefined
  switch (kind) {
    case 'person': return { id, label: v.name ?? '', sublabel: join(v.alias, v.phone), meta: { kind } }
    case 'vehicle': return { id, label: v.plate ?? '', sublabel: join(v.color, v.model), meta: { kind } }
    case 'gang': return { id, label: v.name ?? '', sublabel: v.aliases || undefined, meta: { kind } }
    case 'place': return { id, label: v.name ?? '', sublabel: join(v.type?.replace(/_/g, ' '), v.area), meta: { kind } }
    case 'account': return { id, label: `@${v.handle ?? ''}`, sublabel: join(v.platform, v.display_name), meta: { kind } }
    case 'narcotic': return { id, label: v.name ?? '', sublabel: v.category || undefined, meta: { kind } }
  }
}

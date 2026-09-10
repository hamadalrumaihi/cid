/** Gang-roster duplicate detection — the ONE cluster rule shared by the
 *  roster's "possible duplicate" banner (components/gangs/gangIntel) and the
 *  Action Center's gang_duplicate lane (lib/actionItems). Pure and generic:
 *  works over any slim projection of gang_members that carries id, gang_id,
 *  name and person_id, so the queue never has to load full member rows.
 *
 *  Rule: exact normalized-name matches INSIDE one gang are grouped; a shared
 *  linked person_id strengthens the signal. Never mutates or removes anything
 *  — it only surfaces clusters for review. */

export interface DuplicateMemberLike {
  id: string
  gang_id: string
  name?: string | null
  person_id?: string | null
}

export interface DuplicateClusterOf<T extends DuplicateMemberLike> {
  /** `<gang_id>|<normalized name>` — stable across refreshes. */
  key: string
  members: T[]
  reason: string
}

export const normalizeName = (name?: string | null): string =>
  (name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()

/** Likely-duplicate members grouped per gang; most-collisions first. */
export function clusterDuplicates<T extends DuplicateMemberLike>(members: readonly T[]): DuplicateClusterOf<T>[] {
  const byKey = new Map<string, T[]>()
  for (const m of members) {
    const n = normalizeName(m.name)
    if (!n) continue
    const k = `${m.gang_id}|${n}`
    byKey.set(k, [...(byKey.get(k) ?? []), m])
  }
  const clusters: DuplicateClusterOf<T>[] = []
  for (const [key, group] of byKey) {
    if (group.length < 2) continue
    const personIds = new Set(group.map((m) => m.person_id).filter(Boolean))
    const reason =
      personIds.size === 1 && personIds.has(group[0].person_id)
        ? 'Same name and same linked person'
        : 'Same name within this gang'
    clusters.push({ key, members: group, reason })
  }
  return clusters.sort((a, b) => b.members.length - a.members.length)
}

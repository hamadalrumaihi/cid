/** Device preferences, stored in the SAME localStorage blob as the vanilla app
 *  (key `cid-portal-v3`, one JSON object) so accent/density/pins/drafts carry
 *  over when a user moves between the legacy site and this app. */
const KEY = 'cid-portal-v3'

type Blob = Record<string, unknown>

function load(): Blob {
  if (typeof window === 'undefined') return {}
  try { return (JSON.parse(localStorage.getItem(KEY) ?? 'null') as Blob) ?? {} } catch { return {} }
}

export const Store = {
  get<T>(key: string, fallback: T): T {
    const d = load()
    return (key in d ? (d[key] as T) : fallback)
  },
  set(key: string, value: unknown): void {
    if (typeof window === 'undefined') return
    const d = load()
    d[key] = value
    try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* storage full/blocked */ }
  },
}

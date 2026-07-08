/** Never-lose-work drafts — vanilla core.js:1032-1037. Namespaced localStorage
 *  stash (`cid-draft:<key>`, SAME keys as vanilla so half-typed chat messages
 *  and report drafts survive a move between the legacy site and this app). */
export interface Draft<T = unknown> { at: number; data: T }

const k = (key: string) => `cid-draft:${key}`

export const Drafts = {
  save(key: string, data: unknown): void {
    try { localStorage.setItem(k(key), JSON.stringify({ at: Date.now(), data })) } catch { /* storage full/blocked */ }
  },
  load<T = unknown>(key: string): Draft<T> | null {
    try { return JSON.parse(localStorage.getItem(k(key)) ?? 'null') as Draft<T> | null } catch { return null }
  },
  clear(key: string): void {
    try { localStorage.removeItem(k(key)) } catch { /* ignore */ }
  },
}

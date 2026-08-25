/** Never-lose-work drafts — vanilla core.js:1032-1037. Namespaced localStorage
 *  stash (`cid-draft:<key>`, SAME keys as vanilla so half-typed chat messages
 *  and report drafts survive a move between the legacy site and this app).
 *
 *  CAVEAT: these keys are NOT per-user — on a shared terminal one member can
 *  see another's stash. Surfaces migrated to lib/userDrafts (the DB-backed
 *  layer over `user_drafts`) avoid this: it uses this module as its local
 *  mirror but under per-user keys (`u:<uid>:<key>`). New draft surfaces
 *  should use userDrafts; the legal wizard's hardened stash flow and any
 *  remaining direct consumers keep the vanilla keys deliberately. */
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

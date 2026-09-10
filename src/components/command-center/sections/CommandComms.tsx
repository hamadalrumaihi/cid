'use client'

/** Command Center → Announcements. Surfaces the existing member-facing
 *  Announcements composer (command-gated posting) inside the Center by
 *  reusing its view as-is — it remains on its own tab too; this is a
 *  convenience surface, not a move. Analytics is NOT embedded here any more:
 *  /analytics is the one analytics surface (the Overview links to it). */
import { AnnounceView } from '@/components/announce/AnnounceView'

export function CommandComms() {
  return <AnnounceView />
}

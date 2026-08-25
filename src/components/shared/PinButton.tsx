'use client'

/** Pin/Unpin toggle for a record header — DB-backed quick-access bookmarks
 *  (lib/pins). Distinct from Follow (watchlist): follow = updates on My Desk,
 *  pin = keep this one click away. Renders for every signed-in viewer (pins
 *  are personal; no edit capability required). */
import { useEffect } from 'react'
import { usePinsStore, type PinType } from '@/lib/pins'
import { Button } from '@/components/ui/Button'

export function PinButton({ type, id, label, size = 'md' }: {
  type: PinType
  id: string
  /** Toast label, e.g. the person's name or the plate. */
  label?: string
  size?: 'sm' | 'md'
}) {
  const loaded = usePinsStore((s) => s.loaded)
  const fetch = usePinsStore((s) => s.fetch)
  const pinned = usePinsStore((s) => s.rows.some((p) => p.target_type === type && p.target_id === id))
  const toggle = usePinsStore((s) => s.toggle)

  useEffect(() => { if (!loaded) void fetch() }, [loaded, fetch])

  return (
    <Button
      size={size}
      aria-pressed={pinned}
      title={pinned ? 'Remove from your pinned records' : 'Pin this record for quick access'}
      onClick={() => void toggle(type, id, label)}
    >
      {pinned ? 'Unpin' : 'Pin'}
    </Button>
  )
}

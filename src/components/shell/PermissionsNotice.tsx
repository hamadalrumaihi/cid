'use client'

/** The one place the permission module's failure mode is visible (P1-08):
 *  when `my_permissions()` cannot be read the client stays at NO_ACCESS —
 *  no fallback to the pure mirrors — and this strip says so with a retry.
 *  Renders nothing while the read is in flight or has succeeded. */
import { usePermissions } from '@/lib/permissions'

export function PermissionsNotice() {
  const { error, retry } = usePermissions()
  if (!error) return null
  return (
    <div role="alert" className="mx-3 mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
      <p className="font-semibold">Permissions unavailable</p>
      <p className="mt-0.5 text-amber-200/80">Your capabilities could not be loaded, so controls are hidden until they are.</p>
      <button type="button" onClick={retry} className="mt-1.5 rounded border border-amber-400/40 px-2 py-0.5 font-medium text-amber-100 transition hover:bg-amber-400/20">
        Retry
      </button>
    </div>
  )
}

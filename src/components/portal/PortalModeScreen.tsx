import { ShieldMark } from '@/components/ui/ShieldMark'
import {
  MAINTENANCE_HEADING, MAINTENANCE_LINES, RETIRED_HEADING, RETIRED_LINES,
} from '@/lib/portalMode'

export type ScreenMode = 'retired' | 'maintenance'

/** The whole portal, when it is not available: the retirement notice or the
 *  maintenance notice. This is the ENTIRE page — no navigation, no sidebar,
 *  no login form, no controls — rendered by /unavailable, which the proxy
 *  serves for every route while the mode is blocking. Hook-free so the
 *  server renders it; portal tokens (ink canvas, slate text, the badge mark)
 *  so it reads as the portal, not as an error page. */
export function PortalModeScreen({ mode }: { mode: ScreenMode }) {
  const retired = mode === 'retired'
  const heading = retired ? RETIRED_HEADING : MAINTENANCE_HEADING
  const lines = retired ? RETIRED_LINES : MAINTENANCE_LINES
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-6 py-16 text-white sm:px-10">
      <section aria-labelledby="portal-mode-heading" className="w-full max-w-xl text-center">
        <div className="flex justify-center">
          <ShieldMark size="h-14 w-14 sm:h-16 sm:w-16" icon="h-8 w-8 sm:h-9 sm:w-9" />
        </div>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Criminal Investigation Division
        </p>
        <h1
          id="portal-mode-heading"
          className="mt-3 text-balance text-3xl font-bold tracking-tight text-white sm:text-5xl"
        >
          {heading}
        </h1>
        <div className="mx-auto mt-8 max-w-prose space-y-4 text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
          {lines.map((line) => <p key={line}>{line}</p>)}
        </div>
        <p className="mt-12 border-t border-white/10 pt-5 text-xs text-slate-500">
          {retired ? 'No records were deleted or altered.' : 'No records were deleted or altered. This page will be replaced when the portal returns.'}
        </p>
      </section>
    </main>
  )
}

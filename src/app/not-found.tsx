import Link from 'next/link'

/** Custom 404 — replaces Next's default with a portal-styled screen. Unknown
 *  tab slugs already redirect to /command; this catches everything else. */
export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-900/80 p-8 text-center">
        <p className="font-mono text-5xl font-black text-slate-700">404</p>
        <h1 className="mt-2 text-lg font-black text-white">No such record</h1>
        <p className="mt-1 text-sm text-slate-400">
          This page doesn&rsquo;t exist — or it was reassigned. Nothing was logged against your badge.
        </p>
        <Link
          href="/command"
          className="mt-6 inline-block rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-glow transition hover:brightness-110"
        >
          ← Back to the Dashboard
        </Link>
      </div>
    </div>
  )
}

import { PENAL_CODE } from '@/lib/penal'
import { BUREAUS } from '@/lib/roles'

/* Phase 0 placeholder — proves the scaffold, theme tokens, and ported data
 * libraries compile and render. The real shell lands in Phase 1. */
export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-8 shadow-glow">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-badge-500 to-accent-deep">
            <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">CID Portal</h1>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent-soft/80">React rebuild · Phase 0</p>
          </div>
        </div>
        <p className="text-sm text-slate-400">
          Foundations online: theme tokens, typed database client ({PENAL_CODE.length} penal charges ported,{' '}
          {Object.keys(BUREAUS).length} bureaus). Auth and the app shell arrive in Phase 1.
        </p>
      </div>
    </main>
  )
}

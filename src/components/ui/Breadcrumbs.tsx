'use client'

/** Breadcrumb trail for drill-down pages (case detail, operation detail —
 *  `?case=` / `?op=` sub-states the shell header title doesn't reflect).
 *  Replaces the bare "Back to X" links with a trail that shows where you are;
 *  the parent crumb keeps the exact same back behaviour. Last item is the
 *  current location (aria-current, not clickable). */

export interface Crumb {
  label: React.ReactNode
  /** Click target for ancestor crumbs; omit on the current (last) item. */
  onClick?: () => void
}

export function Breadcrumbs({ items, className = '' }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((it, i) => {
          const last = i === items.length - 1
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden className="text-slate-600">/</span>}
              {last || !it.onClick ? (
                <span aria-current={last ? 'page' : undefined} className={last ? 'font-semibold text-slate-200' : 'text-slate-400'}>
                  {it.label}
                </span>
              ) : (
                <button onClick={it.onClick} className="rounded font-semibold text-badge-200 transition hover:text-white">
                  {it.label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

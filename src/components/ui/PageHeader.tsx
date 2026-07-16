'use client'

/** Consistent in-view title block. Views hand-wrote their own header rows with
 *  random weight/size (text-xl font-bold vs text-2xl font-black) and mixed
 *  heading levels. PageHeader fixes one scale and a real <h1> per view;
 *  SectionHeader is the <h2> rank inside a page. Both take an optional actions
 *  slot so the "title on the left, buttons on the right" row is uniform. */

export interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Small uppercase kicker above the title (e.g. a bureau or category). */
  eyebrow?: string
  /** Right-aligned actions (buttons, filters). */
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, eyebrow, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-black text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  )
}

export function SectionHeader({ title, subtitle, actions, className = '' }: Omit<PageHeaderProps, 'eyebrow'>) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  )
}

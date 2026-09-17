/** The portal's shield mark — the badge on the login gate and on the
 *  portal-mode screens. Presentational; no hooks, so it renders from a server
 *  component as well as a client one. */
export function ShieldMark({ size = 'h-12 w-12', icon = 'h-7 w-7' }: { size?: string; icon?: string }) {
  return (
    <div className={`grid ${size} flex-shrink-0 place-items-center rounded-lg bg-badge-500`}>
      <svg className={`${icon} text-white`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2.5l8 3v6.5c0 5.2-3.6 8.7-8 9.5-4.4-.8-8-4.3-8-9.5V5.5z" />
        <path d="M12 6l1.2 2.4 2.6.4-1.9 1.9.5 2.6-2.4-1.2-2.4 1.2.5-2.6-1.9-1.9 2.6-.4z" />
        <path d="M8 17h8" />
      </svg>
    </div>
  )
}

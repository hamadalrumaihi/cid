/** Tactical icon set — ported from vanilla T_ICONS (core.js:1134-1151) and the
 *  index.html nav markup. Stroke follows currentColor so text-color utilities
 *  tint them; aria-hidden because every use sits beside a label. */

interface IconProps {
  size?: number
}

function T({ size = 18, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

export const CategoryIcon = ({ cat, size }: { cat: string; size?: number }) => {
  switch (cat) {
    case 'command':
      return <T size={size}><path d="M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z" /></T>
    case 'cases':
      return <T size={size}><path d="M3 7.5a2 2 0 0 1 2-2h4.2l1.8 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></T>
    case 'intel':
      return <T size={size}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><path d="M12 12l6-6" /></T>
    case 'reference':
      return <T size={size}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" /><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" /></T>
    case 'oversight':
      return <T size={size}><path d="M12 3.5l7.5 2.8v5.4c0 4.2-3 7.3-7.5 8.8-4.5-1.5-7.5-4.6-7.5-8.8V6.3z" /><path d="M9 12l2 2 4-4" /></T>
    case 'feedback':
      return <T size={size}><path d="M20.5 12a8.5 8.5 0 1 0-3.3 6.7l3.3 1.3-1-3.4a8.4 8.4 0 0 0 1-4.6z" /></T>
    default:
      return null
  }
}

export const MenuIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M3 12h18M3 6h18M3 18h18" />
  </svg>
)

export const CloseIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const BellIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

export const SearchIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

export const ChevronIcon = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {dir === 'left' ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
  </svg>
)

export const ShieldIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5l8 3v6.5c0 5.2-3.6 8.7-8 9.5-4.4-.8-8-4.3-8-9.5V5.5z" />
    <path d="M12 6l1.2 2.4 2.6.4-1.9 1.9.5 2.6-2.4-1.2-2.4 1.2.5-2.6-1.9-1.9 2.6-.4z" />
    <path d="M8 17h8" />
  </svg>
)

/** Tactical icon set — ported from vanilla T_ICONS (core.js:1134-1151) and the
 *  index.html nav markup. Stroke follows currentColor so text-color utilities
 *  tint them; aria-hidden because every use sits beside a label. */

interface IconProps {
  size?: number
  className?: string
}

function T({ size = 18, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
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
    case 'concern':
      return <T size={size}><path d="M12 3.5l8.5 15H3.5z" /><path d="M12 9.5v4" /><path d="M12 16.5h.01" /></T>
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

/* ── Record & interface icons ─────────────────────────────────────────────────
 * The professional set that replaces emoji wherever a glyph functions as an
 * interface control, a navigation symbol or a record-type marker. Same visual
 * language as CategoryIcon: 24×24, stroke-only, currentColor, 1.6 weight.
 * Decorative emoji inside user content is untouched. */

export const PersonIcon = (p: IconProps) => (
  <T {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></T>
)
export const VehicleIcon = (p: IconProps) => (
  <T {...p}><path d="M4 16v-4l1.6-4.4A2 2 0 0 1 7.5 6h9a2 2 0 0 1 1.9 1.6L20 12v4" /><path d="M4 12h16" /><path d="M3.5 16h17v2.5h-2.8V17H6.3v1.5H3.5z" /><circle cx="7.5" cy="14" r=".4" /><circle cx="16.5" cy="14" r=".4" /></T>
)
export const CaseIcon = (p: IconProps) => (
  <T {...p}><path d="M3 7.5a2 2 0 0 1 2-2h4.2l1.8 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></T>
)
export const GangIcon = (p: IconProps) => (
  <T {...p}><path d="M6 21V4" /><path d="M6 4h11l-2.5 3.5L17 11H6" /></T>
)
export const PlaceIcon = (p: IconProps) => (
  <T {...p}><path d="M12 21s-6.5-5.5-6.5-10.3A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.7C18.5 15.5 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.2" /></T>
)
export const NarcoticIcon = (p: IconProps) => (
  <T {...p}><rect x="4.5" y="9" width="15" height="6.5" rx="3.25" transform="rotate(-35 12 12.25)" /><path d="M9.4 9.1l5.2 6.3" /></T>
)
export const AccountIcon = (p: IconProps) => (
  <T {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.7 2.3 4 5.2 4 8.5s-1.3 6.2-4 8.5c-2.7-2.3-4-5.2-4-8.5s1.3-6.2 4-8.5z" /></T>
)
export const IndicatorIcon = (p: IconProps) => (
  <T {...p}><path d="M3.5 11.2V5a1.5 1.5 0 0 1 1.5-1.5h6.2a2 2 0 0 1 1.4.6l7.4 7.4a2 2 0 0 1 0 2.8l-5.9 5.9a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.8z" /><circle cx="8" cy="8" r="1.2" /></T>
)
export const NetworkIcon = (p: IconProps) => (
  <T {...p}><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="18" r="2.2" /><path d="M10.9 7l-4.4 9M13.1 7l4.4 9M7.2 18h9.6" /></T>
)
export const WeaponIcon = (p: IconProps) => (
  <T {...p}><circle cx="12" cy="12" r="7.5" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /><circle cx="12" cy="12" r="1.4" /></T>
)
export const TraceIcon = (p: IconProps) => (
  <T {...p}><path d="M8 3.5c-2.5 2-4 5-4 8.5s1.5 6.5 4 8.5" /><path d="M16 3.5c2.5 2 4 5 4 8.5s-1.5 6.5-4 8.5" /><circle cx="12" cy="12" r="2.4" /><path d="M12 6.5v3M12 14.5v3" /></T>
)
export const DocumentIcon = (p: IconProps) => (
  <T {...p}><path d="M6 3.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V3.5z" /><path d="M14 3.5V8h4.5" /><path d="M9 12.5h6M9 16h6" /></T>
)
export const ReportIcon = (p: IconProps) => (
  <T {...p}><rect x="5" y="4.5" width="14" height="16" rx="1.5" /><path d="M9 2.5h6v4H9z" /><path d="M8.5 11.5h7M8.5 15h7M8.5 18h4" /></T>
)
export const ReceiptIcon = (p: IconProps) => (
  <T {...p}><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" /><path d="M9 8h6M9 12h6M9 16h3.5" /></T>
)
export const OperationIcon = (p: IconProps) => (
  <T {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.4" /><circle cx="12" cy="12" r="1.2" /></T>
)
export const ScaleIcon = (p: IconProps) => (
  <T {...p}><path d="M12 4v16M8 20h8" /><path d="M12 6h6.5M12 6H5.5" /><path d="M5.5 6l-2.6 6a3 3 0 0 0 5.2 0z" /><path d="M18.5 6l-2.6 6a3 3 0 0 0 5.2 0z" /></T>
)
export const PhotoIcon = (p: IconProps) => (
  <T {...p}><rect x="3.5" y="5" width="17" height="14" rx="1.5" /><circle cx="9" cy="10" r="1.6" /><path d="M3.5 16.5l4.5-4 3.5 3 3.5-3.5 5.5 5" /></T>
)
export const VideoIcon = (p: IconProps) => (
  <T {...p}><rect x="3.5" y="6" width="12.5" height="12" rx="1.5" /><path d="M16 11l4.5-3v8L16 13z" /></T>
)
export const AudioIcon = (p: IconProps) => (
  <T {...p}><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3" /></T>
)
export const LinkIcon = (p: IconProps) => (
  <T {...p}><path d="M10 14a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6" /><path d="M14 10a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6" /></T>
)
export const EyeIcon = (p: IconProps) => (
  <T {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></T>
)
export const LockIcon = (p: IconProps) => (
  <T {...p}><rect x="5" y="10.5" width="14" height="10" rx="1.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><path d="M12 14.5v2.5" /></T>
)
export const ClockIcon = (p: IconProps) => (
  <T {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></T>
)
export const CalendarIcon = (p: IconProps) => (
  <T {...p}><rect x="3.5" y="5" width="17" height="16" rx="1.5" /><path d="M3.5 9.5h17M8 2.5V6M16 2.5V6" /></T>
)
export const StarIcon = (p: IconProps) => (
  <T {...p}><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" /></T>
)
export const TrashIcon = (p: IconProps) => (
  <T {...p}><path d="M4.5 6.5h15M9.5 3.5h5M6.5 6.5l1 13.5a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13.5" /><path d="M10 10.5v6M14 10.5v6" /></T>
)
export const PlusIcon = (p: IconProps) => (
  <T {...p}><path d="M12 5v14M5 12h14" /></T>
)
export const CheckIcon = (p: IconProps) => (
  <T {...p}><path d="M4.5 12.5l5 5 10-11" /></T>
)
export const XMarkIcon = (p: IconProps) => (
  <T {...p}><path d="M6 6l12 12M18 6L6 18" /></T>
)
export const AlertIcon = (p: IconProps) => (
  <T {...p}><path d="M12 3.5l8.5 15H3.5z" /><path d="M12 9.5v4" /><path d="M12 16.5h.01" /></T>
)
export const InfoIcon = (p: IconProps) => (
  <T {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><path d="M12 7.5h.01" /></T>
)
export const ArchiveIcon = (p: IconProps) => (
  <T {...p}><rect x="3.5" y="4.5" width="17" height="4.5" rx="1" /><path d="M5.5 9v10a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9" /><path d="M10 13h4" /></T>
)
export const UndoIcon = (p: IconProps) => (
  <T {...p}><path d="M8.5 5.5L4 10l4.5 4.5" /><path d="M4 10h10a6 6 0 0 1 0 12h-3" /></T>
)
export const FilterIcon = (p: IconProps) => (
  <T {...p}><path d="M4 6h16M7 12h10M10 18h4" /></T>
)
export const MapIcon = (p: IconProps) => (
  <T {...p}><path d="M9 4.5L3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5l-6-2z" /><path d="M9 4.5v13M15 6.5v13" /></T>
)
export const RadioIcon = (p: IconProps) => (
  <T {...p}><circle cx="12" cy="12" r="2" /><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4" /><path d="M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14" /></T>
)
export const SettingsIcon = (p: IconProps) => (
  <T {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.8l1.2 2.4 2.6.5 1.9-1 1.4 1.4-1 1.9.5 2.6 2.4 1.2v0l-2.4 1.2-.5 2.6 1 1.9-1.4 1.4-1.9-1-2.6.5L12 21.2l-1.2-2.4-2.6-.5-1.9 1-1.4-1.4 1-1.9-.5-2.6L2.8 12l2.4-1.2.5-2.6-1-1.9 1.4-1.4 1.9 1 2.6-.5z" /></T>
)
export const SlidersIcon = (p: IconProps) => (
  <T {...p}><path d="M5 4v6M5 14v6M12 4v2M12 10v10M19 4v10M19 18v2" /><path d="M3 10h4M10 6h4M17 14h4" /></T>
)
export const SwapIcon = (p: IconProps) => (
  <T {...p}><path d="M4 8h13l-3-3M20 16H7l3 3" /></T>
)

/** One glyph per searchable / linkable record kind — the single source both
 *  the command palette and cross-record chips draw from, replacing the two
 *  parallel emoji maps that used to live in lib/search and ui/EntityLink. */
const KIND_ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  case: CaseIcon,
  report: ReportIcon,
  task: CheckIcon,
  evidence: ReceiptIcon,
  operation: OperationIcon,
  legal: ScaleIcon,
  person: PersonIcon,
  // A BOLO is a flag on a person record — same glyph, different section.
  bolo: PersonIcon,
  tip: RadioIcon,
  member: PersonIcon,
  gang: GangIcon,
  place: PlaceIcon,
  vehicle: VehicleIcon,
  account: AccountIcon,
  narcotic: NarcoticIcon,
  indicator: IndicatorIcon,
  bench: WeaponIcon,
  footprint: TraceIcon,
  document: DocumentIcon,
  charge: ScaleIcon,
  network: NetworkIcon,
  media: PhotoIcon,
}

export function KindIcon({ kind, size = 15, className }: { kind: string; size?: number; className?: string }) {
  const Icon = KIND_ICONS[kind] ?? SearchIcon
  return Icon === SearchIcon
    ? <SearchIcon className={className ?? 'h-[15px] w-[15px]'} />
    : <Icon size={size} className={className} />
}

/** File-type marker for media/evidence records (image types render their own
 *  thumbnail — this covers the non-visual types and link records). */
export function FileTypeIcon({ type, size = 16, className }: { type: string; size?: number; className?: string }) {
  switch (type) {
    case 'video': return <VideoIcon size={size} className={className} />
    case 'audio': return <AudioIcon size={size} className={className} />
    case 'document': return <DocumentIcon size={size} className={className} />
    case 'link': return <LinkIcon size={size} className={className} />
    default: return <PhotoIcon size={size} className={className} />
  }
}

/** One glyph per investigative tool — reuses the shell's tactical icon set
 *  (stroke-only, currentColor) so the directory, tab bar and dropdown share
 *  one visual language with the rest of the portal. */
import type { ToolId } from '@/lib/toolsModel'
import {
  AccountIcon, DocumentIcon, EyeIcon, GangIcon, IndicatorIcon, NarcoticIcon,
  NetworkIcon, PersonIcon, PhotoIcon, PlaceIcon, RadioIcon, TraceIcon,
  VehicleIcon, WeaponIcon,
} from '@/components/shell/icons'

type IconComponent = (p: { size?: number; className?: string }) => React.ReactElement

const TOOL_ICONS: Record<ToolId, IconComponent> = {
  persons: PersonIcon,
  bolo: EyeIcon,
  gangs: GangIcon,
  places: PlaceIcon,
  vehicles: VehicleIcon,
  accounts: AccountIcon,
  indicators: IndicatorIcon,
  'field-review': RadioIcon,
  network: NetworkIcon,
  narcotics: NarcoticIcon,
  ballistics: WeaponIcon,
  modus: TraceIcon,
  media: PhotoIcon,
  records: DocumentIcon,
}

export function ToolIcon({ tool, size = 16, className }: { tool: ToolId; size?: number; className?: string }) {
  const Icon = TOOL_ICONS[tool]
  return <Icon size={size} className={className} />
}

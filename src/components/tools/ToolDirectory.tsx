'use client'

/** Tool directory — the workspace's home surface. Information-dense grid of
 *  the 14 tools grouped per TOOL_GROUPS, each card: icon, name, one-line
 *  description (PAGE_META sub), a live RLS-scoped count where one is useful,
 *  and an "Open" pill when the tool already has a tab (click focuses it).
 *  BOLO carries the board's rose urgency accent. Compact by design — no
 *  oversized cards, no gradients. */
import { PAGE_META, TAB_LABEL } from '@/lib/nav'
import { TOOL_GROUPS, type ToolId } from '@/lib/toolsModel'
import { PageHeader } from '@/components/ui/PageHeader'
import { ToolIcon } from './toolIcons'
import { useToolCounts, COUNTED_TOOLS } from './useToolCounts'

export interface ToolDirectoryProps {
  openKeys: ReadonlySet<ToolId>
  onOpen: (tool: ToolId) => void
}

export function ToolDirectory({ openKeys, onOpen }: ToolDirectoryProps) {
  const { counts, loading } = useToolCounts(true)

  return (
    <section className="view-in space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title={PAGE_META.tools.title}
        subtitle={PAGE_META.tools.sub}
      />
      {TOOL_GROUPS.map((group) => (
        <div key={group.id}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {group.label}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {group.tools.map((tool) => {
              const urgent = tool === 'bolo'
              const counted = COUNTED_TOOLS.includes(tool)
              const count = counts[tool]
              const isOpen = openKeys.has(tool)
              return (
                <button
                  key={tool}
                  onClick={() => onOpen(tool)}
                  className={`group flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
                    urgent
                      ? 'border-rose-500/20 bg-ink-900/60 hover:border-rose-500/40 hover:bg-rose-500/5'
                      : 'border-white/10 bg-ink-900/60 hover:border-white/20 hover:bg-white/5'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg ${
                      urgent ? 'bg-rose-500/15 text-rose-300' : 'bg-white/5 text-slate-300 group-hover:text-white'
                    }`}
                  >
                    <ToolIcon tool={tool} size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white">{TAB_LABEL[tool] ?? tool}</span>
                      {counted && count !== undefined && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                          urgent && count > 0 ? 'bg-rose-500/15 text-rose-300' : 'bg-white/10 text-slate-300'
                        }`}>
                          {count}
                        </span>
                      )}
                      {counted && count === undefined && loading && (
                        <span aria-hidden className="skel inline-block h-4 w-7 rounded-full bg-white/10" />
                      )}
                      {isOpen && (
                        <span className="ml-auto flex-shrink-0 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                          Open
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">{PAGE_META[tool]?.sub}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-400">
        Tools open as tabs above and stay loaded while you work — use the Directory chip to come back here without losing your place.
      </p>
    </section>
  )
}

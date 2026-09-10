'use client'

/** The `/workspace` page body (plan §5.5, §8.1): one tab strip over tools,
 *  tool records and cases. Tool and record panes are KEEP-ALIVE — every open
 *  one stays mounted (inactive ones display:none) so switching never reloads
 *  their data. Case panes are different: ONLY the active case tab is mounted;
 *  a suspended case keeps `{section, scroll}` in provider state and remounts
 *  on return (CaseDetail's own per-section keep-alive then takes over).
 *  With nothing active the directory shows: the tool directory plus a strip
 *  of the open cases. `/tools` renders this same view; the provider mirrors
 *  the URL to `/workspace` so old bookmarks keep landing. The Investigations
 *  leaves (`/intelligence`, `/registries`) render it with a `defaultTool`
 *  the provider opens when the URL names no case or tool. */
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'
import { desktopOnMobile, mobileCaseHref } from '@/components/mobile/mobileCaseRoute'
import { useNarrow } from '@/lib/useNarrow'
import { ToolDirectory } from '@/components/tools/ToolDirectory'
import { TOOL_LIST_COMPONENT, TOOL_RECORD_COMPONENT } from '@/components/tools/toolRegistry'
import { CaseWorkspaceTab } from '@/components/cases/CaseWorkspaceTab'
import { CaseIcon } from '@/components/shell/icons'
import type { ToolId } from '@/lib/toolsModel'
import { CASE_TAB_CAP, type WorkspaceTab } from '@/lib/workspace/model'
import { WorkspaceProvider } from './WorkspaceProvider'
import { WorkspaceTabBar } from './WorkspaceTabBar'
import { TabKeyContext, useWorkspace } from './WorkspaceContext'

export function WorkspaceView({ defaultTool }: { defaultTool?: ToolId } = {}) {
  // useSearchParams (the provider's URL intake) needs a client-side Suspense
  // boundary in this host — same idiom as CasesView / LegalView.
  return (
    <Suspense fallback={<ViewPlaceholder tab="workspace" />}>
      <WorkspaceProvider defaultTool={defaultTool}>
        <WorkspaceBody />
      </WorkspaceProvider>
    </Suspense>
  )
}

function WorkspaceBody() {
  const ws = useWorkspace()
  const router = useRouter()
  const narrow = useNarrow()
  // Phone-first case screen (P8-01): on a narrow viewport an ACTIVE case tab
  // hands over to `/m/cases/<id>?s=<section>` — unless this browser tab chose
  // the desktop ("Open on desktop" sets the session flag before navigating
  // here, so there is no bounce). The mobile route never redirects back on
  // its own, and each (case, section) pair fires at most once per mount.
  const activeCase = ws?.restored ? ws.tabs.find((t) => t.key === ws.activeKey && t.kind === 'case') ?? null : null
  const caseId = activeCase?.id ?? null
  const caseSection = activeCase?.section ?? null
  const handedOff = useRef<string | null>(null)
  useEffect(() => {
    if (!narrow || !caseId) return
    const key = `${caseId}:${caseSection ?? ''}`
    if (handedOff.current === key || desktopOnMobile()) return
    handedOff.current = key
    router.replace(mobileCaseHref(caseId, caseSection))
  }, [narrow, caseId, caseSection, router])
  if (!ws) return null
  const { tabs, activeKey } = ws

  return (
    <>
      <WorkspaceTabBar
        tabs={tabs}
        activeKey={activeKey}
        onActivate={ws.activate}
        onClose={ws.closeTab}
        onCloseOthers={ws.closeOthers}
        onCloseAll={ws.closeAll}
        onReorder={ws.reorder}
        onDirectory={ws.backToDirectory}
      />
      {!ws.restored ? null : (
        <>
          {activeKey === null && <Directory tabs={tabs} onOpenTool={ws.openTool} onActivate={ws.activate} />}
          {tabs.map((tab) => {
            const active = tab.key === activeKey
            if (tab.kind === 'case') {
              if (!active) return null // suspended: state lives in the provider
              return (
                <TabKeyContext.Provider key={tab.key} value={tab.key}>
                  <div className="tools-pane" data-state="active">
                    <CaseWorkspaceTab
                      caseId={tab.id}
                      section={tab.section ?? null}
                      onSectionChange={(s) => ws.setCaseSection(tab.id, s)}
                      onClose={() => ws.closeCase(tab.id)}
                    />
                  </div>
                </TabKeyContext.Provider>
              )
            }
            let content: React.ReactNode = null
            if (tab.kind === 'record' && tab.toolId) {
              const Record = TOOL_RECORD_COMPONENT[tab.toolId]
              if (Record) content = <Record id={tab.id} onBack={() => ws.closeTab(tab.key)} />
            } else if (tab.toolId) {
              const ListView = TOOL_LIST_COMPONENT[tab.toolId]
              content = <ListView />
            }
            return (
              <TabKeyContext.Provider key={tab.key} value={tab.key}>
                <div
                  className="tools-pane"
                  data-state={active ? 'active' : 'inactive'}
                  style={active ? undefined : { display: 'none' }}
                  aria-hidden={active ? undefined : true}
                >
                  {content}
                </div>
              </TabKeyContext.Provider>
            )
          })}
        </>
      )}
    </>
  )
}

function Directory({ tabs, onOpenTool, onActivate }: {
  tabs: readonly WorkspaceTab[]
  onOpenTool: (tool: ToolId) => void
  onActivate: (key: string) => void
}) {
  const openToolIds = useMemo(
    () => new Set<ToolId>(tabs.filter((t) => t.kind === 'tool' && t.toolId).map((t) => t.toolId as ToolId)),
    [tabs],
  )
  const cases = tabs.filter((t) => t.kind === 'case')
  return (
    <>
      {cases.length > 0 && (
        <section aria-labelledby="ws-open-cases" className="mb-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="ws-open-cases" className="text-[13px] font-semibold text-white">Open cases</h2>
            <span className="text-xs tabular-nums text-slate-400">{cases.length} of {CASE_TAB_CAP}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {cases.map((t) => (
              <button
                key={t.key}
                onClick={() => onActivate(t.key)}
                className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-ink-900/60 px-3 text-left transition hover:border-white/20 hover:bg-white/5"
              >
                <CaseIcon size={15} className="flex-shrink-0 text-slate-300" />
                <span className="font-mono text-xs font-semibold text-white">{t.title}</span>
                {t.section && <span className="text-xs text-slate-400">· {t.section}</span>}
                {t.dirty && <span aria-label="Unsaved changes" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />}
              </button>
            ))}
          </div>
        </section>
      )}
      <ToolDirectory openKeys={openToolIds} onOpen={onOpenTool} />
    </>
  )
}

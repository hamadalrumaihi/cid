'use client'

/** Long-tail views, code-split out of the shared [tab] page chunk. The page
 *  statically imports every view, so without this each rarely-visited screen
 *  (owner tooling, the handbook, chart-heavy analysis tabs) ships to EVERY
 *  route. next/dynamic with ssr off needs a client module — the page itself
 *  is a server component — so the dynamic wrappers live here and the page
 *  imports them by their original names (CaseDetail's CaseGraphTab pattern).
 *  Loading fallback is the same ViewPlaceholder the page already uses as its
 *  Suspense fallback, so the swap is invisible. Hot paths (command, cases,
 *  inbox, persons, gangs, …) stay statically imported in the page. */
import dynamic from 'next/dynamic'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'

const lazy = (tab: string, load: () => Promise<React.ComponentType>) =>
  dynamic(load, { ssr: false, loading: () => <ViewPlaceholder tab={tab} /> })

export const SiuView = lazy('siu', () => import('@/components/siu/SiuView').then((m) => m.SiuView))
export const AuditView = lazy('audit', () => import('@/components/audit/AuditView').then((m) => m.AuditView))
export const FeedbackView = lazy('feedback', () => import('@/components/feedback/FeedbackView').then((m) => m.FeedbackView))
export const ConcernView = lazy('concern', () => import('@/components/concern/ConcernView').then((m) => m.ConcernView))
export const RicoView = lazy('rico', () => import('@/components/rico/RicoView').then((m) => m.RicoView))
export const HeatmapView = lazy('heatmap', () => import('@/components/heatmap/HeatmapView').then((m) => m.HeatmapView))
export const DevDocsView = lazy('devdocs', () => import('@/components/devdocs/DevDocsView').then((m) => m.DevDocsView))
export const OwnerView = lazy('owner', () => import('@/components/owner/OwnerView').then((m) => m.OwnerView))
// The Investigative Tools workspace. The 14 tool views themselves are NOT
// imported here anymore — they live in the workspace's own lazy registry
// (components/tools/toolRegistry) so they aren't double-shipped; their old
// routes render ToolTabRedirect instead.
export const ToolsView = lazy('tools', () => import('@/components/tools/ToolsView').then((m) => m.ToolsView))

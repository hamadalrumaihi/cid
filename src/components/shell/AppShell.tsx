'use client'

/** App shell composition — sidebar + header + sub-tabs + mobile bottom bar
 *  around the active view, mirroring the vanilla #app-shell layout
 *  (index.html:59-165) and drawer behavior (core.js:935-945). */
import { useEffect, useState } from 'react'
import { Store } from '@/lib/store'
import { BottomNav } from './BottomNav'
import { ConnBanner } from './ConnBanner'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { Subtabs } from './Subtabs'
import { useNav } from './useNav'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { activeTab } = useNav()

  // Persist the last tab on EVERY route change — clicks, direct loads,
  // back/forward — matching vanilla navigate() (core.js:928), so the shared
  // Store('tab') stays two-way continuous with the legacy app.
  useEffect(() => {
    Store.set('tab', activeTab)
  }, [activeTab])

  // Desktop breakpoint: the sidebar is always visible (lg:translate-x-0), so
  // reset the mobile drawer state when crossing up (vanilla core.js:941-944).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setDrawerOpen(false) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Body scroll lock while the mobile drawer is open.
  useEffect(() => {
    document.body.classList.toggle('overflow-hidden', drawerOpen)
    document.body.classList.toggle('lg:overflow-auto', drawerOpen)
    return () => {
      document.body.classList.remove('overflow-hidden', 'lg:overflow-auto')
    }
  }, [drawerOpen])

  return (
    <div className="flex min-h-screen">
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink-950/70 backdrop-blur-sm lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <Sidebar drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
      <main className="grid-texture min-w-0 flex-1 lg:ml-64">
        <Header onOpenDrawer={() => setDrawerOpen(true)} />
        <Subtabs />
        <div className="p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8 lg:pb-8">{children}</div>
      </main>
      <BottomNav />
      <ConnBanner />
    </div>
  )
}

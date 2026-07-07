import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })

export const metadata: Metadata = {
  title: 'CID Portal — Criminal Investigation Division | State of San Andreas',
  description: 'CID Portal — case management for the San Andreas Criminal Investigations Division.',
  robots: { index: false, follow: false }, // restricted internal tool
  manifest: '/manifest.webmanifest', // installable PWA — deliberately NO service worker (hard rule #6)
}

export const viewport: Viewport = {
  themeColor: '#070b14',
  viewportFit: 'cover',
}

/* Pre-hydration device-pref applier (continuity hard rule #5): reads the SAME
 * `cid-portal-v3` blob the vanilla app writes and applies accent/density before
 * first paint, so a returning user keeps their theme with no flash. This is a
 * STATIC compile-time script (the one sanctioned dangerouslySetInnerHTML — never
 * user/DB data); localStorage values are allow-listed before touching the DOM
 * so a tampered blob cannot inject attribute values. Defaults mirror vanilla
 * applyAppearance(): accent 'amber', density 'comfortable'. */
const PREF_APPLIER = `(function(){try{
var d=JSON.parse(localStorage.getItem('cid-portal-v3')||'{}')||{};
var a=['blue','amber','emerald','rose'].indexOf(d.accent)>=0?d.accent:'amber';
var den=d.density==='compact'?'compact':'comfortable';
document.body.dataset.accent=a;
document.documentElement.dataset.density=den;
if(d.collapsed===true)document.body.classList.add('nav-collapsed');
}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${jetbrains.variable} font-sans antialiased selection:bg-blue-500/30`}
      >
        <script dangerouslySetInnerHTML={{ __html: PREF_APPLIER }} />
        {children}
      </body>
    </html>
  )
}

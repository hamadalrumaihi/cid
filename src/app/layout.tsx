import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })

export const metadata: Metadata = {
  title: 'CID Portal — Criminal Investigation Division | State of San Andreas',
  description: 'CID Portal — case management for the San Andreas Criminal Investigations Division.',
  robots: { index: false, follow: false }, // restricted internal tool
}

export const viewport: Viewport = {
  themeColor: '#070b14',
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrains.variable} font-sans antialiased`} data-accent="blue">
        {children}
      </body>
    </html>
  )
}

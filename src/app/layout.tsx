import { ClerkProvider } from '@clerk/nextjs'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Tipout Manager',
  description: 'Restaurant tipout calculation and management system',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <SpeedInsights />
      <html lang="en" className="h-full">
        <body className={`${inter.className} h-full bg-[var(--background)] text-[var(--foreground)]`}>
          <div className="min-h-full">
            {children}
          </div>
        </body>
      </html>
    </ClerkProvider>
  )
}

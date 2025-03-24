import './globals.css'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Tipout Manager',
  description: 'Restaurant tipout calculation and management system',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full bg-[var(--background)] text-[var(--foreground)]`}>
        <div className="min-h-full">
          {children}
        </div>
      </body>
    </html>
  )
}

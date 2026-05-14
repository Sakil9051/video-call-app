import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PeerConnect - Video Calling',
  description: 'Peer-to-peer video calling app',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
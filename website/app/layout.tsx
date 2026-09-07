import type { Metadata, Viewport } from 'next'

import './globals.css'

export const metadata: Metadata = {
  // Local by default; override with NEXT_PUBLIC_SITE_URL if you put this
  // behind a hostname on your own network.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  ),
  title: {
    default: 'FindClients',
    template: '%s · FindClients',
  },
  description:
    'A self-hosted lead finder for freelancers. It watches Upwork and Twitter for posts that match your keywords, scores them against your own criteria, and keeps everything on your machine.',
  applicationName: 'FindClients',
  openGraph: {
    type: 'website',
    siteName: 'FindClients',
    title: 'FindClients',
    description:
      'A self-hosted lead finder for freelancers. Watches Upwork and Twitter for work that matches your keywords — on your machine, with your own accounts.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FindClients',
    description:
      'A self-hosted lead finder for freelancers. Watches Upwork and Twitter for work that matches your keywords.',
  },
  // This runs on localhost against your own accounts and data. There is
  // nothing here a search engine should ever hold.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#232322',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        {/* The two faces used above the fold. Preloading them keeps the first
            paint from flashing the fallback stack. */}
        <link
          rel="preload"
          href="/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/instrument-sans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}

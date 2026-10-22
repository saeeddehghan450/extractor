import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'DevTools Extractor',
  description: 'Browser analysis dashboard: live session, interactive scraper, saved sessions, knowledge graph, storage and AI assistant',
  icons: { icon: '/favicon.svg' }
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Applies the saved theme and language before the first paint, so the page never flashes in the
// wrong theme or direction.
const BOOT = `(() => {
  try {
    const theme = localStorage.getItem('dx-theme');
    if (theme) document.documentElement.dataset.theme = theme;
    if (localStorage.getItem('dx-lang') === 'en') {
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
    }
  } catch {}
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { themeScript } from '@/lib/theme-script';
import { Providers } from './providers';
import './globals.css';

/** Switzer: the interface face, neutral and legible at small sizes. Self-hosted (CSP allows only our own origin). */
const switzer = localFont({
  src: [
    { path: '../fonts/Switzer-Variable.woff2', weight: '100 900', style: 'normal' },
    { path: '../fonts/Switzer-VariableItalic.woff2', weight: '100 900', style: 'italic' },
  ],
  variable: '--font-switzer',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Athena · Secure Examinations', template: '%s · Athena' },
  description: 'Author, deliver, proctor and grade examinations with integrity you can prove.',
  applicationName: 'Athena',
  appleWebApp: { title: 'Athena', statusBarStyle: 'default' },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#111113' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={switzer.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

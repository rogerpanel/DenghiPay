import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'MoraPay — send money home',
  description:
    'Cross-border remittances from Russia and Belarus to Nigeria and Ghana, with the exchange-rate margin shown separately from the fee.',
  manifest: '/manifest.webmanifest',
  applicationName: 'MoraPay',
  appleWebApp: { capable: true, title: 'MoraPay', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deliberately not maximum-scale=1: pinch-zoom is an accessibility feature,
  // and a remittance app has readers who need it.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#17150f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AdminProviders } from './providers';

export const metadata: Metadata = {
  title: 'MoraPay back office',
  description: 'Compliance, operations, treasury and reporting.',
  // A back office has no business being indexed, and staging is behind basic
  // auth on top of this (BUILD_PLAN 12.5).
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AdminProviders>{children}</AdminProviders>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://sha.best'),
  title: 'Shark{anty} — free anti-detect browser',
  description:
    'Free, open-source multi-profile anti-detect browser on the newest Chromium. Unlimited profiles, proxies and editable fingerprints. No account, no limits.',
  icons: { icon: '/logo.png' },
  openGraph: {
    title: 'Shark{anty}',
    description: 'Free anti-detect browser. Unlimited profiles, proxies and fingerprints. No account, no limits.',
    images: ['/logo.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0b0c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
